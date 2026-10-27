export interface BatchProcessorOptions<T> {
  maxBatchSize?: number;
  maxWaitMs?: number;
  processor: (batch: T[]) => Promise<void>;
  onError?: (err: unknown, batch: T[]) => void;
}

export class BatchProcessor<T> {
  private pending: T[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly maxBatchSize: number;
  private readonly maxWaitMs: number;
  private readonly processor: (batch: T[]) => Promise<void>;
  private readonly onError?: (err: unknown, batch: T[]) => void;
  private isFlushing = false;
  private totalProcessed = 0;

  constructor(options: BatchProcessorOptions<T>) {
    this.maxBatchSize = options.maxBatchSize ?? 50;
    this.maxWaitMs = options.maxWaitMs ?? 100;
    this.processor = options.processor;
    this.onError = options.onError;
  }

  public add(item: T): void {
    this.pending.push(item);

    if (this.pending.length >= this.maxBatchSize) {
      this.flush();
      return;
    }

    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.maxWaitMs);
    }
  }

  public addMany(items: T[]): void {
    for (const item of items) {
      this.add(item);
    }
  }

  public async flush(): Promise<void> {
    if (this.pending.length === 0 || this.isFlushing) {
      return;
    }

    this.clearTimer();
    this.isFlushing = true;
    const batch = this.pending.splice(0, this.maxBatchSize);

    try {
      await this.processor(batch);
      this.totalProcessed += batch.length;
    } catch (err) {
      if (this.onError) {
        this.onError(err, batch);
      } else {
        throw err;
      }
    } finally {
      this.isFlushing = false;
    }

    // If more items arrived during flush, reschedule
    if (this.pending.length > 0) {
      this.timer = setTimeout(() => this.flush(), this.maxWaitMs);
    }
  }

  public async drain(): Promise<void> {
    while (this.pending.length > 0) {
      await this.flush();
    }
  }

  public discard(): number {
    this.clearTimer();
    const count = this.pending.length;
    this.pending = [];
    return count;
  }

  public getStats() {
    return {
      pendingCount: this.pending.length,
      totalProcessed: this.totalProcessed,
      maxBatchSize: this.maxBatchSize,
      maxWaitMs: this.maxWaitMs,
    };
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
