import { useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Loader2, Play, Headphones } from "lucide-react";
import { requestTtsAudio } from "../services/geminiService";

interface GerarLicaoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAudioSelected: () => void;
  onTextSubmit: (data: { title: string; text: string; voice: string }) => void;
}

const VOICES = [
  { id: "en-US-Neural2-F", label: "F1" },
  { id: "en-US-Neural2-J", label: "F2" },
  { id: "en-US-Neural2-D", label: "M1" },
  { id: "en-US-Neural2-A", label: "M2" },
];

const PREVIEW_PHRASE = "Hi there! This is my voice. How do you like it?";
const PREVIEW_CACHE_KEY = "lingosync_voice_preview_";

export function GerarLicaoModal({ isOpen, onClose, onAudioSelected, onTextSubmit }: GerarLicaoModalProps) {
  const [step, setStep] = useState<"choose" | "text">("choose");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [selectedVoice, setSelectedVoice] = useState("");
  const [isPreviewLoading, setIsPreviewLoading] = useState<string | null>(null);
  const [previewAudios, setPreviewAudios] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const persistentAudioRef = useRef<HTMLAudioElement>(null);

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const isOverLimit = wordCount > 120;
  const canGenerate = title.trim() && text.trim() && selectedVoice && !isOverLimit;

  const handleClose = () => {
    setStep("choose");
    setTitle("");
    setText("");
    setSelectedVoice("");
    setPreviewAudios({});
    setIsPreviewLoading(null);
    onClose();
  };

  const handleAudioChoice = () => {
    onAudioSelected();
    handleClose();
  };

  const handlePreviewVoice = async (voiceId: string) => {
    // Check localStorage cache first
    const cached = localStorage.getItem(PREVIEW_CACHE_KEY + voiceId);
    if (cached) {
      setPreviewAudios(prev => ({ ...prev, [voiceId]: cached }));
      playAudio(cached);
      return;
    }

    setIsPreviewLoading(voiceId);
    try {
      const base64Audio = await requestTtsAudio(PREVIEW_PHRASE, voiceId);
      localStorage.setItem(PREVIEW_CACHE_KEY + voiceId, base64Audio);
      setPreviewAudios(prev => ({ ...prev, [voiceId]: base64Audio }));
      playAudio(base64Audio);
    } catch (err) {
      console.error("Preview generation failed:", err);
    } finally {
      setIsPreviewLoading(null);
    }
  };

  const playAudio = (base64: string) => {
    const el = persistentAudioRef.current;
    if (el) {
      el.pause();
      el.src = `data:audio/mp3;base64,${base64}`;
      el.play().catch(console.error);
    } else {
      const audio = new Audio(`data:audio/mp3;base64,${base64}`);
      audio.play().catch(console.error);
    }
  };

  const handleGenerate = () => {
    if (!canGenerate) return;
    setIsSubmitting(true);
    onTextSubmit({ title: title.trim(), text: text.trim(), voice: selectedVoice });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            className="w-full max-w-md bg-[#161616] border border-[#827367]/30 rounded-3xl overflow-hidden shadow-2xl relative"
            onClick={e => e.stopPropagation()}
          >
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#827367]/50 to-transparent" />

            <audio ref={persistentAudioRef} className="hidden" />

            {step === "choose" ? (
              <div className="p-8 text-center space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold text-gray-200">Nova Lição</h3>
                  <button onClick={handleClose} className="text-gray-500 hover:text-gray-300 transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <p className="text-base text-gray-400">Escolha como deseja criar sua lição</p>

                <div className="space-y-4">
                  <button
                    onClick={handleAudioChoice}
                    className="w-full p-6 rounded-2xl bg-[#0d0d0d] border border-white/10 hover:border-[#827367]/50 transition-all text-left group"
                  >
                    <div className="flex items-center space-x-4">
                      <div className="w-12 h-12 bg-[#827367]/10 rounded-xl flex items-center justify-center border border-[#827367]/20 group-hover:bg-[#827367]/20 transition-colors">
                        <Headphones className="w-6 h-6 text-[#827367]" />
                      </div>
                      <div>
                        <p className="text-lg font-bold text-gray-200">Áudio</p>
                        <p className="text-sm text-gray-500">Transcreva um áudio ou vídeo do seu dispositivo</p>
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => setStep("text")}
                    className="w-full p-6 rounded-2xl bg-[#0d0d0d] border border-white/10 hover:border-[#827367]/50 transition-all text-left group"
                  >
                    <div className="flex items-center space-x-4">
                      <div className="w-12 h-12 bg-[#827367]/10 rounded-xl flex items-center justify-center border border-[#827367]/20 group-hover:bg-[#827367]/20 transition-colors">
                        <svg className="w-6 h-6 text-[#827367]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-gray-200">Texto</p>
                        <p className="text-sm text-gray-500">Digite ou cole um texto de até 120 palavras</p>
                      </div>
                    </div>
                  </button>
                </div>

                <button
                  onClick={handleClose}
                  className="text-base font-bold uppercase tracking-widest text-gray-500 hover:text-gray-300 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <div className="p-8 space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold text-gray-200">Nova Lição por Texto</h3>
                  <button onClick={handleClose} className="text-gray-500 hover:text-gray-300 transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-5">
                  <div className="space-y-2">
                    <label className="text-sm font-bold uppercase tracking-widest text-gray-500">Título</label>
                    <input
                      type="text"
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      placeholder="Ex: Daily Routine"
                      className="w-full bg-[#0d0d0d] border border-white/10 rounded-xl px-4 py-3 text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-[#827367]/50 transition-colors text-base"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-bold uppercase tracking-widest text-gray-500">
                      Texto ({wordCount}/120 palavras)
                    </label>
                    <textarea
                      value={text}
                      onChange={e => setText(e.target.value)}
                      placeholder="Digite ou cole o texto da lição aqui..."
                      rows={5}
                      className={`w-full bg-[#0d0d0d] border ${isOverLimit ? 'border-red-500/50' : 'border-white/10'} rounded-xl px-4 py-3 text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-[#827367]/50 transition-colors text-base resize-none`}
                    />
                    {isOverLimit && (
                      <p className="text-sm text-red-400">O texto excede o limite de 120 palavras.</p>
                    )}
                  </div>

                  <div className="space-y-3">
                    <label className="text-sm font-bold uppercase tracking-widest text-gray-500">Voz de Narração</label>
                    <div className="flex gap-3">
                      {VOICES.map(voice => (
                        <button
                          key={voice.id}
                          onClick={() => {
                            setSelectedVoice(voice.id);
                            if (!previewAudios[voice.id]) {
                              handlePreviewVoice(voice.id);
                            } else {
                              playAudio(previewAudios[voice.id]);
                            }
                          }}
                          className={`flex-1 py-3 rounded-xl border transition-all text-center ${
                            selectedVoice === voice.id
                              ? "bg-[#827367]/20 border-[#827367] text-gray-200"
                              : "bg-[#0d0d0d] border-white/10 text-gray-400 hover:border-[#827367]/50 hover:text-gray-300"
                          }`}
                        >
                          <div className="flex items-center justify-center space-x-2">
                            {isPreviewLoading === voice.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : previewAudios[voice.id] ? (
                              <Play className="w-3.5 h-3.5 fill-current" />
                            ) : (
                              <Play className="w-3.5 h-3.5" />
                            )}
                            <span className="font-bold">{voice.label}</span>
                          </div>
                        </button>
                      ))}
                    </div>

                  </div>
                </div>

                <div className="space-y-3">
                  <button
                    onClick={handleGenerate}
                    disabled={!canGenerate || isSubmitting}
                    className={`w-full py-3 rounded-xl font-bold uppercase tracking-widest transition-all ${
                      canGenerate && !isSubmitting
                        ? "bg-[#827367] hover:bg-[#9a8c80] text-gray-100 shadow-lg shadow-[#827367]/10"
                        : "bg-white/5 text-gray-600 cursor-not-allowed"
                    }`}
                  >
                    {isSubmitting ? (
                      <span className="flex items-center justify-center space-x-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Gerando...</span>
                      </span>
                    ) : (
                      "Gerar Lição"
                    )}
                  </button>

                  <button
                    onClick={() => setStep("choose")}
                    className="w-full text-base font-bold uppercase tracking-widest text-gray-500 hover:text-gray-300 transition-colors py-2"
                  >
                    Voltar
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
