import { AudioTrack } from "../types";

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
  private tokenClient: any = null;
  private accessToken: string | null = null;
  private tokenExpiresAt: number | null = null;
  private _userInfo: GoogleUserInfo | null = null;

  get userInfo(): GoogleUserInfo | null {
    return this._userInfo;
  }

  private getRequiredScopesHash(): string {
    return SCOPES.split(" ").sort().join(" ");
  }

  constructor() {
    this.accessToken = localStorage.getItem("google_drive_access_token");
    this.tokenExpiresAt = localStorage.getItem("google_drive_token_expires_at")
      ? Number(localStorage.getItem("google_drive_token_expires_at"))
      : null;
  }

  async initialize(clientId: string) {
    if (typeof window !== "undefined" && (window as any).google?.accounts?.oauth2) {
      this.setupTokenClient(clientId);
      return;
    }
    return new Promise<void>((resolve) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.onload = () => {
        this.setupTokenClient(clientId);
        resolve();
      };
      document.head.appendChild(script);
    });
  }

  private setupTokenClient(clientId: string) {
    this.tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (response: any) => {
        if (response.error) {
          console.error("Google Auth Error:", response.error);
          return;
        }
        this.setTokens(response);
      },
    });
  }

  private setTokens(response: any) {
    this.accessToken = response.access_token;
    this.tokenExpiresAt = Date.now() + (response.expires_in || 3600) * 1000;
    localStorage.setItem("google_drive_access_token", response.access_token);
    localStorage.setItem("google_drive_token_expires_at", String(this.tokenExpiresAt));
    localStorage.setItem("google_drive_scopes", this.getRequiredScopesHash());
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
    return new Promise<void>((resolve, reject) => {
      if (!this.tokenClient) {
        reject(new Error("Google OAuth not initialized"));
        return;
      }
      this.tokenClient.callback = async (response: any) => {
        if (response.error) {
          reject(new Error(response.error));
          return;
        }
        const grantedScopes = (response.scope || "").split(" ");
        if (!grantedScopes.includes("https://www.googleapis.com/auth/drive.appdata")) {
          reject(new Error(
            "Escopo drive.appdata não foi autorizado. Verifique se adicionou " +
            "'https://www.googleapis.com/auth/drive.appdata' na tela de consentimento " +
            "OAuth do Google Cloud Console (APIs & Services > OAuth consent screen > Scopes) " +
            "e que o app está publicado."
          ));
          return;
        }
        this.setTokens(response);
        const userInfo = await this.getUserInfo();
        if (!userInfo) {
          reject(new Error("Failed to fetch user info"));
          return;
        }
        resolve();
      };
      this.tokenClient.requestAccessToken({ prompt: "consent" });
    });
  }

  async trySilentLogin() {
    if (!this.accessToken) return false;
    if (this.tokenExpiresAt && Date.now() > this.tokenExpiresAt) {
      this.logout();
      return false;
    }
    const storedScopes = localStorage.getItem("google_drive_scopes");
    if (storedScopes !== this.getRequiredScopesHash()) {
      this.logout();
      return false;
    }
    const userInfo = await this.getUserInfo();
    if (!userInfo) {
      this.logout();
      return false;
    }
    this._userInfo = userInfo;
    return true;
  }

  logout() {
    this.accessToken = null;
    this.tokenExpiresAt = null;
    this._userInfo = null;
    localStorage.removeItem("google_drive_access_token");
    localStorage.removeItem("google_drive_token_expires_at");
    localStorage.removeItem("google_drive_scopes");
  }

  isLoggedIn() {
    if (!this.accessToken) return false;
    const storedScopes = localStorage.getItem("google_drive_scopes");
    if (storedScopes !== this.getRequiredScopesHash()) {
      this.logout();
      return false;
    }
    if (this.tokenExpiresAt && Date.now() > this.tokenExpiresAt) {
      this.logout();
      return false;
    }
    return true;
  }

  getAccessToken() {
    if (this.tokenExpiresAt && Date.now() > this.tokenExpiresAt) {
      this.logout();
      return null;
    }
    return this.accessToken;
  }

  private async fetchDrive(url: string, options: RequestInit = {}) {
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
      console.error("Google Drive API error:", msg, "| URL:", url.split("?")[0]);
      throw new Error(msg);
    }

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || "Google Drive API Error");
    }

    return response.json();
  }

  async uploadFile(name: string, content: Blob | string, mimeType: string, existingFileId?: string): Promise<string> {
    const isUpdate = !!existingFileId;
    const metadata: any = {
      name,
      mimeType,
    };

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
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: form,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || "Upload failed");
    }

    const data = await response.json();
    return data.id;
  }

  async deleteFile(fileId: string) {
    if (!this.accessToken) throw new Error("Not logged in to Google Drive");

    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    // DELETE returns 204 No Content (empty body) on success
    if (response.status === 401 || response.status === 403) {
      const errorBody = await response.json().catch(() => ({}));
      const msg = errorBody.error?.message || `HTTP ${response.status}`;
      throw new Error(msg);
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `Google Drive API Error: HTTP ${response.status}`);
    }
  }

  async downloadFile(fileId: string, onProgress?: (progress: number) => void): Promise<Blob> {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    if (!response.ok) throw new Error("Download failed");

    if (!onProgress || !response.body) {
      return response.blob();
    }

    const contentLength = response.headers.get("Content-Length");
    const total = contentLength ? parseInt(contentLength, 10) : 0;

    if (!total) {
      return response.blob();
    }

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
  }

  async listFiles(): Promise<GoogleDriveFile[]> {
    const query = `'appDataFolder' in parents and trashed = false`;
    const data = await this.fetchDrive(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${encodeURIComponent(query)}&fields=files(id, name, mimeType)`);
    return data.files || [];
  }
}

export const googleDriveService = new GoogleDriveService();
