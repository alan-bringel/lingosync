import { TranscriptSegment } from "../types";

const ASSEMBLYAI_BASE = "https://api.assemblyai.com/v2";

// ─── Upload ────────────────────────────────────────────────────────────────────
async function uploadAudio(audioBlob: Blob, apiKey: string): Promise<string> {
  const response = await fetch(`${ASSEMBLYAI_BASE}/upload`, {
    method: "POST",
    headers: {
      authorization: apiKey,
      "content-type": "application/octet-stream",
    },
    body: audioBlob,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`AssemblyAI upload falhou (${response.status}): ${text}`);
  }

  const data = await response.json();
  if (!data.upload_url) {
    throw new Error("AssemblyAI não retornou uma URL de upload válida.");
  }
  return data.upload_url as string;
}

// ─── Create transcript job ─────────────────────────────────────────────────────
async function createTranscript(uploadUrl: string, apiKey: string): Promise<string> {
  const response = await fetch(`${ASSEMBLYAI_BASE}/transcript`, {
    method: "POST",
    headers: {
      authorization: apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      audio_url: uploadUrl,
      speech_models: ["universal-3-pro", "universal-2"],
      language_detection: true,
      punctuate: true,
      format_text: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`AssemblyAI criação de transcrição falhou (${response.status}): ${text}`);
  }

  const data = await response.json();
  if (!data.id) {
    throw new Error("AssemblyAI não retornou um ID de transcrição.");
  }
  return data.id as string;
}

// ─── Poll until done ──────────────────────────────────────────────────────────
interface AssemblyWord {
  text: string;
  start: number; // ms
  end: number;   // ms
  confidence: number;
}

interface AssemblyTranscriptResult {
  status: "queued" | "processing" | "completed" | "error";
  text?: string;
  words?: AssemblyWord[];
  error?: string;
}

async function pollTranscript(id: string, apiKey: string): Promise<AssemblyTranscriptResult> {
  const MAX_ATTEMPTS = 120; // 4 minutes (2s interval)
  
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));

    const response = await fetch(`${ASSEMBLYAI_BASE}/transcript/${id}`, {
      headers: { authorization: apiKey },
    });

    if (!response.ok) {
      throw new Error(`AssemblyAI polling falhou (${response.status}): ${response.statusText}`);
    }

    const data: AssemblyTranscriptResult = await response.json();

    if (data.status === "completed") return data;
    if (data.status === "error") {
      throw new Error(`AssemblyAI reportou erro: ${data.error || "desconhecido"}`);
    }
    // status === "queued" | "processing" → continue polling
  }

  throw new Error("Tempo de espera da transcrição AssemblyAI esgotado. Tente novamente.");
}

// ─── Convert AssemblyAI words → loose chunks for Gemini to re-segment ────────
/**
 * Groups words into large, loose chunks based only on significant silences (≥ 2.5s)
 * or max word count. Gemini will re-segment these into proper study segments.
 */
function buildLooseChunks(words: AssemblyWord[]): Omit<TranscriptSegment, "translation">[] {
  if (!words || words.length === 0) return [];

  const LONG_SILENCE_MS = 2500; // Only break on meaningful pauses
  const MAX_WORDS_PER_CHUNK = 60; // Keep chunks manageable for Gemini

  const chunks: Omit<TranscriptSegment, "translation">[] = [];
  let currentWords: AssemblyWord[] = [];

  const flush = () => {
    if (currentWords.length === 0) return;
    const segWords = currentWords.map((w) => ({
      text: w.text,
      start: w.start / 1000,
      end: w.end / 1000,
    }));
    chunks.push({
      text: currentWords.map((w) => w.text).join(" "),
      start: currentWords[0].start / 1000,
      end: currentWords[currentWords.length - 1].end / 1000 + 0.3,
      words: segWords,
    });
    currentWords = [];
  };

  for (let i = 0; i < words.length; i++) {
    currentWords.push(words[i]);

    const silenceToNext =
      i + 1 < words.length ? words[i + 1].start - words[i].end : Infinity;
    const reachedMax = currentWords.length >= MAX_WORDS_PER_CHUNK;

    if (silenceToNext > LONG_SILENCE_MS || reachedMax) {
      flush();
    }
  }
  flush();

  return chunks;
}

// ─── Public API ───────────────────────────────────────────────────────────────
/**
 * Transcribes audio using AssemblyAI and returns segments WITHOUT translation.
 * Translation must be added by a subsequent step (Gemini).
 */
export async function transcribeAudioAssemblyAI(
  audioBlob: Blob,
  apiKey: string
): Promise<Omit<TranscriptSegment, "translation">[]> {
  if (!apiKey || apiKey.trim() === "") {
    throw new Error(
      "AssemblyAI API Key não configurada. Configure-a nas Configurações do app."
    );
  }

  // 1. Upload
  const uploadUrl = await uploadAudio(audioBlob, apiKey.trim());

  // 2. Create job
  const transcriptId = await createTranscript(uploadUrl, apiKey.trim());

  // 3. Poll until complete
  const result = await pollTranscript(transcriptId, apiKey.trim());

  if (!result.words || result.words.length === 0) {
    throw new Error(
      "A AssemblyAI processou o áudio, mas nenhuma palavra foi detectada. Verifique se o áudio contém voz em inglês."
    );
  }

  // 4. Group into loose chunks
  return buildLooseChunks(result.words);
}
