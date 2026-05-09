import React, { useState, useRef } from 'react';
import { X, Youtube, Loader2, Upload } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';

interface VideoSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  onContinue: (url?: string, videoFile?: File) => void;
  onRemove?: () => void;
  isProcessing: boolean;
  hasExistingVideo?: boolean;
}

export function VideoSyncModal({ isOpen, onClose, onContinue, onRemove, isProcessing, hasExistingVideo }: VideoSyncModalProps) {
  const [url, setUrl] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);

  // Clear fields when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setUrl('');
      setVideoFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [isOpen]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedUrl = url.trim();
    onContinue(trimmedUrl || undefined, videoFile || undefined);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('video/')) {
        alert("Por favor, selecione um arquivo de vídeo para sincronização offline.");
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      setVideoFile(file);
    }
  };

  return (
    <AnimatePresence>
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
        onClick={onClose}
      >
        <motion.div 
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="w-full max-w-lg bg-[#161616] border border-white/10 rounded-3xl overflow-hidden shadow-2xl"
          onClick={e => e.stopPropagation()}
        >
          <div className="p-6 border-b border-white/5 flex items-center justify-between">
            <h3 className="text-lg font-bold text-gray-200">Sincronizar Vídeo</h3>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 text-gray-400">
              <X className="w-5 h-5" />
            </button>
          </div>
          
          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            <div className="p-4 rounded-xl bg-[#0d0d0d] border border-white/10 space-y-3">
              <div className="flex items-center space-x-3 text-[#827367]">
                <Youtube className="w-5 h-5 shrink-0" />
                <p className="text-xs font-bold uppercase tracking-tight">Vincular Conteúdo Visual</p>
              </div>
              <div className="space-y-2">
                <p className="text-base text-gray-300 leading-relaxed font-medium">
                  Adicione um vídeo para complementar o conteúdo da sua lição com a referência visual original.
                </p>
                <p className="text-base text-gray-400 leading-relaxed italic">
                  O vídeo local (offline) é processado apenas no seu dispositivo, sem pesar no arquivo de sincronização.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 flex items-center">
                  <Youtube className="w-3 h-3 mr-2" /> Link do Vídeo YouTube
                </label>
                <input 
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  disabled={isProcessing}
                  className="w-full bg-[#0d0d0d] border border-white/10 rounded-xl px-4 py-3 text-sm text-gray-300 focus:outline-none focus:border-white/20 disabled:opacity-50"
                />
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-white/5"></span>
                </div>
                <div className="relative flex justify-center text-[10px] uppercase font-bold tracking-widest">
                  <span className="bg-[#161616] px-4 text-gray-600">ou</span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 flex items-center">
                  <Upload className="w-3 h-3 mr-2" /> Selecionar Arquivo Local
                </label>
                <input 
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="video/*"
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    "w-full flex items-center justify-center p-4 rounded-xl border-[1.5px] border-dashed transition-all",
                    videoFile 
                      ? "bg-green-500/5 border-green-500/30 text-green-500" 
                      : "bg-[#0d0d0d] border-white/10 text-gray-400 hover:border-white/20"
                  )}
                >
                  <Upload className="w-5 h-5 mr-3" />
                  <span className="text-xs font-bold uppercase tracking-widest truncate max-w-[200px]">
                    {videoFile ? videoFile.name : "Selecionar vídeo"}
                  </span>
                </button>
              </div>
            </div>

            <div className="pt-2 space-y-3">
              <button 
                type="submit"
                disabled={isProcessing || (!url.trim() && !videoFile)}
                className="w-full p-4 rounded-xl bg-[#827367] text-white font-bold text-sm uppercase tracking-widest hover:bg-[#9a8c80] transition-all disabled:opacity-50 flex items-center justify-center"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Sincronizando...
                  </>
                ) : (
                  'Confirmar Sincronização'
                )}
              </button>

              {hasExistingVideo && (
                <button 
                  type="button"
                  onClick={() => { setUrl(""); setVideoFile(null); if(fileInputRef.current) fileInputRef.current.value = ""; onRemove && onRemove(); }}
                  disabled={isProcessing}
                  className="w-full p-4 mt-2 rounded-xl border border-red-900/20 text-red-500/60 font-bold text-[10px] uppercase tracking-widest hover:bg-red-500/5 transition-all disabled:opacity-30"
                >
                  Remover Vídeo Atual
                </button>
              )}
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
