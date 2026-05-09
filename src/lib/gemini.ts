import { GoogleGenAI, Type } from "@google/genai";
import { TranscriptSegment } from "../types";
import { transcribeAudioAssemblyAI } from "../services/assemblyAiService";
import { callDeepSeekChat } from "../services/deepseekService";

import { isQuotaError } from "../services/geminiService";
import { withRateLimit } from "./rateLimitWrapper";

const GEMINI_CORE_MODEL = "gemini-flash-latest";
const GEMINI_TTS_MODEL = "gemini-3.1-flash-tts-preview";
const DISALLOWED_GEMINI_PRO_MODELS = [
  "gemini-3.1-pro",
  "gemini-3.1-pro-preview",
  "gemini-3.1-pro-tts-preview",
];

function assertNonProGeminiModel(model: string) {
  if (DISALLOWED_GEMINI_PRO_MODELS.some(disallowed => model.includes(disallowed))) {
    throw new Error("Uso de modelo Gemini 3.1 Pro não é permitido.");
  }
}

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

/**
 * Robustly fixes common AI segmentation errors like:
 * 1. Fragments under 5 words (merges them)
 * 2. Word repetitions at boundaries (removes them)
 * 3. Dangling prepositions or broken thoughts in English AND translation
 */
export function remedySegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  if (segments.length <= 1) return segments;

  const result: TranscriptSegment[] = [];
  
  for (let i = 0; i < segments.length; i++) {
    let current = { ...segments[i] };
    
    const isLastSegment = i === segments.length - 1;
    const wordCount = current.text.trim().split(/\s+/).filter(w => w.length > 0).length;
    const isSpecialIsolate = /^(goodbye|hello|so let's get started|amen|thank you|welcome)$/i.test(current.text.trim().replace(/[^a-z]/g, ""));
    
    // Rule: NO Small segments in the middle of a lesson.
    let shouldMerge = (wordCount < 4 || (wordCount === 1 && !isLastSegment)) && !isSpecialIsolate; 
    
    if (result.length > 0 && !shouldMerge) {
      const prev = result[result.length - 1];
      const prevText = prev.text.trim().toLowerCase();
      const currText = current.text.trim().toLowerCase();
      const prevTrans = (prev.translation || "").trim().toLowerCase();
      const currTrans = (current.translation || "").trim().toLowerCase();
      
      // ─── English dangling-end patterns ───
      // Words that should NOT normally be the last word of a segment
      const engLastWord = prevText.split(/\s+/).filter(w => w.length > 0).pop() || "";
      
      const englishDanglingEnd = new Set([
        // Prepositions (strong signal of bad break)
        "in", "on", "at", "to", "for", "with", "by", "from", "of", "about",
        "into", "through", "during", "before", "after", "above", "below",
        "between", "under", "without", "against", "within", "along", "across",
        "behind", "beyond", "around", "upon", "onto", "toward", "towards",
        "via", "since", "until", "beside", "besides", "among", "amid",
        // Articles
        "a", "an", "the",
        // Subordinating conjunctions that suggest continuation
        "that", "which", "because", "while", "although", "though", "unless",
        "if", "when", "where", "whether",
        // Auxiliary verbs (dangling - need complement)
        "is", "are", "was", "were", "has", "have", "had",
        "does", "do", "did", "will", "would", "shall", "should",
        "can", "could", "may", "might", "must",
        "leads",
      ]);
      
      const endsWithDanglingEnglish = englishDanglingEnd.has(engLastWord);
      
      // ─── English continuation-start patterns ───
      const englishContinuationStart = [
        "to ", "the ", "a ", "an ",
        "and ", "but ", "or ", "so ", "because ",
        "that ", "which ", "in ", "on ", "at ", "for ", "with ", "by ", "from ",
        "of ", "about ", "is ", "are ", "was ", "were ", "has ", "have ",
        "it ", "he ", "she ", "they ", "we ", "you ", "this ", "that ",
        "as ", "if ", "when ", "while ", "although ",
        "another ", "some ", "any ", "each ", "every ",
        "into ", "through ", "during ", "without ",
      ];
      
      const startsWithContinuationEnglish = englishContinuationStart.some(prefix => currText.startsWith(prefix));
      
      // ─── Portuguese dangling-end patterns ───
      const porLastWord = prevTrans.split(/\s+/).filter(w => w.length > 0).pop() || "";
      
      const portugueseDanglingEnd = new Set([
        // Articles
        "o", "a", "os", "as", "um", "uma", "uns", "umas",
        // Prepositions and contractions
        "de", "da", "do", "das", "dos", "dum", "duma",
        "em", "no", "na", "nos", "nas", "num", "numa",
        "por", "para", "com", "sem", "sob", "sobre", "entre", "após",
        "até", "contra", "perante", "trás", "desde",
        // Conjunctions
        "que", "mas", "porque", "pois", "como", "se", "embora",
        // Relative pronouns
        "cujo", "cuja", "cujos", "cujas",
        // Verb forms that need completion
        "leva", "levam", "levar", "faz", "fazem", "fazer",
        "tem", "têm", "ter", "é", "são", "era", "eram", "foi", "foram",
        "será", "serão", "seja", "sejam",
        // Prepositional phrase starters
        "forma", "maneira", "modo",
        // Quantifiers
        "cada", "algum", "alguma", "alguns", "algumas",
        "nenhum", "nenhuma", "todo", "toda", "todos", "todas",
        "muito", "muita", "muitos", "muitas", "pouco", "pouca",
        "vários", "várias",
        // Contractions
        "deste", "desta", "destes", "destas",
        "nesse", "nessa", "nesses", "nessas", "neste", "nesta",
        "desse", "dessa", "desses", "dessas",
        "daquele", "daquela", "daqueles", "daquelas",
        "naquele", "naquela", "naqueles", "naquelas",
        "àquele", "àquela", "àqueles", "àquelas",
        "noutro", "noutra", "noutros", "noutras",
      ]);
      
      const endsWithDanglingPortuguese = portugueseDanglingEnd.has(porLastWord);
      
      // ─── Portuguese continuation-start patterns ───
      const portugueseContinuationStart = [
        "que ", "e ", "mas ", "porque ", "pois ", "como ", "se ",
        "o ", "a ", "os ", "as ", "um ", "uma ",
        "de ", "da ", "do ", "das ", "dos ",
        "em ", "no ", "na ", "nos ", "nas ",
        "para ", "com ", "por ", "sem ", "sob ", "sobre ",
        "é ", "são ", "era ", "foi ", "será ",
        "ele ", "ela ", "eles ", "elas ", "você ", "nós ",
        "isto ", "isso ", "aquele ", "aquela ",
        "também ", "ainda ", "já ", "só ", "apenas ",
        "leva ", "faz ", "tem ",
        "há ", "existe ", "existem ",
        "este ", "esta ", "esse ", "essa ",
        "forma ", "maneira ", "modo ",
      ];
      
      const startsWithContinuationPortuguese = portugueseContinuationStart.some(prefix => currTrans.startsWith(prefix));
      
      // Merge if ANY indicator suggests a broken segment boundary
      if (endsWithDanglingEnglish || endsWithDanglingPortuguese || 
          startsWithContinuationEnglish || startsWithContinuationPortuguese) {
        shouldMerge = true;
      }
    }

    if (shouldMerge && result.length > 0) {
      const prev = result[result.length - 1];
      console.log(`[LingoSync] FORÇANDO FUSÃO: Merging "${current.text}" into previous segment.`);
      
      if (current.text.length > 0) {
        prev.text = (prev.text.trim() + " " + current.text.trim()).trim();
      }
      
      // Merge translation
      let t1 = prev.translation?.trim() || "";
      let t2 = current.translation?.trim() || "";
      if (t1.endsWith(".") && t2.length > 0 && !/^[A-Z]/.test(t2)) {
        t1 = t1.slice(0, -1);
      }
      if (t2.length > 0) {
        prev.translation = (t1 + " " + t2).trim();
      }
      
      prev.end = current.end;
    } else if (current.text.trim().length > 0) {
      result.push(current);
    }
  }

  // 3. Final refinement: Subtract 0.5s from the end of each segment to prevent "word bleeding"
  const buffer = 0.5;
  const remedied = result.map((segment) => {
    return {
      ...segment,
      start: Math.max(0, segment.start - buffer),
      end: Math.max(segment.start, segment.end - buffer)
    };
  });

  return remedied;
}

