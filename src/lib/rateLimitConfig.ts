/**
 * Limites de RPM (Requisições por Minuto) e RPD (Requisições por Dia) para cada modelo Gemini
 * Conforme regras oficiais do Google AI Studio (2026)
 */

export interface ModelRateLimit {
  model: string;
  maxRequestsPerMinute: number;
  maxRequestsPerDay: number;
  description: string;
}

export const GEMINI_RATE_LIMITS: Record<string, ModelRateLimit> = {
  'gemini-flash-latest': {
    model: 'gemini-flash-latest',
    maxRequestsPerMinute: 14,
    maxRequestsPerDay: 1500,
    description: 'Gemini 3 Flash (Texto, Tradução, Transcrição)',
  },
  'gemini-3-flash': {
    model: 'gemini-3-flash',
    maxRequestsPerMinute: 14,
    maxRequestsPerDay: 1500,
    description: 'Gemini 3 Flash',
  },
  'gemini-3.1-flash-tts-preview': {
    model: 'gemini-3.1-flash-tts-preview',
    maxRequestsPerMinute: 14,
    maxRequestsPerDay: 1500,
    description: 'Gemini 3.1 Flash TTS (Text-to-Speech)',
  },
  'gemini-3.1-flash-latest': {
    model: 'gemini-3.1-flash-latest',
    maxRequestsPerMinute: 14,
    maxRequestsPerDay: 1500,
    description: 'Gemini 3.1 Flash (Última Versão)',
  },
  'gemini-3.1-pro-latest': {
    model: 'gemini-3.1-pro-latest',
    maxRequestsPerMinute: 10,
    maxRequestsPerDay: 50,
    description: 'Gemini 3.1 Pro (Não recomendado - custo elevado)',
  },
};

/**
 * Obter limite de RPM para um modelo específico
 */
export function getRateLimitForModel(model: string): number {
  const limit = GEMINI_RATE_LIMITS[model];
  if (!limit) {
    console.warn(`Modelo ${model} não encontrado na tabela de limites. Usando padrão 15 RPM.`);
    return 15;
  }
  return limit.maxRequestsPerMinute;
}

/**
 * Obter limite de RPD para um modelo específico
 */
export function getDailyLimitForModel(model: string): number {
  const limit = GEMINI_RATE_LIMITS[model];
  if (!limit) {
    console.warn(`Modelo ${model} não encontrado na tabela de limites diários. Usando padrão 1500 RPD.`);
    return 1500;
  }
  return limit.maxRequestsPerDay;
}

/**
 * Obter descrição amigável do modelo
 */
export function getModelDescription(model: string): string {
  const limit = GEMINI_RATE_LIMITS[model];
  if (!limit) {
    return model;
  }
  return limit.description;
}

/**
 * Todos os modelos com seus limites
 */
export function getAllModelsWithLimits(): ModelRateLimit[] {
  return Object.values(GEMINI_RATE_LIMITS);
}
