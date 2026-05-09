import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Youtube, Music, Video, Link } from "lucide-react";

interface VideoSourcePromptProps {
  isOpen: boolean;
  onClose: () => void;
  onContinue: (youtubeUrl?: string) => void;
  fileName: string;
  isVideo: boolean;
}

export function VideoSourcePrompt({ isOpen, onClose, onContinue, fileName, isVideo }: VideoSourcePromptProps) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (isOpen) {
      setUrl("");
    }
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedUrl = url.trim();
    onContinue(trimmedUrl || undefined);
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

            <form onSubmit={handleSubmit} className="p-8 space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-[#827367]/10 rounded-xl flex items-center justify-center border border-[#827367]/20">
                    {isVideo ? (
                      <Video className="w-5 h-5 text-[#827367]" />
                    ) : (
                      <Music className="w-5 h-5 text-[#827367]" />
                    )}
                  </div>
                  <h3 className="text-xl font-bold text-gray-200">
                    {isVideo ? "Vídeo" : "Áudio"} carregado
                  </h3>
                </div>
                <button type="button" onClick={() => onClose()} className="text-gray-500 hover:text-gray-300 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 rounded-2xl bg-[#0d0d0d] border border-white/10 space-y-4">
                <div className="flex items-center space-x-2 text-[#827367]">
                  <Youtube className="w-5 h-5 shrink-0" />
                  <p className="text-xs font-bold uppercase tracking-widest">Sincronização entre dispositivos</p>
                </div>

                {isVideo ? (
                  <div className="space-y-3">
                    <p className="text-sm text-gray-300 leading-relaxed">
                      Este vídeo está disponível apenas offline ou também está presente no YouTube?
                    </p>
                    <p className="text-sm text-gray-400 leading-relaxed">
                      Se ele estiver no YouTube, recomendamos que adicione o link abaixo para facilitar a sincronização desta lição em diferentes dispositivos.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-gray-300 leading-relaxed">
                      Este áudio é de algum vídeo? Se sim, ele está disponível no YouTube?
                    </p>
                    <p className="text-sm text-gray-400 leading-relaxed">
                      Se estiver, recomendamos que adicione o link do vídeo abaixo. Isso irá facilitar a sincronização desta lição em diferentes dispositivos, incluindo a fonte do vídeo.
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 flex items-center">
                  <Link className="w-3 h-3 mr-2" /> Link do YouTube <span className="text-gray-600 font-normal normal-case ml-1">(opcional)</span>
                </label>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="w-full bg-[#0d0d0d] border border-white/10 rounded-xl px-4 py-3 text-sm text-gray-300 placeholder:text-gray-600 focus:outline-none focus:border-[#827367]/50 transition-colors"
                />
              </div>

              <div className="p-4 rounded-xl bg-[#0d0d0d] border border-white/5">
                <p className="text-xs text-gray-500 leading-relaxed">
                  <span className="text-gray-400 font-medium">Você pode fazer isso mais tarde.</span> Use o botão <Youtube className="w-3 h-3 inline-block -mt-0.5 text-gray-500" /> na tela da lição para sincronizar ou alterar a fonte de vídeo quando quiser.
                </p>
              </div>

              <div className="space-y-3 pt-2">
                <button
                  type="submit"
                  className="w-full py-3 rounded-xl bg-[#827367] hover:bg-[#9a8c80] text-gray-100 font-bold uppercase tracking-widest transition-all shadow-lg shadow-[#827367]/10"
                >
                  Continuar
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
