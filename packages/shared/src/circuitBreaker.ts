export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  recoveryTimeoutMs?: number;
  halfOpenSuccessThreshold?: number;
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
}

export class CircuitBreakerError extends Error {
  constructor(message: string = "Circuit breaker is OPEN. Fast failing request.") {
    super(message);
    this.name = "CircuitBreakerError";
  }
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount: number = 0;
  private consecutiveSuccesses: number = 0;
  private nextAttemptTimestamp: number = 0;
  private readonly failureThreshold: number;
  private readonly recoveryTimeoutMs: number;
  private readonly halfOpenSuccessThreshold: number;
  private readonly onStateChange?: (from: CircuitState, to: CircuitState) => void;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.recoveryTimeoutMs = options.recoveryTimeoutMs ?? 30000;
    this.halfOpenSuccessThreshold = options.halfOpenSuccessThreshold ?? 2;
    this.onStateChange = options.onStateChange;
  }

  public getState(): CircuitState {
    if (this.state === "OPEN" && Date.now() >= this.nextAttemptTimestamp) {
      this.transitionTo("HALF_OPEN");
    }
    return this.state;
  }

  public async execute<T>(action: () => Promise<T>): Promise<T> {
    const currentState = this.getState();

    if (currentState === "OPEN") {
      throw new CircuitBreakerError();
    }

    try {
      const result = await action();
      this.handleSuccess();
      return result;
    } catch (err) {
      this.handleFailure();
      throw err;
    }
  }

  public reset(): void {
    this.failureCount = 0;
    this.consecutiveSuccesses = 0;
    this.nextAttemptTimestamp = 0;
    this.transitionTo("CLOSED");
  }

  public getStats() {
    return {
      state: this.getState(),
      failureCount: this.failureCount,
      consecutiveSuccesses: this.consecutiveSuccesses,
      nextAttemptTimestamp: this.nextAttemptTimestamp,
    };
  }

  private handleSuccess(): void {
    if (this.state === "HALF_OPEN") {
      this.consecutiveSuccesses++;
      if (this.consecutiveSuccesses >= this.halfOpenSuccessThreshold) {
        this.transitionTo("CLOSED");
        this.failureCount = 0;
        this.consecutiveSuccesses = 0;
      }
    } else if (this.state === "CLOSED") {
      this.failureCount = 0;
    }
  }

  private handleFailure(): void {
    this.failureCount++;
    if (this.state === "HALF_OPEN" || this.failureCount >= this.failureThreshold) {
      this.nextAttemptTimestamp = Date.now() + this.recoveryTimeoutMs;
      this.consecutiveSuccesses = 0;
      this.transitionTo("OPEN");
    }
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state !== newState) {
      const oldState = this.state;
      this.state = newState;
      this.onStateChange?.(oldState, newState);
    }
  }
}
