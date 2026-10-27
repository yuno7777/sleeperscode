/**
 * AsyncMutex - ensures exclusive async access to a shared resource.
 *
 * Usage:
 *   const mutex = new AsyncMutex();
 *   const release = await mutex.acquire();
 *   try { ... } finally { release(); }
 *
 *   // Or using the helper:
 *   await mutex.runExclusive(async () => { ... });
 */
export class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked = false;
  private lockCount = 0;
  private totalWaits = 0;

  public get isLocked(): boolean {
    return this.locked;
  }

  public get stats() {
    return {
      isLocked: this.locked,
      queueDepth: this.queue.length,
      totalAcquired: this.lockCount,
      totalWaits: this.totalWaits,
    };
  }

  public acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      this.lockCount++;
      return Promise.resolve(() => this.release());
    }

    this.totalWaits++;
    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        this.locked = true;
        this.lockCount++;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.locked = false;
    }
  }

  public async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  public tryAcquire(): (() => void) | null {
    if (this.locked) return null;
    this.locked = true;
    this.lockCount++;
    return () => this.release();
  }
}

/**
 * AsyncSemaphore - controls access to a pool of N concurrent slots.
 */
export class AsyncSemaphore {
  private available: number;
  private readonly queue: Array<() => void> = [];
  private totalAcquired = 0;

  constructor(private readonly permits: number) {
    this.available = permits;
  }

  public get freePermits(): number {
    return this.available;
  }

  public acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available--;
      this.totalAcquired++;
      return Promise.resolve(() => this.release());
    }

    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        this.available--;
        this.totalAcquired++;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.available++;
      next();
    } else {
      this.available++;
    }
  }

  public async runWithPermit<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  public getStats() {
    return {
      permits: this.permits,
      freePermits: this.available,
      waitingCount: this.queue.length,
      totalAcquired: this.totalAcquired,
    };
  }
}
