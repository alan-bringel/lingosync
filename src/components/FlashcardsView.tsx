import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, ChevronLeft, ChevronRight, RotateCw, CheckCircle2, Volume2, Sparkles, Loader2, Info, ArrowLeft } from "lucide-react";
// import { Button } from "@/components/ui/button";
const Button = ({ children, className, variant, size, ...props }: any) => <button className={className} {...props}>{children}</button>;
import { Flashcard, AudioTrack } from "../types";
import { cn } from "@/lib/utils";

interface FlashcardsViewProps {
  track: AudioTrack;
  onClose: () => void;
  onUpdateTrack: (updates: Partial<AudioTrack>) => void;
  userApiKey?: string;
  onMissingKey?: () => void;
  onQuotaExceeded?: () => void;
  onFlashcardAudioError?: (message: string) => void;
  globalKnownWords?: string[];
  onToggleKnownWord?: (word: string) => void;
  hasBillingEnabled?: boolean;
  initialIndex?: number;
}

import { playPcmBase64, isQuotaError, generateExpressionAudio, ensureAudioContext } from "../services/geminiService";
import { getCachedWordAudio, setCachedWordAudio } from "../lib/wordAudioCache";

export function FlashcardsView({ 
  track, 
  onClose, 
  onUpdateTrack, 
  userApiKey,
  onMissingKey,
  onQuotaExceeded,
  onFlashcardAudioError,
  globalKnownWords = [], 
  onToggleKnownWord,
  hasBillingEnabled = false,
  initialIndex = 0
}: FlashcardsViewProps) {
  const flashcards = track.flashcards || [];
  const [currentIndex, setCurrentIndex] = useState(() => {
    const startIdx = typeof initialIndex === 'number' ? initialIndex : 0;
    if (flashcards.length === 0) return 0;
    return Math.min(Math.max(0, Math.floor(startIdx)), flashcards.length - 1);
  });
  const [direction, setDirection] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const pressTimer = useRef<NodeJS.Timeout | null>(null);
  
  const currentCard = flashcards[currentIndex];
  const isSafari = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.vendor === "Apple Computer, Inc.");

  // Persistent audio element for mobile compatibility
  const persistentAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (flashcards.length > 0) {
      const startIdx = typeof initialIndex === 'number' ? initialIndex : 0;
      setCurrentIndex(Math.min(Math.max(0, Math.floor(startIdx)), flashcards.length - 1));
    }
  }, [initialIndex, flashcards.length]);


  const variants = {
    enter: (dir: number) => ({ x: dir > 0 ? '100%' : '-100%' }),
    center: { x: 0 },
    exit: (dir: number) => ({ x: dir < 0 ? '100%' : '-100%' }),
  };

  const toggleKnown = (expression: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleKnownWord) onToggleKnownWord(expression);
  };

  const isKnown = currentCard ? globalKnownWords.includes(currentCard.expression.toLowerCase()) : false;
  const isAudioDataUri = (audio?: string) => !!audio && audio.startsWith("data:audio/");

  const playAudioElement = async (src: string) => {
    return new Promise<void>((resolve, reject) => {
      try {
        if (!persistentAudioRef.current) {
          persistentAudioRef.current = new Audio();
          persistentAudioRef.current.preload = "auto";
          persistentAudioRef.current.crossOrigin = "anonymous";
        }
        const audio = persistentAudioRef.current;
        audio.src = src;
        audio.onloadeddata = () => {
          console.log("Audio loaded successfully");
        };
        
        audio.onended = () => {
          console.log("Audio playback ended");
          resolve();
        };
        
        audio.onerror = (event) => {
          console.error("Audio element error:", event);
          reject(new Error("Audio element playback failed"));
        };
        
        audio.play().catch((err) => {
          console.error("Error calling audio.play():", err);
          reject(err);
        });
      } catch (err) {
        console.error("Error in playAudioElement:", err);
        reject(err);
      }
    });
  };

  const handlePlayAudio = async (e?: React.MouseEvent | React.TouchEvent, forceRegenerate: boolean = false) => {
    if (e) e.stopPropagation();
    if (!currentCard || isGeneratingAudio || isPlayingAudio) return;
    
    const word = currentCard.expression;
    if (isPlayingAudio && !forceRegenerate) return;

    setIsPlayingAudio(true);
    try {
      // Primary choice: Gemini TTS (with caching)
      // Initialize and resume AudioContext FIRST (inside user gesture handler for iOS)
      const ctx = ensureAudioContext();
      
      if (ctx.state === 'suspended') {
        console.log("AudioContext suspended, resuming...");
        await ctx.resume();
      }

      if (isSafari) {
        console.log("iOS/Safari detected, ensuring audio is unlocked...");
        try {
          const silentBuffer = ctx.createBuffer(1, 1, 22050);
          const source = ctx.createBufferSource();
          source.buffer = silentBuffer;
          source.connect(ctx.destination);
          source.start();
        } catch (err) {
          console.warn("Silent buffer unlock failed:", err);
        }
      }

    // Function to play base64 audio using Web Audio API directly
    const playWithWebAudio = async (base64Data: string): Promise<boolean> => {
      try {
        const binaryString = atob(base64Data);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        
        console.log("Audio bytes first 20:", bytes.subarray(0, 20));
        
        // Decode audio data using Web Audio API
        const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
        console.log("Audio decoded successfully:", audioBuffer);
        
        // Check if audio is empty (duration 0 or all zeros)
        if (audioBuffer.duration === 0 || bytes.every(b => b === 0)) {
          throw new Error("Audio buffer is empty or invalid");
        }
        
        return new Promise<boolean>((resolve) => {
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ctx.destination);
          
          // Safety timeout: resolve if onended isn't called within 10s
          const timeout = setTimeout(() => {
            console.warn("Web Audio playback timeout reached");
            resolve(true);
          }, 10000);

          source.onended = () => {
            clearTimeout(timeout);
            resolve(true);
          };
          source.start();
          console.log("Web Audio API playback started");
        });
      } catch (err) {
        console.warn("Web Audio API decode failed:", err);
        return false;
      }
    };

    // Play already-generated flashcard audio directly if available.
    if (!forceRegenerate) {
      if (currentCard.audioBase64) {
        // Check if audio is silent (mostly zeros in base64)
        // We check if a significant portion of the start is silent (20000 chars is ~300ms)
        const isLikelySilent = currentCard.audioBase64.length > 20000 && /^A+$/.test(currentCard.audioBase64.substring(0, 20000));
        
        if (!isLikelySilent) {
          // Try Web Audio API first (most reliable)
          const playedWithWebAudio = await playWithWebAudio(currentCard.audioBase64);
          if (playedWithWebAudio) return;
          
          // If Web Audio API didn't work, try playPcmBase64
          try {
            console.log("Trying playPcmBase64");
            await playPcmBase64(currentCard.audioBase64);
            console.log("playPcmBase64 succeeded");
            return;
          } catch (err2) {
            console.warn("playPcmBase64 failed, will attempt re-generation:", err2);
            // Fall through to generation logic below
          }
        } else {
          console.log("Existing audioBase64 is likely silent, will regenerate.");
        }
      }

      if (currentCard.audioUrl) {
        console.log("Found audioUrl, trying to play");
        try {
          await playAudioElement(currentCard.audioUrl);
          console.log("audioUrl playback succeeded");
          return;
        } catch (err) {
          console.warn("audioUrl playback failed, will regenerate audio:", err);
        }
      }
    }

    // Check global cache next
    if (!forceRegenerate) {
      const cached = await getCachedWordAudio(word);
      if (cached) {
        console.log("Found cached audio, length:", cached.length);
        console.log("First 100 chars of cached audio:", cached.substring(0, 100));
        
        // Save to current flashcard for future offline exports
        const newFlashcards = [...flashcards];
        newFlashcards[currentIndex] = { ...currentCard, audioBase64: cached };
        onUpdateTrack({ flashcards: newFlashcards });
        
        // Try Web Audio API first
        const playedWithWebAudio = await playWithWebAudio(cached);
        if (playedWithWebAudio) return;
        
        // If Web Audio API didn't work, try playPcmBase64
        try {
          console.log("Trying cached audio with playPcmBase64");
          await playPcmBase64(cached);
          console.log("Cached playPcmBase64 succeeded");
          return;
        } catch (err2) {
          console.warn("Cached playPcmBase64 also failed:", err2);
          return;
        }
      }
    }

    console.log("No existing audio found, generating new audio");
    const persistedGeminiApiKey = typeof window !== "undefined" ? (localStorage.getItem("gemini_api_key") || "") : "";
    const effectiveGeminiApiKey = (userApiKey || persistedGeminiApiKey).trim();

    if (!effectiveGeminiApiKey) {
      onMissingKey?.();
      return;
    }

    setIsGeneratingAudio(true);
    console.log("Calling generateExpressionAudio for word:", word);
    // Using 'Aoede' for a suave/soft voice as requested
    const base64Audio = await generateExpressionAudio(word, effectiveGeminiApiKey, 'Aoede', hasBillingEnabled);
    console.log("Audio generated successfully, length:", base64Audio.length);
    console.log("First 100 chars of generated audio:", base64Audio.substring(0, 100));
    
    // Save globally
    await setCachedWordAudio(word, base64Audio);
    
    // Save to flashcard
    const newFlashcards = [...flashcards];
    newFlashcards[currentIndex] = { ...currentCard, audioBase64: base64Audio };
    onUpdateTrack({ flashcards: newFlashcards });
    
    // Try Web Audio API first
    const playedWithWebAudio = await playWithWebAudio(base64Audio);
    if (playedWithWebAudio) return;
    
    // If Web Audio API didn't work, try playPcmBase64
    try {
      console.log("Trying generated audio with playPcmBase64");
      await playPcmBase64(base64Audio);
      console.log("Generated playPcmBase64 succeeded");
      return;
    } catch (err2) {
      console.warn("Generated playPcmBase64 also failed:", err2);
    }
  } catch (err: any) {
    console.error("Audio generation/playback failed:", err);
    
    if (isQuotaError(err)) {
      onQuotaExceeded?.();
    } else {
      onFlashcardAudioError?.("Não foi possível gerar o áudio. Tente outra vez, se persistir, tente mais tarde.");
    }
  } finally {
    setIsPlayingAudio(false);
    setIsGeneratingAudio(false);
  }
};

  // Long press handling
  const handleTouchStart = (e: React.TouchEvent | React.MouseEvent) => {
    e.stopPropagation();
    pressTimer.current = setTimeout(() => {
      handlePlayAudio(undefined, true); // force regenerate
      pressTimer.current = null;
    }, 1000); // 1 second hold to regenerate
  };

  const handleTouchEnd = (e: React.TouchEvent | React.MouseEvent) => {
    e.stopPropagation();
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
      // It was a short click, play normally
      handlePlayAudio();
    }
  };

  const nextCard = () => {
    setIsFlipped(false);
    setDirection(1);
    const nextIdx = (currentIndex + 1) % flashcards.length;
    setCurrentIndex(nextIdx);
  };

  const prevCard = () => {
    setIsFlipped(false);
    setDirection(-1);
    const prevIdx = (currentIndex - 1 + flashcards.length) % flashcards.length;
    setCurrentIndex(prevIdx);
  };

  if (flashcards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center space-y-4 h-full bg-[#161616] rounded-3xl border border-white/10">
        <div className="w-16 h-16 rounded-2xl bg-white/[0.02] flex items-center justify-center border border-white/10">
          <Info className="w-8 h-8 text-gray-600" />
        </div>
        <p className="text-gray-400 text-sm">Não há flashcards gerados para esta lição ainda.</p>
        <Button onClick={onClose} variant="ghost" className="text-[10px] font-bold uppercase tracking-widest text-[#827367]">
          Voltar
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-transparent overflow-hidden relative">
      <div className="pb-4 flex items-center justify-between">
        <Button 
          variant="ghost" 
          onClick={onClose}
          className="text-gray-600 hover:text-gray-300 text-xs uppercase tracking-widest font-bold flex items-center justify-start w-fit px-2"
        >
          <ArrowLeft className="w-5 h-5 mr-3 shrink-0" />
          Voltar à Lição
        </Button>
        <div className="flex items-center space-x-4 pr-4">
          {flashcards.length > 0 && !isNaN(currentIndex) && (
            <span className="text-[10px] font-mono text-gray-500">
              {currentIndex + 1} / {flashcards.length}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-2 sm:p-12 min-h-0 perspective-1000 relative">
        <div className="w-full max-w-sm h-full max-h-[480px] min-h-[360px] relative">
          <AnimatePresence initial={false} custom={direction}>
            <motion.div
              key={currentIndex}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{
                x: { type: "tween", duration: 0.15, ease: "easeOut" }
              }}
              onPanEnd={(e, info) => {
                const swipeThreshold = 40;
                if (info.offset.x < -swipeThreshold) {
                  nextCard();
                } else if (info.offset.x > swipeThreshold) {
                  prevCard();
                }
              }}
              className="absolute inset-0 w-full h-full touch-pan-y"
            >
              <motion.div
                animate={{ rotateY: isFlipped ? 180 : 0 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
                className="w-full h-full relative preserve-3d cursor-pointer"
                onClick={() => setIsFlipped(!isFlipped)}
              >
              {/* Front */}
              <div className={cn(
                "absolute inset-0 backface-hidden bg-[#161616] rounded-[2.5rem] border-[1.5px] p-8 flex flex-col items-center justify-center text-center space-y-8 transition-colors duration-500 shadow-2xl",
                isKnown ? "border-[#827367]/40" : "border-white/10"
              )}>
                <div className="absolute top-4 left-4 sm:top-6 sm:left-6 flex items-center space-x-2">
                  <Button 
                    variant="ghost" 
                    className={cn(
                      "flex items-center justify-center rounded-full h-10 px-4 transition-colors",
                      isKnown ? "text-[#a39487] bg-[#827367]/20 hover:bg-[#827367]/30" : "text-gray-500 bg-white/5 hover:text-gray-300 hover:bg-white/10"
                    )}
                    onClick={(e: React.MouseEvent) => toggleKnown(currentCard.expression, e)}
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2 border-none shrink-0" />
                    <span className="text-[10px] font-bold uppercase tracking-widest mt-0.5">
                      {isKnown ? "Já conheço" : "Aprendendo"}
                    </span>
                  </Button>
                </div>

                <h2 className={cn(
                  "text-3xl font-bold leading-tight",
                  isKnown ? "text-[#827367]" : "text-gray-100 border-b-[1.5px] border-dotted border-[#827367] pb-1"
                )}>
                  {currentCard?.expression || "Carregando..."}
                </h2>
                <div className="text-[10px] font-bold uppercase tracking-widest text-gray-700 flex items-center">
                  <RotateCw className="w-3 h-3 mr-2" /> Toque para virar
                </div>

                {/* Speaker icon — bottom-right */}
                <div className="absolute bottom-6 right-6">
                  <Button 
                    size="icon" 
                    variant="ghost" 
                    className="rounded-full w-10 h-10 text-gray-600 hover:text-[#827367] active:scale-90 transition-all"
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    onMouseDown={handleTouchStart}
                    onMouseUp={handleTouchEnd}
                    onMouseLeave={handleTouchEnd}
                    onTouchStart={handleTouchStart}
                    onTouchEnd={handleTouchEnd}
                    disabled={isGeneratingAudio}
                  >
                    {isGeneratingAudio ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Volume2 className="w-5 h-5" />
                    )}
                  </Button>
                </div>
              </div>

              {/* Back */}
              <div className="absolute inset-0 [transform:rotateY(180deg)] backface-hidden bg-[#1a1a1a] rounded-[2.5rem] border-[1.5px] border-[#827367]/30 p-8 flex flex-col items-center justify-center text-center space-y-6 shadow-2xl">
                <div className="space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#827367]">Tradução</span>
                  <p className="text-2xl font-bold text-gray-200">{currentCard?.translation || "..."}</p>
                </div>
                <div className="w-12 h-[1px] bg-white/5" />
                <div className="space-y-2 overflow-y-auto max-h-40 px-2 scrollbar-hide">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-600">Explicação</span>
                  <p className="text-sm text-gray-400 italic leading-relaxed">{currentCard?.explanation || "Sem explicação disponível."}</p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>
        </div>
      </div>

      <div className="p-4 sm:p-8 pb-6 sm:pb-8 flex items-center justify-center space-x-6 shrink-0 z-10 bg-[#0d0d0d]">
        <Button variant="ghost" size="icon" onClick={prevCard} className="w-12 h-12 rounded-full border border-white/10 text-gray-400 flex items-center justify-center">
          <ChevronLeft className="w-6 h-6 shrink-0" />
        </Button>
        <div className="w-24 h-1 bg-white/5 rounded-full overflow-hidden">
          <motion.div 
            className="h-full bg-[#827367]"
            initial={{ width: 0 }}
            animate={{ width: `${((currentIndex + 1) / flashcards.length) * 100}%` }}
          />
        </div>
        <Button variant="ghost" size="icon" onClick={nextCard} className="w-12 h-12 rounded-full border border-white/10 text-gray-400 flex items-center justify-center">
          <ChevronRight className="w-6 h-6 shrink-0" />
        </Button>
      </div>
    </div>
  );
}
