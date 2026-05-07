import { get, set } from 'idb-keyval';

const CACHE_KEY = 'lingosync_word_audio_cache';

interface WordAudioMap {
  [word: string]: string; // lowercase word -> base64 PCM audio
}

let memoryCache: WordAudioMap | null = null;

async function loadCache(): Promise<WordAudioMap> {
  if (memoryCache) return memoryCache;
  try {
    const stored = await get<WordAudioMap>(CACHE_KEY);
    memoryCache = stored || {};
  } catch {
    memoryCache = {};
  }
  return memoryCache;
}

async function persistCache() {
  if (memoryCache) {
    try {
      await set(CACHE_KEY, memoryCache);
    } catch (err) {
      console.warn("Failed to persist word audio cache:", err);
    }
  }
}

/**
 * Get cached audio for a word and specific voice.
 * Returns base64 PCM string or undefined if not cached.
 */
export async function getCachedWordAudio(word: string, voiceName: string): Promise<string | undefined> {
  const cache = await loadCache();
  const key = `${word.toLowerCase().trim()}:${voiceName}`;
  return cache[key];
}

/**
 * Save audio for a word and specific voice in the global cache.
 */
export async function setCachedWordAudio(word: string, audioBase64: string, voiceName: string): Promise<void> {
  const cache = await loadCache();
  const key = `${word.toLowerCase().trim()}:${voiceName}`;
  cache[key] = audioBase64;
  await persistCache();
}
