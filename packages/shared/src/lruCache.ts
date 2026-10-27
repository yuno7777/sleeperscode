export interface LRUCacheOptions {
  maxSize: number;
  defaultTtlMs?: number;
}

interface CacheNode<K, V> {
  key: K;
  value: V;
  expiresAt: number | null;
}

export class LRUCache<K, V> {
  private readonly maxSize: number;
  private readonly defaultTtlMs: number | null;
  private readonly map = new Map<K, CacheNode<K, V>>();

  constructor(options: LRUCacheOptions) {
    if (options.maxSize <= 0) {
      throw new Error("LRUCache maxSize must be positive");
    }
    this.maxSize = options.maxSize;
    this.defaultTtlMs = options.defaultTtlMs ?? null;
  }

  public get size(): number {
    return this.map.size;
  }

  public set(key: K, value: V, ttlMs?: number): void {
    const effectiveTtl = ttlMs !== undefined ? ttlMs : this.defaultTtlMs;
    const expiresAt = effectiveTtl !== null ? Date.now() + effectiveTtl : null;

    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }

    this.map.set(key, { key, value, expiresAt });
  }

  public get(key: K): V | undefined {
    const node = this.map.get(key);
    if (!node) {
      return undefined;
    }

    if (node.expiresAt !== null && Date.now() > node.expiresAt) {
      this.map.delete(key);
      return undefined;
    }

    // Refresh position to mark as recently used
    this.map.delete(key);
    this.map.set(key, node);
    return node.value;
  }

  public has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  public delete(key: K): boolean {
    return this.map.delete(key);
  }

  public clear(): void {
    this.map.clear();
  }

  public pruneExpired(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [key, node] of this.map.entries()) {
      if (node.expiresAt !== null && now > node.expiresAt) {
        this.map.delete(key);
        pruned++;
      }
    }
    return pruned;
  }

  public keys(): K[] {
    return Array.from(this.map.keys());
  }

  public values(): V[] {
    const validValues: V[] = [];
    const now = Date.now();
    for (const node of this.map.values()) {
      if (node.expiresAt === null || now <= node.expiresAt) {
        validValues.push(node.value);
      }
    }
    return validValues;
  }
}
