/**
 * Rate Limiter: Controla requisições por minuto (RPM) e por dia (RPD) por modelo e chave API
 * Implementa fila automática e callbacks para modal UX
 */

export interface RateLimitConfig {
  model: string;
  apiKey: string;
  maxRequestsPerMinute: number;
  maxRequestsPerDay: number;
  hasBillingEnabled?: boolean;
}

interface RequestTimestamp {
  timestamp: number;
}

interface RateLimiterState {
  minuteTimestamps: RequestTimestamp[];
  dayTimestamps: RequestTimestamp[];
  isWaiting: boolean;
  waitUntil: number | null;
  secondsRemaining: number;
}

// Dicionário global: `${apiKey}:${model}` -> RateLimiterState
const rateLimiters = new Map<string, RateLimiterState>();

// Callbacks para comunicar com a UI
let onRateLimitCallback: ((data: {
  isWaiting: boolean;
  secondsRemaining: number;
  model: string;
  isDailyLimit?: boolean;
}) => void) | null = null;

/**
 * Registra callback para quando rate limit é ativado/desativado
 */
export function setRateLimitCallback(
  callback: (data: {
    isWaiting: boolean;
    secondsRemaining: number;
    model: string;
    isDailyLimit?: boolean;
  }) => void
) {
  onRateLimitCallback = callback;
}

/**
 * Obter state atual do rate limiter
 */
function getState(key: string): RateLimiterState {
  if (!rateLimiters.has(key)) {
    rateLimiters.set(key, {
      minuteTimestamps: [],
      dayTimestamps: [],
      isWaiting: false,
      waitUntil: null,
      secondsRemaining: 0,
    });
  }
  return rateLimiters.get(key)!;
}

/**
 * Limpar timestamps antigos (fora da janela de 1 minuto)
 */
function cleanOldMinuteTimestamps(state: RateLimiterState): void {
  const now = Date.now();
  const oneMinuteAgo = now - 60000;
  state.minuteTimestamps = state.minuteTimestamps.filter(
    (req) => req.timestamp > oneMinuteAgo
  );
}

/**
 * Limpar timestamps antigos (fora da janela de 1 dia)
 */
function cleanOldDayTimestamps(state: RateLimiterState): void {
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  state.dayTimestamps = state.dayTimestamps.filter(
    (req) => req.timestamp > oneDayAgo
  );
}

/**
 * Verificar se pode fazer requisição agora (limite por minuto)
 */
function canMakeMinuteRequest(state: RateLimiterState, maxRPM: number): boolean {
  cleanOldMinuteTimestamps(state);
  return state.minuteTimestamps.length < maxRPM;
}

/**
 * Verificar se pode fazer requisição agora (limite por dia)
 */
function canMakeDailyRequest(state: RateLimiterState, maxRPD: number): boolean {
  cleanOldDayTimestamps(state);
  return state.dayTimestamps.length < maxRPD;
}

/**
 * Calcular tempo de espera até poder fazer próxima requisição (limite por minuto)
 */
function calculateMinuteWaitTime(state: RateLimiterState): number {
  if (state.minuteTimestamps.length === 0) return 0;

  const now = Date.now();
  const oldestRequest = state.minuteTimestamps[0];
  const waitUntil = oldestRequest.timestamp + 60000;

  if (waitUntil > now) {
    return Math.ceil((waitUntil - now) / 1000);
  }
  return 0;
}

/**
 * Calcular tempo de espera até poder fazer próxima requisição (limite por dia)
 */
function calculateDailyWaitTime(state: RateLimiterState): number {
  if (state.dayTimestamps.length === 0) return 0;

  const now = Date.now();
  const oldestRequest = state.dayTimestamps[0];
  const waitUntil = oldestRequest.timestamp + 24 * 60 * 60 * 1000;

  if (waitUntil > now) {
    return Math.ceil((waitUntil - now) / 1000);
  }
  return 0;
}

/**
 * Aguardar até que o rate limit seja liberado
 * Retorna Promise que resolve quando pode fazer requisição
 */
