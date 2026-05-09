import React, { useState, useRef, useEffect, useCallback } from "react";
import { AudioPlayer } from "./components/AudioPlayer";
import { INITIAL_PLAYLIST } from "./constants";
import { AudioTrack, TranscriptSegment, Word } from "./types";
// import { ScrollArea } from "@/components/ui/scroll-area";
const ScrollArea = ({ children, className }: any) => <div className={className} style={{ overflowY: 'auto' }}>{children}</div>;
// import { Badge } from "@/components/ui/badge";
const Badge = ({ children, className }: any) => <span className={className}>{children}</span>;
import { VideoSyncModal } from "./components/VideoSyncModal";
import { GerarLicaoModal } from "./components/GerarLicaoModal";
import { VideoSourcePrompt } from "./components/VideoSourcePrompt";
import { Headphones, Loader2, Download, Upload, ArrowLeft, Trash2, Settings2, Info, ExternalLink, Key, Database, RefreshCw, X, Shield, RectangleVertical, AudioLines, Library, RotateCw, ChevronDown, Link2, Languages, Coins, UserCircle, LogOut, CloudDownload, Eye, EyeOff } from "lucide-react";
// import { Button } from "@/components/ui/button";
const Button = ({ children, className, variant, size, ...props }: any) => <button className={className} {...props}>{children}</button>;
import { motion, AnimatePresence, useMotionValue } from "motion/react";
import { transcribeAudio } from "./lib/gemini";
import { cn } from "@/lib/utils";
import { FlashcardsView } from "./components/FlashcardsView";
import { saveTrack, getSavedTracks, deleteTrack, updateTrackMetadata, clearAllTracks, saveTrackVideo, removeTrackVideo, removeTrackAudio, saveLastDirectoryHandle, getLastDirectoryHandle } from "./lib/db";
import { get, set } from "idb-keyval";
import { googleDriveService } from "./services/googleDriveService";
import { CloudOff, CloudUpload, AlertCircle } from "lucide-react";

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

const LingoSyncLogo = ({ className = "w-10 h-10" }: { className?: string }) => (
  <div className={cn("relative flex items-center justify-center", className)}>
    <svg 
      viewBox="0 0 512 512" 
      className="w-full h-full" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      shapeRendering="geometricPrecision"
      textRendering="geometricPrecision"
    >
      {/* Simple L at the left */}
      <text 
        x="40" 
        y="360" 
        fill="#827367" 
        fontSize="240" 
        fontWeight="900" 
        style={{ fontFamily: 'system-ui, sans-serif' }}
      >
        L
      </text>

      {/* Real Compass Icon - Centered composition */}
      <g transform="translate(40, 20)">
        <g stroke="#827367" strokeWidth="25" strokeLinecap="round" strokeLinejoin="round">
          {/* Left leg with needle point */}
          <path d="M170 100L85 340" />
          <path d="M85 340L75 380" strokeWidth="15" />
          
          {/* Right leg with pencil/pen holder */}
          <path d="M170 100L255 340" />
          <path d="M255 340L265 380" strokeWidth="50" />
          
          {/* Hinge and handle */}
          <circle cx="170" cy="100" r="22" fill="#827367" stroke="none" />
          <path d="M170 100V60" strokeWidth="40" />
          
          {/* Adjustment screw/arc */}
          <path d="M115 230C135 220 205 220 225 230" strokeWidth="12" opacity="0.6" />
          <circle cx="170" cy="225" r="12" fill="#827367" stroke="none" />
        </g>
      </g>
      
      {/* Small s above 文 character */}
      <text 
        x="330" 
        y="190" 
        fill="#827367" 
        fontSize="160" 
        fontWeight="900" 
        style={{ fontFamily: 'system-ui, sans-serif' }}
      >
        s
      </text>

      {/* 文 character */}
      <text 
        x="320" 
        y="360" 
        fill="#827367" 
        fontSize="170" 
        fontWeight="900" 
        style={{ fontFamily: 'system-ui, sans-serif' }}
      >
        文
      </text>
    </svg>
  </div>
);