function normalizeWordsForComparison(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .match(/[a-z']+/g) || [];
}

function canUseRefinedEnglishText(original: string, refined: string): boolean {
  const originalWords = normalizeWordsForComparison(original);
  const refinedWords = normalizeWordsForComparison(refined);
  if (originalWords.length !== refinedWords.length) return false;
  for (let i = 0; i < originalWords.length; i++) {
    if (originalWords[i] !== refinedWords[i]) return false;
  }
  return true;
}

/**
 * Transcribes audio using AssemblyAI (STT) then translates/formats with Gemini Flash.
 * AssemblyAI is mandatory — Gemini is NOT used for speech recognition.
 *
 * @param audioBlob    The raw audio/video file blob.
 * @param assemblyAiApiKey  AssemblyAI API key (required).
 * @param geminiApiKey      Gemini API key for translation/formatting (required).
 * @param hasBillingEnabled Whether the user has Gemini billing enabled.
 */
export async function transcribeAudio(
  audioBlob: Blob,
  nativeLanguage: string,
  assemblyAiApiKey: string,
  deepseekApiKey: string,
  hasBillingEnabled?: boolean
): Promise<TranscriptSegment[]> {
  if (!assemblyAiApiKey || assemblyAiApiKey.trim() === "") {
    throw new Error("AssemblyAI API Key não configurada.");
  }
  if (!deepseekApiKey || deepseekApiKey.trim() === "") {
    throw new Error("DeepSeek API Key não configurada.");
  }

  // ── Step 1: STT via AssemblyAI ───────────────────────────────────────────
  console.log("[transcribeAudio] Iniciando STT com AssemblyAI...");
  const rawSegments = await transcribeAudioAssemblyAI(audioBlob, assemblyAiApiKey);

  if (!rawSegments || rawSegments.length === 0) {
    throw new Error("A AssemblyAI não detectou voz no áudio.");
  }

  // ── Step 2: Translation + formatting via DeepSeek-V3 ──────────────────
  console.log(`[transcribeAudio] Inteligência (Tradução/Segmentação) via DeepSeek...`);
  const translated = await translateAndFormatWithDeepSeek(
    rawSegments as any[],
    nativeLanguage,
    deepseekApiKey
  );

  return translated;
}

/**
 * Uses DeepSeek-V3 (deepseek-chat) to translate and re-segment.
 */
export async function translateAndFormatWithDeepSeek(
  rawChunks: any[],
  nativeLanguage: string,
  apiKey: string
): Promise<TranscriptSegment[]> {
  // Extreme Optimization: Bare minimum tokens for input
  // We send a flat list of words. Groq (Llama 3) is smart enough to re-segment from words.
  const allWords = rawChunks.flatMap(c => c.words || []).map(w => ({
    t: w.text,
    s: Math.round((w.start || 0) * 100) / 100,
    e: Math.round((w.end || 0) * 100) / 100
  }));

  const langName = getLanguageName(nativeLanguage);
  const systemPrompt = `You are a world-class linguistic expert. Your goal is to re-segment a raw transcript into study-friendly blocks for a language learning app.
You must be as intelligent and context-aware as Gemini 1.5 Flash.

### CRITICAL RULES (TOTAL FIDELITY & SEMANTIC ALIGNMENT):
1. **100% WORD COVERAGE**: Use EVERY word from the input exactly once.
2. **NO CROSSING RULE (MANDATORY)**: A translated word MUST stay with its English source in the SAME segment pair. If ${langName} requires an inverted word order (e.g., "simple way" → "forma simples"), DO NOT split them. MOVE the English words to the next segment if necessary, OR keep them together in the current segment.
3. **NATURAL ${langName.toUpperCase()}**: Prioritize idiomatic, native-sounding ${langName}.
4. **ADJUST ENGLISH BREAKS**: You have full authority to move English words between segments to ensure the translation is not split.
5. **SIZE LIMITS**: 4 to 15 words per segment.
6. **FIX TRANSCRIPTION ERRORS**: AssemblyAI sometimes mishears words (e.g., "the" instead of "that", "it's" instead of "its", "to" instead of "too"). If a word is contextually illogical but phonetically similar to a correct word, you MUST fix the English text in your output to ensure the lesson makes sense.

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
- Input: "...and see how the Bible is divinely inspired literature that leads us to Jesus."
- RIGHT (Semantic Break):
  - English: "...and see how the Bible"
  - Translation: "...e veja como a Bíblia"
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
- Input: "...children's book is another. Each genre..."
- WRONG: "is another." and then "another. Each genre..." -> WRONG: "another" repeated.
- RIGHT: "...children's book is another." and then "Each genre has separate techniques..."

Output MINIFIED JSON array: [{ "text": string, "translation": string, "start": number, "end": number, "words": [{ "text": string, "start": number, "end": number }] }]`;

  try {
    const BATCH_SIZE = 250; // Reduced for stability on longer audio
    const wordBatches: any[][] = [];
    for (let i = 0; i < allWords.length; i += BATCH_SIZE) {
      wordBatches.push(allWords.slice(i, i + BATCH_SIZE));
    }

    console.log(`[DeepSeek] Processando ${allWords.length} palavras em ${wordBatches.length} lotes...`);
    const allSegments: TranscriptSegment[] = [];

    for (let i = 0; i < wordBatches.length; i++) {
      const batch = wordBatches[i];
      console.log(`[DeepSeek-R1] Processando lote ${i + 1}/${wordBatches.length}... (Aguardando raciocínio)`);
      const userPrompt = `Words Batch ${i + 1}/${wordBatches.length}: ${JSON.stringify(batch)}`;

      const fullUserPrompt = `${systemPrompt}\n\nNOW PROCESS THIS BATCH AND OUTPUT ONLY THE JSON ARRAY:\n${userPrompt}`;

      const resultText = await callDeepSeekChat(
        [
          { role: "user", content: fullUserPrompt }
        ],
        apiKey,
        { type: "text" },
        8192 
      );

      if (!resultText || resultText.trim() === "") {
        console.error(`[DeepSeek Error] Lote ${i + 1} retornou vazio.`);
        throw new Error("O DeepSeek retornou uma resposta vazia.");
      }

      // Extract JSON from markdown blocks if present
      let jsonText = resultText;
      const jsonMatch = resultText.match(/```json\n([\s\S]*?)\n```/) || resultText.match(/```([\s\S]*?)```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1].trim();
      }

      try {
        let parsed = JSON.parse(jsonText);
        const segments = Array.isArray(parsed) ? parsed : (parsed.segments || parsed.data || parsed.transcript || []);
        
        if (segments && segments.length > 0) {
          allSegments.push(...segments);
        }
      } catch (e) {
        console.error("[DeepSeek JSON Parse Error]", { resultText, jsonText });
        throw new Error("Erro ao processar a resposta da Inteligência. O formato retornado é inválido.");
      }
    }

    if (allSegments.length === 0) {
      throw new Error("O DeepSeek não retornou nenhum segmento processado.");
    }

    const cleaned = allSegments.map((segment: any) => {
      // Buffers: -0.1s at start, +0.5s at end
      const bufferedStart = Math.max(0, (segment.start || 0) - 0.1);
      const bufferedEnd = (segment.end || 0) + 0.5;

      return {
        ...segment,
        start: bufferedStart,
        end: bufferedEnd,
      };
    });

    console.log("[LingoSync] IA Bruta (DeepSeek):", cleaned.length, "segmentos.");
    const final = remedySegments(cleaned);
    console.log("[LingoSync] IA Limpa (Pós-Processada):", final.length, "segmentos.");
    return final;
  } catch (error: any) {
    console.error("DeepSeek Intelligence failed:", error);
    throw new Error(`Falha na inteligência do DeepSeek: ${error.message}`);
  }
}

export async function generateAudioFromText(text: string, voiceSample?: { data: string, mimeType: string }, customApiKey?: string, hasBillingEnabled?: boolean) {
  // Strict: Use only custom User Key
  const apiKey = customApiKey;
  if (!apiKey) throw new Error("API Key não configurada. Por favor, acesse as configurações e insira sua chave do Gemini.");

  return withRateLimit(
    {
      model: GEMINI_TTS_MODEL,
      apiKey,
      operationName: "Geração de Áudio",
      hasBillingEnabled,
    },
    async () => {
      const ai = new GoogleGenAI({ 
        apiKey,
        httpOptions: { apiVersion: "v1beta" }
      });
      const prompt = voiceSample 
        ? `Narrate the following text exactly in the voice style provided in the audio sample: "${text}"`
        : `Narrate the following text: "${text}"`;

      const contents = voiceSample 
        ? [
            { inlineData: { data: voiceSample.data, mimeType: voiceSample.mimeType } },
            { text: prompt }
          ]
        : [{ text: prompt }];

      try {
        const response = await ai.models.generateContent({
          model: GEMINI_TTS_MODEL,
          contents: [{ parts: contents }],
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Zephyr' }, // Default high-quality voice
              },
            },
          },
        });

        const candidate = response.candidates?.[0];
        const parts = candidate?.content?.parts || [];
        let base64Audio = undefined;
        for (const part of parts) {
          if (part.inlineData?.data) {
            base64Audio = part.inlineData.data;
            break;
          }
        }

        if (!base64Audio) {
          console.error("No audio returned. Full response:", JSON.stringify(response, null, 2));
          throw new Error(`No audio generated. Reason: ${candidate?.finishReason || 'Unknown'}. Check console for details.`);
        }

        return base64Audio;
      } catch (error: any) {
        if (isQuotaError(error)) throw new Error("QUOTA_EXCEEDED");
        throw error;
      }
    }
  );
}

