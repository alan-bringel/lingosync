import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Zap, Clock, Calendar } from 'lucide-react';

interface RateLimitModalProps {
  isVisible: boolean;
  secondsRemaining: number;
  model: string;
  isDailyLimit?: boolean;
}

export function RateLimitModal({ isVisible, secondsRemaining, model, isDailyLimit = false }: RateLimitModalProps) {
  const [displaySeconds, setDisplaySeconds] = useState(secondsRemaining);

  useEffect(() => {
    setDisplaySeconds(secondsRemaining);
  }, [secondsRemaining]);

  const getModelDisplay = (modelName: string): string => {
    if (modelName.includes('tts')) {
      return 'Narração de Áudio';
    } else if (modelName.includes('flash')) {
      return 'Processamento de Texto';
    }
    return 'Processamento';
  };

  const formatTime = (totalSeconds: number): string => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          {/* Backdrop com blur */}
          <motion.div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm pointer-events-auto"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />

          {/* Modal Card */}
          <motion.div
            className="relative pointer-events-auto bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8 max-w-md mx-auto"
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ duration: 0.3, type: 'spring', stiffness: 300, damping: 30 }}
          >
            {/* Header com ícone */}
            <div className="flex items-center gap-3 mb-4">
              <div className={`p-3 ${isDailyLimit ? 'bg-amber-100 dark:bg-amber-900' : 'bg-blue-100 dark:bg-blue-900'} rounded-lg`}>
                {isDailyLimit ? (
                  <Calendar className={`w-6 h-6 ${isDailyLimit ? 'text-amber-600 dark:text-amber-300' : 'text-blue-600 dark:text-blue-300'}`} />
                ) : (
                  <Clock className={`w-6 h-6 ${isDailyLimit ? 'text-amber-600 dark:text-amber-300' : 'text-blue-600 dark:text-blue-300'}`} />
                )}
              </div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                {isDailyLimit ? 'Limite diário atingido' : 'Um momento, por favor'}
              </h2>
            </div>

            {/* Mensagem descritiva */}
            <p className="text-gray-700 dark:text-gray-300 mb-6 leading-relaxed">
              O sistema está processando{' '}
              <span className={`font-semibold ${isDailyLimit ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'}`}>
                {getModelDisplay(model)}
              </span>{' '}
              {isDailyLimit 
                ? 'e atingiu o limite diário gratuito de 1.500 requisições. Isso é para garantir que todos tenham acesso ao serviço de forma justa.'
                : 'e atingiu o limite de velocidade por minuto. Isso garante qualidade e estabilidade.'}
            </p>

            {/* Contador de tempo */}
            <div className="mb-6">
              <div className="flex items-center justify-center mb-2">
                <motion.div
                  key={displaySeconds}
                  className={`text-5xl font-bold ${isDailyLimit ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'}`}
                  initial={{ scale: 1.2, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  {formatTime(Math.max(0, displaySeconds))}
                </motion.div>
              </div>
              
              {/* Barra de progresso */}
              {!isDailyLimit && (
                <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full"
                    initial={{ width: '100%' }}
                    animate={{ width: '0%' }}
                    transition={{
                      duration: Math.max(1, displaySeconds),
                      ease: 'linear',
                    }}
                  />
                </div>
              )}
            </div>

            {/* Mensagem informativa */}
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center flex items-center justify-center gap-2">
              <Zap className="w-4 h-4" />
              {isDailyLimit 
                ? 'Aguarde o reset do limite (meia-noite horário do Pacífico) ou use uma conta diferente'
                : 'Sua requisição será processada automaticamente em breve'}
            </p>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
