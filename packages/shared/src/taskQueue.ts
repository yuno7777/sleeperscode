export type TaskPriority = "high" | "normal" | "low";

export interface QueuedTask<T> {
  id: string;
  priority: TaskPriority;
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  enqueuedAt: number;
}

export interface TaskQueueOptions {
  concurrency?: number;
  defaultPriority?: TaskPriority;
}

export interface TaskQueueStats {
  pending: number;
  running: number;
  completed: number;
  failed: number;
}

const PRIORITY_ORDER: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };

export class TaskQueue {
  private readonly queue: QueuedTask<unknown>[] = [];
  private running = 0;
  private completed = 0;
  private failed = 0;
  private readonly concurrency: number;
  private readonly defaultPriority: TaskPriority;

  constructor(options: TaskQueueOptions = {}) {
    this.concurrency = options.concurrency ?? 2;
    this.defaultPriority = options.defaultPriority ?? "normal";
  }

  public enqueue<T>(
    fn: () => Promise<T>,
    options: { priority?: TaskPriority; id?: string } = {}
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task: QueuedTask<T> = {
        id: options.id ?? crypto.randomUUID(),
        priority: options.priority ?? this.defaultPriority,
        fn,
        resolve,
        reject,
        enqueuedAt: Date.now(),
      };

      this.queue.push(task as unknown as QueuedTask<unknown>);
      this.sortQueue();
      this.tick();
    });
  }

  public cancel(id: string): boolean {
    const idx = this.queue.findIndex((t) => t.id === id);
    if (idx === -1) return false;
    const [task] = this.queue.splice(idx, 1);
    task.reject(new Error(`Task ${id} was cancelled`));
    return true;
  }

  public async drain(): Promise<void> {
    while (this.queue.length > 0 || this.running > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }

  public getStats(): TaskQueueStats {
    return {
      pending: this.queue.length,
      running: this.running,
      completed: this.completed,
      failed: this.failed,
    };
  }

  private sortQueue(): void {
    this.queue.sort((a, b) => {
      const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      return pd !== 0 ? pd : a.enqueuedAt - b.enqueuedAt;
    });
  }

  private tick(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift()!;
      this.running++;
      task
        .fn()
        .then((result) => {
          task.resolve(result);
          this.completed++;
        })
        .catch((err) => {
          task.reject(err);
          this.failed++;
        })
        .finally(() => {
          this.running--;
          this.tick();
        });
    }
  }
}