function LanguageSelector({ currentLanguage, onLanguageChange, exclude, className }: { currentLanguage: string, onLanguageChange: (code: string) => void, exclude?: string, className?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedLang = SUPPORTED_LANGUAGES.find(l => l.code === currentLanguage) || SUPPORTED_LANGUAGES[0];

  useEffect(() => {
    if (isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const dropdownWidth = 120;
      setAlignRight(rect.right + dropdownWidth > viewportWidth);
    }
  }, [isOpen]);

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
        className={cn("flex items-center space-x-1 hover:opacity-80 transition-opacity focus:outline-none uppercase tracking-widest", className || "text-xs font-bold text-[#827367]")}
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
            className={cn(
              "absolute top-full mt-2 z-[100] bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl py-1 min-w-[80px] overflow-hidden",
              alignRight ? "right-0" : "left-0"
            )}
          >
            {SUPPORTED_LANGUAGES.filter(l => l.code !== exclude).map((lang) => (
              <button
                key={lang.code}
                onClick={() => {
                  onLanguageChange(lang.code);
                  setIsOpen(false);
                }}
                className={cn(
                  "w-full text-left px-4 py-2 text-xs font-bold uppercase tracking-widest hover:bg-white/5 transition-colors",
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
  const allWords = normalized.split(/\s+/).filter(Boolean);
  if (allWords.length <= 1) return chunkSizes.map((_, i) => (i === 0 ? normalized : ""));

  const sentences: string[] = [];
  const sentenceRegex = /[^.!?]*[.!?]+/g;
  let match;
  while ((match = sentenceRegex.exec(normalized)) !== null) {
    sentences.push(match[0].trim());
  }
  const remainder = normalized.replace(sentenceRegex, "").trim();
  if (remainder) sentences.push(remainder);
  if (sentences.length === 0) sentences.push(normalized);

  const sentenceWordCounts = sentences.map(s => s.split(/\s+/).filter(Boolean).length);
  const totalTranslationWords = sentenceWordCounts.reduce((a, b) => a + b, 0);
  const totalTextWords = chunkSizes.reduce((a, b) => a + b, 0);

  const result: string[] = chunkSizes.map(() => "");
  let sentenceIdx = 0;

  chunkSizes.forEach((chunkSize, chunkIdx) => {
    if (sentenceIdx >= sentences.length) return;

    const targetWords = (chunkSize / totalTextWords) * totalTranslationWords;
    let accumulatedWords = 0;
    const accumulatedSentences: string[] = [];

    while (sentenceIdx < sentences.length) {
      const nextWords = sentenceWordCounts[sentenceIdx];

      if (chunkIdx === chunkSizes.length - 1) {
        accumulatedSentences.push(sentences[sentenceIdx]);
        accumulatedWords += nextWords;
        sentenceIdx++;
        continue;
      }

      const remainingChunks = chunkSizes.length - 1 - chunkIdx;
      const remainingSentenceWords = sentenceWordCounts.slice(sentenceIdx).reduce((a, b) => a + b, 0);
      const minNeeded = remainingSentenceWords - (remainingChunks * 3);

      if (accumulatedWords > 0 && accumulatedWords + nextWords > targetWords * 1.5 && accumulatedWords >= minNeeded) {
        break;
      }

      accumulatedSentences.push(sentences[sentenceIdx]);
      accumulatedWords += nextWords;
      sentenceIdx++;

      if (accumulatedWords >= targetWords && accumulatedWords >= 1) {
        break;
      }
    }

    result[chunkIdx] = accumulatedSentences.join(" ");
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
    const textWords = segment.text.trim().split(/\s+/).filter(Boolean);
    const textWordCount = textWords.length;

    if (textWordCount <= MAX_WORDS_PER_SEGMENT) {
      rebuilt.push(segment);
      continue;
    }

    const hasWordsArray = Array.isArray(segment.words) && segment.words.length > 0;
    const wordIterations = hasWordsArray ? segment.words : splitTextIntoEstimatedWords(segment.text, segment.start, segment.end);
    const textChunks = splitSegmentTextPreservingPunctuation(segment.text, MAX_WORDS_PER_SEGMENT);
    const chunks: Word[][] = [];
    for (let i = 0; i < wordIterations.length; i += MAX_WORDS_PER_SEGMENT) {
      chunks.push(wordIterations.slice(i, i + MAX_WORDS_PER_SEGMENT));
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

function splitTextIntoEstimatedWords(text: string, start: number, end: number): Word[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const duration = end - start;
  const avgWordDuration = duration / words.length;
  return words.map((w, i) => ({
    text: w,
    start: start + i * avgWordDuration,
    end: start + (i + 1) * avgWordDuration
  }));
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
  const playlistRef = useRef(playlist);
  playlistRef.current = playlist;

  // latestTrackRef sempre tem o estado MAIS RECENTE de cada track.
  // performSync SEMPRE le deste ref, garantindo que o sync nunca use dados parciais.
  const latestTrackRef = useRef<Map<string, AudioTrack>>(new Map());
  const syncLatestToRef = (track: AudioTrack) => {
    const existing = latestTrackRef.current.get(track.id);
    if (!existing) {
      latestTrackRef.current.set(track.id, track);
      return;
    }
    const merged = { ...existing, ...track };
    if (track.flashcards && existing.flashcards) {
      merged.flashcards = existing.flashcards.map((ec, i) => {
        const tc = track.flashcards![i];
        if (tc && ec.id === tc.id) {
          const mergedAudio: Record<string, string> = {};
          if (ec.audioBase64 && typeof ec.audioBase64 === 'object') {
            Object.assign(mergedAudio, ec.audioBase64);
          }
          if (tc.audioBase64 && typeof tc.audioBase64 === 'object') {
            Object.assign(mergedAudio, tc.audioBase64);
          } else if (tc.audioBase64 && typeof tc.audioBase64 === 'string') {
            mergedAudio._legacy = tc.audioBase64;
          }
          return { ...ec, ...tc, audioBase64: mergedAudio };
        }
        return tc || ec;
      });
    }
    latestTrackRef.current.set(track.id, merged as AudioTrack);
  };
  const syncManyToRef = (tracks: AudioTrack[]) => {
    for (const t of tracks) {
      latestTrackRef.current.set(t.id, t);
    }
  };

  const [isTranscribing, setIsTranscribing] = useState(false);
  const [showFlashcards, setShowFlashcards] = useState(false);
  const [isGeneratingCards, setIsGeneratingCards] = useState(false);
  const [isGoogleLoggedIn, setIsGoogleLoggedIn] = useState(googleDriveService.isLoggedIn());
  const [isSyncing, setIsSyncing] = useState<string | null>(null);
  const syncDirectionRef = useRef<'upload' | 'download' | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const dirtyTracksRef = useRef<Set<string>>(new Set());
  const syncingTrackIdRef = useRef<string | null>(null);
  const deletedDriveIdsRef = useRef<Set<string>>(new Set(JSON.parse(localStorage.getItem('lingosync_deleted_drive_ids') || '[]')));
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: () => void; onCancel: () => void } | null>(null);

  const showConfirm = (title: string, message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmDialog({
        isOpen: true,
        title,
        message,
        onConfirm: () => {
          setConfirmDialog(null);
          resolve(true);
        },
        onCancel: () => {
          setConfirmDialog(null);
          resolve(false);
        },
      });
    });
  };
  const requestSyncImmediate = (trackId: string) => {
    if (!isGoogleLoggedIn) return;

    if (syncingTrackIdRef.current === trackId) {
      dirtyTracksRef.current.add(trackId);
      return;
    }

    performSync(trackId);
  };

  const performSync = async (trackId: string) => {
    syncingTrackIdRef.current = trackId;
    dirtyTracksRef.current.delete(trackId);

    const track = latestTrackRef.current.get(trackId);
    if (!track) {
      syncingTrackIdRef.current = null;
      return;
    }

    await syncTrackToDrive(track);

    syncingTrackIdRef.current = null;

    if (dirtyTracksRef.current.has(trackId)) {
      dirtyTracksRef.current.delete(trackId);
      performSync(trackId);
    }
  };

  const syncTrackToDrive = async (track: AudioTrack, retryCount = 0): Promise<boolean> => {
    if (!isGoogleLoggedIn) return false;
    syncDirectionRef.current = 'upload';
    setIsSyncing(track.id);
    setDownloadProgress(prev => ({ ...prev, [track.id]: 0 }));
    let mergedTrack = { ...track };
    let progressInterval: ReturnType<typeof setInterval> | null = null;
    const startProgress = () => {
      let pct = 0;
      progressInterval = setInterval(() => {
        if (pct < 95) {
          const increment = pct < 30 ? 5 : pct < 60 ? 3 : pct < 80 ? 1.5 : 0.5;
          pct = Math.min(95, Math.round(pct + increment * (0.5 + Math.random() * 0.5)));
          setDownloadProgress(prev => ({ ...prev, [track.id]: pct }));
        }
      }, 300);
    };
    startProgress();
    try {
      let driveAudioFileId = track.driveAudioFileId;
      const storedTracks = await get<any[]>('lingosync_tracks') || [];
      const storedTrack = storedTracks.find((t: any) => t.id === track.id);

      // BEFORE uploading, merge with remote state to avoid overwriting advanced progress from other devices
      mergedTrack = { ...track };
      if (track.driveFileId) {
        try {
          const jsonBlob = await googleDriveService.downloadFile(track.driveFileId);
          const jsonData = JSON.parse(await jsonBlob.text());
          const remoteTrack = jsonData as AudioTrack;

          // Merge knownWords: keep superset
          const localKnown = (track.knownWords || []).map((w: string) => w.toLowerCase());
          const remoteKnown = (remoteTrack.knownWords || []).map((w: string) => w.toLowerCase());
          const mergedKnown = [...new Set([...localKnown, ...remoteKnown])];

          // Merge flashcards: take remote if local is empty; otherwise merge audioBase64
          let mergedFlashcards = track.flashcards;
          if (remoteTrack.flashcards && remoteTrack.flashcards.length > 0) {
            if (!mergedFlashcards || mergedFlashcards.length === 0) {
              mergedFlashcards = remoteTrack.flashcards;
            } else {
              const newFlashcards = [...mergedFlashcards];
              for (let i = 0; i < remoteTrack.flashcards.length; i++) {
                const rc = remoteTrack.flashcards[i];
                const lc = newFlashcards[i];
                if (lc && rc && lc.id === rc.id && rc.audioBase64) {
                  const mergedAudio = { ...(typeof lc.audioBase64 === 'object' ? lc.audioBase64 : {}), ...(typeof rc.audioBase64 === 'object' ? rc.audioBase64 : {}) };
                  if (Object.keys(mergedAudio).length > Object.keys(typeof lc.audioBase64 === 'object' ? lc.audioBase64 : {}).length) {
                    newFlashcards[i] = { ...lc, audioBase64: mergedAudio };
                  }
                }
              }
              mergedFlashcards = newFlashcards;
            }
          }

          // Merge metadata usando timestamp como fonte da verdade
          // Se remote e mais recente, usa os metadados do remote
          const remoteUpdatedAt = remoteTrack.updatedAt || 0;
          const localUpdatedAt = mergedTrack.updatedAt || 0;
          if (remoteUpdatedAt > localUpdatedAt) {
            const metadataFields: (keyof AudioTrack)[] = ['title', 'lessonNumber', 'artist', 'coverUrl', 'language', 'updatedAt'];
            const remoteMetadata: Partial<AudioTrack> = {};
            for (const field of metadataFields) {
              if (remoteTrack[field] !== undefined && remoteTrack[field] !== mergedTrack[field]) {
                (remoteMetadata as any)[field] = remoteTrack[field];
              }
            }
            mergedTrack = { ...mergedTrack, ...remoteMetadata };
          }

          mergedTrack = { ...mergedTrack, knownWords: mergedKnown, flashcards: mergedFlashcards };
          // Update ref with merged data before upload so subsequent operations use correct state
          syncLatestToRef(mergedTrack);
        } catch (err) {
          console.debug("Could not fetch remote state for merge before upload:", err);
        }
      }
      
      if (storedTrack?.audioBuffer) {
        const audioBlob = new Blob([storedTrack.audioBuffer], { type: storedTrack.audioType || 'audio/wav' });
        const audioFileName = mergedTrack.audioFileName || `${mergedTrack.title}.mp3`;
        driveAudioFileId = await googleDriveService.uploadFile(audioFileName, audioBlob, storedTrack.audioType || 'audio/mpeg', track.driveAudioFileId);
      }

      const exportData: any = { ...mergedTrack, driveAudioFileId };
      delete exportData.url;
      delete exportData.localVideoUrl;
      delete exportData.syncStatus;

      const jsonBlob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const jsonFileName = `${mergedTrack.title}.lsync.json`;
      const driveFileId = await googleDriveService.uploadFile(jsonFileName, jsonBlob, "application/json", track.driveFileId);

      await updateTrackMetadata(track.id, { 
        driveFileId, 
        driveAudioFileId, 
        syncStatus: 'synced' 
      });
      
      setPlaylist(prev => {
        const updated = prev.map(t => t.id === track.id ? { 
          ...t, 
          driveFileId, 
          driveAudioFileId, 
          syncStatus: 'synced' as const 
        } : t);
        return updated;
      });
      // Update ref separadamente (preserva dados locais mais recentes que ja estao no ref)
      const currentRefTrack = latestTrackRef.current.get(track.id);
      if (currentRefTrack) {
        syncLatestToRef({ ...currentRefTrack, driveFileId, driveAudioFileId, syncStatus: 'synced' } as AudioTrack);
      } else {
        syncLatestToRef({ ...mergedTrack, driveFileId, driveAudioFileId, syncStatus: 'synced' } as AudioTrack);
      }
      return true;
    } catch (error) {
      console.error("Failed to sync to Drive:", error);
      if (retryCount < 5) {
        const delay = Math.min(1000 * Math.pow(2, retryCount), 15000);
        console.log(`[LingoSync] Retrying sync in ${delay}ms (attempt ${retryCount + 1}/5)...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        const refreshedTrack = latestTrackRef.current.get(track.id);
        return syncTrackToDrive(refreshedTrack || mergedTrack, retryCount + 1);
      } else {
        await updateTrackMetadata(track.id, { syncStatus: 'error' });
        setPlaylist(prev => prev.map(t => t.id === track.id ? { ...t, syncStatus: 'error' } : t));
      }
      return false;
    } finally {
      if (progressInterval) clearInterval(progressInterval);
      setDownloadProgress(prev => {
        const next = { ...prev };
        delete next[track.id];
        return next;
      });
      setIsSyncing(null);
    }
  };

  const downloadTrackFromDrive = async (track: AudioTrack) => {
    if (!isGoogleLoggedIn || !track.driveFileId) return;
    syncDirectionRef.current = 'download';
    setIsSyncing(track.id);
    setDownloadProgress(prev => ({ ...prev, [track.id]: 0 }));
    try {
      const jsonBlob = await googleDriveService.downloadFile(track.driveFileId, (pct) => {
        setDownloadProgress(prev => ({ ...prev, [track.id]: Math.min(99, pct) }));
      });
      const jsonData = JSON.parse(await jsonBlob.text());
      
      let audioBlob: Blob | null = null;
      if (track.driveAudioFileId) {
        try {
          audioBlob = await googleDriveService.downloadFile(track.driveAudioFileId, (pct) => {
            setDownloadProgress(prev => ({ ...prev, [track.id]: Math.min(99, 50 + Math.round(pct / 2)) }));
          });
        } catch (audioErr) {
          console.warn("Audio download failed, continuing without audio:", audioErr);
        }
      }
      
      const fallbackAudio = audioBlob || new Blob([new ArrayBuffer(44)], { type: 'audio/wav' });
      const newTrack: AudioTrack = {
        ...jsonData,
        id: track.id,
        url: audioBlob ? URL.createObjectURL(audioBlob) : URL.createObjectURL(fallbackAudio),
        syncStatus: 'synced' as const
      };
      
      await saveTrack(newTrack, fallbackAudio);
      syncLatestToRef(newTrack);
      setPlaylist(prev => prev.map(t => t.id === track.id ? newTrack : t));
      setTimeout(() => evictCacheIfNeeded(), 0);
    } catch (error: any) {
      console.error("Failed to download from Drive:", error);
      const msg = error?.message || String(error) || "";
      const isNotFound = msg.includes("File not found") || msg.includes("404") || msg.includes("Download failed");
      if (isNotFound) {
        await deleteTrack(track.id);
        setPlaylist(prev => {
          const next = prev.filter(t => t.id !== track.id);
          refreshGlobalKnownWords(next);
          return next;
        });
        if (currentTrack?.id === track.id) {
          setCurrentView('library');
          setCurrentTrackIndex(0);
        }
      } else {
        setPlaylist(prev => prev.map(t =>
          t.id === track.id ? { ...t, syncStatus: 'error' as const } : t
        ));
      }
    } finally {
      setIsSyncing(null);
      setDownloadProgress(prev => {
        const next = { ...prev };
        delete next[track.id];
        return next;
      });
    }
  };

  const updateLastAccessed = (trackId: string) => {
    const now = Date.now();
    setPlaylist(prev => prev.map(t =>
      t.id === trackId ? { ...t, lastAccessedAt: now } : t
    ));
    updateTrackMetadata(trackId, { lastAccessedAt: now });
  };

  const evictCacheIfNeeded = () => {
    const maxCached = 5;
    const cachedTracks = playlist.filter(t =>
      t.syncStatus !== 'cloud_only' && t.syncStatus !== 'missing_local' && t.url
    );
    if (cachedTracks.length <= maxCached) return;
    const sorted = [...cachedTracks].sort((a, b) =>
      (a.lastAccessedAt || 0) - (b.lastAccessedAt || 0)
    );
    const toEvict = sorted[0];
    if (!toEvict || !toEvict.driveFileId) return;
    removeTrackAudio(toEvict.id).then(() => {
      if (toEvict.url) URL.revokeObjectURL(toEvict.url);
      setPlaylist(prev => prev.map(t =>
        t.id === toEvict.id ? { ...t, url: '', syncStatus: 'cloud_only' as const } : t
      ));
      updateTrackMetadata(toEvict.id, { syncStatus: 'cloud_only' as const });
    }).catch(err => console.error("Failed to evict track from cache:", err));
  };

  const handleGoogleLogin = async () => {
    try {
      await googleDriveService.login();
      setIsGoogleLoggedIn(true);
    } catch (error: any) {
      if (error.message !== 'user_cancelled' && error.message !== 'access_denied') {
        console.error("Google login failed:", error);
        alert("Falha ao conectar com a nuvem. Tente novamente.");
      }
    }
  };

  const handleGoogleLogout = () => {
    googleDriveService.logout();
    setIsGoogleLoggedIn(false);
  };

  const requireGoogleLogin = async (): Promise<boolean> => {
    if (isGoogleLoggedIn) return true;
    try {
      await googleDriveService.login();
      setIsGoogleLoggedIn(true);
      return true;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (clientId) {
      googleDriveService.initialize(clientId).then(async () => {
        const wasLoggedIn = localStorage.getItem("google_drive_access_token");
        if (wasLoggedIn) {
          const success = await googleDriveService.trySilentLogin();
          setIsGoogleLoggedIn(success);
        } else {
          setIsGoogleLoggedIn(false);
        }
      });
    }
  }, []);

  // Refresh token periodically so the user stays logged in
  useEffect(() => {
    if (!isGoogleLoggedIn) return;
    const interval = setInterval(async () => {
      const refreshed = await googleDriveService.refreshTokenSilently();
      if (!refreshed) {
        setIsGoogleLoggedIn(false);
      }
    }, 25 * 60 * 1000);
    return () => clearInterval(interval);
  }, [isGoogleLoggedIn]);

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

  const [nativeLanguage, setNativeLanguage] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem('lingosync_native_language') || 'pt';
    }
    return 'pt';
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

  useEffect(() => {
    localStorage.setItem('lingosync_native_language', nativeLanguage);
  }, [nativeLanguage]);

  const [ttsWorkerUrl, setTtsWorkerUrl] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem('lingosync_tts_worker_url') || '';
    }
    return '';
  });

  useEffect(() => {
    localStorage.setItem('lingosync_tts_worker_url', ttsWorkerUrl);
  }, [ttsWorkerUrl]);

  const [googleCloudApiKey, setGoogleCloudApiKey] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem('lingosync_google_cloud_api_key') || '';
    }
    return '';
  });

  useEffect(() => {
    localStorage.setItem('lingosync_google_cloud_api_key', googleCloudApiKey);
  }, [googleCloudApiKey]);

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
  const [showGerarLicaoModal, setShowGerarLicaoModal] = useState(false);
  const [showVideoSourcePrompt, setShowVideoSourcePrompt] = useState(false);
  const [pendingVideoSourceFile, setPendingVideoSourceFile] = useState<{ file: File; isVideo: boolean } | null>(null);
  const pendingFileResolveRef = useRef<((value: { cancelled: boolean; youtubeUrl?: string }) => void) | null>(null);
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

  const [returnSegmentIndex, setReturnSegmentIndex] = useState<number | null>(null);
  const [externalJumpToSegmentIndex, setExternalJumpToSegmentIndex] = useState<number | null>(null);

  const handleGerarPorTexto = async ({ title, text, voice }: { title: string; text: string; voice: string }) => {
    setIsTranscribing(true);
    setShowGerarLicaoModal(false);
    try {
      const { requestTtsAudio: requestTts } = await import("./services/geminiService");

      // Generate full audio narration from the input text
      const base64Audio = await requestTts(text, voice);

      // Create audio blob from base64
      const binaryStr = atob(base64Audio);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      const audioBlob = new Blob([bytes], { type: 'audio/mp3' });
      const audioUrl = URL.createObjectURL(audioBlob);

      // Same pipeline as audio lessons: AssemblyAI transcribes the TTS audio,
      // then DeepSeek segments the transcribed text with translations (0.5s buffers via remedySegments)
      const { transcribeAudio } = await import("./lib/gemini");
      const transcript = enforceSegmentWordLimit(
        await transcribeAudio(audioBlob, nativeLanguage, assemblyAiApiKey, deepseekApiKey, hasBillingEnabled)
      );

      const nextLessonNumber = playlist.reduce((max, t) => {
        const num = t.lessonNumber ?? 0;
        return num > max ? num : max;
      }, 0) + 1;

      const newTrack: AudioTrack = {
        id: Date.now().toString(36) + Math.random().toString(36).substring(2),
        title: title,
        artist: "",
        url: audioUrl,
        coverUrl: `https://picsum.photos/seed/${title}/400/400`,
        transcript: transcript,
        language: currentLanguage,
        lessonNumber: nextLessonNumber
      };

      await saveTrack(newTrack, audioBlob);

      setPlaylist((prev) => {
        const newList = [...prev, newTrack];
        setCurrentTrackIndex(newList.length - 1);
        return newList;
      });

      if (isGoogleLoggedIn) {
        syncTrackToDrive(newTrack);
        setTimeout(() => evictCacheIfNeeded(), 500);
      }

      setCurrentView('lesson');
    } catch (error: any) {
      if (error.message === "QUOTA_EXCEEDED") {
        setShowQuotaModal(true);
      } else {
        console.error("Text lesson generation failed:", error);
        const errorMessage = typeof error === 'string' ? error : error?.message;
        alert(`Erro ao gerar lição por texto: ${errorMessage || 'Falha ao processar. Tente novamente mais tarde.'}`);
      }
    } finally {
      setIsTranscribing(false);
    }
  };

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

  const handleOpenFlashcards = async (startIndex: number = 0, segmentIndex?: number) => {
    if (!currentTrack) return;

    // Set the starting index
    setReturnSegmentIndex(segmentIndex ?? null);
    setFlashcardStartIndex(startIndex);

    if (currentTrack.flashcards && currentTrack.flashcards.length > 0) {
      setShowFlashcards(true);
      return;
    }

    // No local flashcards — check Drive before generating new ones
    if (isGoogleLoggedIn && currentTrack.driveFileId) {
      try {
        const jsonBlob = await googleDriveService.downloadFile(currentTrack.driveFileId);
        const jsonData = JSON.parse(await jsonBlob.text());
        const remoteTrack = jsonData as AudioTrack;
        if (remoteTrack.flashcards && remoteTrack.flashcards.length > 0) {
          handleUpdateTrack({ flashcards: remoteTrack.flashcards });
          setShowFlashcards(true);
          return;
        }
      } catch (err) {
        console.debug("Failed to check Drive for flashcards:", err);
      }
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
      const cards = await extractLessonFlashcards(fullTranscript, nativeLanguage, deepseekApiKey, hasBillingEnabled);
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
          syncManyToRef(saved);
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

  // Check Drive for restore when user logs in (after playlist is loaded)
  const checkDriveRestore = useCallback(async () => {
    if (!isGoogleLoggedIn) return;
    try {
      const files = await googleDriveService.listFiles();
      const lsyncFiles = files.filter(f => f.name.endsWith('.lsync.json'));
      const driveFileIds = new Set(lsyncFiles.map(f => f.id));

      // Remove ANY track whose Drive file no longer exists (deleted from another device)
      const currentPlaylist = playlistRef.current;
      const staleTracks = currentPlaylist.filter(t =>
        t.driveFileId &&
        !driveFileIds.has(t.driveFileId)
      );
      if (staleTracks.length > 0) {
        for (const stale of staleTracks) {
          await deleteTrack(stale.id);
        }
        setPlaylist(prev => {
          const staleIds = new Set(staleTracks.map(t => t.id));
          const next = prev.filter(t => !staleIds.has(t.id));
          refreshGlobalKnownWords(next);
          return next;
        });
        if (staleTracks.some(t => t.id === currentTrack?.id)) {
          setCurrentView('library');
          setCurrentTrackIndex(0);
        }
      }

      // Restore lessons from Drive that aren't in the local playlist
      const localDriveIds = currentPlaylist
        .filter(t => t.driveFileId && !staleTracks.some(s => s.id === t.id))
        .map(t => t.driveFileId)
        .filter(Boolean);
      
      const missingFiles = lsyncFiles.filter(f => !localDriveIds.includes(f.id) && !deletedDriveIdsRef.current.has(f.id));

      // Clean up deletedDriveIdsRef for files that no longer exist on Drive
      let cleaned = false;
      for (const deletedId of deletedDriveIdsRef.current) {
        if (!driveFileIds.has(deletedId)) {
          deletedDriveIdsRef.current.delete(deletedId);
          cleaned = true;
        }
      }
      if (cleaned) {
        localStorage.setItem('lingosync_deleted_drive_ids', JSON.stringify([...deletedDriveIdsRef.current]));
      }
      
      if (missingFiles.length > 0) {
        const confirmRestore = await showConfirm(
          "Lições encontradas na nuvem",
          `Encontramos ${missingFiles.length} lição(ões) sua(s) na nuvem que não estão salvas neste app. Deseja restaurá-las?`
        );
        if (confirmRestore) {
          for (const file of missingFiles) {
            try {
              const jsonBlob = await googleDriveService.downloadFile(file.id);
              const jsonData = JSON.parse(await jsonBlob.text());
              
              const newTrack: AudioTrack = {
                ...jsonData,
                url: '',
                syncStatus: 'missing_local',
                driveFileId: file.id,
              };
              
              localStorage.setItem(`drive_lesson_${newTrack.id}`, JSON.stringify({
                title: newTrack.title,
                driveFileId: file.id,
                driveAudioFileId: newTrack.driveAudioFileId,
              }));
              
              setPlaylist(prev => {
                const exists = prev.some(t => t.id === newTrack.id || t.driveFileId === file.id);
                if (exists) return prev;
                syncLatestToRef(newTrack);
                return [...prev, newTrack];
              });
            } catch (err) {
              console.error("Failed to restore lesson from Drive:", err);
            }
          }
          setTimeout(() => evictCacheIfNeeded(), 100);
        }
      }

    } catch (err) {
      console.debug("Drive restore check error:", err);
    }
  }, [isGoogleLoggedIn]);

  // When user logs in, check if there are Drive files to restore
  useEffect(() => {
    if (isGoogleLoggedIn && !isLoading) {
      checkDriveRestore();
    }
  }, [isGoogleLoggedIn, isLoading, checkDriveRestore]);

  // Check Drive for deleted lessons when navigating to library
  const lastLibraryCheckRef = useRef(0);
  useEffect(() => {
    if (currentView === 'library' && isGoogleLoggedIn && !isLoading) {
      const now = Date.now();
      if (now - lastLibraryCheckRef.current > 5000) {
        lastLibraryCheckRef.current = now;
        checkDriveRestore();
      }
    }
  }, [currentView, isGoogleLoggedIn, isLoading, checkDriveRestore]);

  // Periodic sync: check Drive for current lesson changes every 15 seconds
  const lastPeriodicSyncRef = useRef(0);
  
  const currentTrackIndexRef = useRef(currentTrackIndex);
  currentTrackIndexRef.current = currentTrackIndex;
  const currentTrackIdRef = useRef(playlist[currentTrackIndex]?.id);
  currentTrackIdRef.current = playlist[currentTrackIndex]?.id;
  const periodicSyncCurrentTrack = async () => {
    const trackId = currentTrackIdRef.current;
    if (!trackId) return;
    const track = latestTrackRef.current.get(trackId);
    if (!track?.driveFileId || !isGoogleLoggedIn) return;
    try {
      const jsonBlob = await googleDriveService.downloadFile(track.driveFileId);
      const jsonData = JSON.parse(await jsonBlob.text());
      const remoteTrack = jsonData as AudioTrack;

      const remoteKnown = (remoteTrack.knownWords || []).map((w: string) => w.toLowerCase());
      const localKnown = (track.knownWords || []).map((w: string) => w.toLowerCase());

      let changed = false;

      // Merge knownWords: keep superset of both sides
      const mergedKnown = [...new Set([...localKnown, ...remoteKnown])];
      if (mergedKnown.length !== localKnown.length) {
        changed = true;
      }

      // Merge flashcards from remote if local is empty/incomplete
      let mergedFlashcards = track.flashcards;
      if (remoteTrack.flashcards && remoteTrack.flashcards.length > 0) {
        if (!mergedFlashcards || mergedFlashcards.length === 0) {
          // Local has no flashcards — copy full cards from remote
          mergedFlashcards = remoteTrack.flashcards;
          changed = true;
        } else {
          // Both have flashcards: merge audioBase64
          const newFlashcards = [...mergedFlashcards];
          for (let i = 0; i < remoteTrack.flashcards.length; i++) {
            const rc = remoteTrack.flashcards[i];
            const lc = newFlashcards[i];
            if (lc && rc && lc.id === rc.id && rc.audioBase64) {
              const mergedAudio = { ...(typeof lc.audioBase64 === 'object' ? lc.audioBase64 : {}), ...(typeof rc.audioBase64 === 'object' ? rc.audioBase64 : {}) };
              if (Object.keys(mergedAudio).length > Object.keys(typeof lc.audioBase64 === 'object' ? lc.audioBase64 : {}).length) {
                newFlashcards[i] = { ...lc, audioBase64: mergedAudio };
                changed = true;
              }
            }
          }
          mergedFlashcards = newFlashcards;
        }
      }

      // Sync metadata (title, lessonNumber, etc.) usando timestamp como fonte da verdade
      // Se o updatedAt remoto e mais recente que o local, copia os metadados do remote
      let mergedMetadata: Partial<AudioTrack> = {};
      const remoteUpdatedAt = remoteTrack.updatedAt || 0;
      const localUpdatedAt = track.updatedAt || 0;
      if (remoteUpdatedAt > localUpdatedAt) {
        const metadataFields: (keyof AudioTrack)[] = ['title', 'lessonNumber', 'artist', 'coverUrl', 'language', 'updatedAt'];
        for (const field of metadataFields) {
          const remoteVal = remoteTrack[field];
          const localVal = track[field];
          if (remoteVal !== undefined && remoteVal !== localVal) {
            (mergedMetadata as any)[field] = remoteVal;
            changed = true;
          }
        }
      }

      if (!changed) return;

      const updatedTrack = { ...track, knownWords: mergedKnown, flashcards: mergedFlashcards, ...mergedMetadata };

      syncLatestToRef(updatedTrack);
      requestSyncImmediate(track.id);

      const metadataForDb: Record<string, any> = { knownWords: mergedKnown, flashcards: mergedFlashcards };
      if (mergedMetadata.title) metadataForDb.title = mergedMetadata.title;
      if (mergedMetadata.lessonNumber !== undefined) metadataForDb.lessonNumber = mergedMetadata.lessonNumber;
      if (mergedMetadata.artist) metadataForDb.artist = mergedMetadata.artist;
      if (mergedMetadata.coverUrl) metadataForDb.coverUrl = mergedMetadata.coverUrl;
      if (mergedMetadata.language) metadataForDb.language = mergedMetadata.language;
      if (mergedMetadata.updatedAt) metadataForDb.updatedAt = mergedMetadata.updatedAt;

      await updateTrackMetadata(track.id, metadataForDb);
      setPlaylist(prev => {
        const updated = prev.map(t => t.id === track.id ? { ...t, ...updatedTrack } : t);
        refreshGlobalKnownWords(updated);
        return updated;
      });
    } catch (err) {
      console.debug("Periodic sync check error:", err);
    }
  };

  useEffect(() => {
    if (!isGoogleLoggedIn || isLoading || (currentView !== 'lesson' && currentView !== 'library')) return;
    lastPeriodicSyncRef.current = Date.now();

    // Run sync immediately when the effect starts
    periodicSyncCurrentTrack();

    const interval = setInterval(() => {
      lastPeriodicSyncRef.current = Date.now();
      periodicSyncCurrentTrack();
    }, 15000);
    return () => clearInterval(interval);
  }, [isGoogleLoggedIn, isLoading, currentView]);

  const toggleGlobalKnownWord = (word: string) => {
    const lower = word.toLowerCase();
    setGlobalKnownWords(prev => {
      const isKnown = prev.includes(lower);
      const next = isKnown ? prev.filter(w => w !== lower) : [...prev, lower];
      set("lingosync_global_known_words", next).catch(console.error);
      return next;
    });

    const track = currentTrack;
    if (!track) return;

    const trackKnown = track.knownWords || [];
    const trackIsKnown = trackKnown.includes(lower);
    const nextTrackKnown = trackIsKnown
      ? trackKnown.filter(w => w !== lower)
      : [...trackKnown, lower];

    updateTrackMetadata(track.id, { knownWords: nextTrackKnown }).catch(console.error);

    if (isGoogleLoggedIn) {
      const existingRefTrack = latestTrackRef.current.get(track.id);
      syncLatestToRef({ ...(existingRefTrack || track), knownWords: nextTrackKnown });
      requestSyncImmediate(track.id);
    }

    setPlaylist(prev => prev.map(item =>
      item.id === track.id ? { ...item, knownWords: nextTrackKnown } : item
    ));
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

  const handleVideoSourceContinue = (youtubeUrl?: string) => {
    setShowVideoSourcePrompt(false);
    if (pendingFileResolveRef.current) {
      pendingFileResolveRef.current({ cancelled: false, youtubeUrl: youtubeUrl || undefined });
      pendingFileResolveRef.current = null;
    }
  };

  const handleVideoSourceClose = () => {
    setShowVideoSourcePrompt(false);
    if (pendingFileResolveRef.current) {
      pendingFileResolveRef.current({ cancelled: true });
      pendingFileResolveRef.current = null;
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const effectiveAssemblyKey = (assemblyAiApiKey || localStorage.getItem("lingosync_assemblyai_api_key") || "").trim();
    const effectiveDeepseekKey = (deepseekApiKey || localStorage.getItem("lingosync_deepseek_api_key") || "").trim();
    const effectiveGoogleKey = (googleCloudApiKey || localStorage.getItem("lingosync_google_cloud_api_key") || "").trim();
    const effectiveWorkerUrl = (ttsWorkerUrl || localStorage.getItem("lingosync_tts_worker_url") || "").trim();

    if (!effectiveAssemblyKey || !effectiveDeepseekKey || (!effectiveGoogleKey && !effectiveWorkerUrl)) {
      alert("Configure as chaves de API nas Configurações antes de transcrever.\n\n• AssemblyAI — Transcrição\n• DeepSeek — Tradução e Inteligência\n• Google Cloud — Narração (TTS)");
      setShowSettings(true);
      e.target.value = '';
      return;
    }

    const isVideo = file.type.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv'].includes(file.name.split('.').pop()?.toLowerCase() || '');

    const result = await new Promise<{ cancelled: boolean; youtubeUrl?: string }>((resolve) => {
      setPendingVideoSourceFile({ file, isVideo });
      pendingFileResolveRef.current = resolve;
      setShowVideoSourcePrompt(true);
    });

    if (result.cancelled) {
      e.target.value = '';
      return;
    }

    const youtubeUrl = result.youtubeUrl;

    let youtubeId: string | undefined;
    if (youtubeUrl) {
      const regExp = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
      const match = youtubeUrl.match(regExp);
      if (match && match[1]) {
        youtubeId = match[1];
      }
    }

    setIsTranscribing(true);
    try {
      let transcript;
      transcript = enforceSegmentWordLimit(
        await transcribeAudio(file, nativeLanguage, effectiveAssemblyKey, effectiveDeepseekKey, hasBillingEnabled)
      );

      const nextLessonNumber = playlist.reduce((max, t) => {
        const num = t.lessonNumber ?? 0;
        return num > max ? num : max;
      }, 0) + 1;

      const newTrack: AudioTrack = {
        id: Date.now().toString(36) + Math.random().toString(36).substring(2),
        title: file.name.replace(/\.[^/.]+$/, ""),
        artist: "",
        url: URL.createObjectURL(file),
        coverUrl: `https://picsum.photos/seed/${file.name}/400/400`,
        transcript: transcript,
        isVideo: isVideo || !!youtubeId,
        audioFileName: file.name,
        language: currentLanguage,
        youtubeId: youtubeId,
        lessonNumber: nextLessonNumber
      };

      if (isVideo && !youtubeId) {
        newTrack.localVideoUrl = newTrack.url;
        newTrack.videoFileName = file.name;
      }

      await saveTrack(newTrack, file);

      if (isVideo && !youtubeId) {
        await saveTrackVideo(newTrack.id, file);
      }

      setPlaylist((prev) => {
        const newList = [...prev, newTrack];
        setCurrentTrackIndex(newList.length - 1);
        return newList;
      });
      
      if (isGoogleLoggedIn) {
        syncTrackToDrive(newTrack);
        setTimeout(() => evictCacheIfNeeded(), 500);
      }
      
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
    const trackId = currentTrack?.id;
    if (trackId) {
      const { url, localVideoUrl, ...updates } = updatedTrack;

      // Only stamp updatedAt for actual metadata changes (title, lessonNumber, etc.)
      // not for flashcards/knownWords updates
      const metadataFields: (keyof AudioTrack)[] = ['title', 'lessonNumber', 'artist', 'coverUrl', 'language'];
      if (metadataFields.some(f => f in updates)) {
        updates.updatedAt = Date.now();
      }

      updateTrackMetadata(trackId, updates);

      // Update ref BEFORE state, so sync sempre tem os dados mais recentes
      // Usa existingRefTrack como base para preservar knownWords/flashcards que vieram do Drive via periodic sync
      if (isGoogleLoggedIn && currentTrack) {
        const existingRefTrack = latestTrackRef.current.get(trackId);
        syncLatestToRef({ ...(existingRefTrack || currentTrack), ...updates } as AudioTrack);
        requestSyncImmediate(trackId);
      }

      setPlaylist(prev => prev.map(t =>
        t.id === trackId ? { ...t, ...updates } : t
      ));
    }
  };

  const deleteFromDriveWithRetry = async (track: AudioTrack, retryCount = 0): Promise<boolean> => {
    const filesToDelete: string[] = [];
    if (track.driveFileId) filesToDelete.push(track.driveFileId);
    if (track.driveAudioFileId) filesToDelete.push(track.driveAudioFileId);

    if (filesToDelete.length === 0) return true;

    try {
      for (const fileId of filesToDelete) {
        await googleDriveService.deleteFile(fileId);
      }
      return true;
    } catch (error: any) {
      const isNotFound = error?.message?.includes("File not found") || error?.message?.includes("404");
      if (isNotFound) {
        return true;
      }
      if (retryCount < 5) {
        const delay = Math.min(1000 * Math.pow(2, retryCount), 15000);
        console.log(`[LingoSync] Retrying Drive delete in ${delay}ms (attempt ${retryCount + 1}/5)...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return deleteFromDriveWithRetry(track, retryCount + 1);
      }
      return false;
    }
  };

  const handleDeleteTrack = async (id: string, e: React.MouseEvent, deleteFromDrive: boolean = false) => {
    e.stopPropagation();
    const track = playlist.find(t => t.id === id);
    if (!track) return;

    const confirmed = await showConfirm(
      deleteFromDrive ? "Excluir lição" : "Excluir lição",
      deleteFromDrive 
        ? "Tem certeza que deseja excluir esta lição deste app e da nuvem? Esta ação não pode ser desfeita."
        : "Tem certeza que deseja excluir esta lição deste app? Se ela estiver sincronizada, você poderá baixá-la novamente depois."
    );
    if (!confirmed) return;

    if (deleteFromDrive && (track.driveFileId || track.driveAudioFileId)) {
      const driveDeleted = await deleteFromDriveWithRetry(track);
      if (!driveDeleted) {
        if (track.driveFileId) {
          deletedDriveIdsRef.current.add(track.driveFileId);
          localStorage.setItem('lingosync_deleted_drive_ids', JSON.stringify([...deletedDriveIdsRef.current]));
        }
        await showConfirm("Erro", "Não foi possível excluir da nuvem após várias tentativas. A lição será removida apenas localmente.");
      }
    }

    await deleteTrack(id);

    if (!deleteFromDrive && track.driveFileId) {
      const missingTrack = { ...track, syncStatus: 'missing_local' as const, url: '' };
      const updatedPlaylist = playlist.map(t => t.id === id ? missingTrack : t);
      setPlaylist(updatedPlaylist);
      await refreshGlobalKnownWords(updatedPlaylist);

      if (isGoogleLoggedIn && track.driveFileId) {
        syncLatestToRef(missingTrack);
        requestSyncImmediate(id);
      }
    } else {
      const newPlaylist = playlist.filter(t => t.id !== id);
      setPlaylist(newPlaylist);
      await refreshGlobalKnownWords(newPlaylist);
    }

    if (currentTrack?.id === id) {
      setCurrentView('library');
      setCurrentTrackIndex(0);
    } else {
      const deletedIdx = playlist.findIndex(t => t.id === id);
      if (deletedIdx >= 0 && deletedIdx < currentTrackIndex) {
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
      <div className="space-y-3 p-4 rounded-xl border-[1.5px] border-white/10 bg-[#0d0d0d] relative">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            {/* Logo is now always present in SidebarHeader */}
            <div className="w-10 h-10 bg-[#827367]/20 rounded-full flex items-center justify-center shrink-0 aspect-square">
              <LingoSyncLogo className="w-8 h-8 text-[#827367]" />
            </div>

            {currentView === 'library' ? (
              <Badge variant="ghost" className="bg-transparent border-none p-0 h-10 flex items-center justify-center shrink-0 gap-4 w-fit">
                <span className="text-2xl font-bold tracking-tight text-gray-500">Língua nativa</span>
                <div className="w-[1px] h-3 bg-[#827367]/30" />
                <LanguageSelector currentLanguage={nativeLanguage} onLanguageChange={setNativeLanguage} exclude={currentLanguage} className="text-sm font-bold text-gray-500" />
              </Badge>
            ) : (
              <div className="flex items-center space-x-3">
                <h1 className="text-2xl font-bold tracking-tight text-gray-300">LingoSync</h1>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowHelp(true)}
                  className="text-gray-600 hover:text-gray-300 h-8 w-8"
                  title="Guia LingoSync"
                >
                  <Info className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
            <div className="flex items-center space-x-3">
              {currentView === 'home' && (
                <>
                  {/* Credits Counter - Styled like the vocabulary badge - text-base like header phrase - Height matched to avatar */}
                  <Badge variant="ghost" className="text-base font-normal tracking-tight text-[#827367] bg-[#827367]/20 border-none px-4 py-1 h-10 rounded-full flex items-center justify-center leading-none shrink-0 gap-2">
                    <AudioLines className="w-3.5 h-3.5" />
                    <span>10</span>
                  </Badge>

                  {/* Google User Avatar */}
                  {isGoogleLoggedIn && googleDriveService.userInfo ? (
                    <div className="relative">
                      <button
                        onClick={() => setShowUserMenu(prev => !prev)}
                        className="w-10 h-10 rounded-full shrink-0 overflow-hidden cursor-pointer"
                        title={googleDriveService.userInfo.name}
                      >
                        <img 
                          src={googleDriveService.userInfo.picture} 
                          alt={googleDriveService.userInfo.name}
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      </button>
                      {showUserMenu && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                          <div className="absolute right-0 top-full mt-2 z-50 w-48 bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl overflow-hidden">
                            <div className="px-4 py-3 border-b border-white/5">
                              <p className="text-sm font-medium text-white truncate">{googleDriveService.userInfo.name}</p>
                              <p className="text-xs text-gray-400 truncate">{googleDriveService.userInfo.email}</p>
                            </div>
                            <button
                              onClick={() => {
                                handleGoogleLogout();
                                setShowUserMenu(false);
                              }}
                              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-400 hover:bg-white/5 transition-colors"
                            >
                              <LogOut className="w-4 h-4" />
                              Sair
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ) : import.meta.env.VITE_GOOGLE_CLIENT_ID ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleGoogleLogin}
                      className="text-gray-500 hover:text-gray-300 h-10 w-10 rounded-full hover:bg-white/5 flex items-center justify-center shrink-0"
                      title="Conectar à nuvem"
                    >
                      <UserCircle className="w-10 h-10" />
                    </Button>
                  ) : null}
                </>
              )}
  
              {currentView === 'library' && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowSettings(true)}
                className="text-gray-600 hover:text-gray-300 h-8 w-8"
              >
                <Settings2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
        <p className="text-gray-500 text-base font-medium tracking-tight">
          {currentView === 'home'
            ? `Aprenda idiomas de forma divertida com legendas do seu conteúdo favorito`
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

    const handleItemClick = async () => {
      if (isMenuOpen) {
        setIsMenuOpen(false);
        return;
      }
      if (track.syncStatus === 'missing_local' || track.syncStatus === 'cloud_only') {
        if (isGoogleLoggedIn && track.driveFileId) {
          setIsMenuOpen(true);
          downloadTrackFromDrive(track);
        }
        return;
      }
      setCurrentTrackIndex(index);
      setCurrentView('lesson');
      updateLastAccessed(track.id);
    };

    return (
      <div
        className="relative mb-2 rounded-xl group overflow-hidden bg-[#0d0d0d]"
        ref={containerRef}
      >
        {/* Action Buttons Background - Positioned behind the sliding content */}
        <div className="absolute inset-y-0 right-0 flex items-center pr-3 space-x-3 w-[130px] justify-end">
          {/* Cloud Sync Button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              if (!isGoogleLoggedIn) return;
              if (track.syncStatus === 'missing_local' || track.syncStatus === 'cloud_only') {
                downloadTrackFromDrive(track);
              } else {
                syncTrackToDrive(track);
              }
            }}
            disabled={isSyncing === track.id}
            className={cn(
              "h-12 w-12 rounded-full transition-all flex items-center justify-center",
              isGoogleLoggedIn ? (
                track.syncStatus === 'synced' ? "text-[#827367] hover:bg-[#0d0d0d]" : 
                track.syncStatus === 'missing_local' ? "text-[#827367] hover:bg-[#827367]/10" :
                track.syncStatus === 'cloud_only' ? "text-yellow-400 hover:bg-yellow-500/10" :
                track.syncStatus === 'error' ? "text-red-400 hover:bg-red-500/10" :
                "text-[#827367] hover:text-[#9a8c80] hover:bg-white/5"
              ) : "text-gray-600 cursor-default"
            )}
          >
            {isSyncing === track.id ? (
              <div className="relative w-5 h-5">
                <svg className="w-5 h-5 -rotate-90" viewBox="0 0 20 20">
                  <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.2" />
                  <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={`${2 * Math.PI * 8}`} strokeDashoffset={`${2 * Math.PI * 8 * (1 - (downloadProgress[track.id] || 0) / 100)}`} strokeLinecap="round" />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold">{downloadProgress[track.id] || 0}</span>
              </div>
            ) : !isGoogleLoggedIn ? (
              <CloudOff className="w-5 h-5" />
            ) : track.syncStatus === 'synced' ? (
              <svg className="w-6 h-6" viewBox="-2 -2 28 28" fill="none">
                <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" stroke="#827367" strokeWidth="1.5" fill="none"/>
                <path d="M10 12.5l1.5 1.5 3-3" stroke="#827367" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : track.syncStatus === 'missing_local' ? (
              <svg className="w-6 h-6" viewBox="-2 -2 28 28" fill="none">
                <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" stroke="#827367" strokeWidth="1.5" fill="none"/>
                <path d="M12 9v6m0 0l-2.5-2.5M12 15l2.5-2.5" stroke="#827367" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : track.syncStatus === 'cloud_only' ? (
              <CloudOff className="w-5 h-5" />
            ) : track.syncStatus === 'error' ? (
              <AlertCircle className="w-5 h-5" />
            ) : (
              <CloudUpload className="w-5 h-5" />
            )}
          </Button>

          {/* Delete Button - removes from app + cloud */}
          <Button
            variant="ghost"
            size="icon"
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              handleDeleteTrack(track.id, e, true);
              setIsMenuOpen(false);
            }}
            title="Excluir lição"
            className="text-red-400/60 hover:text-red-400 hover:bg-red-500/10 h-12 w-12 rounded-full transition-all flex items-center justify-center"
          >
            <Trash2 className="w-5 h-5" />
          </Button>
        </div>

        {/* Sliding Foreground Content */}
        <div
          className={cn(
            "relative z-10 w-full flex items-center p-4 rounded-xl transition-colors duration-300 text-left border-[1.5px] cursor-pointer",
            "bg-[#111111]",
            currentTrackIndex === index && currentView === 'lesson'
              ? "border-white/20"
              : "border-white/10 hover:border-white/20"
          )}
          style={{ transform: `translateX(${isMenuOpen ? -135 : 0}px)`, transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}
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
            <p className={cn("text-xl font-semibold truncate transition-colors", currentTrackIndex === index && currentView === 'lesson' ? "text-gray-200" : "text-gray-500 group-hover:text-gray-300")}>
              {track.title}
            </p>
            <div className="h-[36px] relative mt-2">
              {/* Syncing progress - always rendered, opacity toggled */}
              <div className={cn("absolute inset-0 flex flex-col justify-center space-y-1 transition-opacity duration-200", isSyncing === track.id ? "opacity-100" : "opacity-0 pointer-events-none")}>
                <div className="flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin text-[#827367] shrink-0" />
                  <span className="text-xs text-[#827367] font-medium">
                    {syncDirectionRef.current === 'upload'
                      ? 'Enviando para a nuvem'
                      : 'Baixando da nuvem'}
                    <span className="animate-dots inline-block ml-0.5">...</span>
                  </span>
                  <span className="text-xs text-[#827367] font-medium w-9 text-right tabular-nums">{downloadProgress[track.id] || 0}%</span>
                </div>
                <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                  <div className="bg-[#827367] h-full rounded-full transition-all duration-300" style={{ width: `${downloadProgress[track.id] || 0}%` }} />
                </div>
              </div>
              {/* Missing local text */}
              <div className={cn("absolute inset-0 flex items-center transition-opacity duration-200", track.syncStatus === 'missing_local' && isSyncing !== track.id ? "opacity-100" : "opacity-0 pointer-events-none")}>
                <p className="text-xs text-[#827367]/60">Disponível na nuvem — clique para baixar</p>
              </div>
              {/* Error text */}
              <div className={cn("absolute inset-0 flex items-center transition-opacity duration-200", track.syncStatus === 'error' && isSyncing !== track.id ? "opacity-100" : "opacity-0 pointer-events-none")}>
                <p className="text-xs text-[#827367]/60">Erro ao sincronizar — clique na nuvem para tentar novamente</p>
              </div>
            </div>
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
        </div>
      </div>
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
          <div className="flex items-center text-sm uppercase tracking-widest h-10 font-bold text-[#827367]">
            <Library className="w-4 h-4 mr-2" />
            Biblioteca
          </div>
          <div className="flex items-center space-x-2">
            <Badge variant="ghost" className="text-sm uppercase tracking-widest font-bold text-[#827367] bg-transparent border-none p-0">
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
                <p className="text-base">Nenhuma lição encontrada para este idioma.</p>
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
              <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-3xl bg-[#827367]/20 flex items-center justify-center border-[1.5px] border-white/10 shadow-inner">
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
              <p className="text-base font-bold uppercase tracking-widest text-[#827367]">Sincronizando Biblioteca...</p>
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
                              onClick={async () => {
                                const ok = await requireGoogleLogin();
                                if (ok) setCurrentView('library');
                              }}
                              className="w-full flex items-center justify-center py-3 px-5 rounded-xl border-[1.5px] border-dashed border-white/10 text-gray-400 hover:text-gray-200 hover:border-white/20 transition-all group bg-[#161616] shadow-sm shadow-black/40"
                            >
                              <Library className="w-8 h-8 mr-4 group-hover:scale-110 transition-transform text-[#827367]" />
                              <div className="flex flex-col items-center text-center">
                                <span className="text-sm font-bold uppercase tracking-widest text-[#827367]">Acessar Biblioteca de Lições</span>
                                <span className="text-base font-normal opacity-70">Estude e gerencie suas lições</span>
                              </div>
                            </button>
                          </div>

                          <div className="space-y-3">
                            <button
                              onClick={async () => {
                                const ok = await requireGoogleLogin();
                                if (ok) setShowGerarLicaoModal(true);
                              }}
                              disabled={isTranscribing}
                              className="w-full flex items-center justify-center py-3 px-5 rounded-xl border-[1.5px] border-dashed border-white/10 text-gray-400 hover:text-gray-200 hover:border-white/20 transition-all group disabled:opacity-50 disabled:cursor-not-allowed bg-[#161616] shadow-sm shadow-black/40"
                            >
                              <AudioLines className={cn("w-8 h-8 mr-4 group-hover:scale-110 transition-transform text-[#827367]", isTranscribing && "animate-wave-pulse")} />
                              <div className="flex flex-col items-center text-center">
                                <span className="text-sm font-bold uppercase tracking-widest">
                                  {isTranscribing
                                    ? (transcribePercent > 90 ? "Sincronizando..." : `Progresso: ${Math.round(transcribePercent)}%`)
                                    : "GERAR LIÇÃO (TEXTO OU ÁUDIO)"}
                                </span>
                                <span className="text-base font-normal opacity-70">Recomendado: 1 a 3 min. Máx: 5 min.</span>
                              </div>
                            </button>
                          </div>
                        </div>

                        {/* Home Content Box */}
                        <div className="flex-1 flex flex-col items-center justify-center bg-[#0d0d0d] rounded-3xl border-[1.5px] border-white/10 p-8 sm:p-12 text-center space-y-8 shadow-2xl relative overflow-hidden">
                          <div className="absolute inset-0 bg-radial-gradient from-[#443a32]/10 to-transparent opacity-50" />
                          
                          <div className="relative z-10 space-y-8 flex flex-col items-center">
                            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-3xl bg-[#827367]/20 flex items-center justify-center border-[1.5px] border-white/10 shadow-inner">
                              <LingoSyncLogo className="w-14 h-14 sm:w-16 sm:h-16" />
                            </div>
                            <div className="space-y-4">
                              <h2 className="text-3xl font-bold text-gray-100 tracking-tight">Bem-vindo ao LingoSync</h2>
                              <p className="text-gray-400 text-base max-w-sm mx-auto leading-relaxed">
                                Transforme seus áudios favoritos em lições poderosas para aprender idiomas. Com o <b>LingoSync</b>, você aprende naturalmente com legendas inteligentes e interativas, usando o método comprovado do <b>Input Compreensivo</b>.
                              </p>
                            </div>
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
                          className="text-gray-600 hover:text-gray-300 text-sm uppercase tracking-widest font-bold flex items-center justify-start w-fit px-3 h-10 whitespace-nowrap"
                        >
                          <ArrowLeft className="w-5 h-5 mr-3 shrink-0" />
                          <span>Início</span>
                        </Button>
                        <Badge variant="ghost" className="text-sm font-bold uppercase tracking-widest text-[#827367] bg-[#827367]/20 border-none px-4 py-1.5 h-10 rounded-full flex items-center justify-center leading-none shrink-0 gap-3">
                          <span>VOCABULÁRIO: {globalKnownWords.length}</span>
                          <div className="w-[1px] h-3 bg-[#827367]/30" />
                          <LanguageSelector currentLanguage={currentLanguage} onLanguageChange={setCurrentLanguage} exclude={nativeLanguage} className="text-sm font-bold" />
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
                    {!isMaximized && (
                      <div className="pb-4 flex items-center justify-between">
                        <Button
                          variant="ghost"
                          onClick={() => setCurrentView('library')}
                          className="text-gray-600 hover:text-gray-300 text-sm uppercase tracking-widest font-bold flex items-center justify-start w-fit px-3 h-10 whitespace-nowrap"
                        >
                          <ArrowLeft className="w-5 h-5 mr-3 shrink-0" />
                          <span>Biblioteca</span>
                        </Button>

                        <div className="absolute left-1/2 -translate-x-1/2 flex items-center justify-center">
                          <button
                            onClick={() => setIsMaximized(prev => !prev)}
                            className="p-1.5 rounded-lg transition-colors duration-200 text-gray-600 hover:text-white hover:bg-white/5"
                            title="Maximizar visualização"
                          >
                            <Eye className="w-6 h-6" />
                          </button>
                        </div>

                        <Button
                          variant="ghost"
                          onClick={handleOpenFlashcards}
                          disabled={isGeneratingCards}
                          className="text-sm uppercase tracking-widest h-10 font-bold text-[#827367] hover:text-[#9a8c80] flex flex-row items-center px-3 w-fit"
                        >
                          {isGeneratingCards ? (
                            <>
                              <Loader2 className="w-5 h-5 mr-2 animate-spin shrink-0" />
                              {Math.round(flashcardPercent)}%
                            </>
                          ) : (
                            <>
                              <svg className="w-5 h-5 mr-2 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="5" y="2" width="14" height="20" rx="4" />
                              </svg>
                              Flashcards
                            </>
                          )}
                        </Button>
                      </div>
                    )}

                    {isMaximized && (
                      <div className="pb-4 flex items-center justify-center">
                        <button
                          onClick={() => setIsMaximized(prev => !prev)}
                          className="p-1.5 rounded-lg transition-colors duration-200 text-white/70 hover:text-white hover:bg-white/10"
                          title="Mostrar controles"
                        >
                          <EyeOff className="w-6 h-6" />
                        </button>
                      </div>
                    )}
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
                        onOpenFlashcardAtIndex={(idx, segmentIdx) => handleOpenFlashcards(idx, segmentIdx)}
                        nativeLanguage={nativeLanguage}
                        externalJumpToSegmentIndex={externalJumpToSegmentIndex}
                        onJumpedToSegment={() => setExternalJumpToSegmentIndex(null)}
                        isMaximized={isMaximized}
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
                              returnSegmentIndex={returnSegmentIndex}
                              onWordClick={(segmentIdx) => {
                                setShowFlashcards(false);
                                setExternalJumpToSegmentIndex(segmentIdx);
                              }}
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
                    <p className="text-base text-gray-500 leading-relaxed italic">
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
                    <p className="text-base text-gray-500 leading-relaxed italic">
                      Usada para tradução e organização. Modelo DeepSeek V3.
                    </p>
                  </div>

                  {/* Google Cloud API Key (TTS) */}
                  <div className="space-y-3 pt-4 border-t border-white/5">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 flex items-center">
                        <Key className="w-3 h-3 mr-2" />
                        Google Cloud API Key (TTS)
                      </label>
                      <a 
                        href="https://console.cloud.google.com/apis/api/texttospeech.googleapis.com/quotas"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[9px] font-bold uppercase tracking-widest text-gray-500 hover:text-gray-300 transition-colors flex items-center ml-auto mr-3"
                      >
                        Acompanhar Cota
                        <ExternalLink className="w-2.5 h-2.5 ml-1.5" />
                      </a>
                    </div>
                    <div className="relative">
                      <input
                        type="password"
                        value={googleCloudApiKey}
                        onChange={(e) => setGoogleCloudApiKey(e.target.value)}
                        placeholder="Cole sua chave Google Cloud aqui..."
                        className="w-full bg-[#0d0d0d] border border-white/10 rounded-xl px-4 py-3 text-base text-gray-300 focus:outline-none focus:border-white/20 transition-colors"
                      />
                    </div>
                    <p className="text-base text-gray-500 leading-relaxed italic">
                      Usada para a narração profissional dos flashcards (Vozes Neural2).
                    </p>
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
                          href="https://console.cloud.google.com/apis/api/texttospeech.googleapis.com/quotas"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5 text-[10px] font-bold text-[#827367] hover:text-[#9a8c80] hover:bg-white/[0.04] transition-all group"
                        >
                          <span className="uppercase tracking-widest">MEU USO (CLOUD TEXT-TO-SPEECH API)</span>
                          <ExternalLink className="w-3 h-3 text-[#827367] opacity-80 group-hover:opacity-100 transition-opacity" />
                        </a>
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
                const regExp = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
                const match = url.match(regExp);
                if (match && match[1]) {
                  updates.youtubeId = match[1];
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
                          <p className="text-base text-gray-500">Basta subir seu áudio (MP3 ou WAV) e o <b>LingoSync</b> gera as legendas em inglês e português na hora para você.</p>
                        </div>
                        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-2">
                          <p className="text-sm font-bold text-gray-300">Personalize sua Lição</p>
                          <p className="text-base text-gray-500">Clique em qualquer frase para ajustar o texto. Use o <b>Enter</b> para dividir uma frase longa em duas partes menores.</p>
                        </div>
                        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-2">
                          <p className="text-sm font-bold text-gray-300">Sincronização Avançada</p>
                          <p className="text-base text-gray-500">O botão <b>Ajustar Tradução</b> utiliza a inteligência do <b>LingoSync</b> para alinhar sua edição perfeitamente.</p>
                        </div>
                        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-2">
                          <p className="text-sm font-bold text-gray-300">Leve suas Lições com Você</p>
                          <p className="text-base text-gray-500">Exporte suas lições como arquivos <b>.lsync.json</b> e estude em qualquer outro dispositivo quando quiser.</p>
                        </div>
                      </div>
                    </section>

                    <section className="p-6 rounded-2xl bg-[#827367]/5 border border-[#827367]/10 space-y-4">
                      <div className="flex items-center space-x-3 text-[#827367]">
                        <Key className="w-5 h-5" />
                        <h4 className="font-bold">Poder e Controle Total no Seu Bolso</h4>
                      </div>
                      <p className="text-base text-gray-300 leading-relaxed font-medium">
                        Com o <b>LingoSync</b>, você é o dono da sua jornada. Diferente de outros apps com assinaturas caras, aqui você tem uma <b>ferramenta poderosa</b> sob seu comando absoluto.
                      </p>
                      <div className="space-y-3 bg-[#0d0d0d] p-4 rounded-xl border border-white/5">
                        <p className="text-base text-gray-400">
                          <b>Economia Real:</b> Ao usar sua própria chave, você paga apenas pelo que consome. Transcrever <b>uma hora inteira de áudio</b> custa apenas <b>alguns centavos de dólar</b>.
                        </p>
                        <p className="text-base text-gray-400">
                          <b>Segurança Financeira:</b> No painel do Google, você pode definir um <b>limite mensal</b> (como $1 ou $5 dólares). Assim, você aproveita o <b>LingoSync</b> com total previsibilidade.
                        </p>
                      </div>
                      <p className="text-base text-gray-400 leading-relaxed">
                        Essa solução foi desenvolvida para revolucionar o custo-benefício no aprendizado de idiomas. Tudo é transparente para sua tranquilidade e satisfação em primeiro lugar. Ah, o <b>LingoSync</b> processa tudo de forma <b>local</b> e seus áudios nunca saem do seu <b>dispositivo</b>.
                      </p>
                    </section>

                    <section className="space-y-4 pt-4 border-t border-white/5">
                      <div className="flex items-center space-x-3 text-gray-400">
                        <Shield className="w-5 h-5" />
                        <h4 className="font-bold">Termos e Privacidade</h4>
                      </div>
                      <div className="space-y-4 text-base text-gray-500 leading-relaxed">
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
                      <p className="text-base text-gray-500 leading-relaxed font-medium">
                        Ao criar sua API, o plano gratuito é ativado por padrão. Para uso além do limite gratuito diário, o Google solicitará a configuração de um método de pagamento.
                      </p>
                      <p className="text-base text-[#827367] leading-relaxed uppercase tracking-widest font-bold pt-1">Tutorial rápido em 3 passos:</p>
                    </div>

                    <div className="text-left space-y-3">
                      <div className="flex items-start space-x-3 p-3 rounded-xl bg-white/[0.02] border border-white/5">
                        <div className="w-5 h-5 rounded-full bg-[#827367]/20 text-[#827367] flex items-center justify-center text-base font-bold shrink-0 mt-0.5">1</div>
                        <p className="text-base text-gray-400 leading-tight">Acesse o <b>Google AI Studio</b> através do link abaixo ou nas configurações.</p>
                      </div>
                      <div className="flex items-start space-x-3 p-3 rounded-xl bg-white/[0.02] border border-white/5">
                        <div className="w-5 h-5 rounded-full bg-[#827367]/20 text-[#827367] flex items-center justify-center text-base font-bold shrink-0 mt-0.5">2</div>
                        <p className="text-base text-gray-400 leading-tight">Escolha <b>"Create API key in new project"</b>. Ignore opções como "projeto importado" para ser mais rápido.</p>
                      </div>
                      <div className="flex items-start space-x-3 p-3 rounded-xl bg-white/[0.02] border border-white/5">
                        <div className="w-5 h-5 rounded-full bg-[#827367]/20 text-[#827367] flex items-center justify-center text-base font-bold shrink-0 mt-0.5">3</div>
                        <p className="text-base text-gray-400 leading-tight">Clique em <b>"Configurar Chave"</b> e cole o código no campo de senha.</p>
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
                    <p className="text-base text-gray-400 leading-relaxed">
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
                    <p className="text-base text-gray-400 leading-relaxed">
                      O arquivo de áudio desta lição não está disponível localmente neste dispositivo.
                    </p>

                    {currentTrack?.driveAudioFileId && isGoogleLoggedIn ? (
                      <div className="space-y-4">
                        <div className="p-4 rounded-2xl bg-[#827367]/5 border border-[#827367]/10">
                          <p className="text-base text-[#a39487] font-medium mb-4">
                            O áudio está salvo na nuvem. Clique abaixo para baixá-lo.
                          </p>
                          <Button
                            onClick={() => {
                              if (currentTrack) downloadTrackFromDrive(currentTrack);
                            }}
                            disabled={isSyncing === currentTrack?.id}
                            className="w-full bg-[#827367] hover:bg-[#9a8c80] text-gray-100 font-bold uppercase tracking-widest text-base h-10 rounded-xl flex items-center justify-center space-x-2 transition-all shadow-lg shadow-[#827367]/10"
                          >
                            {isSyncing === currentTrack?.id ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span>Baixando... {downloadProgress[currentTrack?.id || ''] || 0}%</span>
                              </>
                            ) : (
                              <>
                                <CloudDownload className="w-3.5 h-3.5" />
                                <span>Baixar da Nuvem</span>
                              </>
                            )}
                          </Button>
                          {isSyncing === currentTrack?.id && (
                            <div className="mt-3">
                              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                                <div className="h-full bg-[#827367] transition-all duration-200" style={{ width: `${downloadProgress[currentTrack?.id || ''] || 0}%` }} />
                              </div>
                              <p className="text-base text-gray-400 uppercase tracking-[0.2em] mt-2">
                                {downloadProgress[currentTrack?.id || ''] || 0}% concluído
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-base text-gray-400 leading-relaxed">
                          O áudio original não foi salvo na nuvem. Selecione a pasta onde o arquivo <b>{currentTrack?.audioFileName || "original"}</b> está localizado.
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
                          className="w-full bg-[#827367] hover:bg-[#9a8c80] text-gray-100 font-bold uppercase tracking-widest text-base h-10 rounded-xl flex items-center justify-center space-x-2 transition-all shadow-lg shadow-[#827367]/10"
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
                            <p className="text-base text-gray-400 uppercase tracking-[0.2em] mt-2">
                              {syncProgress}% concluído
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      setShowMissingAudioModal(false);
                      setCurrentView('library');
                    }}
                    className="text-base font-bold uppercase tracking-widest text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    Biblioteca
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Gerar Lição Modal */}
        <GerarLicaoModal
          isOpen={showGerarLicaoModal}
          onClose={() => setShowGerarLicaoModal(false)}
          onAudioSelected={() => {
            setShowGerarLicaoModal(false);
            fileInputRef.current?.click();
          }}
          onTextSubmit={handleGerarPorTexto}
        />

        {/* Rate Limit Modal */}
        <RateLimitModal
          isVisible={isRateLimited}
          secondsRemaining={rateLimitSecondsRemaining}
          model={rateLimitModel}
          isDailyLimit={isRateLimitDaily}
        />

        {/* Custom Confirm Dialog */}
        {confirmDialog?.isOpen && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              className="w-full max-w-sm bg-[#161616] border border-[#827367]/30 rounded-3xl overflow-hidden shadow-2xl relative"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#827367]/50 to-transparent" />
              <div className="p-8 text-center space-y-6">
                <h3 className="text-xl font-bold text-gray-200">{confirmDialog.title}</h3>
                <p className="text-base text-gray-400 leading-relaxed">{confirmDialog.message}</p>
                <div className="flex gap-3">
                  <button
                    onClick={confirmDialog.onCancel}
                    className="flex-1 py-3 rounded-xl text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors font-bold uppercase tracking-widest"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={confirmDialog.onConfirm}
                    className="flex-1 py-3 rounded-xl bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors font-bold uppercase tracking-widest"
                  >
                    Confirmar
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </div>

      <VideoSourcePrompt
        isOpen={showVideoSourcePrompt}
        onClose={handleVideoSourceClose}
        onContinue={handleVideoSourceContinue}
        fileName={pendingVideoSourceFile?.file?.name || ''}
        isVideo={pendingVideoSourceFile?.isVideo || false}
      />
    </>
  );
}

