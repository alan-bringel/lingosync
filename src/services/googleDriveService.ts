const SCOPES = "openid profile email https://www.googleapis.com/auth/drive.appdata";

export interface GoogleUserInfo {
  name: string;
  picture: string;
  email: string;
}

export interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
}

class GoogleDriveService {
  private clientId: string = "";
  private clientSecret: string = "";
  private tokenClient: any = null;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiresAt: number | null = null;
  private _userInfo: GoogleUserInfo | null = null;
  private refreshIntervalId: ReturnType<typeof setInterval> | null = null;

  get userInfo(): GoogleUserInfo | null {
    return this._userInfo;
  }

  constructor() {
    this.accessToken = localStorage.getItem("google_drive_access_token");
    this.refreshToken = localStorage.getItem("google_drive_refresh_token");
    this.tokenExpiresAt = localStorage.getItem("google_drive_token_expires_at")
      ? Number(localStorage.getItem("google_drive_token_expires_at"))
      : null;
  }

  async initialize(clientId: string, clientSecret?: string) {
    this.clientId = clientId;
    if (clientSecret) this.clientSecret = clientSecret;
    if (typeof window !== "undefined" && (window as any).google?.accounts?.oauth2) {
      return;
    }
    return new Promise<void>((resolve, reject) => {
      const existingScript = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
      if (existingScript) {
        const checkLoaded = () => {
          if ((window as any).google?.accounts?.oauth2) {
            resolve();
          } else {
            setTimeout(checkLoaded, 100);
          }
        };
        checkLoaded();
        return;
      }
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Falha ao carregar a biblioteca Google Identity Services"));
      document.head.appendChild(script);
    });
  }

  private saveTokens(accessToken: string, expiresIn: number, refreshToken?: string) {
    this.accessToken = accessToken;
    this.tokenExpiresAt = Date.now() + expiresIn * 1000;
    localStorage.setItem("google_drive_access_token", accessToken);
    localStorage.setItem("google_drive_token_expires_at", String(this.tokenExpiresAt));
    if (refreshToken) {
      this.refreshToken = refreshToken;
      localStorage.setItem("google_drive_refresh_token", refreshToken);
    }
  }

