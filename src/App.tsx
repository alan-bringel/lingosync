import React, { useState, useRef, useEffect } from "react";
import { AudioPlayer } from "./components/AudioPlayer";
import { INITIAL_PLAYLIST } from "./constants";
import { AudioTrack, TranscriptSegment, Word } from "./types";
// import { ScrollArea } from "@/components/ui/scroll-area";
const ScrollArea = ({ children, className }: any) => <div className={className} style={{ overflowY: 'auto' }}>{children}</div>;
// import { Badge } from "@/components/ui/badge";
const Badge = ({ children, className }: any) => <span className={className}>{children}</span>;
import { VideoSyncModal } from "./components/VideoSyncModal";
import { Headphones, Loader2, Download, Upload, ArrowLeft, Trash2, Settings2, Info, ExternalLink, Key, Database, RefreshCw, X, Shield, RectangleVertical, AudioLines, Library, RotateCw, ChevronDown } from "lucide-react";
// import { Button } from "@/components/ui/button";
const Button = ({ children, className, variant, size, ...props }: any) => <button className={className} {...props}>{children}</button>;
import { motion, AnimatePresence, useMotionValue } from "motion/react";
import { transcribeAudio } from "./lib/gemini";
import { cn } from "@/lib/utils";
import { FlashcardsView } from "./components/FlashcardsView";
import { saveTrack, getSavedTracks, deleteTrack, updateTrackMetadata, clearAllTracks, saveTrackVideo, removeTrackVideo, saveLastDirectoryHandle, getLastDirectoryHandle } from "./lib/db";
import { get, set } from "idb-keyval";

import { QuotaExceededModal } from "./components/QuotaExceededModal";
import { RateLimitModal } from "./components/RateLimitModal";
import { setRateLimitCallback } from "./lib/rateLimiter";

type View = 'home' | 'library' | 'lesson';

interface Language {
  code: string;
  label: string;
}

const SUPPORTED_LANGUAGES: Language[] = [
  { code: 'en', label: 'EN' },
  { code: 'es', label: 'ES' },
  { code: 'de', label: 'DE' },
  { code: 'fr', label: 'FR' },
  { code: 'el', label: 'EL' },
  { code: 'he', label: 'HE' },
  { code: 'pt', label: 'PT' },
];

const MAX_WORDS_PER_SEGMENT = 15;

const LingoSyncLogo = ({ className = "w-8 h-8" }: { className?: string }) => (
  <img
    src="/logo-ligosync.svg"
    alt="LingoSync Logo"
    className={className}
    style={{ objectFit: 'contain' }}
  />
);

