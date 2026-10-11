// Small key-value interface over Upstash Redis (production) or memory (dev/tests).

import { Redis } from '@upstash/redis';

export interface Store {
  readonly kind: 'memory' | 'upstash';
  get(key: string): Promise<string | null>;
  /** Returns false when `nx` is set and the key already exists. */
  set(key: string, value: string, ttlSec: number, opts?: { nx?: boolean }): Promise<boolean>;
  getdel(key: string): Promise<string | null>;
  del(keys: string[]): Promise<void>;
  /** Increments a counter, giving it ttlSec when it is created. */
  incr(key: string, ttlSec: number): Promise<number>;
}

export class MemoryStore implements Store {
  readonly kind = 'memory' as const;
  private data = new Map<string, { value: string; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  private read(key: string): string | null {
    const entry = this.data.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.data.delete(key);
      return null;
    }
    return entry.value;
  }

  private write(key: string, value: string, ttlSec: number): void {
    if (this.data.size > 10_000) this.sweep();
    this.data.set(key, { value, expiresAt: this.now() + ttlSec * 1000 });
  }

  private sweep(): void {
    const now = this.now();
    for (const [k, e] of this.data) if (e.expiresAt <= now) this.data.delete(k);
  }

  async get(key: string): Promise<string | null> {
    return this.read(key);
  }

  async set(key: string, value: string, ttlSec: number, opts?: { nx?: boolean }): Promise<boolean> {
    if (opts?.nx && this.read(key) !== null) return false;
    this.write(key, value, ttlSec);
    return true;
  }

  async getdel(key: string): Promise<string | null> {
    const v = this.read(key);
    this.data.delete(key);
    return v;
  }

  async del(keys: string[]): Promise<void> {
    for (const k of keys) this.data.delete(k);
  }

  async incr(key: string, ttlSec: number): Promise<number> {
    const cur = this.read(key);
    const next = (cur === null ? 0 : Number(cur)) + 1;
    if (cur === null) this.write(key, String(next), ttlSec);
    else this.data.get(key)!.value = String(next);
    return next;
  }
}

export class UpstashStore implements Store {
  readonly kind = 'upstash' as const;
  private redis: Redis;

  constructor(url: string, token: string) {
    this.redis = new Redis({ url, token, automaticDeserialization: false, enableTelemetry: false });
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get<string>(key);
  }

  async set(key: string, value: string, ttlSec: number, opts?: { nx?: boolean }): Promise<boolean> {
    const res = opts?.nx
      ? await this.redis.set(key, value, { ex: ttlSec, nx: true })
      : await this.redis.set(key, value, { ex: ttlSec });
    return res === 'OK';
  }

  async getdel(key: string): Promise<string | null> {
    return this.redis.getdel<string>(key);
  }

  async del(keys: string[]): Promise<void> {
    if (keys.length > 0) await this.redis.del(...keys);
  }

  async incr(key: string, ttlSec: number): Promise<number> {
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, ttlSec);
    return n;
  }
}