  private clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiresAt = null;
    this._userInfo = null;
    localStorage.removeItem("google_drive_access_token");
    localStorage.removeItem("google_drive_refresh_token");
    localStorage.removeItem("google_drive_token_expires_at");
  }

  async exchangeRefreshToken(): Promise<boolean> {
    if (!this.clientId || !this.refreshToken) return false;

    try {
      const params: Record<string, string> = {
        client_id: this.clientId,
        refresh_token: this.refreshToken,
        grant_type: "refresh_token",
      };
      if (this.clientSecret) {
        params.client_secret = this.clientSecret;
      }

      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params),
      });

      if (!response.ok) {
        console.error("Refresh token exchange failed:", response.status);
        return false;
      }

      const data = await response.json();
      if (data.access_token) {
        this.saveTokens(data.access_token, data.expires_in || 3600);
        return true;
      }
      return false;
    } catch (e) {
      console.error("Refresh token exchange threw:", e);
      return false;
    }
  }

  async getUserInfo() {
    if (!this.accessToken) return null;
    try {
      const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
      if (!response.ok) return null;
      const data = await response.json();
      this._userInfo = {
        name: data.name,
        picture: data.picture,
        email: data.email,
      };
      return this._userInfo;
    } catch {
      return null;
    }
  }

  async login() {
    if (!this.clientId) {
      throw new Error("Google OAuth não iniciado. Chame initialize() primeiro.");
    }

    // === PASSO 1: initTokenClient (Implicit Grant) — sempre funciona em SPA ===
    const tokenResponse = await new Promise<any>((resolve, reject) => {
      const client = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: SCOPES,
        callback: (response: any) => {
          if (response.error) {
            reject(new Error(response.error));
            return;
          }
          if (!response.access_token) {
            reject(new Error("Nenhum token de acesso retornado"));
            return;
          }
          resolve(response);
        },
      });
      client.requestAccessToken();
    });

    this.saveTokens(tokenResponse.access_token, tokenResponse.expires_in || 3600);
    this.tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: this.clientId,
      scope: SCOPES,
      callback: () => {},
    });

    const userInfo = await this.getUserInfo();
    if (!userInfo) {
      this.clearTokens();
      throw new Error("Falha ao obter informações do usuário");
    }
    this._userInfo = userInfo;

    // === PASSO 2: initCodeClient (Authorization Code) — tenta capturar refresh_token ===
    // Como o usuário acabou de interagir, o popup não será bloqueado.
    // Usamos prompt: "none" pois o usuário já consentiu no passo 1.
    this.tryCaptureRefreshToken();

    this.startPeriodicRefresh();
  }

  private async tryCaptureRefreshToken() {
    try {
      const codeResponse = await new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timeout")), 15000);
        const codeClient = (window as any).google.accounts.oauth2.initCodeClient({
          client_id: this.clientId,
          scope: SCOPES,
          access_type: "offline",
          prompt: "none",
          redirect_uri: "postmessage",
          callback: (response: any) => {
            clearTimeout(timer);
            if (response.error) {
              reject(new Error(response.error));
              return;
            }
            resolve(response);
          },
        });
        codeClient.requestCode();
      });

      if (codeResponse.refresh_token) {
        this.refreshToken = codeResponse.refresh_token;
        localStorage.setItem("google_drive_refresh_token", codeResponse.refresh_token);
      }
    } catch {
      // Não conseguir refresh_token não é fatal — initTokenClient já funciona
    }
  }

  async trySilentLogin() {
    if (!this.accessToken && !this.refreshToken) return false;

    // 1. Try existing access_token if still valid
    if (this.accessToken && this.tokenExpiresAt && Date.now() < this.tokenExpiresAt) {
      const userInfo = await this.getUserInfo();
      if (userInfo) {
        this._userInfo = userInfo;
        this.tokenClient = (window as any).google?.accounts?.oauth2?.initTokenClient({
          client_id: this.clientId,
          scope: SCOPES,
          callback: () => {},
        });
        this.startPeriodicRefresh();
        return true;
      }
    }

    // 2. Try refresh_token exchange via REST endpoint (no popup, never blocked)
    if (this.refreshToken) {
      const exchanged = await this.exchangeRefreshToken();
      if (exchanged) {
        const userInfo = await this.getUserInfo();
        if (userInfo) {
          this._userInfo = userInfo;
          this.tokenClient = (window as any).google?.accounts?.oauth2?.initTokenClient({
            client_id: this.clientId,
            scope: SCOPES,
            callback: () => {},
          });
          this.startPeriodicRefresh();
          return true;
        }
      }
    }

    this.clearTokens();
    this.stopPeriodicRefresh();
    return false;
  }

  logout() {
    this.stopPeriodicRefresh();
    this.clearTokens();
    this.tokenClient = null;
  }

  isLoggedIn() {
    if (this._userInfo && this.accessToken) return true;
    if (!this.accessToken && !this.refreshToken) return false;
    if (this.accessToken && this.tokenExpiresAt && Date.now() <= this.tokenExpiresAt) {
      return true;
    }
    if (this.refreshToken) {
      return true;
    }
    return false;
  }

  startPeriodicRefresh(intervalMinutes: number = 25) {
    this.stopPeriodicRefresh();
    this.refreshIntervalId = setInterval(async () => {
      const isNearExpiry = this.tokenExpiresAt && Date.now() > this.tokenExpiresAt - 5 * 60 * 1000;
      if (!isNearExpiry) return;

      if (this.refreshToken) {
        await this.exchangeRefreshToken();
      }
    }, intervalMinutes * 60 * 1000);
  }

  stopPeriodicRefresh() {
    if (this.refreshIntervalId !== null) {
      clearInterval(this.refreshIntervalId);
      this.refreshIntervalId = null;
    }
  }

  getAccessToken() {
    if (this.accessToken && this.tokenExpiresAt && Date.now() > this.tokenExpiresAt) {
      return null;
    }
    return this.accessToken;
  }

  async refreshTokenSilently(): Promise<boolean> {
    if (this.refreshToken) {
      const exchanged = await this.exchangeRefreshToken();
      if (exchanged) return true;
    }
    this.clearTokens();
    return false;
  }

  private async executeWithRefresh<T>(fn: () => Promise<T>, hasRetried = false): Promise<T> {
    try {
      return await fn();
    } catch (error: any) {
      const msg = error?.message || String(error);
      const isAuthError = msg.includes("401") || msg.includes("403") ||
        msg.includes("invalid authentication credentials") ||
        msg.includes("Invalid Credentials") ||
        msg.includes("Request had invalid authentication");
      if (isAuthError && !hasRetried) {
        const refreshed = await this.refreshTokenSilently();
        if (refreshed && this.accessToken) {
          return await fn();
        }
        this.clearTokens();
        throw new Error("Sessão do Google expirada. Faça login novamente.");
      }
      throw error;
    }
  }

  private async fetchDrive(url: string, options: RequestInit = {}) {
    return this.executeWithRefresh(async () => {
      if (!this.accessToken) throw new Error("Not logged in to Google Drive");

      const response = await fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          Authorization: `Bearer ${this.accessToken}`,
        },
      });

      if (response.status === 401 || response.status === 403) {
        const errorBody = await response.json().catch(() => ({}));
        const msg = errorBody.error?.message || `HTTP ${response.status}`;
        throw new Error(msg);
      }

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || "Google Drive API Error");
      }

      return response.json();
    });
  }

  async uploadFile(name: string, content: Blob | string, mimeType: string, existingFileId?: string): Promise<string> {
    return this.executeWithRefresh(async () => {
      if (!this.accessToken) throw new Error("Not logged in to Google Drive");

      const isUpdate = !!existingFileId;
      const metadata: any = { name, mimeType };
      if (!isUpdate) {
        metadata.parents = ["appDataFolder"];
      }

      const form = new FormData();
      form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
      form.append("file", typeof content === "string" ? new Blob([content], { type: mimeType }) : content);

      const url = existingFileId
        ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
        : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";

      const response = await fetch(url, {
        method: existingFileId ? "PATCH" : "POST",
        headers: { Authorization: `Bearer ${this.accessToken}` },
        body: form,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || "Upload failed");
      }

      const data = await response.json();
      return data.id;
    });
  }

  async deleteFile(fileId: string) {
    return this.executeWithRefresh(async () => {
      if (!this.accessToken) throw new Error("Not logged in to Google Drive");

      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });

      if (response.status === 401 || response.status === 403) {
        const errorBody = await response.json().catch(() => ({}));
        const msg = errorBody.error?.message || `HTTP ${response.status}`;
        throw new Error(msg);
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `Google Drive API Error: HTTP ${response.status}`);
      }
    });
  }

  async downloadFile(fileId: string, onProgress?: (progress: number) => void): Promise<Blob> {
    return this.executeWithRefresh(async () => {
      if (!this.accessToken) throw new Error("Not logged in to Google Drive");

      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });

      if (!response.ok) throw new Error("Download failed");

      if (!onProgress || !response.body) {
        return response.blob();
      }

      const contentLength = response.headers.get("Content-Length");
      const total = contentLength ? parseInt(contentLength, 10) : 0;

      if (!total) return response.blob();

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        onProgress(Math.round((received / total) * 100));
      }

      return new Blob(chunks as BlobPart[]);
    });
  }

  async listFiles(): Promise<GoogleDriveFile[]> {
    const query = `'appDataFolder' in parents and trashed = false`;
    const data = await this.fetchDrive(
      `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${encodeURIComponent(query)}&fields=files(id, name, mimeType)`
    );
    return data.files || [];
  }
}

export const googleDriveService = new GoogleDriveService();