export async function waitForRateLimit(config: RateLimitConfig): Promise<void> {
  // Se o usuário tem faturamento ativo, não aplicar limites gratuitos
  if (config.hasBillingEnabled) {
    return;
  }

  const key = `${config.apiKey}:${config.model}`;
  const state = getState(key);

  cleanOldMinuteTimestamps(state);
  cleanOldDayTimestamps(state);

  // Verificar limite diário primeiro (mais restritivo)
  if (!canMakeDailyRequest(state, config.maxRequestsPerDay)) {
    state.isWaiting = true;
    const waitSeconds = calculateDailyWaitTime(state);
    state.secondsRemaining = waitSeconds;

    if (onRateLimitCallback) {
      onRateLimitCallback({
        isWaiting: true,
        secondsRemaining: waitSeconds,
        model: config.model,
        isDailyLimit: true,
      });
    }

    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        cleanOldDayTimestamps(state);
        const waitSecs = calculateDailyWaitTime(state);
        state.secondsRemaining = waitSecs;

        if (onRateLimitCallback) {
          onRateLimitCallback({
            isWaiting: waitSecs > 0,
            secondsRemaining: waitSecs,
            model: config.model,
            isDailyLimit: true,
          });
        }

        if (canMakeDailyRequest(state, config.maxRequestsPerDay)) {
          clearInterval(checkInterval);
          state.isWaiting = false;
          state.waitUntil = null;

          if (onRateLimitCallback) {
            onRateLimitCallback({
              isWaiting: false,
              secondsRemaining: 0,
              model: config.model,
              isDailyLimit: false,
            });
          }

          resolve();
        }
      }, 1000);
    });
  }

  // Verificar limite por minuto
  if (canMakeMinuteRequest(state, config.maxRequestsPerMinute)) {
    return;
  }

  // Não pode fazer agora, precisa esperar (limite por minuto)
  state.isWaiting = true;

  return new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      cleanOldMinuteTimestamps(state);
      const waitSeconds = calculateMinuteWaitTime(state);
      state.secondsRemaining = waitSeconds;

      // Notifica UI do tempo restante
      if (onRateLimitCallback) {
        onRateLimitCallback({
          isWaiting: waitSeconds > 0,
          secondsRemaining: waitSeconds,
          model: config.model,
          isDailyLimit: false,
        });
      }

      // Se passou o tempo mínimo e pode fazer requisição, libera
      if (canMakeMinuteRequest(state, config.maxRequestsPerMinute)) {
        clearInterval(checkInterval);
        state.isWaiting = false;
        state.waitUntil = null;

        // Último callback informando que foi liberado
        if (onRateLimitCallback) {
          onRateLimitCallback({
            isWaiting: false,
            secondsRemaining: 0,
            model: config.model,
            isDailyLimit: false,
          });
        }

        resolve();
      }
    }, 500); // Atualiza a cada 500ms para UI responsiva
  });
}

/**
 * Registrar que uma requisição foi feita
 * Deve ser chamado APÓS a requisição ser feita com sucesso
 */
export function recordRequest(apiKey: string, model: string): void {
  const key = `${apiKey}:${model}`;
  const state = getState(key);
  const now = Date.now();
  state.minuteTimestamps.push({ timestamp: now });
  state.dayTimestamps.push({ timestamp: now });
  cleanOldMinuteTimestamps(state);
  cleanOldDayTimestamps(state);
}

/**
 * Obter info sobre requisições restantes neste minuto e dia
 */
export function getQuotaInfo(
  apiKey: string,
  model: string,
  maxRPM: number,
  maxRPD: number
): {
  usedMinute: number;
  remainingMinute: number;
  maxRPM: number;
  usedDay: number;
  remainingDay: number;
  maxRPD: number;
} {
  const key = `${apiKey}:${model}`;
  const state = getState(key);
  cleanOldMinuteTimestamps(state);
  cleanOldDayTimestamps(state);

  const usedMinute = state.minuteTimestamps.length;
  const remainingMinute = Math.max(0, maxRPM - usedMinute);
  const usedDay = state.dayTimestamps.length;
  const remainingDay = Math.max(0, maxRPD - usedDay);

  return { usedMinute, remainingMinute, maxRPM, usedDay, remainingDay, maxRPD };
}

/**
 * Resetar rate limiter (útil para testes ou limpeza)
 */
export function resetRateLimiter(apiKey?: string, model?: string): void {
  if (apiKey && model) {
    const key = `${apiKey}:${model}`;
    rateLimiters.delete(key);
  } else {
    rateLimiters.clear();
  }
}

/**
 * Obter estado de todos os rate limiters (debug)
 */
export function getAllRateLimitStates(): Record<string, RateLimiterState> {
  const result: Record<string, RateLimiterState> = {};
  rateLimiters.forEach((state, key) => {
    cleanOldMinuteTimestamps(state);
    cleanOldDayTimestamps(state);
    result[key] = { ...state };
  });
  return result;
}