function LanguageSelector({ currentLanguage, onLanguageChange }: { currentLanguage: string, onLanguageChange: (code: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedLang = SUPPORTED_LANGUAGES.find(l => l.code === currentLanguage) || SUPPORTED_LANGUAGES[0];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-1 text-[#827367] hover:text-[#9a8c80] transition-colors focus:outline-none text-xs uppercase tracking-widest font-bold"
      >
        <span>{selectedLang.label}</span>
        <ChevronDown className={cn("w-3 h-3 transition-transform duration-200", isOpen && "rotate-180")} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute left-0 top-full mt-2 z-[100] bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl py-1 min-w-[80px] overflow-hidden"
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                onClick={() => {
                  onLanguageChange(lang.code);
                  setIsOpen(false);
                }}
                className={cn(
                  "w-full text-left px-4 py-2 text-[10px] font-bold uppercase tracking-widest hover:bg-white/5 transition-colors",
                  currentLanguage === lang.code ? "text-[#827367] bg-[#827367]/5" : "text-gray-400"
                )}
              >
                {lang.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function splitTranslationByWordChunks(translation: string, chunkSizes: number[]): string[] {
  const normalized = (translation || "").trim();
  if (!normalized) return chunkSizes.map(() => "");
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return chunkSizes.map((_, i) => (i === 0 ? normalized : ""));

  const total = chunkSizes.reduce((acc, n) => acc + n, 0) || 1;
  const result: string[] = [];
  let cursor = 0;

  chunkSizes.forEach((size, idx) => {
    const remainingChunks = chunkSizes.length - idx;
    const remainingWords = words.length - cursor;
    if (remainingChunks <= 1) {
      result.push(words.slice(cursor).join(" "));
      cursor = words.length;
      return;
    }

    const target = Math.round((size / total) * words.length);
    const safeMin = Math.max(1, target);
    const safeTake = Math.min(remainingWords - (remainingChunks - 1), safeMin);
    result.push(words.slice(cursor, cursor + safeTake).join(" "));
    cursor += safeTake;
  });

  return result;
}

function splitSegmentTextPreservingPunctuation(text: string, maxWords: number): string[] {
  const source = (text || "").trim();
  if (!source) return [""];

  const wordRegex = /[A-Za-z']+/g;
  const matches = Array.from(source.matchAll(wordRegex));
  if (matches.length <= maxWords) return [source];

  const chunks: string[] = [];
  for (let i = 0; i < matches.length; i += maxWords) {
    const startMatch = matches[i];
    const nextStartMatch = matches[i + maxWords];
    const startIndex = startMatch?.index ?? 0;
    const endIndex = nextStartMatch?.index ?? source.length;
    chunks.push(source.slice(startIndex, endIndex).trim());
  }

  return chunks.filter(Boolean);
}

function enforceSegmentWordLimit(transcript: TranscriptSegment[]): TranscriptSegment[] {
  const normalized = Array.isArray(transcript) ? transcript : [];
  const rebuilt: TranscriptSegment[] = [];

  for (const segment of normalized) {
    const words = Array.isArray(segment.words) ? segment.words : [];
    if (words.length <= MAX_WORDS_PER_SEGMENT) {
      rebuilt.push(segment);
      continue;
    }

    const textChunks = splitSegmentTextPreservingPunctuation(segment.text, MAX_WORDS_PER_SEGMENT);
    const chunks: Word[][] = [];
    for (let i = 0; i < words.length; i += MAX_WORDS_PER_SEGMENT) {
      chunks.push(words.slice(i, i + MAX_WORDS_PER_SEGMENT));
    }

    const translations = splitTranslationByWordChunks(
      segment.translation || "",
      chunks.map(chunk => chunk.length)
    );

    chunks.forEach((chunk, idx) => {
      const first = chunk[0];
      const last = chunk[chunk.length - 1];
      rebuilt.push({
        ...segment,
        text: textChunks[idx] || chunk.map(w => w.text).join(" "),
        translation: translations[idx] || "",
        start: first?.start ?? segment.start,
        end: last?.end ?? segment.end,
        words: chunk
      });
    });
  }

  return rebuilt;
}

export default function App() {
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  const [playlist, setPlaylist] = useState<AudioTrack[]>(INITIAL_PLAYLIST);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [showFlashcards, setShowFlashcards] = useState(false);
  const [isGeneratingCards, setIsGeneratingCards] = useState(false);
  const [currentView, setCurrentView] = useState<View>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem('lingosync_current_view') as View) || 'home';
    }
    return 'home';
  });
  const [currentLanguage, setCurrentLanguage] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem('lingosync_current_language') || 'en';
    }
    return 'en';
  });

  useEffect(() => {
    localStorage.setItem('lingosync_current_view', currentView);
    // Stop audio when leaving the lesson view
    if (currentView !== 'lesson') {
      // Stop all HTML audio and video elements
      const mediaElements = document.querySelectorAll('audio, video');
      mediaElements.forEach((el: any) => el.pause());

      // Stop any active browser narration (TTS)
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }

      // Close flashcards if open
      setShowFlashcards(false);
    }
  }, [currentView]);

  useEffect(() => {
    localStorage.setItem('lingosync_current_language', currentLanguage);
  }, [currentLanguage]);

  const [isImporting, setIsImporting] = useState(false);
  const [globalKnownWords, setGlobalKnownWords] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  const getGlobalKnownWordsFromTracks = (tracks: AudioTrack[]) => {
    // Filter tracks by current language
    const languageTracks = tracks.filter(t => (t.language || 'en') === currentLanguage);
    const allWords = languageTracks.flatMap(track => (track.knownWords || [])
      .map(word => word.toLowerCase().trim())
      .filter(Boolean)
    );
    return Array.from(new Set(allWords));
  };

  const refreshGlobalKnownWords = async (tracks: AudioTrack[]) => {
    const next = getGlobalKnownWordsFromTracks(tracks);
    setGlobalKnownWords(next);
    await set(`lingosync_global_known_words_${currentLanguage}`, next).catch(console.error);
  };

  // Load known words for current language on mount or language change
  useEffect(() => {
    const loadKnownWords = async () => {
      const saved = await get<string[]>(`lingosync_global_known_words_${currentLanguage}`);
      if (saved) {
        setGlobalKnownWords(saved);
      } else {
        // Fallback to calculating from tracks if no specific storage exists yet
        const tracks = await getSavedTracks();
        const next = getGlobalKnownWordsFromTracks(tracks);
        setGlobalKnownWords(next);
      }
    };
    loadKnownWords();
  }, [currentLanguage]);
  const [showHelp, setShowHelp] = useState(false);
  const [showKeyAlert, setShowKeyAlert] = useState(false);
  const [showQuotaModal, setShowQuotaModal] = useState(false);
  const [showAudioErrorModal, setShowAudioErrorModal] = useState(false);
  const [audioErrorMessage, setAudioErrorMessage] = useState("");
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [isSyncingVideo, setIsSyncingVideo] = useState(false);
  const [showMissingAudioModal, setShowMissingAudioModal] = useState(false);
  const [isSyncingAudio, setIsSyncingAudio] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [rateLimitModel, setRateLimitModel] = useState('');
  const [rateLimitSecondsRemaining, setRateLimitSecondsRemaining] = useState(0);
  const [isRateLimitDaily, setIsRateLimitDaily] = useState(false);
  const [flashcardStartIndex, setFlashcardStartIndex] = useState(0);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const countDirEntries = async (dirHandle: any): Promise<number> => {
    let count = 0;
    try {
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') {
          count += 1;
          if (count % 50 === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        } else if (entry.kind === 'directory') {
          count += await countDirEntries(entry);
        }
      }
    } catch (err) {
      console.warn("Error counting directory entries:", err);
    }
    return Math.max(count, 1);
  };

  const findFileInDirectory = async (
    dirHandle: any,
    targetName: string,
    totalEntries: number,
    processed: { value: number }
  ): Promise<File | null> => {
    for await (const entry of dirHandle.values()) {
      processed.value += 1;
      if (processed.value % 10 === 0) {
        setSyncProgress(Math.round((processed.value / totalEntries) * 100));
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      if (entry.kind === 'file' && entry.name.toLowerCase() === targetName) {
        setSyncProgress(100);
        return await entry.getFile();
      }
      if (entry.kind === 'directory') {
        const found = await findFileInDirectory(entry, targetName, totalEntries, processed);
        if (found) return found;
      }
    }
    return null;
  };

  const handleSyncAudioFolder = async (e?: React.ChangeEvent<HTMLInputElement>) => {
    if (!currentTrack || !currentTrack.audioFileName) return;

    setIsSyncingAudio(true);
    setSyncProgress(0);
    let foundFile: File | null = null;
    const targetName = currentTrack.audioFileName.toLowerCase();

    try {
      // Delay para permitir UI renderizar o estado de sincronização
      await new Promise(resolve => setTimeout(resolve, 100));

      // Method 1: File System Access API (Chrome/Edge)
      if (!e && 'showDirectoryPicker' in window) {
        try {
          const dirHandle = await (window as any).showDirectoryPicker();
          setSyncProgress(1);
          await saveLastDirectoryHandle(dirHandle);

          // Iniciar contagem sem esperar terminar completamente
          const totalEntries = await countDirEntries(dirHandle) || 1;
          setSyncProgress(Math.min(5, Math.round(100 / totalEntries)));

          const processed = { value: 0 };
          foundFile = await findFileInDirectory(dirHandle, targetName, totalEntries, processed);
        } catch (pickerError) {
          console.warn("Directory picker failed, falling back to file input:", pickerError);
          if (folderInputRef.current) {
            folderInputRef.current.click();
          }
          return;
        }
      }
      // Method 2: Fallback Input (Safari/iOS/Firefox or manual select)
      else if (e && e.target.files) {
        const files = e.target.files;
        const totalFiles = Math.max(files.length, 1);

        for (let i = 0; i < totalFiles; i++) {
          const f = files[i];
          setSyncProgress(Math.round(((i + 1) / totalFiles) * 100));
          if (f.name.toLowerCase() === targetName) {
            foundFile = f;
            break;
          }
        }
      }

      if (foundFile) {
        const audioBlob = foundFile;
        const url = URL.createObjectURL(audioBlob);

        const updatedTrack = { ...currentTrack, url };
        setPlaylist(prev => prev.map(t => t.id === updatedTrack.id ? updatedTrack : t));
        await saveTrack(updatedTrack, audioBlob);
        setShowMissingAudioModal(false);
      } else {
        alert(`O arquivo "${currentTrack.audioFileName}" não foi encontrado. Verifique se você selecionou a pasta correta.`);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error("Failed to sync audio:", err);
        alert("Erro ao acessar a pasta ou sincronizar o áudio.");
      }
    } finally {
      setIsSyncingAudio(false);
      setSyncProgress(0);
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  };
  const [userApiKey, setUserApiKey] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("gemini_api_key") || "";
    }
    return "";
  });
  const [assemblyAiApiKey, setAssemblyAiApiKey] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("assemblyai_api_key") || "";
    }
    return "";
  });
  const [deepseekApiKey, setDeepseekApiKey] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("deepseek_api_key") || "";
    }
    return "";
  });
  const [hasBillingEnabled, setHasBillingEnabled] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("gemini_billing_enabled") === "true";
    }
    return false;
  });
  const [transcribePercent, setTranscribePercent] = useState(0);
  const [flashcardPercent, setFlashcardPercent] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const currentTrack = playlist[currentTrackIndex];

  // Pause audio, video and narration when flashcards overlay opens
  useEffect(() => {
    if (showFlashcards) {
      const mediaElements = document.querySelectorAll('audio, video');
      mediaElements.forEach((el: any) => el.pause());

      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    }
  }, [showFlashcards]);

  const handleOpenFlashcards = async (startIndex: number = 0) => {
    if (!currentTrack) return;

    // Set the starting index
    setFlashcardStartIndex(startIndex);

    if (currentTrack.flashcards && currentTrack.flashcards.length > 0) {
      setShowFlashcards(true);
      return;
    }

    if (!deepseekApiKey || deepseekApiKey.trim() === "") {
      alert("Configure sua chave DeepSeek nas Configurações para gerar flashcards.");
      setShowSettings(true);
      return;
    }

    setIsGeneratingCards(true);
    try {
      const { extractLessonFlashcards } = await import("./services/geminiService");
      const fullTranscript = currentTrack.transcript.map(s => s.text).join(" ");
      const cards = await extractLessonFlashcards(fullTranscript, deepseekApiKey, hasBillingEnabled);
      handleUpdateTrack({ flashcards: cards });
      setShowFlashcards(true);
    } catch (err: any) {
      console.error("Failed to generate flashcards", err);
      if (err.message === "QUOTA_EXCEEDED") {
        setShowQuotaModal(true);
      } else {
        alert("Erro ao gerar flashcards: " + (err.message || "Tente novamente mais tarde."));
      }
    } finally {
      setIsGeneratingCards(false);
    }
  };

  // Setup Rate Limit callback
  useEffect(() => {
    setRateLimitCallback((data) => {
      setIsRateLimited(data.isWaiting);
      setRateLimitModel(data.model);
      setRateLimitSecondsRemaining(data.secondsRemaining);
      setIsRateLimitDaily(data.isDailyLimit || false);
    });
  }, []);

  // Load saved tracks and API key on mount
  useEffect(() => {
    async function init() {
      try {
        if (navigator.storage && navigator.storage.persist) {
          navigator.storage.persist().catch(console.warn);
        }
        const [saved] = await Promise.all([
          getSavedTracks(),
        ]);

        if (saved && saved.length > 0) {
          setPlaylist(saved);
          await refreshGlobalKnownWords(saved);
        } else {
          setGlobalKnownWords([]);
          await set("lingosync_global_known_words", []).catch(console.error);
        }
      } catch (err) {
        console.error("Failed to load initial data:", err);
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, []);

  const toggleGlobalKnownWord = (word: string) => {
    const lower = word.toLowerCase();
    setGlobalKnownWords(prev => {
      const isKnown = prev.includes(lower);
      const next = isKnown ? prev.filter(w => w !== lower) : [...prev, lower];
      set("lingosync_global_known_words", next).catch(console.error);
      return next;
    });

    setPlaylist(prev => {
      const track = prev[currentTrackIndex];
      if (!track) return prev;

      const trackKnown = track.knownWords || [];
      const trackIsKnown = trackKnown.includes(lower);
      const nextTrackKnown = trackIsKnown
        ? trackKnown.filter(w => w !== lower)
        : [...trackKnown, lower];

      updateTrackMetadata(track.id, { knownWords: nextTrackKnown }).catch(console.error);

      return prev.map((item, idx) =>
        idx === currentTrackIndex ? { ...item, knownWords: nextTrackKnown } : item
      );
    });
  };

  const togglePlay = () => {
    // If audio is not synced, show the missing audio modal instead of playing
    if (!currentTrack?.url || currentTrack.url.startsWith('blob:')) {
      // Check if it's the silent placeholder (44 bytes)
      fetch(currentTrack.url).then(res => res.blob()).then(blob => {
        if (blob.size <= 44) {
          setShowMissingAudioModal(true);
        } else {
          // Normal playback trigger (handled by AudioPlayer component via state)
          // We need to pass a signal or use a ref. For now, let's assume 
          // AudioPlayer handles its own play state but we can trigger modal from here if needed.
        }
      }).catch(() => setShowMissingAudioModal(true));
    }
  };

  // Save API keys when they change
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("gemini_api_key", userApiKey);
    }
    if (!isLoading) {
      set("gemini_api_key", userApiKey).catch(console.error); // Keep backup in IDB just in case
    }
  }, [userApiKey, isLoading]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("assemblyai_api_key", assemblyAiApiKey);
    }
  }, [assemblyAiApiKey]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("deepseek_api_key", deepseekApiKey);
    }
  }, [deepseekApiKey]);

  // Save billing preference when it changes
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("gemini_billing_enabled", hasBillingEnabled.toString());
    }
  }, [hasBillingEnabled]);


  // Simulated progress for Transcribing Audio
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isTranscribing) {
      setTranscribePercent(0);
      interval = setInterval(() => {
        setTranscribePercent(p => {
          if (p < 99) {
            const increment = p < 90 ? Math.max(0.5, (90 - p) / 20) : 0.02;
            return Math.min(99, p + increment);
          }
          return p;
        });
      }, 500);
    } else {
      setTranscribePercent(100);
    }
    return () => clearInterval(interval);
  }, [isTranscribing]);

  // Simulated progress for Generating Flashcards
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isGeneratingCards) {
      setFlashcardPercent(0);
      interval = setInterval(() => {
        setFlashcardPercent(p => {
          if (p < 99) {
            const increment = p < 90 ? Math.max(0.2, (90 - p) / 30) : 0.01;
            return Math.min(99, p + increment);
          }
          return p;
        });
      }, 800);
    } else {
      setFlashcardPercent(100);
    }
    return () => clearInterval(interval);
  }, [isGeneratingCards]);

  // Simulated progress for Video Syncing
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isSyncingVideo) {
      interval = setInterval(() => {
        // Just a fake visual wait for local processing
      }, 500);
    }
    return () => clearInterval(interval);
  }, [isSyncingVideo]);

  const handleClearData = async () => {
    if (confirm("Tem certeza que deseja excluir TODAS as lições? Essa ação não pode ser desfeita.")) {
      await clearAllTracks();
      setPlaylist([]);
      setCurrentView('home');
      setShowSettings(false);
      setGlobalKnownWords([]);
      await set("lingosync_global_known_words", []).catch(console.error);
    }
  };

  const handleNext = () => {
    setCurrentTrackIndex((prev) => (prev + 1) % playlist.length);
  };

  const handlePrev = () => {
    setCurrentTrackIndex((prev) => (prev - 1 + playlist.length) % playlist.length);
  };

  const blobToBase64 = (blobUrl: string): Promise<string> => {
    return new Promise(async (resolve) => {
      const response = await fetch(blobUrl);
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.readAsDataURL(blob);
    });
  };

  const blobDirectToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const handleExport = async (track: AudioTrack) => {
    const transcriptWords = track.transcript
      .flatMap(s => (s.words || []).map(w => w.text.toLowerCase().trim()))
      .filter(Boolean);
    const flashcardWords = (track.flashcards || [])
      .map(fc => fc.expression.toLowerCase().trim())
      .filter(Boolean);
    const lessonWordSet = new Set([...transcriptWords, ...flashcardWords]);
    const fallbackKnownFromGlobal = globalKnownWords.filter(w => lessonWordSet.has(w));
    const mergedKnownWords = Array.from(new Set([...(track.knownWords || []), ...fallbackKnownFromGlobal]));

    const exportData: any = {
      ...track,
      knownWords: mergedKnownWords,
    };

    // Retrieve audio from IndexedDB and embed as base64
    try {
      const storedTracks = await get<any[]>('lingosync_tracks') || [];
      const storedTrack = storedTracks.find((t: any) => t.id === track.id);

      if (storedTrack?.audioBuffer) {
        const audioBlob = new Blob([storedTrack.audioBuffer], { type: storedTrack.audioType || 'audio/wav' });
        const base64 = await blobDirectToBase64(audioBlob);
        exportData.audioBase64 = base64;
      }
    } catch (err) {
      console.warn("Could not embed audio in export:", err);
    }

    // Clean up transient fields
    delete exportData.url;
    delete exportData.localVideoUrl;

    // Remove flashcard audioUrl fields (uses browser SpeechSynthesis or Gemini TTS)
    if (exportData.flashcards) {
      exportData.flashcards = exportData.flashcards.map((fc: any) => {
        const { audioUrl, ...rest } = fc;
        return rest;
      });
    }

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const langSuffix = track.language ? ` (${track.language})` : '';
    const suggestedName = `${track.title}${langSuffix}.lsync.json`;

    // Modern browsers: Allows overwriting the exact same file without adding (1), (2), etc.
    if ('showSaveFilePicker' in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName,
          types: [{
            description: 'LingoSync Lesson',
            accept: { 'application/json': ['.lsync.json'] },
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return; // Success
      } catch (err: any) {
        if (err.name === 'AbortError') return; // User cancelled the dialog
        console.warn('showSaveFilePicker failed, using fallback:', err);
      }
    }

    // Fallback for browsers that don't support the File System Access API (like iOS Safari)
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const base64ToBlob = (base64: string, type: string = 'audio/wav'): Blob => {
    const binStr = atob(base64);
    const len = binStr.length;
    const arr = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      arr[i] = binStr.charCodeAt(i);
    }
    return new Blob([arr], { type: type });
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Relaxed extension check to allow browser-renamed files (e.g. .lsync 2.json on iOS)
    if (!file.name.toLowerCase().endsWith('.json')) {
      alert("Por favor, selecione um arquivo válido no formato .lsync.json");
      e.target.value = '';
      return;
    }

    setIsImporting(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result as string);
        if (!data.transcript) throw new Error("Formato inválido: o arquivo não contém transcrição.");

        if (Array.isArray(data.transcript) && data.transcript.length === 0) {
          alert("Atenção: A lição importada está vazia (não possui legendas). O arquivo parece ter sido gerado enquanto o sistema falhava. Tente transcrever o áudio original `.wav` novamente.");
        }

        let audioBlob: Blob;
        if (data.audioBase64) {
          // Legacy format: audio is embedded in the .lsync.json file
          audioBlob = base64ToBlob(data.audioBase64);
        } else {
          // New lightweight format: no audio embedded
          // Create a tiny silent placeholder blob so we can save to DB
          // The user will need to re-upload or sync the original audio
          audioBlob = new Blob([new ArrayBuffer(44)], { type: 'audio/wav' });
        }

        const importedLanguage = data.language || currentLanguage;
        setCurrentLanguage(importedLanguage);

        const newTrack: AudioTrack = {
          ...data,
          id: Date.now().toString(36) + Math.random().toString(36).substring(2),
          url: URL.createObjectURL(audioBlob),
          audioFileName: data.audioFileName || (data.title ? `${data.title}.mp3` : undefined),
          language: importedLanguage
        };
        delete (newTrack as any).audioBase64;

        // Save to DB
        await saveTrack(newTrack, audioBlob);

        let importedTrackList: AudioTrack[] = [];
        setPlaylist((prev) => {
          const next = [...prev, newTrack];
          importedTrackList = next;
          setCurrentTrackIndex(next.length - 1);
          return next;
        });
        await refreshGlobalKnownWords(importedTrackList);
        setCurrentView('lesson');

        // If no audio was embedded, try to find it automatically or show the modal
        if (!data.audioBase64) {
          const targetName = (data.audioFileName || (data.title ? `${data.title}.mp3` : "")).toLowerCase();
          let found = false;

          if (targetName) {
            try {
              const dirHandle = await getLastDirectoryHandle();
              if (dirHandle) {
                // Request permission if needed
                const permission = await (dirHandle as any).queryPermission({ mode: 'read' });
                if (permission === 'granted' || (await (dirHandle as any).requestPermission({ mode: 'read' })) === 'granted') {
                  for await (const entry of (dirHandle as any).values()) {
                    if (entry.kind === 'file' && entry.name.toLowerCase() === targetName) {
                      const audioFile = await (entry as any).getFile();
                      const url = URL.createObjectURL(audioFile);

                      // Found! Update track in state and DB
                      const updatedTrack = { ...newTrack, url };
                      setPlaylist(prev => prev.map(t => t.id === updatedTrack.id ? updatedTrack : t));
                      await saveTrack(updatedTrack, audioFile);
                      found = true;
                      break;
                    }
                  }
                }
              }
            } catch (err) {
              console.warn("Auto-location failed:", err);
            }
          }

          if (!found) {
            setTimeout(() => setShowMissingAudioModal(true), 500);
          }
        }
      } catch (err: any) {
        console.error("Import failed:", err);
        const errorMessage = typeof err === 'string' ? err : err?.message;
        alert(`Erro ao importar a lição: ${errorMessage || 'Formato de arquivo inválido ou corrompido.'}`);
      } finally {
        setIsImporting(false);
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const effectiveAssemblyKey = (assemblyAiApiKey || localStorage.getItem("assemblyai_api_key") || "").trim();
    const effectiveDeepseekKey = (deepseekApiKey || localStorage.getItem("deepseek_api_key") || "").trim();
    const effectiveGeminiKey = (userApiKey || localStorage.getItem("gemini_api_key") || "").trim();

    if (!effectiveAssemblyKey || !effectiveDeepseekKey || !effectiveGeminiKey) {
      alert("Configure as chaves de API nas Configurações antes de transcrever.\n\n• AssemblyAI — Transcrição\n• DeepSeek — Tradução e Inteligência\n• Gemini — Narração (TTS)");
      setShowSettings(true);
      e.target.value = '';
      return;
    }

    setIsTranscribing(true);
    try {
      let transcript;
      transcript = enforceSegmentWordLimit(
        await transcribeAudio(file, effectiveAssemblyKey, effectiveDeepseekKey, effectiveGeminiKey, hasBillingEnabled)
      );

      const isVideo = file.type.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv'].includes(file.name.split('.').pop()?.toLowerCase() || '');

      const newTrack: AudioTrack = {
        id: Date.now().toString(36) + Math.random().toString(36).substring(2),
        title: file.name.replace(/\.[^/.]+$/, ""),
        artist: "",
        url: URL.createObjectURL(file),
        coverUrl: `https://picsum.photos/seed/${file.name}/400/400`,
        transcript: transcript,
        isVideo: isVideo,
        audioFileName: file.name,
        language: currentLanguage
      };

      // Save to persistence
      await saveTrack(newTrack, file);

      setPlaylist((prev) => {
        const newList = [...prev, newTrack];
        setCurrentTrackIndex(newList.length - 1);
        return newList;
      });
      setIsTranscribing(false);
      setCurrentView('lesson');
    } catch (error: any) {
      if (error.message === "QUOTA_EXCEEDED") {
        setShowQuotaModal(true);
      } else {
        console.error("Transcription failed:", error);
        const errorMessage = typeof error === 'string' ? error : error?.message;
        alert(`Erro na transcrição: ${errorMessage || 'Falha ao processar o áudio. Tente novamente mais tarde.'}`);
      }
      setIsTranscribing(false);
    } finally {
      e.target.value = '';
    }
  };

  const handleUpdateTrack = (updatedTrack: Partial<AudioTrack>) => {
    if (currentTrack) {
      const { url, localVideoUrl, ...updates } = updatedTrack; // never update transient URLs via metadata
      updateTrackMetadata(currentTrack.id, updates);
    }
    setPlaylist(prev => prev.map((track, i) =>
      i === currentTrackIndex ? { ...track, ...updatedTrack } : track
    ));
  };

  const handleDeleteTrack = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("Tem certeza que deseja excluir esta lição? Esta ação não pode ser desfeita.")) {
      return;
    }
    await deleteTrack(id);
    const newPlaylist = playlist.filter(t => t.id !== id);
    setPlaylist(newPlaylist);
    await refreshGlobalKnownWords(newPlaylist);
    if (currentTrack?.id === id) {
      setCurrentView('library');
      setCurrentTrackIndex(0);
    } else {
      // Adjusted index if deleting item before current
      const deletedIdx = playlist.findIndex(t => t.id === id);
      if (deletedIdx < currentTrackIndex) {
        setCurrentTrackIndex(prev => prev - 1);
      }
    }
  };

  // --- UI Components with Previous Styles ---

  const SidebarHeader = () => {
    const getLanguageName = (code: string) => {
      const names: Record<string, string> = {
        en: 'inglês',
        es: 'espanhol',
        de: 'alemão',
        fr: 'francês',
        el: 'grego',
        he: 'hebraico',
        pt: 'português'
      };
      return names[code] || 'idiomas';
    };

    return (
      <div className="space-y-3 p-4 rounded-xl border-[1.5px] border-white/10 bg-white/[0.01] relative overflow-hidden">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <h1 className="text-2xl font-bold tracking-tight text-gray-300">LingoSync</h1>
            <div className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center shrink-0 aspect-square">
              <LingoSyncLogo className="w-8 h-8 text-[#827367]" />
            </div>
          </div>
          <div className="flex items-center space-x-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowHelp(true)}
              className="text-gray-600 hover:text-gray-300 h-8 w-8"
            >
              <Info className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowSettings(true)}
              className="text-gray-600 hover:text-gray-300 h-8 w-8"
            >
              <Settings2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <p className="text-gray-500 text-sm font-medium tracking-tight">
          {currentView === 'home'
            ? `Aprenda ${getLanguageName(currentLanguage)} de forma divertida com legendas do seu conteúdo preferido`
            : "Selecione uma lição para começar"}
        </p>
      </div>
    );
  };

  const TrackItem = ({ track, index }: { track: AudioTrack, index: number }) => {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
          setIsMenuOpen(false);
        }
      };
      if (isMenuOpen) {
        document.addEventListener("mousedown", handleClickOutside);
      }
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isMenuOpen]);

    const handleItemClick = () => {
      if (isMenuOpen) {
        setIsMenuOpen(false);
        return;
      }
      setCurrentTrackIndex(index);
      setCurrentView('lesson');
    };

    return (
      <motion.div
        className="relative mb-2 rounded-xl group overflow-hidden"
        ref={containerRef}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.05, duration: 0.3 }}
      >
        {/* Action Buttons Background */}
        <div className="absolute inset-y-0 right-0 flex items-center pr-3 space-x-3 w-[140px] justify-end bg-transparent">
          <Button
            variant="ghost"
            size="icon"
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              handleExport(track);
              setIsMenuOpen(false);
            }}
            className="text-[#827367] hover:text-[#9a8c80] hover:bg-white/5 h-12 w-12 rounded-full transition-all"
          >
            <Download className="w-5 h-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              handleDeleteTrack(track.id, e);
              setIsMenuOpen(false);
            }}
            className="text-red-400 hover:text-red-300 hover:bg-red-500/10 h-12 w-12 rounded-full transition-all"
          >
            <Trash2 className="w-5 h-5" />
          </Button>
        </div>

        {/* Sliding Foreground Content */}
        <motion.div
          initial={false}
          animate={{ x: isMenuOpen ? -140 : 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 40 }}
          className={cn(
            "relative z-10 w-full flex items-center p-4 rounded-xl transition-colors duration-300 text-left border-[1.5px] cursor-pointer bg-[#0d0d0d]",
            currentTrackIndex === index && currentView === 'lesson'
              ? "border-white/20"
              : "border-white/10 hover:border-white/20"
          )}
          onClick={handleItemClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              handleItemClick();
            }
          }}
        >
          <div className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-full overflow-hidden shrink-0 aspect-square bg-[#443a32]/20 border border-white/5 flex items-center justify-center">
            <span className="text-base sm:text-lg font-bold text-[#827367]/40 font-mono">{track.lessonNumber ?? index + 1}</span>
          </div>
          <div className="ml-5 flex-1 overflow-hidden pr-8">
            <p className={cn("text-base font-medium truncate transition-colors", currentTrackIndex === index && currentView === 'lesson' ? "text-gray-200" : "text-gray-500 group-hover:text-gray-300")}>
              {track.title}
            </p>
          </div>

          {/* Drag/Menu Icon - Two Lines */}
          <div
            className="absolute right-4 top-1/2 -translate-y-1/2 z-20 w-10 h-10 flex flex-col items-center justify-center space-y-[4px] rounded-full hover:bg-white/5 transition-all cursor-pointer group/icon"
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              setIsMenuOpen(!isMenuOpen);
            }}
          >
            <div className="w-[14px] h-[1.5px] bg-gray-500 group-hover/icon:bg-gray-300 rounded-full transition-colors" />
            <div className="w-[14px] h-[1.5px] bg-gray-500 group-hover/icon:bg-gray-300 rounded-full transition-colors" />
          </div>
        </motion.div>
      </motion.div>
    );
  };

  const PlaylistList = () => {
    const filteredPlaylist = playlist.filter(t => (t.language || 'en') === currentLanguage);

    // Sort by lessonNumber, falling back to original order index if undefined
    const sortedPlaylist = [...filteredPlaylist].sort((a, b) => {
      const indexA = filteredPlaylist.indexOf(a);
      const indexB = filteredPlaylist.indexOf(b);
      const numA = a.lessonNumber !== undefined ? a.lessonNumber : (indexA + 1);
      const numB = b.lessonNumber !== undefined ? b.lessonNumber : (indexB + 1);
      return numA - numB;
    });

    return (
      <div className="flex-1 flex flex-col space-y-6 min-h-0">
        <div className="flex items-center justify-between border-b-[1.5px] border-white/10 pb-4 mt-2">
          <div className="flex items-center text-xs uppercase tracking-widest h-10 font-bold text-[#827367]">
            <Library className="w-4 h-4 mr-2" />
            Biblioteca
          </div>
          <div className="flex items-center space-x-2">
            <Badge variant="ghost" className="text-xs uppercase tracking-widest font-bold text-[#827367] bg-transparent border-none p-0">
              {sortedPlaylist.length} {sortedPlaylist.length === 1 ? 'lição' : 'lições'}
            </Badge>
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="space-y-1 pb-10">
            {sortedPlaylist.length > 0 ? (
              sortedPlaylist.map((track, displayIndex) => {
                // Find the actual index in the main playlist array so handleItemClick works correctly
                const originalIndex = playlist.findIndex(t => t.id === track.id);
                return <TrackItem key={track.id} track={track} index={originalIndex} />;
              })
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-center space-y-4 opacity-40">
                <Library className="w-12 h-12 text-gray-600" />
                <p className="text-sm">Nenhuma lição encontrada para este idioma.</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    );
  };

  return (
    <>
      <AnimatePresence>
        {showSplash && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#0d0d0d]"
          >
            <div className="absolute inset-0 bg-radial-gradient from-[#443a32]/10 to-transparent opacity-50" />
            <div className="relative z-10 flex flex-col items-center space-y-6">
              <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-3xl bg-white/[0.02] flex items-center justify-center border-[1.5px] border-white/10 shadow-inner">
                <LingoSyncLogo className="w-14 h-14 sm:w-16 sm:h-16" />
              </div>
              <motion.h1
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.05, ease: "easeOut" }}
                className="text-3xl font-bold text-gray-100 tracking-tight"
              >
                LingoSync
              </motion.h1>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="h-dvh w-full bg-[#0d0d0d] text-gray-400 font-sans selection:bg-white/10 overflow-hidden flex flex-col">
        <input type="file" ref={importInputRef} onChange={handleImport} accept=".lsync.json,.json" className="hidden" />
        <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="audio/*,video/*,.mp3,.wav,.m4a,.mp4,.webm,.mpeg,.ogg,.aac,.mov,.mkv" className="hidden" />

        <div className={cn(
          "relative max-w-5xl mx-auto w-full px-4 sm:px-6 transition-all duration-500 flex flex-col min-h-0 flex-1",
          currentView === 'lesson' ? "pt-2 pb-6 sm:pt-4 sm:pb-8" : "py-4 sm:py-8"
        )}>
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-full animate-pulse transition-opacity duration-1000">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#827367]">Sincronizando Biblioteca...</p>
            </div>
          ) : (
            <>
              <AnimatePresence mode="wait">
                {currentView === 'home' && (
                  <motion.div
                    key="home"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="h-full w-full max-w-5xl mx-auto overflow-hidden"
                  >
                    <ScrollArea className="h-full w-full">
                      <div className="flex flex-col space-y-8 py-4 pb-10">
                        {/* Home Header */}
                        <SidebarHeader />

                        {/* Main Action Buttons Stacked */}
                        <div className="flex flex-col space-y-4">
                          <div className="space-y-3">
                            <button
                              onClick={() => setCurrentView('library')}
                              className="w-full flex items-center justify-center py-4 px-5 rounded-xl border-[1.5px] border-dashed border-white/10 text-gray-400 hover:text-gray-200 hover:border-white/20 transition-all group bg-[#161616] shadow-sm shadow-black/40"
                            >
                              <Library className="w-8 h-8 mr-4 group-hover:scale-110 transition-transform text-[#827367]" />
                              <div className="flex flex-col items-center text-center">
                                <span className="text-sm font-bold uppercase tracking-widest text-[#827367]">Acessar Biblioteca de Lições</span>
                                <span className="text-sm font-normal opacity-70 mt-1">Estude e exporte suas lições para salvar</span>
                              </div>
                            </button>
                          </div>

                          <div className="space-y-3">
                            <button
                              onClick={() => fileInputRef.current?.click()}
                              disabled={isTranscribing}
                              className="w-full flex items-center justify-center py-4 px-5 rounded-xl border-[1.5px] border-dashed border-white/10 text-gray-400 hover:text-gray-200 hover:border-white/20 transition-all group disabled:opacity-50 disabled:cursor-not-allowed bg-[#161616] shadow-sm shadow-black/40"
                            >
                              <AudioLines className="w-8 h-8 mr-4 group-hover:scale-110 transition-transform text-[#827367]" />
                              <div className="flex flex-col items-center text-center">
                                <span className="text-sm font-bold uppercase tracking-widest">
                                  {isTranscribing
                                    ? (transcribePercent > 90 ? "Sincronizando..." : `Progresso: ${Math.round(transcribePercent)}%`)
                                    : "Gerar Lição (Importar Áudio)"}
                                </span>
                                <span className="text-sm font-normal opacity-70 mt-1">Recomendado: 1 a 3 min. Máximo: 5 min.</span>
                              </div>
                            </button>
                          </div>
                        </div>

                        {/* Home Content Box */}
                        <div className="flex-1 flex flex-col items-center justify-center bg-[#0d0d0d] rounded-3xl border-[1.5px] border-white/10 p-8 sm:p-12 text-center space-y-8 shadow-2xl relative overflow-hidden">
                          <div className="absolute inset-0 bg-radial-gradient from-[#443a32]/10 to-transparent opacity-50" />
                          <div className="relative z-10 space-y-8 flex flex-col items-center">
                            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-3xl bg-white/[0.02] flex items-center justify-center border-[1.5px] border-white/10 shadow-inner">
                              <LingoSyncLogo className="w-14 h-14 sm:w-16 sm:h-16" />
                            </div>
                            <div className="space-y-4">
                              <h2 className="text-3xl font-bold text-gray-100 tracking-tight">Bem-vindo ao LingoSync</h2>
                              <p className="text-gray-400 text-sm max-w-sm mx-auto leading-relaxed">
                                Transforme seus áudios favoritos em lições de inglês poderosas. Com o <b>LingoSync</b>, você aprende de forma natural usando legendas inteligentes e traduções precisas, seguindo o método comprovado de <b>Input Compreensivo</b>.
                              </p>
                            </div>
                            <button
                              onClick={() => importInputRef.current?.click()}
                              disabled={isImporting}
                              className="max-w-sm w-full flex items-center justify-center p-4 rounded-xl border-[1.5px] border-dashed border-white/10 text-gray-400 hover:text-gray-200 hover:border-white/20 transition-all group bg-[#161616] shadow-xl shadow-black/60 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {isImporting ? <Loader2 className="w-5 h-5 mr-3 animate-spin text-[#827367]" /> : <Upload className="w-5 h-5 mr-3 group-hover:scale-110 transition-transform text-[#827367]" />}
                              <span className="text-[10px] font-bold uppercase tracking-widest whitespace-nowrap">{isImporting ? 'Importando...' : 'Importar Lição (.lsync.json)'}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </ScrollArea>
                  </motion.div>
                )}

                {currentView === 'library' && (
                  <motion.div
                    key="library"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="flex flex-col space-y-8 h-full w-full max-w-5xl mx-auto"
                  >
                    <div className="flex flex-col space-y-8 h-full">
                      <div className="flex items-center justify-between">
                        <Button
                          variant="ghost"
                          onClick={() => setCurrentView('home')}
                          className="text-gray-600 hover:text-gray-300 text-xs uppercase tracking-widest font-bold flex items-center justify-start w-fit px-2 whitespace-nowrap"
                        >
                          <ArrowLeft className="w-5 h-5 mr-3 shrink-0" />
                          <span>Início</span>
                        </Button>
                        <Badge variant="ghost" className="text-xs font-bold uppercase tracking-widest text-[#827367] bg-[#827367]/20 border-none px-4 py-1.5 h-10 rounded-full flex items-center justify-center leading-none shrink-0 gap-3">
                          <LanguageSelector currentLanguage={currentLanguage} onLanguageChange={setCurrentLanguage} />
                          <div className="w-[1px] h-3 bg-[#827367]/30" />
                          <span>VOCABULÁRIO: {globalKnownWords.length}</span>
                        </Badge>
                      </div>
                      <SidebarHeader />
                      <PlaylistList />
                    </div>
                  </motion.div>
                )}

                {currentView === 'lesson' && currentTrack && (
                  <motion.div
                    key="lesson"
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    className="flex flex-col h-full max-w-5xl mx-auto w-full overflow-hidden relative"
                  >
                    <div className="pb-4 flex items-center justify-between">
                      <Button
                        variant="ghost"
                        onClick={() => setCurrentView('library')}
                        className="text-gray-600 hover:text-gray-300 text-xs uppercase tracking-widest font-bold flex items-center justify-start w-fit px-2 whitespace-nowrap"
                      >
                        <ArrowLeft className="w-5 h-5 mr-3 shrink-0" />
                        <span>Biblioteca</span>
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleOpenFlashcards}
                        disabled={isGeneratingCards}
                        className="text-xs uppercase tracking-widest h-10 font-bold text-[#827367] hover:text-[#9a8c80] flex flex-row items-center"
                      >
                        {isGeneratingCards ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin shrink-0" />
                            {Math.round(flashcardPercent)}%
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4 mr-2 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="5" y="2" width="14" height="20" rx="4" />
                            </svg>
                            Flashcards
                          </>
                        )}
                      </Button>
                    </div>
                    <div className="flex-1 min-h-0 h-full w-full overflow-hidden">
                      <AudioPlayer
                        track={currentTrack}
                        trackNumber={currentTrackIndex + 1}
                        onNext={handleNext}
                        onPrev={handlePrev}
                        onExport={handleExport}
                        onUpdateTrack={handleUpdateTrack}
                        onVideoSyncClick={() => setShowSyncModal(true)}
                        onMissingAudioSyncClick={() => setShowMissingAudioModal(true)}
                        userApiKey={userApiKey}
                        deepseekApiKey={deepseekApiKey}
                        onMissingKey={() => setShowKeyAlert(true)}
                        onQuotaExceeded={() => setShowQuotaModal(true)}
                        globalKnownWords={globalKnownWords}
                        onToggleKnownWord={toggleGlobalKnownWord}
                        hasBillingEnabled={hasBillingEnabled}
                        isPausedExternally={showFlashcards}
                        onOpenFlashcardAtIndex={(idx) => handleOpenFlashcards(idx)}
                      />
                    </div>

                    {/* FLASHCARDS OVERLAY */}
                    <AnimatePresence>
                      {showFlashcards && (
                        <motion.div
                          key="flashcards-overlay"
                          initial={{ opacity: 0, scale: 0.98 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.98 }}
                          className="fixed inset-0 z-50 bg-[#0d0d0d] flex flex-col items-center justify-center p-4 sm:p-8"
                        >
                          <div className="w-full max-w-5xl h-full pb-4 sm:pb-8 flex flex-col">
                            <FlashcardsView
                              track={currentTrack}
                              onClose={() => setShowFlashcards(false)}
                              onUpdateTrack={handleUpdateTrack}
                              globalKnownWords={globalKnownWords}
                              onToggleKnownWord={toggleGlobalKnownWord}
                              userApiKey={userApiKey}
                              onMissingKey={() => setShowKeyAlert(true)}
                              onQuotaExceeded={() => setShowQuotaModal(true)}
                              onFlashcardAudioError={(message) => {
                                setAudioErrorMessage(message);
                                setShowAudioErrorModal(true);
                              }}
                              hasBillingEnabled={hasBillingEnabled}
                              initialIndex={flashcardStartIndex}
                            />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}
        </div>

        {/* Settings Modal */}
        <AnimatePresence>
          {showSettings && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              onClick={() => setShowSettings(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="w-full max-w-md max-h-[90dvh] bg-[#161616] border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col"
                onClick={e => e.stopPropagation()}
              >
                <div className="p-6 border-b border-white/5 flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <Settings2 className="w-5 h-5 text-gray-400" />
                    <h3 className="text-lg font-bold text-gray-200">Configurações</h3>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setShowSettings(false)} className="rounded-full">
                    <X className="w-5 h-5" />
                  </Button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6">

                  {/* AssemblyAI API Key */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 flex items-center">
                        <AudioLines className="w-3 h-3 mr-2" />
                        AssemblyAI API Key
                      </label>
                      <span className="text-[9px] font-bold uppercase tracking-widest bg-[#827367]/15 text-[#a39487] border border-[#827367]/20 rounded-full px-2 py-0.5">
                        Transcrição
                      </span>
                    </div>
                    <div className="relative">
                      <input
                        type="password"
                        value={assemblyAiApiKey}
                        onChange={(e) => setAssemblyAiApiKey(e.target.value)}
                        placeholder="Cole sua chave AssemblyAI aqui..."
                        className="w-full bg-[#0d0d0d] border border-white/10 rounded-xl px-4 py-3 text-base text-gray-300 focus:outline-none focus:border-white/20 transition-colors"
                      />
                    </div>
                    <p className="text-[10px] text-gray-500 leading-relaxed italic">
                      Usada exclusivamente para transcrição de áudio. Salva apenas no seu navegador.
                    </p>
                  </div>

                  {/* DeepSeek API Key */}
                  <div className="space-y-3 pt-4 border-t border-white/5">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 flex items-center">
                        <Database className="w-3 h-3 mr-2" />
                        DeepSeek API Key
                      </label>
                      <span className="text-[9px] font-bold uppercase tracking-widest bg-[#827367]/15 text-[#a39487] border border-[#827367]/20 rounded-full px-2 py-0.5">
                        Inteligência · DeepSeek V3
                      </span>
                    </div>
                    <div className="relative">
                      <input
                        type="password"
                        value={deepseekApiKey}
                        onChange={(e) => setDeepseekApiKey(e.target.value)}
                        placeholder="Cole sua chave DeepSeek aqui..."
                        className="w-full bg-[#0d0d0d] border border-white/10 rounded-xl px-4 py-3 text-base text-gray-300 focus:outline-none focus:border-white/20 transition-colors"
                      />
                    </div>
                    <p className="text-[10px] text-gray-500 leading-relaxed italic">
                      Usada para tradução e organização. Modelo DeepSeek V3.
                    </p>
                  </div>

                  {/* Gemini API Key */}
                  <div className="space-y-3 pt-4 border-t border-white/5">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 flex items-center">
                        <Key className="w-3 h-3 mr-2" />
                        Google Gemini API Key
                      </label>
                      <span className="text-[9px] font-bold uppercase tracking-widest bg-[#827367]/15 text-[#a39487] border border-[#827367]/20 rounded-full px-2 py-0.5">
                        Tradução · Flashcards · TTS
                      </span>
                    </div>
                    <div className="relative">
                      <input
                        type="password"
                        value={userApiKey}
                        onChange={(e) => setUserApiKey(e.target.value)}
                        placeholder="Cole sua chave Gemini aqui..."
                        className="w-full bg-[#0d0d0d] border border-white/10 rounded-xl px-4 py-3 text-base text-gray-300 focus:outline-none focus:border-white/20 transition-colors"
                      />
                    </div>
                    <p className="text-[10px] text-gray-500 leading-relaxed italic">
                      Sua chave é salva apenas no seu navegador e não é enviada para nossos servidores.
                    </p>
                  </div>

                  {/* Dashboard Links Footer */}
                  <div className="pt-6 border-t border-white/10 space-y-4 bg-white/[0.02] -mx-6 -mb-6 p-6">
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-4">Atalhos de Consumo</h4>

                    {/* AssemblyAI */}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">AssemblyAI</span>
                      <div className="flex items-center space-x-4">
                        <a href="https://www.assemblyai.com/dashboard/settings" target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold text-[#827367] hover:text-[#9a8c80] flex items-center uppercase tracking-widest">
                          Obter Chave <ExternalLink className="w-3 h-3 ml-1" />
                        </a>
                        <a href="https://www.assemblyai.com/dashboard/cost" target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold text-[#827367] hover:text-[#9a8c80] flex items-center uppercase tracking-widest">
                          Ver Consumo <ExternalLink className="w-3 h-3 ml-1" />
                        </a>
                      </div>
                    </div>

                    {/* DeepSeek */}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">DeepSeek</span>
                      <div className="flex items-center space-x-4">
                        <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold text-[#827367] hover:text-[#9a8c80] flex items-center uppercase tracking-widest">
                          Obter Chave <ExternalLink className="w-3 h-3 ml-1" />
                        </a>
                        <a href="https://platform.deepseek.com/usage" target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold text-[#827367] hover:text-[#9a8c80] flex items-center uppercase tracking-widest">
                          Ver Consumo <ExternalLink className="w-3 h-3 ml-1" />
                        </a>
                      </div>
                    </div>

                    {/* Gemini */}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Google Gemini</span>
                      <div className="flex items-center space-x-4">
                        <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold text-[#827367] hover:text-[#9a8c80] flex items-center uppercase tracking-widest">
                          Obter Chave <ExternalLink className="w-3 h-3 ml-1" />
                        </a>
                        <a href="https://aistudio.google.com/app/plan" target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold text-[#827367] hover:text-[#9a8c80] flex items-center uppercase tracking-widest">
                          Ver Consumo <ExternalLink className="w-3 h-3 ml-1" />
                        </a>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 pt-4 border-t border-white/5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 flex items-center">
                      <Key className="w-3 h-3 mr-2" />
                      Faturamento Ativo
                    </label>
                    <div className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.03] border border-white/10 gap-4">
                      <div className="space-y-1 flex-1">
                        <p className="text-sm font-bold text-gray-200">
                          Tenho faturamento configurado na minha conta
                        </p>
                        <p className="text-[10px] text-gray-500 leading-relaxed">
                          Se ativado, os limites gratuitos não serão aplicados. Use apenas se você tiver uma forma de pagamento configurada no Google AI Studio.
                        </p>
                      </div>
                      <button
                        onClick={() => setHasBillingEnabled(!hasBillingEnabled)}
                        className={`relative w-11 h-6 rounded-full transition-all duration-300 flex-shrink-0 focus:outline-none ${hasBillingEnabled ? 'bg-[#827367] shadow-[0_0_10px_rgba(130,115,103,0.3)]' : 'bg-gray-800'
                          }`}
                      >
                        <div
                          className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-300 shadow-sm ${hasBillingEnabled ? 'translate-x-5' : 'translate-x-0'
                            }`}
                        />
                      </button>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-white/5 space-y-4">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <p className="text-sm font-bold text-gray-300 flex items-center">
                          <Database className="w-4 h-4 mr-2" /> Gerenciar Espaço
                        </p>
                        <p className="text-[10px] text-gray-500 leading-relaxed">
                          Se notar lentidão, o app pode estar sobrecarregado. Recomendamos exportar e excluir lições já dominadas para liberar espaço. Na biblioteca, basta arrastar a lição para a esquerda para acessar as opções de exportar e excluir.
                        </p>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-white/5 space-y-4">
                      <div className="space-y-1">
                        <p className="text-sm font-bold text-gray-300 flex items-center">
                          <RefreshCw className="w-4 h-4 mr-2 text-gray-500" />
                          Monitorar Uso das APIs
                        </p>
                        <p className="text-[10px] text-gray-500 leading-relaxed">
                          Acompanhe em tempo real sua cota gratuita e consumo nos painéis oficiais.
                        </p>
                      </div>
                      <div className="grid grid-cols-1 gap-2">
                        <a
                          href="https://www.assemblyai.com/dashboard/cost"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5 text-[10px] font-bold text-[#827367] hover:text-[#9a8c80] hover:bg-white/[0.04] transition-all group"
                        >
                          <span className="uppercase tracking-widest">MEU USO (ASSEMBLYAI STT)</span>
                          <ExternalLink className="w-3 h-3 text-[#827367] opacity-80 group-hover:opacity-100 transition-opacity" />
                        </a>

                        <a
                          href="https://platform.deepseek.com/usage"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5 text-[10px] font-bold text-[#827367] hover:text-[#9a8c80] hover:bg-white/[0.04] transition-all group"
                        >
                          <span className="uppercase tracking-widest">MEU USO (DEEPSEEK V3 INTELLIGENCE)</span>
                          <ExternalLink className="w-3 h-3 text-[#827367] opacity-80 group-hover:opacity-100 transition-opacity" />
                        </a>

                        <a
                          href="https://aistudio.google.com/app/plan"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5 text-[10px] font-bold text-[#827367] hover:text-[#9a8c80] hover:bg-white/[0.04] transition-all group"
                        >
                          <span className="uppercase tracking-widest">MEU USO (GOOGLE GEMINI TTS)</span>
                          <ExternalLink className="w-3 h-3 text-[#827367] opacity-80 group-hover:opacity-100 transition-opacity" />
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Hidden Folder Input for Audio Sync */}
        <input
          type="file"
          ref={folderInputRef}
          style={{ display: 'none' }}
          onChange={handleSyncAudioFolder}
          multiple
          {...({ webkitdirectory: "", directory: "" } as any)}
        />

        <VideoSyncModal
          isOpen={showSyncModal}
          onClose={() => setShowSyncModal(false)}
          isProcessing={isSyncingVideo}
          hasExistingVideo={!!(currentTrack?.isVideo || currentTrack?.youtubeId || currentTrack?.localVideoUrl || currentTrack?.videoFileName)}
          onRemove={async () => {
            if (!currentTrack) return;
            // Physically remove video data from DB (buffers and metadata)
            await removeTrackVideo(currentTrack.id);

            // Update local state with explicit removal
            const cleanedTrack = { ...currentTrack };
            delete cleanedTrack.youtubeId;
            delete cleanedTrack.localVideoUrl;
            delete cleanedTrack.videoFileName;
            cleanedTrack.isVideo = false;

            setPlaylist(prev => prev.map(t => t.id === cleanedTrack.id ? cleanedTrack : t));
            setShowSyncModal(false);
          }}
          onContinue={async (url, videoFile) => {
            if (!currentTrack) return;

            setIsSyncingVideo(true);
            try {
              const updates: Partial<AudioTrack> = {};

              if (url) {
                const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
                const match = url.match(regExp);
                if (match && match[2].length === 11) {
                  updates.youtubeId = match[2];
                  updates.isVideo = true;
                  // Clear local video when YouTube is synced
                  updates.localVideoUrl = null as any;
                  updates.videoFileName = null as any;
                } else {
                  alert("Link do YouTube inválido.");
                  return;
                }
              }

              if (videoFile) {
                updates.localVideoUrl = URL.createObjectURL(videoFile);
                updates.videoFileName = videoFile.name;
                updates.isVideo = true;
                // Clear YouTube when local video is synced
                updates.youtubeId = null as any;
                await saveTrackVideo(currentTrack.id, videoFile);
              }

              handleUpdateTrack(updates);
              setShowSyncModal(false);
            } catch (err) {
              console.error("Sync failed:", err);
            } finally {
              setIsSyncingVideo(false);
            }
          }}
        />

        {/* Help Modal */}
        <AnimatePresence>
          {showHelp && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
              onClick={() => setShowHelp(false)}
            >
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 20, opacity: 0 }}
                className="w-full max-w-2xl bg-[#0d0d0d] border border-white/10 rounded-3xl overflow-hidden shadow-2xl"
                onClick={e => e.stopPropagation()}
              >
                <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                  <div className="flex items-center space-x-3">
                    <Info className="w-5 h-5 text-[#827367]" />
                    <h3 className="text-lg font-bold text-gray-200">Guia do LingoSync</h3>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setShowHelp(false)} className="rounded-full">
                    <X className="w-5 h-5" />
                  </Button>
                </div>

                <ScrollArea className="h-[70vh] p-8">
                  <div className="space-y-10 pb-10">
                    <section className="space-y-4">
                      <h4 className="text-xl font-bold text-gray-200 border-l-2 border-[#827367] pl-4">Como o LingoSync ajuda você?</h4>
                      <p className="text-gray-400 text-sm leading-relaxed">
                        O LingoSync aplica a técnica de <b>Input Compreensivo</b>. Isso significa que você aprende inglês entendendo o contexto real do que ouve. Com legendas sincronizadas e o apoio do <b>LingoSync</b>, seu cérebro absorve o novo idioma de forma muito mais rápida e divertida.
                      </p>
                    </section>

                    <section className="space-y-4">
                      <h4 className="text-xl font-bold text-gray-200 border-l-2 border-[#827367] pl-4">Aprenda Editando: O Estudo Ativo</h4>
                      <p className="text-gray-400 text-sm leading-relaxed">
                        O <b>LingoSync</b> gera alguns segmentos com precisão na sincronização entre texto e áudio e outros precisam de refinamento manual no <b>Modo de Edição</b> para ajustar o tempo exato do áudio com o texto, o que tem <b>propósito pedagógico</b>. A ferramenta foi projetada para <b>estudo ativo</b> por meio de sua interação com as legendas inteligentes produzida nela, transformando a criação e estudo das lições em aprendizado real.
                      </p>
                    </section>

                    <section className="space-y-6">
                      <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Recursos para acelerar seu aprendizado</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-2">
                          <p className="text-sm font-bold text-gray-300">Transcrição Inteligente</p>
                          <p className="text-[11px] text-gray-500">Basta subir seu áudio (MP3 ou WAV) e o <b>LingoSync</b> gera as legendas em inglês e português na hora para você.</p>
                        </div>
                        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-2">
                          <p className="text-sm font-bold text-gray-300">Personalize sua Lição</p>
                          <p className="text-[11px] text-gray-500">Clique em qualquer frase para ajustar o texto. Use o <b>Enter</b> para dividir uma frase longa em duas partes menores.</p>
                        </div>
                        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-2">
                          <p className="text-sm font-bold text-gray-300">Sincronização Avançada</p>
                          <p className="text-[11px] text-gray-500">O botão <b>Ajustar Tradução</b> utiliza a inteligência do <b>LingoSync</b> para alinhar sua edição perfeitamente.</p>
                        </div>
                        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-2">
                          <p className="text-sm font-bold text-gray-300">Leve suas Lições com Você</p>
                          <p className="text-[11px] text-gray-500">Exporte suas lições como arquivos <b>.lsync.json</b> e estude em qualquer outro dispositivo quando quiser.</p>
                        </div>
                      </div>
                    </section>

                    <section className="p-6 rounded-2xl bg-[#827367]/5 border border-[#827367]/10 space-y-4">
                      <div className="flex items-center space-x-3 text-[#827367]">
                        <Key className="w-5 h-5" />
                        <h4 className="font-bold">Poder e Controle Total no Seu Bolso</h4>
                      </div>
                      <p className="text-[13px] text-gray-300 leading-relaxed font-medium">
                        Com o <b>LingoSync</b>, você é o dono da sua jornada. Diferente de outros apps com assinaturas caras, aqui você tem uma <b>ferramenta poderosa</b> sob seu comando absoluto.
                      </p>
                      <div className="space-y-3 bg-[#0d0d0d] p-4 rounded-xl border border-white/5">
                        <p className="text-[12px] text-gray-400">
                          <b>Economia Real:</b> Ao usar sua própria chave, você paga apenas pelo que consome. Transcrever <b>uma hora inteira de áudio</b> custa apenas <b>alguns centavos de dólar</b>.
                        </p>
                        <p className="text-[12px] text-gray-400">
                          <b>Segurança Financeira:</b> No painel do Google, você pode definir um <b>limite mensal</b> (como $1 ou $5 dólares). Assim, você aproveita o <b>LingoSync</b> com total previsibilidade.
                        </p>
                      </div>
                      <p className="text-[12px] text-gray-400 leading-relaxed">
                        Essa solução foi desenvolvida para revolucionar o custo-benefício no aprendizado de idiomas. Tudo é transparente para sua tranquilidade e satisfação em primeiro lugar. Ah, o <b>LingoSync</b> processa tudo de forma <b>local</b> e seus áudios nunca saem do seu <b>dispositivo</b>.
                      </p>
                    </section>

                    <section className="space-y-4 pt-4 border-t border-white/5">
                      <div className="flex items-center space-x-3 text-gray-400">
                        <Shield className="w-5 h-5" />
                        <h4 className="font-bold">Termos e Privacidade</h4>
                      </div>
                      <div className="space-y-4 text-[11px] text-gray-500 leading-relaxed">
                        <p>
                          <b>1. Uso do Serviço:</b> O <b>LingoSync</b> é uma ferramenta de auxílio ao estudo de idiomas. Ao utilizá-lo, você concorda com o processamento <b>local</b> de seus dados para fins educacionais.
                        </p>
                        <p>
                          <b>2. Privacidade de Dados:</b> Temos um compromisso rigoroso com a transparência. Seus arquivos de áudio e transcrições <b>não são enviados para nossos servidores</b>. Tudo é armazenado no banco de dados do seu próprio <b>dispositivo</b> (IndexedDB).
                        </p>
                        <p>
                          <b>3. Segurança da API:</b> A <b>Gemini API Key</b> que você insere fica guardada de forma segura apenas no seu navegador. O <b>LingoSync</b> nunca compartilha sua chave com terceiros, utilizando-a exclusivamente para a comunicação direta entre seu dispositivo e o Google.
                        </p>
                        <p>
                          <b>4. Futuras Atualizações:</b> O <b>LingoSync</b> é disponibilizado hoje de forma gratuita para aprimorar sua experiência. O desenvolvedor reserva-se o direito de, futuramente, oferecer a ferramenta em lojas oficiais (como Google Play) sob a modalidade de <b>pagamento único</b>, como reconhecimento pelo valor e desenvolvimento desta ferramenta.
                        </p>
                        <p>
                          <b>5. Uso Legal de Conteúdos:</b> Ao utilizar o <b>LingoSync</b>, você concorda em carregar apenas arquivos de áudio (e vídeos) que você obteve de forma legal e para os quais possui direitos de uso, reprodução e modificação para fins educacionais pessoais. O <b>LingoSync</b> não deve ser utilizado com conteúdos protegidos por direitos autorais sem a devida autorização dos titulares dos direitos.
                        </p>
                        <p>
                          <b>6. Isenção de Responsabilidade:</b> Esta ferramenta é fornecida "como está". O desenvolvedor não se responsabiliza por eventuais custos gerados na sua conta do Google AI Studio, nem por quaisquer questões relacionadas a violações de direitos autorais ou uso indevido de conteúdos carregados pelo usuário. Qualquer responsabilidade decorrente do uso do <b>LingoSync</b> é exclusiva do usuário.
                        </p>
                        <p>
                          <b>7. Dados no Google Gemini (Importante):</b> Ao usar o <b>LingoSync</b> com sua chave do Google AI Studio, você concorda que os dados enviados ao Gemini (áudios transcritos, textos traduzidos e outros conteúdos) <b>podem ser lidos por revisores humanos do Google para melhorar e treinar modelos de IA</b>. Isso faz parte da política de privacidade do plano gratuito do AI Studio. Para fins educacionais pessoais, considere usar conteúdo público ou de domínio público.
                        </p>
                      </div>
                    </section>
                  </div>
                </ScrollArea>
              </motion.div>
            </motion.div>
          )}
          {showKeyAlert && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
              onClick={() => setShowKeyAlert(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 20 }}
                className="w-full max-w-sm bg-[#161616] border border-[#827367]/30 rounded-3xl overflow-hidden shadow-2xl relative"
                onClick={e => e.stopPropagation()}
              >
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#827367]/50 to-transparent" />
                <div className="p-8 text-center space-y-6">
                  <div className="w-16 h-16 bg-[#827367]/10 rounded-2xl flex items-center justify-center mx-auto border border-[#827367]/20">
                    <Key className="w-8 h-8 text-[#827367]" />
                  </div>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <h3 className="text-xl font-bold text-gray-200">Chave API do Google necessária</h3>
                      <p className="text-[10px] text-gray-500 leading-relaxed font-medium">
                        Ao criar sua API, o plano gratuito é ativado por padrão. Para uso além do limite gratuito diário, o Google solicitará a configuração de um método de pagamento.
                      </p>
                      <p className="text-[11px] text-[#827367] leading-relaxed uppercase tracking-widest font-bold pt-1">Tutorial rápido em 3 passos:</p>
                    </div>

                    <div className="text-left space-y-3">
                      <div className="flex items-start space-x-3 p-3 rounded-xl bg-white/[0.02] border border-white/5">
                        <div className="w-5 h-5 rounded-full bg-[#827367]/20 text-[#827367] flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">1</div>
                        <p className="text-[12px] text-gray-400 leading-tight">Acesse o <b>Google AI Studio</b> através do link abaixo ou nas configurações.</p>
                      </div>
                      <div className="flex items-start space-x-3 p-3 rounded-xl bg-white/[0.02] border border-white/5">
                        <div className="w-5 h-5 rounded-full bg-[#827367]/20 text-[#827367] flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">2</div>
                        <p className="text-[12px] text-gray-400 leading-tight">Escolha <b>"Create API key in new project"</b>. Ignore opções como "projeto importado" para ser mais rápido.</p>
                      </div>
                      <div className="flex items-start space-x-3 p-3 rounded-xl bg-white/[0.02] border border-white/5">
                        <div className="w-5 h-5 rounded-full bg-[#827367]/20 text-[#827367] flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">3</div>
                        <p className="text-[12px] text-gray-400 leading-tight">Clique em <b>"Configurar Chave"</b> e cole o código no campo de senha.</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col space-y-3">
                    <Button
                      onClick={() => {
                        setShowKeyAlert(false);
                        setShowSettings(true);
                      }}
                      className="w-full bg-[#827367] hover:bg-[#9a8c80] text-gray-200 font-bold uppercase tracking-widest h-12 rounded-xl"
                    >
                      Configurar Chave Agora
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setShowKeyAlert(false)}
                      className="text-gray-600 hover:text-gray-400 text-[10px] font-bold uppercase tracking-widest"
                    >
                      Ignorar por enquanto
                    </Button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        <QuotaExceededModal
          isOpen={showQuotaModal}
          onClose={() => setShowQuotaModal(false)}
        />

        <AnimatePresence>
          {showAudioErrorModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
              onClick={() => setShowAudioErrorModal(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 20 }}
                className="w-full max-w-sm bg-[#161616] border border-[#827367]/30 rounded-3xl overflow-hidden shadow-2xl relative"
                onClick={e => e.stopPropagation()}
              >
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#827367]/50 to-transparent" />
                <div className="p-8 text-center space-y-6">
                  <div className="w-16 h-16 bg-[#827367]/10 rounded-2xl flex items-center justify-center mx-auto border border-[#827367]/20">
                    <AudioLines className="w-8 h-8 text-[#827367]" />
                  </div>
                  <div className="space-y-4">
                    <h3 className="text-xl font-bold text-gray-200">Falha ao gerar som do flashcard</h3>
                    <p className="text-[12px] text-gray-400 leading-relaxed">
                      {audioErrorMessage || "Não foi possível gerar a pronúncia desta palavra no momento."}
                    </p>
                  </div>
                  <Button
                    onClick={() => setShowAudioErrorModal(false)}
                    className="w-full bg-[#827367] hover:bg-[#9a8c80] text-gray-200 font-bold uppercase tracking-widest h-12 rounded-xl"
                  >
                    Entendi
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Missing Audio Modal */}
        <AnimatePresence>
          {showMissingAudioModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl"
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 20 }}
                className="w-full max-w-sm bg-[#161616] border border-[#827367]/30 rounded-3xl overflow-hidden shadow-2xl relative"
                onClick={e => e.stopPropagation()}
              >
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#827367]/50 to-transparent" />
                <div className="p-8 text-center space-y-6">
                  <div className="w-16 h-16 bg-[#827367]/10 rounded-2xl flex items-center justify-center mx-auto border border-[#827367]/20">
                    <AudioLines className="w-8 h-8 text-[#827367]" />
                  </div>
                  <div className="space-y-4">
                    <h3 className="text-xl font-bold text-gray-200">Áudio não encontrado</h3>
                    <div className="text-left space-y-3">
                      <p className="text-[12px] text-gray-400 leading-relaxed">
                        Não conseguimos localizar o áudio original desta lição. Isso pode acontecer se o arquivo foi <b>renomeado</b>, <b>movido</b> ou <b>excluído</b> do seu dispositivo.
                      </p>
                      <div className="p-4 rounded-2xl bg-[#827367]/5 border border-[#827367]/10 space-y-3">
                        <p className="text-[11px] text-[#a39487] font-medium">
                          Para ouvir o áudio, selecione a pasta onde o arquivo <b>{currentTrack?.audioFileName || "original"}</b> está localizado.
                        </p>
                        <Button
                          onClick={() => {
                            const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
                            const canUseDirectoryPicker = !isSafari && 'showDirectoryPicker' in window;
                            if (canUseDirectoryPicker) {
                              handleSyncAudioFolder();
                            } else {
                              folderInputRef.current?.click();
                            }
                          }}
                          disabled={isSyncingAudio}
                          className="w-full bg-[#827367] hover:bg-[#9a8c80] text-gray-100 font-bold uppercase tracking-widest text-[10px] h-10 rounded-xl flex items-center justify-center space-x-2 transition-all shadow-lg shadow-[#827367]/10"
                        >
                          {isSyncingAudio ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span>Buscando... {syncProgress}%</span>
                            </>
                          ) : (
                            <>
                              <RotateCw className="w-3.5 h-3.5" />
                              <span>Sincronizar Áudio</span>
                            </>
                          )}
                        </Button>
                        {isSyncingAudio && (
                          <div className="mt-3">
                            <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                              <div className="h-full bg-[#827367] transition-all duration-200" style={{ width: `${syncProgress}%` }} />
                            </div>
                            <p className="text-[11px] text-gray-400 uppercase tracking-[0.2em] mt-2">
                              {syncProgress}% concluído
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setShowMissingAudioModal(false);
                      setCurrentView('library');
                    }}
                    className="text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    Biblioteca
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Rate Limit Modal */}
        <RateLimitModal
          isVisible={isRateLimited}
          secondsRemaining={rateLimitSecondsRemaining}
          model={rateLimitModel}
          isDailyLimit={isRateLimitDaily}
        />
      </div>
    </>
  );
}