export async function translateAndFormatWithGemini(rawChunks: any[], nativeLanguage: string, customApiKey?: string, hasBillingEnabled?: boolean): Promise<TranscriptSegment[]> {
  const apiKey = customApiKey;
  if (!apiKey) throw new Error("API Key não configurada. Por favor, acesse as configurações e insira sua chave do Gemini.");
  
  return withRateLimit(
    {
      model: GEMINI_CORE_MODEL,
      apiKey,
      operationName: "Tradução e Formatação",
      hasBillingEnabled,
    },
    async () => {
      const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1beta" } });
      
      // Optimization: Clean input to bare minimum tokens
      const compactChunks = rawChunks.map(chunk => ({
        t: chunk.text,
        w: (chunk.words || []).map((w: any) => ({ t: w.text, s: w.start, e: w.end }))
      }));

      const langName = getLanguageName(nativeLanguage);
      const prompt = `Translate and re-segment this AssemblyAI transcript into logical study segments (5-15 words).
Output must be a MINIFIED JSON array of objects.

RULES:
- Segments: 5-15 words.
- Isolates: "So let's get started", "Let's dive in", or "Goodbye" must be their own segments.
- Semantic Breaks: Break at logical endings or conjunctions (and, but, so, because).
- Avoid tiny segments: Never 1-3 words unless it's an isolate phrase mentioned above.
- Timestamps: Match start/end to word timings.
- Translation: ${langName}. Match punctuation style.
- words array: Include timings.
- Order: Preserve sequence.

Input:
${JSON.stringify(compactChunks)}`;

      try {
        assertNonProGeminiModel(GEMINI_CORE_MODEL);
        const response = await ai.models.generateContent({
          model: GEMINI_CORE_MODEL,
          contents: [{ parts: [{ text: prompt }] }],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: { type: Type.STRING },
                  translation: { type: Type.STRING },
                  start: { type: Type.NUMBER },
                  end: { type: Type.NUMBER },
                  words: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        text: { type: Type.STRING },
                        start: { type: Type.NUMBER },
                        end: { type: Type.NUMBER },
                      },
                      required: ["text", "start", "end"],
                    },
                  },
                },
                required: ["text", "translation", "start", "end", "words"],
              },
            },
          },
        });

        if (!response.text) throw new Error("Translation failed.");
        let cleanText = response.text.replace(/```json/g, "").replace(/```/g, "").trim();
        const translated = JSON.parse(cleanText) as TranscriptSegment[];
        return translated.map((segment) => {
          // Buffers: -0.1s at start to catch the first syllable, +0.5s at end for natural decay
          const bufferedStart = Math.max(0, (segment.start || 0) - 0.1);
          const bufferedEnd = (segment.end || 0) + 0.5;

          return {
            ...segment,
            start: bufferedStart,
            end: bufferedEnd,
            translation: normalizeTranslationPunctuationBySource(segment.text, segment.translation || "")
          };
        });
      } catch (error: any) {
        if (isQuotaError(error)) throw new Error("QUOTA_EXCEEDED");
        console.error("Translation logic failed:", error);
        // Expose API key errors clearly instead of swallowing them
        const msg: string = error?.message || String(error);
        if (msg.toLowerCase().includes("api key") || msg.toLowerCase().includes("invalid_argument") || msg.toLowerCase().includes("api_key_invalid")) {
          throw new Error("Gemini API Key inválida. Acesse as Configurações e verifique sua chave do Google Gemini.");
        }
        throw new Error("Erro na tradução das legendas: " + msg);
      }
    }
  );
}
