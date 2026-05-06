const DEEPSEEK_BASE = "https://api.deepseek.com";

export async function callDeepSeekChat(
  messages: { role: string; content: string }[],
  apiKey: string,
  responseFormat?: { type: string },
  maxTokens: number = 4096
) {
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("DeepSeek API Key não configurada.");
  }

  const response = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey.trim()}`,
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache"
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages,
      temperature: 0.1,
      max_tokens: 8192,
      user: `lingosync_${Date.now()}` // Bypass server cache
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const message = errorData.error?.message || response.statusText;
    throw new Error(`Erro na API do DeepSeek (${response.status}): ${message}`);
  }

  const data = await response.json();
  console.log("[DeepSeek API Response]", data);
  
  // For Reasoner, content might be in choices[0].message.content
  // but some providers might use different paths.
  return data.choices?.[0]?.message?.content || "";
}
