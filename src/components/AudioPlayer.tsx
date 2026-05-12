import React, { useEffect, useLayoutEffect, useRef, useState, useMemo } from "react";
import { Play, Pause, SkipBack, SkipForward, Languages, ChevronDown, ChevronUp, Download, Edit2, Check, X, Settings2, Clock, Sparkles, Infinity as InfinityIcon, Gauge, Repeat, Youtube, Monitor, MonitorOff, RefreshCw, Loader2, Book, Edit3 } from "lucide-react";

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { AudioTrack, TranscriptSegment, Word } from "@/types";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { smartSplitTranslation, smartAlignSegmentTranslation } from "@/services/geminiService";

interface AudioPlayerProps {
  track: AudioTrack;
  trackNumber: number;
  onNext?: () => void;
  onPrev?: () => void;
  onExport?: (track: AudioTrack) => void;
  onUpdateTrack?: (updatedTrack: Partial<AudioTrack>) => void;
  onVideoSyncClick?: () => void;
  onMissingAudioSyncClick?: () => void;
  userApiKey?: string;
  deepseekApiKey?: string;
  onMissingKey?: () => void;
  onQuotaExceeded?: () => void;
  globalKnownWords?: string[];
  onToggleKnownWord?: (word: string) => void;
  hasBillingEnabled?: boolean;
  isPausedExternally?: boolean;
  onOpenFlashcardAtIndex?: (index: number, segmentIndex?: number) => void;
  nativeLanguage: string;
  externalJumpToSegmentIndex?: number | null;
  onJumpedToSegment?: () => void;
  isMaximized?: boolean;
}

