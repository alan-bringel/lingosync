const DEEPSEEK_BASE = "https://api.deepseek.com";

export async function callDeepSeekChat(
  messages: { role: string; content: string }[],
  apiKey: string,
  responseFormat?: { type: string },
  maxTokens: number = 8192
) {
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("DeepSeek API Key não configurada.");
  }

  const MAX_RETRIES = 3;
  let lastError: any = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000); // 120s timeout

      const response = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey.trim()}`,
          "Content-Type": "application/json",
          "Cache-Control": "no-cache"
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages,
          temperature: 0.1,
          max_tokens: maxTokens,
          response_format: responseFormat,
          user: `lingosync_${Date.now()}`
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Erro na API do DeepSeek (${response.status}): ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "";
      
      if (!content.trim() && attempt < MAX_RETRIES) {
        console.warn(`[DeepSeek] Resposta vazia na tentativa ${attempt}. Tentando novamente...`);
        continue;
      }

      return content;
    } catch (error: any) {
      lastError = error;
      if (attempt < MAX_RETRIES) {
        console.warn(`[DeepSeek] Tentativa ${attempt} falhou: ${error.message}. Tentando novamente...`);
        await new Promise(r => setTimeout(r, 2000 * attempt)); // Exponential backoff
        continue;
      }
    }
  }

  throw lastError || new Error("Falha ao comunicar com DeepSeek após várias tentativas.");
}
