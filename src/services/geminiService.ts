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
Mirror punctuation. Ensure natural ${langName} flow in both parts. NEVER add quotation marks around the translations. Pay attention to noun genders when translating pronouns.`;

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
  let translation = (translationText || "").trim();
  if (!translation) return translation;

  // ── Mirror MID-TEXT punctuation from source to translation ──
  const srcTokens = source.match(/\S+/g) || [];
  const translTokens = translation.match(/\S+/g) || [];
  const maxIdx = Math.min(srcTokens.length, translTokens.length);

  for (let i = 0; i < maxIdx; i++) {
    const srcToken = srcTokens[i];
    const trailingPunct = srcToken.match(/[.!?,;:]+$/)?.[0] || '';
    if (trailingPunct) {
      const translToken = translTokens[i];
      if (!translToken.endsWith(trailingPunct)) {
        translTokens[i] = translToken.replace(/[.!?,;:]*$/, '') + trailingPunct;
      }
    }
  }
  translation = translTokens.join(' ');

  // ── Mirror ENDING punctuation ──
  const sourceEndsWithComma = /,\s*$/.test(source);
  const sourceEndsWithTerminal = /[.!?]\s*$/.test(source);
  const sourceEndingPunctuation = source.match(/[.!?,]\s*$/)?.[0]?.trim() || "";

  let normalized = translation;

  if (!sourceEndsWithTerminal && !sourceEndsWithComma) {
    normalized = normalized.replace(/[.!?,;:]+\s*$/, "");
  } else if (sourceEndingPunctuation) {
    normalized = normalized.replace(/[.!?,;:]+\s*$/, "");
    normalized = `${normalized}${sourceEndingPunctuation}`;
  }

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
CRITICAL: Use natural, idiomatic ${langName}. Mirror punctuation exactly. NEVER add quotation marks around the translation. Pay attention to noun genders when translating pronouns (e.g., "it" referring to "the world"/"o mundo" → "ele", not "ela"). Return ONLY the translation string.`;

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
  const systemPrompt = `You are a world-class linguistic expert. Your goal is to break the following text into study-friendly blocks for a language learning app.

### CRITICAL RULES (TOTAL FIDELITY & SEMANTIC ALIGNMENT):
1. **100% WORD COVERAGE**: Use EVERY word from the input exactly once.
2. **NO CROSSING RULE (MANDATORY)**: A translated word MUST stay with its English source in the SAME segment pair. If ${langName} requires an inverted word order (e.g., "simple way" → "forma simples"), DO NOT split them. MOVE the English words to the next segment if necessary, OR keep them together in the current segment.
3. **NATURAL ${langName.toUpperCase()} (CRITICAL — AVOID LITERALISM)**: Translate into natural, idiomatic ${langName} as a native speaker would write it. Avoid literal word-for-word translations that sound awkward. Prefer:
    - Contracted/merged verb forms: "governá-lo" instead of "governar sobre ele", "usá-la" instead of "usar ela"
    - Natural word order for ${langName}, not mirroring English syntax
    - Common ${langName} expressions over direct English calques
    - Example: "rule over it" → "governá-lo" (NOT "governar sobre ele")
    - Example: "we watch God create" → "vemos Deus criar" (NOT "nós vemos Deus criar")
    - Example: "on His behalf" → "em Seu nome" (NOT "em Seu lugar")
4. **ADJUST ENGLISH BREAKS**: You have full authority to move English words between segments to ensure the translation is not split.
5. **SIZE LIMITS (CRITICAL — PREFER SHORTER SEGMENTS)**: 4 to 12 words per segment. PREFER segments closer to 8-10 words. NEVER exceed 15 words. Break long segments at natural connectors.
6. **SPLIT AT NATURAL CONNECTORS**: When a sentence has a natural break (comma, "and", "but", "or", "so", "however", "with", "because", "which"), split it into two segments at that point. This makes the lesson easier to study.
   - Example: "Genres are a unique style of communicating, with certain ones being more effective..." → 
     - Seg 1: "Genres are a unique style of communicating," / "Gêneros são um estilo único de comunicação,"
     - Seg 2: "with certain ones being more effective..." / "sendo alguns mais eficazes..."
   - Example: "So a lot of these images come from the last book of the Bible, but to understand them, you have to go back to the first book." →
     - Seg 1: "So a lot of these images come from the last book of the Bible," / "Então muitas dessas imagens vêm do último livro da Bíblia,"
     - Seg 2: "but to understand them, you have to go back to the first book." / "mas para entendê-las, você tem que voltar ao primeiro livro."
7. **MIRROR PUNCTUATION**: Mirror the punctuation of the English text EXACTLY in the ${langName} translation for each segment.
8. **NO QUOTATION MARKS**: Never add quotation marks (") around text. If the original transcription has no quotes, the output must also have no quotes. Never open a quote without closing it.
9. **CORRECT PRONOUN GENDER IN ${langName.toUpperCase()}**: Pay close attention to the gender of nouns when translating pronouns. **Trace back to find the noun that the pronoun refers to**, identify its gender in ${langName}, and match the pronoun consistently. Examples:
   - "the world (o mundo, masculine) → rule over **it**" → "governar sobre **ele**" (NOT "ela")
   - "the story (a história, feminine) → read **it**" → "ler **ela**" (NOT "ele")
   - "God gave humans power to rule over **it**" ("it" = world/mundo/masculine) → "governar sobre **ele**"
10. **CAPITALIZE DIVINE PRONOUNS**: When English pronouns ("he", "him", "his", "you", "your", "me", "my") refer to God, Jesus, or the Holy Spirit, they MUST be capitalized ("He", "Him", "His", "You", "Your", "Me", "My"). This is a standard English reverence convention. For example: "...God created the world, and then he gave humans power..." → "...God created the world, and then He gave humans power..."

### ⚠️ NEVER DO THIS (WORD CROSSING VIOLATION):
- Seg 1 English: "truth spoken in a simple" → Seg 1 ${langName}: "verdade dita de forma" ❌
- Seg 2 English: "way can reach every heart." → Seg 2 ${langName}: "simples pode alcançar cada coração." ❌
- **PROBLEM**: "simples" (translation of "simple") is in Seg 2, but "simple" is in Seg 1. The words crossed segments!

### ✅ ALWAYS DO THIS (Option A — keep phrase together in Seg 1):
- Seg 1 English: "truth spoken in a simple way" → Seg 1 ${langName}: "verdade dita de forma simples" ✅
- Seg 2 English: "can reach every heart." → Seg 2 ${langName}: "pode alcançar cada coração." ✅

### ✅ ALWAYS DO THIS (Option B — keep phrase together in Seg 2):
- Seg 1 English: "truth spoken" → Seg 1 ${langName}: "verdade dita" ✅
- Seg 2 English: "in a simple way can reach every heart." → Seg 2 ${langName}: "de forma simples pode alcançar cada coração." ✅

### KEY INSIGHT: 
Every word in the English segment and EVERY word in the ${langName} segment must be a DIRECT 1:1 match. If a ${langName} phrase translates an English phrase, BOTH must be in the SAME segment. Adjust the English boundary to make this work.

### EXAMPLE OF PERFECT ALIGNMENT:
- Input: "and see how the Bible is divinely inspired literature that leads us to Jesus."
- RIGHT (Semantic Break):
  - English: "and see how the Bible"
  - Translation: "e veja como a Bíblia"
  - English: "is divinely inspired literature that leads us to Jesus."
  - Translation: "é literatura divinamente inspirada que nos leva a Jesus."

### EXAMPLE OF CORRECT SEGMENTATION:
- Input: "The Bible is an intricate work of art that tells one unified story that leads to Jesus. But it isn't like any book you've ever read."
- WRONG (Fragmented):
  - "The Bible is an intricate work of art that tells one unified story that leads" (Translation: ...que leva)
  - "to Jesus." (Translation: a Jesus) -> WRONG: Dangling preposition.
- RIGHT (Semantic):
  - "The Bible is an intricate work of art that tells one unified story" (Translation: A Bíblia é uma obra de arte intrincada que conta uma história unificada)
  - "that leads to Jesus. But it isn't like any book you've ever read." (Translation: que leva a Jesus. Mas não é como nenhum livro que você já leu.)

### EXAMPLE OF REPETITION FIX:
- Input: "children's book is another. Each genre..."
- WRONG: "is another." and then "another. Each genre..." -> WRONG: "another" repeated.
- RIGHT: "children's book is another." and then "Each genre has separate techniques..."

Return exactly a JSON array of objects. Fields: text, translation.`;

  const userPrompt = `Text: "${text}"

Process this text following all the rules above and return ONLY a JSON array of { text, translation } objects.`;

  try {
    const resultText = await callDeepSeekChat(
      [{ role: "user", content: systemPrompt + "\n\n" + userPrompt }],
      apiKey,
      { type: "json_object" },
      8192
    );

    let parsed = JSON.parse(resultText);
    let segments = Array.isArray(parsed) ? parsed : (parsed.segments || parsed.data || parsed.transcript || []);

    if (!segments || segments.length === 0) {
      throw new Error("O DeepSeek não retornou nenhum segmento.");
    }

    // Post-process: merge small segments and fix broken boundaries (same logic as remedySegments)
    const result: { text: string, translation: string }[] = [];
    for (let i = 0; i < segments.length; i++) {
      const current = segments[i];
      const wordCount = current.text.trim().split(/\s+/).filter((w: string) => w.length > 0).length;
      const isLast = i === segments.length - 1;
      const isSpecialIsolate = /^(goodbye|hello|so let's get started|amen|thank you|welcome)$/i.test(current.text.trim().replace(/[^a-z]/g, ""));
      let shouldMerge = (wordCount < 4 || (wordCount === 1 && !isLast)) && !isSpecialIsolate;

      if (result.length > 0 && !shouldMerge) {
        const prev = result[result.length - 1];
        const prevText = prev.text.trim().toLowerCase();
        const currText = current.text.trim().toLowerCase();

        const engLastWord = prevText.split(/\s+/).filter((w: string) => w.length > 0).pop() || "";
        const englishDanglingEnd = new Set(["in","on","at","to","for","with","by","from","of","about","into","through","during","before","after","above","below","between","under","without","against","within","along","across","behind","beyond","around","upon","onto","toward","towards","via","since","until","beside","besides","among","amid","a","an","the","that","which","because","while","although","though","unless","if","when","where","whether","is","are","was","were","has","have","had","does","do","did","will","would","shall","should","can","could","may","might","must","leads"]);
        const endsWithDanglingEnglish = englishDanglingEnd.has(engLastWord);

        const englishContinuationStart = ["to ","the ","a ","an ","and ","but ","or ","so ","because ","that ","which ","in ","on ","at ","for ","with ","by ","from ","of ","about ","is ","are ","was ","were ","has ","have ","it ","he ","she ","they ","we ","you ","this ","that ","as ","if ","when ","while ","although ","another ","some ","any ","each ","every ","into ","through ","during ","without "];
        const startsWithContinuationEnglish = englishContinuationStart.some(prefix => currText.startsWith(prefix));

        // ─── Intentional break connectors — these are GOOD split points ───
        const intentionalBreakPrefixes = ["but ", "and ", "or ", "so ", "because "];
        const isIntentionalBreak = wordCount >= 4 && intentionalBreakPrefixes.some(p => currText.startsWith(p));

        if (!isIntentionalBreak && (endsWithDanglingEnglish || startsWithContinuationEnglish)) {
          shouldMerge = true;
        }
      }

      if (shouldMerge && result.length > 0) {
        const prev = result[result.length - 1];
        prev.text = (prev.text.trim() + " " + current.text.trim()).trim();
        let t1 = (prev.translation || "").trim();
        let t2 = (current.translation || "").trim();
        if (t1.endsWith(".") && t2.length > 0 && !/^[A-Z]/.test(t2)) {
          t1 = t1.slice(0, -1);
        }
        prev.translation = (t1 + " " + t2).trim();
      } else if (current.text.trim().length > 0) {
        result.push({ text: current.text, translation: current.translation });
      }
    }

    // Normalize punctuation for every segment
    return result.map(segment => ({
      ...segment,
      translation: normalizeTranslationPunctuationBySource(segment.text, segment.translation || "")
    }));
  } catch (error: any) {
    console.error("generateLessonSegments failed:", error);
    throw new Error(`Falha ao gerar segmentos: ${error.message}`);
  }
}
