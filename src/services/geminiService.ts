import { Flashcard } from "../types";
import { callDeepSeekChat } from "./deepseekService";

// Este projeto evita explicitamente o uso de modelos Gemini 3.1 Pro para reduzir custos.

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  de: 'German',
  fr: 'French',
  el: 'Greek',
  he: 'Hebrew',
  pt: 'Portuguese'
};

function getLanguageName(code: string): string {
  return LANGUAGE_NAMES[code] || 'Portuguese';
}

export interface SplitTranslationResult {
  translationA: string;
  translationB: string;
}export async function smartSplitTranslation(
  originalEnglish: string,
  originalTranslation: string,
  englishA: string,
  englishB: string,
  nativeLanguage: string,
  customApiKey?: string,
  hasBillingEnabled?: boolean
): Promise<SplitTranslationResult> {
  const apiKey = customApiKey || localStorage.getItem("deepseek_api_key") || "";

  try {
    const langName = getLanguageName(nativeLanguage);
    const prompt = `Split this ${langName} translation into two parts to match the English.
Original English: "${originalEnglish}"
Original Translation: "${originalTranslation}"
Part 1 English: "${englishA}"
Part 2 English: "${englishB}"

CRITICAL: Return ONLY a MINIFIED JSON object: { "translationA": string, "translationB": string }. 
Mirror punctuation. Ensure natural ${langName} flow in both parts.`;

    const resultText = await callDeepSeekChat(
      [{ role: "user", content: prompt }],
      apiKey,
      { type: "json_object" }
    );

    const result = JSON.parse(resultText);
    return {
      translationA: normalizeTranslationPunctuationBySource(englishA, result.translationA || ""),
      translationB: normalizeTranslationPunctuationBySource(englishB, result.translationB || "")
    } as SplitTranslationResult;
  } catch (error: any) {
    console.error("Error splitting translation with DeepSeek:", error);
    // Fallback: simple character-based split
    const ratio = englishA.length / (englishA.length + englishB.length);
    const splitIdx = Math.floor(originalTranslation.length * ratio);
    return {
      translationA: originalTranslation.slice(0, splitIdx).trim(),
      translationB: originalTranslation.slice(splitIdx).trim(),
    };
  }
}

function normalizeTranslationPunctuationBySource(sourceText: string, translationText: string): string {
  const source = (sourceText || "").trim();
  const translation = (translationText || "").trim();
  if (!translation) return translation;

  const sourceEndsWithComma = /,\s*$/.test(source);
  const sourceEndsWithTerminal = /[.!?]\s*$/.test(source);
  const sourceEndingPunctuation = source.match(/[.!?,]\s*$/)?.[0]?.trim() || "";

  let normalized = translation;

  // If source has no terminal punctuation, avoid introducing hard stop at the end.
  if (!sourceEndsWithTerminal && !sourceEndsWithComma) {
    normalized = normalized.replace(/[.!?,;:]+\s*$/, "");
  } else if (sourceEndingPunctuation) {
    normalized = normalized.replace(/[.!?,;:]+\s*$/, "");
    normalized = `${normalized}${sourceEndingPunctuation}`;
  }

  // If source ends with comma, avoid period immediately before final clause in translation.
  if (sourceEndsWithComma) {
    normalized = normalized.replace(/([a-zA-ZÀ-ÿ0-9])\.\s+([A-ZÀ-Ý])/g, "$1, $2");
  }

  return normalized;
}

