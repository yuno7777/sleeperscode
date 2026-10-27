export type EventListener<T> = (data: T) => void | Promise<void>;

export class TypedEventEmitter<TEvents extends Record<string, unknown>> {
  private readonly listeners = new Map<keyof TEvents, Set<EventListener<any>>>();

  public on<K extends keyof TEvents>(event: K, listener: EventListener<TEvents[K]>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const handlers = this.listeners.get(event)!;
    handlers.add(listener);

    return () => this.off(event, listener);
  }

  public once<K extends keyof TEvents>(event: K, listener: EventListener<TEvents[K]>): () => void {
    const wrapped: EventListener<TEvents[K]> = async (data: TEvents[K]) => {
      this.off(event, wrapped);
      await listener(data);
    };
    return this.on(event, wrapped);
  }

  public off<K extends keyof TEvents>(event: K, listener: EventListener<TEvents[K]>): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(listener);
      if (handlers.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  public async emit<K extends keyof TEvents>(event: K, data: TEvents[K]): Promise<void> {
    const handlers = this.listeners.get(event);
    if (!handlers || handlers.size === 0) {
      return;
    }

    const promises: Promise<void>[] = [];
    for (const listener of Array.from(handlers)) {
      try {
        const result = listener(data);
        if (result instanceof Promise) {
          promises.push(result);
        }
      } catch (err) {
        console.error(`[TypedEventEmitter] Error in listener for event "${String(event)}":`, err);
      }
    }

    if (promises.length > 0) {
      await Promise.allSettled(promises);
    }
  }

  public listenerCount<K extends keyof TEvents>(event: K): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  public removeAllListeners<K extends keyof TEvents>(event?: K): void {
    if (event !== undefined) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}
