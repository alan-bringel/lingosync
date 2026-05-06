/**
 * Wrapper para aplicar Rate Limiting automaticamente em chamadas Gemini
 * 
 * Uso:
 * const result = await withRateLimit({
 *   model: 'gemini-3.1-flash-tts-preview',
 *   apiKey: userApiKey,
 * }, async () => {
 *   return await generateExpressionAudio(text, apiKey);
 * });
 */

import { waitForRateLimit, recordRequest } from './rateLimiter';
import { getRateLimitForModel, getDailyLimitForModel } from './rateLimitConfig';

export interface RateLimitWrapperConfig {
  model: string;
  apiKey: string;
  operationName?: string;
  hasBillingEnabled?: boolean;
}

/**
 * Envolver operação Gemini com rate limiting automático
 */
export async function withRateLimit<T>(
  config: RateLimitWrapperConfig,
  operation: () => Promise<T>
): Promise<T> {
  const { model, apiKey, operationName = 'Operação', hasBillingEnabled = false } = config;

  // Obter limites para este modelo
  const maxRPM = getRateLimitForModel(model);
  const maxRPD = getDailyLimitForModel(model);

  // Aguardar se necessário
  await waitForRateLimit({
    model,
    apiKey,
    maxRequestsPerMinute: maxRPM,
    maxRequestsPerDay: maxRPD,
    hasBillingEnabled,
  });

  try {
    // Executar a operação
    const result = await operation();

    // Registrar que a requisição foi bem-sucedida (apenas se não tiver faturamento ativo, para estatísticas)
    if (!hasBillingEnabled) {
      recordRequest(apiKey, model);
    }

    return result;
  } catch (error) {
    // Se falhar, NÃO registra a requisição
    // (não contar requisições falhadas na cota)
    throw error;
  }
}

/**
 * Versão simplificada: rate limiting sem try-catch adicional
 * Apenas aguarda e registra
 */
export async function applyRateLimit(
  model: string,
  apiKey: string,
  hasBillingEnabled: boolean = false
): Promise<void> {
  const maxRPM = getRateLimitForModel(model);
  const maxRPD = getDailyLimitForModel(model);

  await waitForRateLimit({
    model,
    apiKey,
    maxRequestsPerMinute: maxRPM,
    maxRequestsPerDay: maxRPD,
    hasBillingEnabled,
  });

  // Registrar apenas se não tiver faturamento ativo
  if (!hasBillingEnabled) {
    recordRequest(apiKey, model);
  }
}
