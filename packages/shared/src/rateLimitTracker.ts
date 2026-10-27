export interface RateLimitTrackerConfig {
  windowMs: number;
  maxUnits: number;
}

interface WindowBucket {
  timestamp: number;
  units: number;
}

export class RateLimitTracker {
  private readonly windowMs: number;
  private readonly maxUnits: number;
  private buckets: WindowBucket[] = [];

  constructor(config: RateLimitTrackerConfig) {
    if (config.windowMs <= 0 || config.maxUnits <= 0) {
      throw new Error("windowMs and maxUnits must be strictly positive");
    }
    this.windowMs = config.windowMs;
    this.maxUnits = config.maxUnits;
  }

  public prune(now: number = Date.now()): void {
    const threshold = now - this.windowMs;
    this.buckets = this.buckets.filter((bucket) => bucket.timestamp > threshold);
  }

  public getCurrentUsage(now: number = Date.now()): number {
    this.prune(now);
    return this.buckets.reduce((acc, bucket) => acc + bucket.units, 0);
  }

  public getRemaining(now: number = Date.now()): number {
    const usage = this.getCurrentUsage(now);
    return Math.max(0, this.maxUnits - usage);
  }

  public canConsume(units: number = 1, now: number = Date.now()): boolean {
    if (units <= 0) {
      return true;
    }
    const usage = this.getCurrentUsage(now);
    return usage + units <= this.maxUnits;
  }

  public tryConsume(units: number = 1, now: number = Date.now()): boolean {
    if (!this.canConsume(units, now)) {
      return false;
    }
    this.buckets.push({ timestamp: now, units });
    return true;
  }

  public record(units: number = 1, now: number = Date.now()): void {
    this.prune(now);
    this.buckets.push({ timestamp: now, units });
  }

  public reset(): void {
    this.buckets = [];
  }

  public getStats(now: number = Date.now()) {
    const current = this.getCurrentUsage(now);
    return {
      windowMs: this.windowMs,
      maxUnits: this.maxUnits,
      currentUsage: current,
      remainingUnits: Math.max(0, this.maxUnits - current),
      utilizationPercentage: (current / this.maxUnits) * 100,
    };
  }
}
