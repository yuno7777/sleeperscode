export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  jitter?: boolean;
  retryIf?: (err: unknown) => boolean;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

export interface RetryResult<T> {
  value: T;
  attempts: number;
  totalElapsedMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  factor: number,
  jitter: boolean
): number {
  const exponential = Math.min(baseDelayMs * Math.pow(factor, attempt - 1), maxDelayMs);
  if (jitter) {
    return Math.floor(exponential * (0.5 + Math.random() * 0.5));
  }
  return Math.floor(exponential);
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  const {
    maxAttempts = 3,
    baseDelayMs = 200,
    maxDelayMs = 30_000,
    factor = 2,
    jitter = true,
    retryIf = () => true,
    onRetry,
  } = options;

  const startTime = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const value = await fn();
      return {
        value,
        attempts: attempt,
        totalElapsedMs: Date.now() - startTime,
      };
    } catch (err) {
      lastError = err;

      if (attempt === maxAttempts || !retryIf(err)) {
        break;
      }

      const delayMs = computeDelay(attempt, baseDelayMs, maxDelayMs, factor, jitter);
      onRetry?.(err, attempt, delayMs);
      await sleep(delayMs);
    }
  }

  throw lastError;
}

export async function retryUntilDefined<T>(
  fn: () => Promise<T | undefined | null>,
  options: RetryOptions = {}
): Promise<T> {
  const result = await retryWithBackoff(async () => {
    const value = await fn();
    if (value == null) {
      throw new Error("Expected defined value but received null/undefined");
    }
    return value;
  }, options);
  return result.value;
}
