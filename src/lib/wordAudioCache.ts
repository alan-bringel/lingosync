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
 * Get cached audio for a word (case-insensitive).
 * Returns base64 PCM string or undefined if not cached.
 */
export async function getCachedWordAudio(word: string): Promise<string | undefined> {
  const cache = await loadCache();
  return cache[word.toLowerCase().trim()];
}

/**
 * Save audio for a word in the global cache (case-insensitive).
 */
export async function setCachedWordAudio(word: string, audioBase64: string): Promise<void> {
  const cache = await loadCache();
  cache[word.toLowerCase().trim()] = audioBase64;
  await persistCache();
}
