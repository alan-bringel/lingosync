import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, AlertTriangle, ExternalLink, Calendar, CreditCard } from 'lucide-react';
// import { Button } from "@/components/ui/button";
const Button = ({ children, className, variant, size, ...props }: any) => <button className={className} {...props}>{children}</button>;

interface QuotaExceededModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function QuotaExceededModal({ isOpen, onClose }: QuotaExceededModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-md bg-[#161616] rounded-3xl border border-[#827367]/30 shadow-2xl overflow-hidden"
          >
            {/* Header with gradient accent matching KeyAlert */}
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#827367]/50 to-transparent" />
            
            <div className="p-8 space-y-6">
              <div className="flex items-center justify-between pt-2">
                <div className="w-12 h-12 rounded-2xl bg-[#827367]/10 flex items-center justify-center border border-[#827367]/20">
                  <AlertTriangle className="w-6 h-6 text-[#827367]" />
                </div>
                <button 
                  onClick={onClose}
                  className="p-2 rounded-full hover:bg-white/5 text-gray-500 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-gray-100 tracking-tight">Limite Gratuito Atingido</h2>
                <p className="text-gray-400 text-base leading-relaxed">
                  Você atingiu o limite de quota diária da sua chave gratuita do Gemini.
                </p>
              </div>

              <div className="space-y-4 py-2">
                <div className="flex items-start space-x-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                  <Calendar className="w-5 h-5 text-[#827367] shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-widest text-gray-300">Aguarde o Reset</h3>
                    <p className="text-base text-gray-500 mt-1">O limite gratuito é renovado diariamente (geralmente à meia-noite no fuso do Google).</p>
                  </div>
                </div>

                <div className="flex items-start space-x-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                  <CreditCard className="w-5 h-5 text-[#827367] shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-widest text-gray-300">Uso Ilimitado</h3>
                    <p className="text-base text-gray-500 mt-1">Você pode adicionar um método de pagamento no Google Cloud Console para continuar usando sem interrupções.</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col space-y-3 pt-2">
                <Button 
                  onClick={() => window.open('https://aistudio.google.com/app/apikey', '_blank')}
                  className="w-full h-14 bg-[#827367] hover:bg-[#6d6056] text-white font-bold rounded-2xl group flex items-center justify-center"
                >
                  Configurar Faturamento
                  <ExternalLink className="w-4 h-4 ml-2 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                </Button>
                
                <Button 
                  variant="ghost" 
                  onClick={onClose}
                  className="w-full text-gray-500 hover:text-gray-300 font-bold uppercase tracking-widest text-base"
                >
                  Entendi, voltarei mais tarde
                </Button>
              </div>
            </div>
            
            <div className="bg-white/5 p-4 text-center border-t border-white/5">
              <p className="text-base text-gray-600 font-medium">
                DICA: Você também pode tentar usar uma chave de outra conta Google.
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