function DropdownSelector({
  value,
  options,
  icon: Icon,
  onChange,
  onFormatValue,
  direction = "up"
}: {
  value: number;
  options: number[];
  icon: any;
  onChange: (val: number) => void;
  onFormatValue: (val: number) => string | React.ReactNode;
  direction?: "up" | "down";
}) {
  const [open, setOpen] = useState(false);
  const [alignLeft, setAlignLeft] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const dropdownWidth = 96;
      const centerX = rect.left + rect.width / 2;
      setAlignLeft(centerX - dropdownWidth / 2 >= 0 && centerX + dropdownWidth / 2 <= viewportWidth);
    }
  }, [open]);

  useEffect(() => {
    const clickOut = (e: MouseEvent) => { if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', clickOut);
    return () => document.removeEventListener('mousedown', clickOut);
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="text-[10px] text-gray-400 hover:text-[#827367] hover:bg-[#827367]/10 font-bold px-2 py-1 h-auto flex items-center space-x-1 uppercase tracking-widest gap-1 transition-colors"
      >
        <Icon className="w-3.5 h-3.5" />
        <span>{onFormatValue(value)}</span>
      </Button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: direction === "up" ? 10 : -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: direction === "up" ? 10 : -10 }}
            className={cn(
              "absolute bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl py-1 w-24 z-[100] overflow-hidden",
              direction === "up" ? "bottom-full mb-2" : "top-full mt-2",
              alignLeft ? "left-1/2 -translate-x-1/2" : "right-0"
            )}
          >
            {options.map(opt => (
              <button
                key={opt}
                onClick={(e) => { e.stopPropagation(); onChange(opt); setOpen(false); }}
                className={cn(
                  "w-full flex items-center justify-center py-2 text-[10px] font-bold uppercase tracking-widest hover:bg-white/5 transition-colors cursor-pointer",
                  value === opt ? "text-[#827367] bg-[#827367]/5" : "text-gray-400"
                )}
              >
                {onFormatValue(opt)}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function AudioPlayer({ track, trackNumber, onNext, onPrev, onExport, onUpdateTrack, onVideoSyncClick, onMissingAudioSyncClick, userApiKey, deepseekApiKey, onMissingKey, onQuotaExceeded, globalKnownWords = [], onToggleKnownWord, hasBillingEnabled = false, isPausedExternally = false, onOpenFlashcardAtIndex, nativeLanguage, externalJumpToSegmentIndex, onJumpedToSegment, isMaximized = false }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showTranslations, setShowTranslations] = useState<Record<number, boolean>>({});
  const [isDictionaryModeGlobal, setIsDictionaryModeGlobal] = useState(false);
  const [focusSegmentIndex, setFocusSegmentIndex] = useState(0);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [manuallyHighlightedSegment, setManuallyHighlightedSegment] = useState<number | null>(null);

  const getLanguageNameLabel = (code: string) => {
    const names: Record<string, string> = {
      en: 'Inglês',
      es: 'Espanhol',
      de: 'Alemão',
      fr: 'Francês',
      el: 'Grego',
      he: 'Hebraico',
      pt: 'Português'
    };
    return names[code] || 'Idiomas';
  };
  const [editSliderBounds, setEditSliderBounds] = useState({ min: 0, max: 0 });
  const [isEditModeGlobal, setIsEditModeGlobal] = useState(false);
  const longPressTimerRef = useRef<any>(null);
  const isLongPressRef = useRef(false);
  const handledByPointerRef = useRef(false);

  const handleVideoClick = () => {
    if (handledByPointerRef.current) {
      handledByPointerRef.current = false;
      return;
    }
    if (hasVideo) {
      setShowVideo(!showVideo);
    } else {
      onVideoSyncClick?.();
    }
  };

  const handleVideoTouchStart = (e: React.PointerEvent) => {
    handledByPointerRef.current = false;
    isLongPressRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      onVideoSyncClick?.();
    }, 500);
  };

  const handleVideoTouchEnd = (e: React.PointerEvent) => {
    handledByPointerRef.current = true;
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    if (!isLongPressRef.current) {
      if (hasVideo) {
        setShowVideo(!showVideo);
      } else {
        onVideoSyncClick?.();
      }
    }
  };

  const [showVideo, setShowVideo] = useState(() => {
    const saved = localStorage.getItem('lingosync_show_video');
    return saved !== null ? JSON.parse(saved) : true;
  });

  useEffect(() => {
    localStorage.setItem('lingosync_show_video', JSON.stringify(showVideo));
  }, [showVideo]);

  // Handle external pause (e.g. when flashcards open)
  useEffect(() => {
    if (isPausedExternally && isPlaying) {
      if (track.youtubeId && ytPlayerRef.current && isYtReady) {
        ytPlayerRef.current.pauseVideo?.();
      } else if (audioRef.current) {
        audioRef.current.pause();
        setIsPlaying(false);
      }
    }
  }, [isPausedExternally]);

  // Stop playback and reset to first segment when toggling focus mode
  useEffect(() => {
    // Always stop everything regardless of isPlaying state
    if (ytPlayTimeoutRef.current) {
      clearTimeout(ytPlayTimeoutRef.current);
      ytPlayTimeoutRef.current = null;
    }
    lastSeekToRef.current = null;
    if (track.youtubeId && ytPlayerRef.current) {
      try { ytPlayerRef.current.pauseVideo?.(); } catch (_) {}
      try { ytPlayerRef.current.seekTo?.(0); } catch (_) {}
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    setCurrentTime(0);
    stableTimeRef.current = 0;
    setStopTime(null);
    setShowTranslations({});
    setFocusSegmentIndex(0);
    // Limpa destaque palavra por palavra residual ao sair do modo foco
    if (lastActiveWordRef.current) {
      const prevEl = document.querySelector(`[data-word-key="${lastActiveWordRef.current}"]`) as HTMLElement | null;
      if (prevEl) prevEl.style.removeProperty('color');
      lastActiveWordRef.current = null;
    }
  }, [isMaximized]);

  // Playback settings
  const [globalSpeed, setGlobalSpeed] = useState<number>(1);
  const [globalRepeat, setGlobalRepeat] = useState<number>(1);



  const ytPlayerRef = useRef<any>(null);
  const [isYtReady, setIsYtReady] = useState(false);
  const [ytError, setYtError] = useState(false);
  const isDraggingRef = useRef(false);
  const lastActiveWordRef = useRef<string | null>(null);
  const stableTimeRef = useRef<number>(0);
  const handleTimeUpdateRef = useRef<(time: number) => void>(() => {});
  const lastSeekToRef = useRef<number | null>(null);
  const ytPlayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const togglePlayRef = useRef<() => void>(() => {});
  const stopNarrationRef = useRef<() => void>(() => {});
  const playSegmentRef = useRef<(start: number, end: number, index: number) => void>(() => {});
  const focusSegmentIndexRef = useRef<number>(0);
  const trackRef = useRef(track);

  const hasVideo = !!(track.isVideo && ((track.youtubeId && !ytError) || track.localVideoUrl || track.videoFileName));

  // Reset ytError when switching to a different track
  useEffect(() => {
    setYtError(false);
  }, [track.id]);

  // Close video drawer if video is removed
  useEffect(() => {
    if (!hasVideo && showVideo) {
      setShowVideo(false);
    }
  }, [hasVideo, showVideo]);

  // Reset to beginning on mount (when returning from Library/Home)
  // This won't trigger when returning from Flashcards because AudioPlayer stays mounted.
  useEffect(() => {
    setCurrentTime(0);
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }
    // For YouTube, it will be handled when the player is ready or via seekTo if already ready
    if (ytPlayerRef.current && isYtReady) {
      ytPlayerRef.current.seekTo?.(0);
    }
  }, []);

  // YouTube API initialization
  useEffect(() => {
    if (track.youtubeId && !window.YT) {
      const tag = document.createElement('script');
      tag.src = "https://www.youtube.com/iframe_api";
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
    }
  }, [track.youtubeId]);

  useEffect(() => {
    if (!track.youtubeId) return;

    setYtError(false);
    let destroyed = false;
    const ytContainerId = 'yt-player-element';

    const onPlayerReady = (event: any) => {
      if (destroyed) return;
      setIsYtReady(true);
      setDuration(event.target.getDuration());
    };

    const onPlayerStateChange = (event: any) => {
      if (destroyed) return;
      const state = event.data;
      if (state === 1) setIsPlaying(true);
      else if (state === 2) setIsPlaying(false);
      else if (state === 0) {
        handleEndedInternal();
      }
    };

    const onPlayerError = () => {
      if (destroyed) return;
      setYtError(true);
      setIsYtReady(false);
    };

    const initYt = () => {
      if (destroyed) return;
      if (!document.getElementById(ytContainerId)) return;
      if (ytPlayerRef.current) {
        try { ytPlayerRef.current.destroy(); } catch (e) { }
        ytPlayerRef.current = null;
      }
      ytPlayerRef.current = new window.YT.Player(ytContainerId, {
        videoId: track.youtubeId,
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          fs: 0,
          cc_load_policy: 0,
          iv_load_policy: 3,
          origin: window.location.origin
        },
        events: {
          onReady: onPlayerReady,
          onStateChange: onPlayerStateChange,
          onError: onPlayerError
        }
      });
    };

    const tryInit = (attempts = 0) => {
      if (destroyed) return;
      if (document.getElementById(ytContainerId)) {
        initYt();
      } else if (attempts < 20) {
        requestAnimationFrame(() => tryInit(attempts + 1));
      }
    };

    if (window.YT && window.YT.Player) {
      tryInit();
    } else {
      window.onYouTubeIframeAPIReady = () => {
        if (!destroyed) tryInit();
      };
    }

    return () => {
      destroyed = true;
      if (ytPlayerRef.current && ytPlayerRef.current.destroy) {
        try {
          ytPlayerRef.current.destroy();
        } catch (e) { }
        ytPlayerRef.current = null;
      }
      setIsYtReady(false);
    };
  }, [track.youtubeId, track.id]);

  // Keep handleTimeUpdateRef sempre atualizado para evitar stale closure no RAF
  useEffect(() => {
    handleTimeUpdateRef.current = handleTimeUpdateLogic;
  });

  // Sync playback time with state using requestAnimationFrame for smooth UI
  useEffect(() => {
    let animationFrameId: number;

    const updateTime = () => {
      if (!isDraggingRef.current) {
        if (track.youtubeId && isYtReady && ytPlayerRef.current?.getCurrentTime) {
          const time = ytPlayerRef.current.getCurrentTime();
          if (time !== undefined) {
            handleTimeUpdateRef.current(time);
          }
        } else if (!track.youtubeId && audioRef.current) {
          handleTimeUpdateRef.current(audioRef.current.currentTime);
        }
      }
      if (isPlaying) {
        animationFrameId = requestAnimationFrame(updateTime);
      }
    };

    if (isPlaying) {
      animationFrameId = requestAnimationFrame(updateTime);
    }

    return () => cancelAnimationFrame(animationFrameId);
  }, [isPlaying, track.youtubeId, isYtReady]);

  // Limpa o destaque da palavra quando a reprodução para
  useLayoutEffect(() => {
    if (!isPlaying) {
      if (lastActiveWordRef.current) {
        const el = document.querySelector(`[data-word-key="${lastActiveWordRef.current}"]`) as HTMLElement | null;
        if (el) el.style.removeProperty('color');
        lastActiveWordRef.current = null;
      }
      stableTimeRef.current = 0;
    }
  }, [isPlaying]);

  // Sync Video Element with Audio Master
  useEffect(() => {
    if (videoRef.current && audioRef.current && !track.youtubeId) {
      const diff = Math.abs(videoRef.current.currentTime - audioRef.current.currentTime);
      if (diff > 0.1) {
        videoRef.current.currentTime = audioRef.current.currentTime;
      }

      if (isPlaying && videoRef.current.paused) {
        videoRef.current.play().catch(() => { });
      } else if (!isPlaying && !videoRef.current.paused) {
        videoRef.current.pause();
      }

      videoRef.current.playbackRate = globalSpeed;
    }
  }, [currentTime, isPlaying, globalSpeed, track.youtubeId]);

  const [editData, setEditData] = useState<{ start: number; end: number; text: string; translation: string }>({
    start: 0,
    end: 0,
    text: '',
    translation: ''
  });

  // Automatically close edit window when global edit mode is turned off
  useEffect(() => {
    if (!isEditModeGlobal) {
      setEditingIndex(null);
    }
  }, [isEditModeGlobal]);

  const getSegmentStartWithPreroll = (start: number) => Math.max(0, start - 0.5);
  const [stopTime, setStopTime] = useState<number | null>(null);

  // Active repeat state tracking
  const repeatsLeftRef = useRef<number>(0);
  const globalRepeatsLeftRef = useRef<number>(0);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number | null>(null);

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const lastScrolledIndex = useRef<number>(-1);
  const transcriptRef = useRef(track.transcript);

  const [isSyncingTranslation, setIsSyncingTranslation] = useState<number | null>(null);

  useEffect(() => {
    transcriptRef.current = track.transcript;
  }, [track.transcript]);

  const knownWords = useMemo(() => new Set((globalKnownWords || []).map(w => w.toLowerCase())), [globalKnownWords]);

  const handleSegmentClick = (e: React.MouseEvent, idx: number, wordIndex?: number, word?: string) => {
    e.stopPropagation();

    // Dictionary Mode Logic
    if (isDictionaryModeGlobal) {
      if (word && track.flashcards && onOpenFlashcardAtIndex) {
        if (e.detail === 2) {
          // Double-click on word: narrate segment
          setManuallyHighlightedSegment(null);
          const seg = track.transcript[idx];
          playSegment(seg.start, seg.end, idx);
          return;
        }
        // Single click on word: open flashcard and highlight segment
        setIsPlaying(false);
        if (track.youtubeId && ytPlayerRef.current && isYtReady) {
          ytPlayerRef.current.pauseVideo?.();
        } else if (audioRef.current) {
          audioRef.current.pause();
        }
        setManuallyHighlightedSegment(idx);

        const lowerSearch = word.toLowerCase().trim();
        let cardIdx = track.flashcards.findIndex(fc =>
          fc.expression.toLowerCase().trim() === lowerSearch
        );

        if (cardIdx === -1) {
          const regex = new RegExp(`\\b${lowerSearch}\\b`, 'i');
          cardIdx = track.flashcards.findIndex(fc => regex.test(fc.expression));
        }

        onOpenFlashcardAtIndex(cardIdx !== -1 ? cardIdx : 0, idx);
      } else if (e.detail === 2 && !word) {
        // Double-click on empty space: narrate segment
        setManuallyHighlightedSegment(null);
        const seg = track.transcript[idx];
        playSegment(seg.start, seg.end, idx);
      }
      return;
    }

    // Normal mode: single click plays segment
    setManuallyHighlightedSegment(null);
    const segment = track.transcript[idx];
    playSegment(segment.start, segment.end, idx);
  };

  const renderSegmentText = (text: string, isActive: boolean, segmentIdx: number) => {
    // Basic word split that preserves punctuation and contractions
    const pattern = /([a-zA-Z']+)/g;
    if (!text) return null;
    const parts = text.split(pattern);

    // Active uses a slightly muted brown, Inactive uses a more discreet faded brown
    const knownColorClass = isActive ? "text-[#827367]" : "text-[#827367]/50";
    const baseColorClass = isActive ? "text-gray-200" : "text-gray-400";

    return parts.map((part, i) => {
      const isWord = /^[a-zA-Z']+$/.test(part);
      if (!isWord) {
        // Apply color to punctuation if the immediately preceding word was known
        let followingKnownWord = false;
        if (i > 0) {
          const prevPart = parts[i - 1];
          if (/^[a-zA-Z']+$/.test(prevPart) && knownWords.has(prevPart.toLowerCase())) {
            followingKnownWord = true;
          }
        }
        return (
          <span
            key={i}
            className={cn(
              "transition-colors duration-120 ease-in-out",
              followingKnownWord ? knownColorClass : baseColorClass
            )}
          >
            {part}
          </span>
        );
      }

      const lowerWord = part.toLowerCase();
      const needsHighlight = !knownWords.has(lowerWord);
      const wordCount = Math.floor(i / 2);

      return (
        <span
          key={i}
          onClick={(e) => handleSegmentClick(e, segmentIdx, i, part)}
          data-word-key={`${segmentIdx}-${wordCount}`}
          className={cn(
            "cursor-pointer",
            needsHighlight ? baseColorClass : knownColorClass,
            isDictionaryModeGlobal && "border-b border-dotted border-[#827367] pb-[1px]"
          )}
        >
          {part}
        </span>
      );
    });
  };

  const triggerSmartSync = async (idx: number) => {
    if (!userApiKey || userApiKey.trim() === "") {
      onMissingKey?.();
      return null;
    }
    setIsSyncingTranslation(idx);
    try {
      const refined = await smartAlignSegmentTranslation(
        editData.text,
        editData.translation,
        track.transcript.map(s => s.text).join(" "),
        nativeLanguage,
        deepseekApiKey,
        hasBillingEnabled
      );
      setEditData(prev => ({ ...prev, translation: refined }));
      return refined;
    } catch (err: any) {
      if (err.message === "QUOTA_EXCEEDED") {
        onQuotaExceeded?.();
      } else {
        console.error("Smart Sync failed", err);
      }
      return null;
    } finally {
      setIsSyncingTranslation(null);
    }
  };

  const handleSmartSync = async (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    await triggerSmartSync(idx);
  };

  useEffect(() => {
    // Auto-scroll to active segment ONLY during global playback (stopTime is null)
    if (isPlaying && stopTime === null) {
      const activeIdx = track.transcript.findIndex(s => currentTime >= s.start && currentTime <= s.end);
      if (activeIdx !== -1 && activeIdx !== lastScrolledIndex.current) {
        lastScrolledIndex.current = activeIdx;
        if (isMaximized) {
          setFocusSegmentIndex(activeIdx);
        }
        const element = document.getElementById(`segment-${activeIdx}`);
        if (element) {
          element.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
        }
      }
    }
  }, [currentTime, isPlaying, track.transcript, stopTime]);

  const handleStartEdit = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingIndex(idx);
    const segment = track.transcript[idx];
    setEditData({
      text: segment.text,
      translation: segment.translation || "",
      start: segment.start,
      end: segment.end
    });

    // Zoom in the slider bounds for precise editing
    const windowSize = segment.end - segment.start;
    const padding = Math.max(5, windowSize * 0.5);
    setEditSliderBounds({
      min: Math.max(0, segment.start - padding),
      max: segment.end + padding
    });
  };

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>, idx: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const selectionStart = e.currentTarget.selectionStart;
      const text = editData.text;

      const beforeSplit = text.slice(0, selectionStart).trim();
      const afterSplit = text.slice(selectionStart).trim();

      if (afterSplit) {
        const originalSegment = track.transcript[idx];
        const totalDuration = editData.end - editData.start;
        const totalChars = beforeSplit.length + afterSplit.length;
        const ratio = totalChars > 0 ? beforeSplit.length / totalChars : 0.5;
        const splitTime = editData.start + totalDuration * ratio;

        // Visual feedback immediate: naive proportional split but at word boundaries
        const originalTranslation = originalSegment.translation || "";
        let naiveSplitIdx = Math.floor(originalTranslation.length * ratio);

        // Improve naive split: find nearest space to avoid cutting words
        const spaceBefore = originalTranslation.lastIndexOf(' ', naiveSplitIdx);
        const spaceAfter = originalTranslation.indexOf(' ', naiveSplitIdx);

        if (spaceBefore !== -1 && (naiveSplitIdx - spaceBefore < spaceAfter - naiveSplitIdx || spaceAfter === -1)) {
          naiveSplitIdx = spaceBefore;
        } else if (spaceAfter !== -1) {
          naiveSplitIdx = spaceAfter;
        }

        const naiveA = originalTranslation.slice(0, naiveSplitIdx).trim();
        const naiveB = originalTranslation.slice(naiveSplitIdx).trim();

        const segmentA: TranscriptSegment = {
          ...originalSegment,
          text: beforeSplit,
          translation: naiveA,
          start: editData.start,
          end: splitTime
        };
        const segmentB: TranscriptSegment = {
          ...originalSegment,
          text: afterSplit,
          translation: naiveB,
          start: splitTime,
          end: editData.end
        };

        const newTranscript = [...track.transcript];
        newTranscript.splice(idx, 1, segmentA, segmentB);

        onUpdateTrack?.({ transcript: newTranscript });

        // Immediate visual feedback: move focus to the new segment
        setEditingIndex(idx + 1);
        setEditData({
          text: afterSplit,
          translation: naiveB,
          start: splitTime,
          end: editData.end
        });

        // Let AI split the translation elegantly in the background
        if (originalTranslation) {
          try {
            const { translationA, translationB } = await smartSplitTranslation(
              originalSegment.text,
              originalTranslation,
              beforeSplit,
              afterSplit,
              nativeLanguage,
              deepseekApiKey,
              hasBillingEnabled
            );

            // Fetch latest transcript from ref to ensure we don't overwrite other changes
            const updatedTranscript = [...transcriptRef.current];

            // Re-find the segments precisely because indices might have changed 
            // if the user did multiple splits rapidly.
            // We'll search for the segments by their current content.
            const targetIdxA = updatedTranscript.findIndex(s => s.text === beforeSplit && s.start === segmentA.start);
            const targetIdxB = updatedTranscript.findIndex(s => s.text === afterSplit && s.start === segmentB.start);

            if (targetIdxA !== -1 && targetIdxB !== -1) {
              updatedTranscript[targetIdxA] = { ...updatedTranscript[targetIdxA], translation: translationA };
              updatedTranscript[targetIdxB] = { ...updatedTranscript[targetIdxB], translation: translationB };
              onUpdateTrack?.({ transcript: updatedTranscript });

              // If we are still editing segment B, update its local editData translation
              // We check if the current editingIndex still corresponds to segment B
              if (editingIndex === targetIdxB) {
                setEditData(prev => ({
                  ...prev,
                  translation: translationB
                }));
              }
            }
          } catch (err: any) {
            if (err.message === "QUOTA_EXCEEDED") {
              onQuotaExceeded?.();
            } else {
              console.error("AI Split failed", err);
            }
          }
        }
      }
    }
  };

  const handleSaveEdit = async (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();

    // Se o texto em inglês for apagado, excluímos o segmento automaticamente
    if (editData.text.trim() === "") {
      const newTranscript = [...track.transcript];
      newTranscript.splice(idx, 1);
      onUpdateTrack?.({ transcript: newTranscript });
      setEditingIndex(null);
      return;
    }

    const originalSegment = track.transcript[idx];
    const englishChanged = originalSegment.text !== editData.text;
    const translationChanged = originalSegment.translation !== editData.translation;

    // Check for multiple lines to split the segment
    const englishLines = editData.text.split("\n").filter(line => line.trim() !== "");
    const translationLines = editData.translation.split("\n").filter(line => line.trim() !== "");

    if (englishLines.length > 1) {
      // ... (Rest of splitting logic stays same)
      const totalDuration = editData.end - editData.start;
      const totalChars = englishLines.reduce((acc, line) => acc + line.length, 0);

      const newSegments: TranscriptSegment[] = [];
      let currentStartTime = editData.start;

      englishLines.forEach((line, i) => {
        const charCount = line.length;
        const durationRatio = charCount / totalChars;
        const segmentDuration = totalDuration * durationRatio;
        const lineTranslation = translationLines[i] || "";

        newSegments.push({
          ...originalSegment,
          text: line.trim(),
          translation: lineTranslation.trim(),
          start: currentStartTime,
          end: i === englishLines.length - 1 ? editData.end : currentStartTime + segmentDuration
        });
        currentStartTime += segmentDuration;
      });

      const newTranscript = [...track.transcript];
      newTranscript.splice(idx, 1, ...newSegments);
      onUpdateTrack?.({ transcript: newTranscript });
      setEditingIndex(null);
    } else {
      // Standard save
      const newTranscript = [...track.transcript];
      newTranscript[idx] = {
        ...newTranscript[idx],
        text: editData.text,
        translation: editData.translation,
        start: editData.start,
        end: editData.end
      };
      onUpdateTrack?.({ transcript: newTranscript });
      setEditingIndex(null);
    }
  };

  const handleCancelEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingIndex(null);
  };

  const handlePreviewEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (editingIndex !== null) {
      playSegment(editData.start, editData.end, editingIndex);
    }
  };

  useEffect(() => {
    trackRef.current = track;
    setIsPlaying(false);
    setCurrentTime(0);
    setStopTime(null);
    setShowTranslations({});
    stableTimeRef.current = 0;
    if (audioRef.current) {
      audioRef.current.load();
    }
    globalRepeatsLeftRef.current = globalRepeat === Infinity ? Infinity : Math.max(0, globalRepeat - 1);
  }, [track]);

  useEffect(() => {
    globalRepeatsLeftRef.current = globalRepeat === Infinity ? Infinity : Math.max(0, globalRepeat - 1);
  }, [globalRepeat]);

  const togglePlay = () => {
    // Check if audio is valid (not the silent placeholder)
    if (!track.youtubeId && audioRef.current) {
      // If the audio URL is a blob and likely the 44-byte placeholder
      if (track.url.startsWith('blob:')) {
        // We check if the duration is extremely short (placeholder is usually < 0.2s)
        // Or if the audio hasn't loaded properly yet, we check the metadata
        if (audioRef.current.duration < 0.2 || isNaN(audioRef.current.duration)) {
          onMissingAudioSyncClick?.();
          return;
        }
      }
    }

    if (track.youtubeId) {
      if (ytPlayerRef.current && isYtReady) {
        if (isPlaying) {
          ytPlayerRef.current.pauseVideo?.();
        } else {
          setManuallyHighlightedSegment(null);
          // If starting fresh or from end reset repeats
          if (ytPlayerRef.current.getCurrentTime && ytPlayerRef.current.getCurrentTime() < 0.1) {
            globalRepeatsLeftRef.current = globalRepeat === Infinity ? Infinity : Math.max(0, globalRepeat - 1);
          }
          setStopTime(null);
          setActiveSegmentIndex(null);
          ytPlayerRef.current.setPlaybackRate?.(globalSpeed);
          ytPlayerRef.current.playVideo?.();
        }
      }
    } else if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        setManuallyHighlightedSegment(null);
        // If starting fresh or from end, reset global repeats
        if (audioRef.current.currentTime < 0.1 || audioRef.current.ended) {
          globalRepeatsLeftRef.current = globalRepeat === Infinity ? Infinity : Math.max(0, globalRepeat - 1);
        }

        // If we were in "segment mode", clearing stopTime allows normal continuation
        setStopTime(null);
        setActiveSegmentIndex(null);
        audioRef.current.playbackRate = globalSpeed;
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };
  togglePlayRef.current = togglePlay;

  const handleTimeUpdateLogic = (time: number) => {
    setCurrentTime(prevTime => {
      const diff = time - prevTime;
      // Strictly enforce forward-only movement during active playback for small variances.
      // This eliminates the 'back and forth' jitter especially at the start.
      if (isPlaying && !isDraggingRef.current && diff < 0 && diff > -0.5) {
        return prevTime;
      }
      return time;
    });

    // Estabiliza o time: só avança, nunca volta (elimina jitter que causava
    // re-destaque rápido em palavras anteriores)
    if (time > stableTimeRef.current || !isPlaying || isDraggingRef.current) {
      stableTimeRef.current = time;
    }
    const stableTime = stableTimeRef.current;

    // Word-by-word highlight apenas no modo foco (isMaximized)
    if (isMaximized) {
      const segIdx = activeSegmentIndex !== null
        ? activeSegmentIndex
        : track.transcript.findIndex(s => stableTime >= s.start && stableTime <= s.end);
      let activeKey: string | null = null;
      if (segIdx !== -1) {
        const seg = track.transcript[segIdx];
        let wIdx: number | null = null;
        if (seg.words?.length) {
          const exact = seg.words.findIndex(w => stableTime >= w.start && stableTime <= w.end);
          if (exact !== -1) {
            wIdx = exact;
          } else {
            const wordCount = seg.words.length;
            const segDur = seg.end - seg.start;
            if (segDur > 0) {
              const estimated = Math.max(0, Math.floor((stableTime - seg.start) / (segDur / wordCount)));
              if (estimated < wordCount) wIdx = estimated;
            }
          }
        }
        if (wIdx === null) {
          const textWords = seg.text.trim().split(/\s+/).filter(w => w.length > 0);
          if (textWords.length > 0) {
            const segDur = seg.end - seg.start;
            if (segDur > 0) {
              const estimated = Math.max(0, Math.floor((stableTime - seg.start) / (segDur / textWords.length)));
              if (estimated < textWords.length) wIdx = estimated;
            }
          }
        }
        if (wIdx !== null) {
          const prevKey = lastActiveWordRef.current;
          if (prevKey) {
            const parts = prevKey.split('-');
            if (parts.length === 2) {
              const prevSeg = parseInt(parts[0], 10);
              const prevWord = parseInt(parts[1], 10);
              if (segIdx === prevSeg && wIdx < prevWord) {
                wIdx = prevWord;
              }
            }
          }
        }
        if (wIdx !== null) activeKey = `${segIdx}-${wIdx}`;
      }
      if (activeKey !== lastActiveWordRef.current) {
        if (lastActiveWordRef.current) {
          const prevEl = document.querySelector(`[data-word-key="${lastActiveWordRef.current}"]`) as HTMLElement | null;
          if (prevEl) prevEl.style.removeProperty('color');
        }
        if (activeKey) {
          const el = document.querySelector(`[data-word-key="${activeKey}"]`) as HTMLElement | null;
          if (el) {
            el.style.setProperty('color', 'rgb(229, 231, 235)', 'important');
          }
        }
        lastActiveWordRef.current = activeKey;
      }
    }

    let currentActiveSpeed = globalSpeed;

    // Apply speed
    if (track.youtubeId) {
      if (ytPlayerRef.current && isYtReady && ytPlayerRef.current.getPlaybackRate?.() !== currentActiveSpeed) {
        ytPlayerRef.current.setPlaybackRate?.(currentActiveSpeed);
      }
    } else if (audioRef.current && audioRef.current.playbackRate !== currentActiveSpeed) {
      audioRef.current.playbackRate = currentActiveSpeed;
    }

    // Handle segment stop time
    if (stopTime !== null && time >= stopTime) {
      if (repeatsLeftRef.current > 0 || repeatsLeftRef.current === Infinity) {
        if (activeSegmentIndex !== null) {
          const seg = track.transcript[activeSegmentIndex];
          const loopStart = getSegmentStartWithPreroll(seg.start);
          stableTimeRef.current = loopStart;
          if (track.youtubeId && ytPlayerRef.current && isYtReady) {
            ytPlayerRef.current.pauseVideo?.();
            setIsPlaying(false);
            ytPlayerRef.current.seekTo?.(loopStart);
            lastSeekToRef.current = loopStart;
            if (ytPlayTimeoutRef.current) clearTimeout(ytPlayTimeoutRef.current);
            ytPlayTimeoutRef.current = setTimeout(() => {
              ytPlayerRef.current?.playVideo?.();
              setIsPlaying(true);
            }, 150);
          } else if (audioRef.current) {
            audioRef.current.currentTime = loopStart;
            audioRef.current.play();
          }
          if (repeatsLeftRef.current !== Infinity) {
            repeatsLeftRef.current -= 1;
          }
        }
      } else {
        if (track.youtubeId && ytPlayerRef.current && isYtReady) {
          ytPlayerRef.current.pauseVideo?.();
        } else if (audioRef.current) {
          audioRef.current.pause();
        }
        setIsPlaying(false);
        setStopTime(null);
        setActiveSegmentIndex(null);
      }
    }
  };

  const handleTimeUpdate = () => {
    if (isDraggingRef.current) return;
    if (audioRef.current) {
      handleTimeUpdateLogic(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleSeekChange = (value: number[]) => {
    if (isNaN(value[0])) return;
    isDraggingRef.current = true;
    setCurrentTime(value[0]);
  };

  const handleSeekCommit = (value: number[]) => {
    if (isNaN(value[0])) {
      isDraggingRef.current = false;
      return;
    }
    const time = value[0];
    stableTimeRef.current = time;
    if (track.youtubeId && ytPlayerRef.current && isYtReady) {
      ytPlayerRef.current.seekTo?.(time);
      setCurrentTime(time);
      setStopTime(null);
      setActiveSegmentIndex(null);
    } else if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
      setStopTime(null);
      setActiveSegmentIndex(null);
    }

    // Delay turning off the dragging flag slightly so the player
    // time has a chance to catch up and we don't snap the slider backward.
    setTimeout(() => {
      isDraggingRef.current = false;
    }, 400);
  };

  useEffect(() => {
    if (externalJumpToSegmentIndex !== undefined && externalJumpToSegmentIndex !== null) {
      const segment = track.transcript[externalJumpToSegmentIndex];
      if (segment) {
        if (isDictionaryModeGlobal) {
          // Just scroll, no playback
          const element = document.getElementById(`segment-${externalJumpToSegmentIndex}`);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          onJumpedToSegment?.();
        } else {
          playSegment(segment.start, segment.end, externalJumpToSegmentIndex);
          onJumpedToSegment?.();
        }
      }
    }
  }, [externalJumpToSegmentIndex, track.transcript, isDictionaryModeGlobal]);

  const playSegment = (start: number, end: number, index: number) => {
    setManuallyHighlightedSegment(null);
    const repeats = globalRepeat;
    repeatsLeftRef.current = repeats === Infinity ? Infinity : Math.max(0, repeats - 1);
    setActiveSegmentIndex(index);

    // O tempo de parada segue exatamente o 'end' do segmento.
    setStopTime(end);

    const speed = globalSpeed;

    // 0.5s de preroll para evitar corte da primeira sílaba por buffer.
    // O destaque palavra por palavra usa activeSegmentIndex diretamente
    // (em vez de buscar por tempo), então não é afetado pelo preroll.
    const exactStart = getSegmentStartWithPreroll(start);
    stableTimeRef.current = exactStart;

    if (track.youtubeId && ytPlayerRef.current && isYtReady) {
      ytPlayerRef.current.pauseVideo?.();
      setIsPlaying(false);
      ytPlayerRef.current.setPlaybackRate?.(speed);
      ytPlayerRef.current.seekTo?.(exactStart);
      lastSeekToRef.current = exactStart;
      setCurrentTime(exactStart);
      if (ytPlayTimeoutRef.current) clearTimeout(ytPlayTimeoutRef.current);
      ytPlayTimeoutRef.current = setTimeout(() => {
        ytPlayerRef.current?.playVideo?.();
        setIsPlaying(true);
      }, 150);
    } else if (audioRef.current) {
      const audio = audioRef.current;
      audio.pause();
      audio.currentTime = exactStart;
      audio.playbackRate = speed;
      const startPlayback = () => {
        audio.play().catch(() => { });
      };
      if (audio.readyState < 2) {
        const onCanPlay = () => {
          audio.removeEventListener('canplay', onCanPlay);
          startPlayback();
        };
        audio.addEventListener('canplay', onCanPlay);
      } else {
        requestAnimationFrame(startPlayback);
      }
      setCurrentTime(exactStart);
      setIsPlaying(true);
    }
  };
  playSegmentRef.current = playSegment;

  const handleEndedInternal = () => {
    if (globalRepeatsLeftRef.current > 0 || globalRepeatsLeftRef.current === Infinity) {
      stableTimeRef.current = 0;
      if (track.youtubeId && ytPlayerRef.current && isYtReady) {
        ytPlayerRef.current.pauseVideo?.();
        setIsPlaying(false);
        ytPlayerRef.current.seekTo?.(0);
        lastSeekToRef.current = 0;
        if (ytPlayTimeoutRef.current) clearTimeout(ytPlayTimeoutRef.current);
        ytPlayTimeoutRef.current = setTimeout(() => {
          ytPlayerRef.current?.playVideo?.();
          setIsPlaying(true);
        }, 150);
      } else if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play();
      }
      if (globalRepeatsLeftRef.current !== Infinity) {
        globalRepeatsLeftRef.current -= 1;
      }
    } else {
      setIsPlaying(false);
    }
  };

  const stopNarration = () => {
    if (ytPlayTimeoutRef.current) {
      clearTimeout(ytPlayTimeoutRef.current);
      ytPlayTimeoutRef.current = null;
    }
    lastSeekToRef.current = null;
    setIsPlaying(false);
    setStopTime(null);
    setActiveSegmentIndex(null);
    if (track.youtubeId && ytPlayerRef.current && isYtReady) {
      ytPlayerRef.current.pauseVideo?.();
    } else if (audioRef.current) {
      audioRef.current.pause();
    }
  };
  stopNarrationRef.current = stopNarration;

  // Mantém a ref sincronizada para uso nos atalhos de teclado
  useEffect(() => {
    focusSegmentIndexRef.current = focusSegmentIndex;
  }, [focusSegmentIndex]);

  // Atalhos de teclado para desktop
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputActive = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (isInputActive) return;

      // Ignora atalhos se a overlay de flashcards estiver aberta
      if (document.body.getAttribute('data-flashcards-open') === 'true') return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (isMaximized) {
          // No modo foco: Espaço reproduz apenas o segmento atual
          const idx = focusSegmentIndexRef.current;
          const seg = trackRef.current.transcript[idx];
          if (seg) {
            playSegmentRef.current(seg.start, seg.end, idx);
          }
        } else {
          // No modo normal: Espaço reproduz a lição completa (play/pause)
          togglePlayRef.current();
        }
      }

      if (isMaximized) {
        if (e.code === 'ArrowRight') {
          e.preventDefault();
          stopNarrationRef.current();
          setFocusSegmentIndex(prev => (prev + 1) % track.transcript.length);
        } else if (e.code === 'ArrowLeft') {
          e.preventDefault();
          stopNarrationRef.current();
          setFocusSegmentIndex(prev => (prev - 1 + track.transcript.length) % track.transcript.length);
        } else if (e.code === 'ArrowDown') {
          e.preventDefault();
          setShowTranslations(prev => ({
            ...prev,
            [focusSegmentIndexRef.current]: !prev[focusSegmentIndexRef.current]
          }));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMaximized, track.transcript.length]);

  const toggleTranslation = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setShowTranslations(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  const formatTime = (time: number) => {
    if (isNaN(time) || time < 0) return "0:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const formatTimeFull = (time: number) => {
    if (isNaN(time) || time < 0) return "0:00.0";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    const tenths = Math.floor((time % 1) * 10);
    return `${minutes}:${seconds.toString().padStart(2, "0")}.${tenths}`;
  };

  const isSegmentActive = (segment: TranscriptSegment) => {
    return currentTime >= segment.start && currentTime <= segment.end;
  };

  // Returns the segment index that should appear active/highlighted
  // Either because it's being narrated or because user clicked a word in dictionary mode
  const getActiveSegmentIndex = (segmentIdx: number): boolean => {
    // When a specific segment is being narrated, always highlight it visually
    if (activeSegmentIndex === segmentIdx) return true;
    // During global play, fall back to time-based detection
    const segment = track.transcript[segmentIdx];
    if (currentTime >= segment.start && currentTime <= segment.end) return true;
    if (manuallyHighlightedSegment === segmentIdx) return true;
    return false;
  };

  return (
    <div className="flex flex-col h-full bg-transparent sm:bg-[#0d0d0d] rounded-3xl border-[1.5px] border-white/10 overflow-hidden shadow-2xl">
      {!isMaximized && (
        /* Track Info */
        <div className="p-4 sm:p-4 flex flex-col bg-white/[0.04] border-b border-white/5">
          <div className="flex items-center space-x-4 w-full">
            <motion.div
              key={track.id}
              className={cn(
                "w-14 h-14 sm:w-16 sm:h-16 flex items-center justify-center shrink-0 aspect-square ml-1 overflow-hidden transition-all duration-300 rounded-full",
                isEditModeGlobal
                  ? "bg-white/[0.03] border border-white/10 focus-within:border-white/20"
                  : "bg-[#443a32]/20 border border-white/5"
              )}
            >
              {isEditModeGlobal ? (
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={track.lessonNumber === undefined ? "" : track.lessonNumber}
                  placeholder={trackNumber.toString()}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "") {
                      onUpdateTrack?.({ lessonNumber: undefined });
                    } else {
                      const parsed = parseInt(val, 10);
                      if (!isNaN(parsed)) {
                        onUpdateTrack?.({ lessonNumber: parsed });
                      }
                    }
                  }}
                  className="bg-transparent border-none text-center outline-none w-full h-full text-base font-bold text-[#827367] font-mono cursor-text placeholder:text-[#827367]/30"
                />
              ) : (
                <span className="text-base sm:text-lg font-bold text-[#827367]/40 font-mono">{track.lessonNumber ?? trackNumber}</span>
              )}
            </motion.div>
            <div className="flex-1 min-w-0">
              {isEditModeGlobal ? (
                <input
                  type="text"
                  value={track.title}
                  onChange={(e) => onUpdateTrack?.({ title: e.target.value })}
                  className="bg-white/[0.03] border border-white/10 rounded-lg px-3 py-1 text-xl font-semibold text-gray-200 tracking-tight w-full outline-none focus:border-white/20 transition-all"
                />
              ) : (
                <h2 className="text-xl font-semibold text-gray-300 tracking-tight break-words whitespace-normal leading-tight">{track.title}</h2>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsDictionaryModeGlobal(!isDictionaryModeGlobal)}
              className={cn(
                "transition-all active:scale-90 w-10 h-10 shrink-0",
                isDictionaryModeGlobal ? "text-[#827367]" : "text-gray-500 hover:text-gray-200"
              )}
              title={isDictionaryModeGlobal ? "Desativar Modo Dicionário" : "Ativar Modo Dicionário"}
            >
              <Book className="w-5 h-5 shrink-0" />
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col relative min-h-0 flex-1">
        {hasVideo && (
          <motion.div
            initial={false}
            animate={{
              height: showVideo ? "auto" : 0,
              opacity: showVideo ? 1 : 0
            }}
            transition={{ duration: 0.4, ease: "easeInOut" }}
            className="overflow-hidden w-full"
          >
            <div className="px-4 sm:px-8 pt-4">
              <div className="w-full sm:max-w-xl lg:max-w-lg mx-auto aspect-video bg-black rounded-2xl border border-white/10 shadow-2xl overflow-hidden group relative z-10">
                {track.youtubeId ? (
                  <div id="yt-player-element" className="w-full h-full" />
                ) : track.localVideoUrl ? (
                  <video
                    ref={videoRef}
                    src={track.localVideoUrl}
                    className="w-full h-full object-contain"
                    muted
                    playsInline
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-center p-6 bg-stone-900 border border-white/5">
                    <Youtube className="w-12 h-12 text-gray-600 mb-4" />
                    <p className="text-base font-bold text-gray-400 mb-2">Vídeo Offline Não Encontrado</p>
                    {track.videoFileName && (
                      <p className="text-base text-gray-500 mb-4 italic">
                        Esperado: {track.videoFileName}
                      </p>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onVideoSyncClick}
                      className="border-white/10 text-xs uppercase tracking-widest font-bold"
                    >
                      Sincronizar Novamente
                    </Button>
                  </div>
                )}
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button size="icon" variant="ghost" onClick={() => setShowVideo(false)} className="w-8 h-8 rounded-full bg-black/40 backdrop-blur-md text-white hover:bg-black/60">
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Transcript Area */}
        {isMaximized ? (
          <div
            onClick={() => {
              const segment = track.transcript[focusSegmentIndex];
              playSegment(segment.start, segment.end, focusSegmentIndex);
            }}
            className="flex-1 min-h-0 px-4 sm:px-8 pt-4 pb-0 flex flex-col overflow-hidden"
          >
            <div className="flex-1 overflow-y-auto min-h-0">
              <div className="w-full max-w-4xl mx-auto px-6 sm:px-10 py-4">
                <div className="min-w-0" key={focusSegmentIndex}>
                  {(() => {
                    const segment = track.transcript[focusSegmentIndex];
                    const sIdx = focusSegmentIndex;
                    if (!segment) return null;
                    return (
                      <div className="space-y-2">
                        <div className="flex justify-between items-start group/title pb-1">
                          <div
                            onClick={(e) => handleSegmentClick(e, sIdx)}
                            className="text-[1.3rem] sm:text-xl leading-relaxed flex-1"
                          >
                            {renderSegmentText(segment.text, false, sIdx)}
                          </div>
                          {isEditModeGlobal && (
                            <button
                              onClick={(e) => handleStartEdit(sIdx, e)}
                              className="p-3 text-gray-700 hover:text-[#827367] ml-2"
                              title="Edit segment"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                        <div className="flex flex-col space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-1">
                              <button
                                onClick={(e) => toggleTranslation(sIdx, e)}
                                className="flex items-center text-[#827367] hover:text-[#9a8c80] w-fit p-2 hover:bg-[#827367]/5 rounded-full"
                                title={showTranslations[sIdx] ? "Esconder Tradução" : "Mostrar Tradução"}
                              >
                                {showTranslations[sIdx] ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>
                          {showTranslations[sIdx] && (
                            <p
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isMaximized) {
                                  playSegment(segment.start, segment.end, sIdx);
                                }
                              }}
                              className={cn(
                                "text-lg sm:text-base text-gray-500 italic font-serif leading-relaxed",
                                isMaximized && "cursor-pointer hover:text-gray-200 transition-colors"
                              )}
                            >
                              {segment.translation || "(Tradução indisponível para este segmento.)"}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between px-6 sm:px-10 pb-0 shrink-0">
              <button
                onClick={(e) => { e.stopPropagation(); stopNarration(); setFocusSegmentIndex(prev => (prev - 1 + track.transcript.length) % track.transcript.length); }}
                className="shrink-0 w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center text-gray-500 hover:text-gray-200 active:scale-90 hover:bg-white/5 rounded-xl"
                title="Segmento anterior"
              >
                <svg viewBox="0 0 24 24" className="w-7 h-7 sm:w-8 sm:h-8 shrink-0" xmlns="http://www.w3.org/2000/svg">
                  <path d="M18 4 L6 12 L18 20 Z" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                </svg>
              </button>
              <span className="text-sm font-mono text-gray-500 select-none">
                {focusSegmentIndex + 1} / {track.transcript.length}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); stopNarration(); setFocusSegmentIndex(prev => (prev + 1) % track.transcript.length); }}
                className="shrink-0 w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center text-gray-500 hover:text-gray-200 active:scale-90 hover:bg-white/5 rounded-xl"
                title="Próximo segmento"
              >
                <svg viewBox="0 0 24 24" className="w-7 h-7 sm:w-8 sm:h-8 shrink-0" xmlns="http://www.w3.org/2000/svg">
                  <path d="M6 4 L18 12 L6 20 Z" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                </svg>
              </button>
            </div>

            {/* Editor Overlay - fica acima de tudo no modo foco */}
            {editingIndex !== null && editingIndex === focusSegmentIndex && (
              <div className="fixed inset-0 z-[999] flex items-start justify-center pt-12 sm:pt-20" onClick={handleCancelEdit}>
                <div
                  className="bg-[#0d0d0d] border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 p-6 sm:p-8 max-h-[85vh] overflow-y-auto"
                  onClick={e => e.stopPropagation()}
                >
                  {(() => {
                    const segment = track.transcript[focusSegmentIndex];
                    const sIdx = focusSegmentIndex;
                    return (
                      <div className="space-y-4">
                        <div className="space-y-3 border-b-[1.5px] border-white/10 pb-4">
                          <div className="flex justify-between items-center px-1">
                            <label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 flex items-center">
                              <Clock className="w-4 h-4 mr-2" /> Intervalo de Tempo
                            </label>
                            <span className="text-[11px] font-mono text-gray-400 uppercase tracking-widest">
                              {formatTimeFull(editData.start)} — {formatTimeFull(editData.end)}
                            </span>
                          </div>
                          <Slider
                            value={[editData.start, editData.end]}
                            min={editSliderBounds.min}
                            max={Math.min(duration || editSliderBounds.max, editSliderBounds.max)}
                            step={0.1}
                            onValueChange={(vals) => setEditData(prev => ({ ...prev, start: vals[0], end: vals[1] }))}
                            className="py-4"
                            indicatorClassName="bg-[#827367]/80"
                            thumbClassName="bg-white"
                          />
                        </div>

                        <div className="flex space-x-2">
                          <Button
                            variant="secondary"
                            size="default"
                            onClick={handlePreviewEdit}
                            className="flex-1 bg-white/5 hover:bg-white/10 text-gray-300 text-[11px] font-bold uppercase tracking-widest h-12 border border-white/5"
                          >
                            <Play className="w-4 h-4 mr-2 fill-current text-[#827367]" /> Preview
                          </Button>
                        </div>

                        <div className="space-y-2">
                          <label className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Texto em Inglês</label>
                          <Textarea
                            value={editData.text}
                            onChange={e => setEditData(prev => ({ ...prev, text: e.target.value }))}
                            onKeyDown={e => handleKeyDown(e, sIdx)}
                            className="bg-white/[0.02] border-[1.5px] border-white/10 text-gray-300 text-lg min-h-[100px]"
                          />
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Tradução em {getLanguageNameLabel(nativeLanguage)}</label>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={isSyncingTranslation !== null}
                              onClick={(e) => handleSmartSync(sIdx, e)}
                              className="flex items-center justify-center h-8 px-3 text-[10px] text-[#827367] hover:text-[#9a8c80] hover:bg-[#827367]/10 font-bold uppercase tracking-tighter whitespace-nowrap min-w-[120px]"
                            >
                              <div className="flex items-center gap-1.5">
                                {isSyncingTranslation === sIdx ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                                ) : (
                                  <Sparkles className="w-3.5 h-3.5 shrink-0" />
                                )}
                                <span>{isSyncingTranslation === sIdx ? "Ajustando..." : "Ajustar Tradução"}</span>
                              </div>
                            </Button>
                          </div>
                          <Textarea
                            value={editData.translation}
                            onChange={e => setEditData(prev => ({ ...prev, translation: e.target.value }))}
                            className="bg-white/[0.02] border-[1.5px] border-white/10 text-gray-400 text-base"
                          />
                        </div>
                        <div className="flex items-center space-x-3 pt-4 w-full">
                          <Button
                            size="default"
                            onClick={(e) => handleSaveEdit(sIdx, e)}
                            disabled={isSyncingTranslation === sIdx}
                            className="flex-1 bg-[#827367]/90 hover:bg-[#827367] text-gray-200 text-[11px] font-bold uppercase tracking-widest h-12 border-[1.5px] border-white/10 disabled:opacity-50"
                          >
                            <Check className="w-4 h-4 mr-2" /> Salvar
                          </Button>
                          <Button
                            variant="ghost"
                            size="default"
                            onClick={handleCancelEdit}
                            disabled={isSyncingTranslation === sIdx}
                            className="flex-1 text-gray-500 hover:text-gray-300 text-[11px] font-bold uppercase tracking-widest h-12 border-[1.5px] border-white/10 disabled:opacity-50"
                          >
                            <X className="w-4 h-4 mr-2" /> Cancelar
                          </Button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        ) : (
          <ScrollArea className="flex-1 min-h-0 px-4 sm:px-8 py-4">
            <div className="space-y-2 pb-8">
              {Array.isArray(track.transcript) && track.transcript.map((segment, sIdx) => (
              <motion.div
                key={sIdx}
                id={`segment-${sIdx}`}
                onClick={(e) => editingIndex === null && handleSegmentClick(e, sIdx)}
                className={cn(
                  "group transition-all duration-300 rounded-xl p-3 sm:p-4",
                  editingIndex === sIdx ? "bg-white/[0.05] border-[1.5px] border-white/20" : "cursor-pointer"
                )}
              >
                <div className="space-y-2">
                  {editingIndex === sIdx ? (
                    <div className="space-y-4" onClick={e => e.stopPropagation()}>
                      <div className="space-y-3 border-b-[1.5px] border-white/10 pb-4">
                        <div className="flex justify-between items-center px-1">
                          <label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 flex items-center">
                            <Clock className="w-4 h-4 mr-2" /> Intervalo de Tempo
                          </label>
                          <span className="text-[11px] font-mono text-gray-400 uppercase tracking-widest">
                            {formatTimeFull(editData.start)} — {formatTimeFull(editData.end)}
                          </span>
                        </div>
                        <Slider
                          value={[editData.start, editData.end]}
                          min={editSliderBounds.min}
                          max={Math.min(duration || editSliderBounds.max, editSliderBounds.max)}
                          step={0.1}
                          onValueChange={(vals) => setEditData(prev => ({ ...prev, start: vals[0], end: vals[1] }))}
                          className="py-4"
                          indicatorClassName="bg-[#827367]/80"
                          thumbClassName="bg-white"
                        />
                      </div>

                      <div className="flex space-x-2">
                        <Button
                          variant="secondary"
                          size="default"
                          onClick={handlePreviewEdit}
                          className="flex-1 bg-white/5 hover:bg-white/10 text-gray-300 text-[11px] font-bold uppercase tracking-widest h-12 border border-white/5"
                        >
                          <Play className="w-4 h-4 mr-2 fill-current text-[#827367]" /> Preview
                        </Button>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Texto em Inglês</label>
                        <Textarea
                          value={editData.text}
                          onChange={e => setEditData(prev => ({ ...prev, text: e.target.value }))}
                          onKeyDown={e => handleKeyDown(e, sIdx)}
                          className="bg-white/[0.02] border-[1.5px] border-white/10 text-gray-300 text-lg min-h-[100px]"
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Tradução em {getLanguageNameLabel(nativeLanguage)}</label>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={isSyncingTranslation !== null}
                            onClick={(e) => handleSmartSync(sIdx, e)}
                            className="flex items-center justify-center h-8 px-3 text-[10px] text-[#827367] hover:text-[#9a8c80] hover:bg-[#827367]/10 font-bold uppercase tracking-tighter whitespace-nowrap min-w-[120px]"
                          >
                            <div className="flex items-center gap-1.5">
                              {isSyncingTranslation === sIdx ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                              ) : (
                                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                              )}
                              <span>{isSyncingTranslation === sIdx ? "Ajustando..." : "Ajustar Tradução"}</span>
                            </div>
                          </Button>
                        </div>
                        <Textarea
                          value={editData.translation}
                          onChange={e => setEditData(prev => ({ ...prev, translation: e.target.value }))}
                          className="bg-white/[0.02] border-[1.5px] border-white/10 text-gray-400 text-base"
                        />
                      </div>
                      <div className="flex items-center space-x-3 pt-4 w-full">
                        <Button
                          size="default"
                          onClick={(e) => handleSaveEdit(sIdx, e)}
                          disabled={isSyncingTranslation === sIdx}
                          className="flex-1 bg-[#827367]/90 hover:bg-[#827367] text-gray-200 text-[11px] font-bold uppercase tracking-widest h-12 border-[1.5px] border-white/10 disabled:opacity-50"
                        >
                          <Check className="w-4 h-4 mr-2" /> Salvar
                        </Button>
                        <Button
                          variant="ghost"
                          size="default"
                          onClick={handleCancelEdit}
                          disabled={isSyncingTranslation === sIdx}
                          className="flex-1 text-gray-500 hover:text-gray-300 text-[11px] font-bold uppercase tracking-widest h-12 border-[1.5px] border-white/10 disabled:opacity-50"
                        >
                          <X className="w-4 h-4 mr-2" /> Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between items-start group/title pb-1 transition-all duration-300">
                        <div className="text-[1.3rem] sm:text-xl leading-relaxed flex-1">
                          {renderSegmentText(segment.text, getActiveSegmentIndex(sIdx), sIdx)}
                        </div>
                        {isEditModeGlobal && (
                          <button
                            onClick={(e) => handleStartEdit(sIdx, e)}
                            className="p-3 text-gray-700 hover:text-[#827367] transition-all ml-2"
                            title="Edit segment"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                      {isMaximized && (
                        <div className="flex flex-col space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-1">
                              <button
                                onClick={(e) => toggleTranslation(sIdx, e)}
                                className="flex items-center text-[#827367] hover:text-[#9a8c80] transition-all w-fit p-2 hover:bg-[#827367]/5 rounded-full"
                                title={showTranslations[sIdx] ? "Esconder Tradução" : "Mostrar Tradução"}
                              >
                                {showTranslations[sIdx] ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>

                          <AnimatePresence>
                            {showTranslations[sIdx] && (
                              <motion.p
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                onClick={() => {
                                  if (isDictionaryModeGlobal) {
                                    playSegment(segment.start, segment.end, sIdx);
                                  }
                                }}
                                className={cn(
                                  "text-lg sm:text-base text-gray-500 italic font-serif leading-relaxed overflow-hidden",
                                  isDictionaryModeGlobal && "cursor-pointer hover:text-gray-200 transition-colors"
                                )}
                              >
                                {segment.translation || "(Tradução indisponível para este segmento.)"}
                              </motion.p>
                            )}
                          </AnimatePresence>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </motion.div>
            ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Controls Container */}
      <div className={cn(isMaximized ? "bg-[#0d0d0d]" : "bg-white/[0.04]", "relative")}>
        <div className="px-4 sm:px-8 py-3 sm:py-4 flex flex-col justify-center min-h-[96px] sm:min-h-[112px]">
          {/* Progress bar positioned between the divider and the controls */}
          <div className="mb-3">
            <div className="flex justify-between mb-1 px-0.5">
              <span className="text-[9px] font-mono text-gray-500 uppercase tracking-widest leading-none">
                {formatTime(currentTime || 0)}
              </span>
              <span className="text-[9px] font-mono text-gray-500 uppercase tracking-widest leading-none">
                {formatTime(duration || 0)}
              </span>
            </div>
            <Slider
              value={[currentTime || 0]}
              min={0}
              max={duration || 100}
              step={0.1}
              onValueChange={handleSeekChange}
              onValueCommitted={handleSeekCommit}
              className="w-full cursor-pointer h-1"
            />
          </div>

          <div className="flex items-center justify-center">
            {/* Center: Playback Buttons + Speed + Repeat */}
            <div className="flex items-center space-x-4 sm:space-x-12">
              <div className="scale-110 sm:scale-100">
                <DropdownSelector
                  value={globalSpeed}
                  options={[0.5, 0.75, 1, 1.25, 1.5, 2]}
                  icon={Gauge}
                  onChange={setGlobalSpeed}
                  onFormatValue={(val) => val === 1 ? "1x" : `${val}x`}
                />
              </div>

              <div className="flex items-center space-x-6 sm:space-x-8">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleVideoClick}
                  onPointerDown={handleVideoTouchStart}
                  onPointerUp={handleVideoTouchEnd}
                  onPointerLeave={() => {
                    if (longPressTimerRef.current) {
                      clearTimeout(longPressTimerRef.current);
                      longPressTimerRef.current = null;
                    }
                  }}
                  className={cn(
                    "transition-all active:scale-90 w-14 h-14 sm:w-12 sm:h-12",
                    hasVideo && showVideo ? "text-gray-200 hover:text-white/80" : "text-gray-500 hover:text-gray-200"
                  )}
                  title={hasVideo ? (showVideo ? "Mostrar vídeo (segure para sincronizar)" : "Mostrar vídeo (segure para sincronizar)") : "Sincronizar Vídeo"}
                >
                  <Youtube className="w-14 h-14 sm:w-12 sm:h-12 shrink-0" />
                </Button>
                <Button
                  onClick={togglePlay}
                  size="icon"
                  className="w-16 h-16 sm:w-14 sm:h-14 rounded-full bg-gray-200 text-black hover:bg-white transition-all transform active:scale-95 shadow-2xl shadow-black/60 flex items-center justify-center group"
                >
                  {isPlaying ? (
                    <Pause className="w-8 h-8 sm:w-6 sm:h-6 fill-current" />
                  ) : (
                    <Play className="w-8 h-8 sm:w-6 sm:h-6 fill-current ml-1" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsEditModeGlobal(!isEditModeGlobal)}
                  className={cn(
                    "transition-all active:scale-90 w-12 h-12 sm:w-10 sm:h-10",
                    isEditModeGlobal ? "text-gray-200 hover:text-white/80" : "text-gray-500 hover:text-gray-200"
                  )}
                  title={isEditModeGlobal ? "Sair da Edição" : "Modo Edição"}
                >
                  <Edit2 className="w-8 h-8 sm:w-6 sm:h-6 shrink-0" />
                </Button>
              </div>

              <div className="scale-110 sm:scale-100">
                <DropdownSelector
                  value={globalRepeat}
                  options={[1, 2, 3, 5, Infinity]}
                  icon={Repeat}
                  onChange={setGlobalRepeat}
                  onFormatValue={(val) => val === Infinity ? <InfinityIcon className="w-3.5 h-3.5" /> : `${val}x`}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <audio
        ref={audioRef}
        src={track.url || null}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEndedInternal}
      />
    </div>
  );
}