export async function smartAlignSegmentTranslation(
  englishText: string,
  currentTranslation: string,
  wholeEnglishTranscript: string,
  nativeLanguage: string,
  customApiKey?: string,
  hasBillingEnabled?: boolean
): Promise<string> {
  const apiKey = customApiKey || localStorage.getItem("deepseek_api_key") || "";

  try {
    const langName = getLanguageName(nativeLanguage);
    const prompt = `Refine translation for this edited segment. Match tone/context.
English: "${englishText}"
Current: "${currentTranslation}"
Context: "${wholeEnglishTranscript.slice(0, 1000)}"
CRITICAL: Use natural, idiomatic ${langName}. Mirror punctuation exactly. Return ONLY the translation string.`;

    const resultText = await callDeepSeekChat(
      [{ role: "user", content: prompt }],
      apiKey
    );

    const cleanedText = resultText.trim().replace(/^["']+|["']+$/g, '');
    return normalizeTranslationPunctuationBySource(englishText, cleanedText);
  } catch (error: any) {
    console.error("Error aligning translation with DeepSeek:", error);
    return currentTranslation;
  }
}

export async function extractLessonFlashcards(
  fullTranscript: string,
  nativeLanguage: string,
  customApiKey?: string,
  hasBillingEnabled?: boolean
): Promise<Flashcard[]> {
  const apiKey = customApiKey || localStorage.getItem("deepseek_api_key") || "";

  // Extract unique words locally
  const uniqueWordsMap = new Map<string, string>();
  const words: string[] = fullTranscript.match(/\b[a-zA-Z']+\b/g) || [];
  words.forEach(w => {
    let cleaned = w.trim();
    if (cleaned.startsWith("'") && cleaned.length > 1) cleaned = cleaned.substring(1);
    if (cleaned.endsWith("'") && cleaned.length > 1) cleaned = cleaned.substring(0, cleaned.length - 1);
    
    const lower = cleaned.toLowerCase();
    if (lower.length === 1 && lower !== 'i' && lower !== 'a') return;
    
    if (cleaned.length > 0) {
      if (!uniqueWordsMap.has(lower) || (cleaned !== lower && uniqueWordsMap.get(lower) === lower)) {
        uniqueWordsMap.set(lower, cleaned);
      }
    }
  });

  const wordsArray = Array.from(uniqueWordsMap.values());
  const wordsList = wordsArray.join(', ');

  try {
    const langName = getLanguageName(nativeLanguage);
    const prompt = `Create a glossary for these English words based on the context.
Context: "${fullTranscript.slice(0, 2000)}"
Words: ${wordsList}

Rules:
- explain apostrophes (possession vs contraction).
- Proper nouns capitalized (Jesus, God, Lord, etc).
- Others lowercase.
- Translation: Use natural, common ${langName} terms.
- Explanation: Provide a brief explanation in ${langName} about usage, grammar or context.
- CRITICAL: Use ONLY standard UTF-8 characters. NEVER replace accented letters with numbers or symbols (e.g., use "Preposição" NOT "Preposi'3o", use "através" NOT "atrav1s"). 
- Ensure all Portuguese accents (á, é, í, ó, ú, â, ê, ô, ã, õ, ç) are correctly rendered.
- Return MINIFIED JSON array: expression, translation, explanation.`;

    const resultText = await callDeepSeekChat(
      [{ role: "user", content: prompt }],
      apiKey,
      { type: "json_object" }
    );

    const items = JSON.parse(resultText);
    const flashcardsArray = Array.isArray(items) ? items : (items.flashcards || items.data || []);

    return flashcardsArray.map((item: any, idx: number) => {
      // Post-process to fix common DeepSeek encoding hallucinations in Portuguese
      let translation = item.translation || "";
      let explanation = item.explanation || "";

      const fixEncoding = (text: string) => {
        return text
          .replace(/Preposi'3o/g, "Preposição")
          .replace(/atrav1s/g, "através")
          .replace(/'3o\b/g, "ção")
          .replace(/'3/g, "çã")
          .replace(/1s\b/g, "és");
      };

      return {
        ...item,
        translation: fixEncoding(translation),
        explanation: fixEncoding(explanation),
        id: `fc-${idx}-${Date.now()}`
      };
    });
  } catch (error: any) {
    console.error("Error extracting flashcards with DeepSeek:", error);
    return [];
  }
}

let sharedAudioContext: AudioContext | null = null;

export function ensureAudioContext() {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    sharedAudioContext = new AudioContextClass();
  }
  if (sharedAudioContext.state === 'suspended') {
    sharedAudioContext.resume().catch(e => console.warn("AudioContext resume failed:", e));
  }
  return sharedAudioContext;
}

export async function playPcmBase64(audioData: string, sampleRate: number = 24000) {
  const ctx = ensureAudioContext();
  if (ctx.state !== 'running') {
    try {
      await ctx.resume();
    } catch (e) {
      console.warn("Failed to resume AudioContext:", e);
    }
  }

  const playAudioElement = async (src: string) => {
    return new Promise<void>((resolve, reject) => {
      const audio = new Audio(src);
      audio.onloadedmetadata = () => {
        if (audio.duration === 0 || isNaN(audio.duration)) {
          reject(new Error("Invalid audio duration"));
        }
      };
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("Audio element playback failed"));
      audio.play().catch(reject);
    });
  };

  console.log("playPcmBase64 called, audioData length:", audioData.length);
  console.log("playPcmBase64 first 100 chars:", audioData.substring(0, 100));

  // Check if audio data is empty
  let binaryStr;
  if (audioData.startsWith('data:')) {
    binaryStr = atob(audioData.split(',')[1]);
  } else {
    binaryStr = atob(audioData);
  }
  const len = binaryStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  if (bytes.every(b => b === 0)) {
    throw new Error("Audio data is empty");
  }

  // First, try to decode using decodeAudioData
  try {
    const audioBuffer = await ctx.decodeAudioData(bytes.buffer);
    console.log("decodeAudioData succeeded:", audioBuffer);
    
    // Check if audio is empty
    if (audioBuffer.duration === 0 || bytes.every(b => b === 0)) {
      throw new Error("Audio buffer is empty or invalid");
    }
    
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    source.start();
    console.log("decodeAudioData succeeded!");
    return;
  } catch (err) {
    console.warn("decodeAudioData failed, trying other methods:", err);
  }

  // Handle legacy saved wav files and ensure cross-platform playback
  if (audioData.startsWith('data:audio')) {
    try {
      const base64Str = audioData.split(',')[1];
      let binStr = atob(base64Str);
      
      if (binStr.substring(0, 4) === 'RIFF') {
        binStr = binStr.slice(44);
        audioData = btoa(binStr); // Proceed to raw PCM block
      } else {
        const audioBuffer = await ctx.decodeAudioData(new Uint8Array(binStr.length).map((_, i) => binStr.charCodeAt(i)).buffer);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.start();
        return;
      }
    } catch (err) {
      console.warn("Could not decode data URI audio, falling back:", err);
    }
  }

  // Common compressed audio signatures:
  const isId3Mp3 = len >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
  const isMp3Frame = len >= 2 && bytes[0] === 0xFF && (bytes[1] === 0xFB || bytes[1] === 0xF3 || bytes[1] === 0xF2);
  const isRiff = len >= 4 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;

  if (isId3Mp3 || isMp3Frame || isRiff) {
    try {
      const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.start();
      return;
    } catch (err) {
      console.warn("Known container decode failed, trying Audio element:", err);
      const mimeType = isRiff ? 'audio/wav' : 'audio/mpeg';
      try {
        await playAudioElement(`data:${mimeType};base64,${audioData}`);
        return;
      } catch (e) {}
    }
  }

  // Handle raw 16-bit PCM by wrapping it in a WAV header
  try {
    const dataLength = bytes.length;
    const header = new Uint8Array(44);
    const view = new DataView(header.buffer);
    
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // Byte rate
    view.setUint16(32, 2, true); // Block align
    view.setUint16(34, 16, true); // Bits per sample
    writeString(36, 'data');
    view.setUint32(40, dataLength, true);

    const wavBlob = new Blob([header, bytes], { type: 'audio/wav' });
    const wavUrl = URL.createObjectURL(wavBlob);
    
    try {
      await playAudioElement(wavUrl);
    } finally {
      URL.revokeObjectURL(wavUrl);
    }
    return;
  } catch (err) {
    console.error("WAV wrapped playback failed:", err);
  }

  // Final fallback to manual Web Audio API buffer if WAV wrapping failed
  const float32Data = new Float32Array(len / 2);
  const dataView = new DataView(bytes.buffer);
  for (let i = 0; i < len / 2; i++) {
    float32Data[i] = dataView.getInt16(i * 2, true) / 32768;
  }
  const audioBuffer = ctx.createBuffer(1, float32Data.length, sampleRate);
  audioBuffer.getChannelData(0).set(float32Data);
  
  return new Promise<void>((resolve) => {
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    const timeout = setTimeout(resolve, 10000);
    source.onended = () => {
      clearTimeout(timeout);
      resolve();
    };
    source.start();
  });
}

export function isQuotaError(error: any): boolean {
  if (!error) return false;
  
  if (error?.status === 429 || error?.code === 429) return true;
  if (error?.status === "RESOURCE_EXHAUSTED" || error?.error?.status === "RESOURCE_EXHAUSTED") return true;

  let msg = "";
  if (typeof error === 'string') {
    msg = error;
  } else if (error instanceof Error) {
    msg = error.message;
    try { msg += " " + JSON.stringify(error); } catch(e){}
  } else if (typeof error === 'object') {
    try { msg = JSON.stringify(error); } catch(e) { msg = String(error); }
  } else {
    msg = String(error);
  }
  
  msg = msg.toLowerCase();
  return msg.includes("429") || msg.includes("quota") || msg.includes("resource_exhausted");
}

export async function requestTtsAudio(
  text: string,
  voiceName: string
): Promise<string | undefined> {
  const workerUrl = localStorage.getItem("lingosync_tts_worker_url") || "";
  const googleCloudApiKey = localStorage.getItem("lingosync_google_cloud_api_key") || "";
  
  if (!workerUrl && !googleCloudApiKey) {
    console.warn("Nenhuma configuração de TTS encontrada (Worker URL ou API Key).");
    throw new Error("TTS_CONFIG_MISSING");
  }

  console.log("requestTtsAudio called with:", { text, voiceName, mode: workerUrl ? "Worker" : "Direct" });
  
  try {
    const url = workerUrl || `https://texttospeech.googleapis.com/v1/text:synthesize?key=${googleCloudApiKey}`;
    
    const body = workerUrl 
      ? { text, voice: voiceName, languageCode: voiceName.substring(0, 5) }
      : {
          input: { text },
          voice: {
            languageCode: voiceName.substring(0, 5),
            name: voiceName
          },
          audioConfig: {
            audioEncoding: "MP3"
          }
        };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.audioContent;
  } catch (error) {
    console.error("requestTtsAudio error:", error);
    throw error;
  }
}

export async function generateExpressionAudio(
  text: string,
  voiceName: string = 'en-US-Neural2-A'
): Promise<string> {
  try {
    // Sanitize text: remove dashes, unusual quotes, and excessive whitespace
    const cleaned = text
      .replace(/[–—""'']/g, " ")
      .replace(/\s+/g, " ")
      .trim();
      
    if (!cleaned) throw new Error("O texto para narração está vazio.");

    const safeText = cleaned.charAt(0).toUpperCase() + cleaned.slice(1) + (cleaned.match(/[.?!]$/) ? "" : ".");
    
    console.log("generateExpressionAudio text:", safeText);
    const base64Audio = await requestTtsAudio(safeText, voiceName);

    if (base64Audio) {
      // Check for silent audio (all zeros)
      const binaryStr = atob(base64Audio);
      const bytes = new Uint8Array(binaryStr.length);
      let allZeros = true;
      for (let i = 0; i < binaryStr.length; i++) {
        const b = binaryStr.charCodeAt(i);
        bytes[i] = b;
        if (b !== 0) {
          allZeros = false;
          break;
        }
      }

      if (allZeros) {
        console.error("Worker returned silent audio (all zeros).");
        throw new Error("A narração gerada está silenciosa. Tente novamente.");
      }

      console.log("generateExpressionAudio returning base64Audio, length:", base64Audio.length);
      return base64Audio;
    }

    throw new Error("Não foi possível gerar o áudio da narração.");
  } catch (error: any) {
    console.error("Error generating audio with TTS Worker:", error);
    throw error;
  }
}

export async function generateLessonSegments(
  title: string,
  text: string,
  nativeLanguage: string,
  customApiKey?: string,
  hasBillingEnabled?: boolean
): Promise<{ text: string, translation: string }[]> {
  const apiKey = customApiKey || localStorage.getItem("deepseek_api_key") || "";
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("DeepSeek API Key não configurada.");
  }

  const langName = getLanguageName(nativeLanguage);
  const prompt = `Break the following text into logical segments for a lesson.
Prioritize natural pauses, punctuation, conjunctions, and clauses to make the segments flow well and make sense.
Segments should be a good size for learning—not too short and not excessively long.
For each segment, provide the English text and its corresponding ${langName} translation.

CRITICAL: Mirror the punctuation of the English text EXACTLY in the ${langName} translation for each segment.

Text: "${text}"

Return exactly a JSON array of objects. Fields: text, translation.`;

  const resultText = await callDeepSeekChat(
    [{ role: "user", content: prompt }],
    apiKey,
    { type: "json_object" }
  );

  return JSON.parse(resultText);
}
