import { randomBytes } from 'node:crypto';
import type { Deps } from './router.js';
import { MemoryStore, UpstashStore, type Store } from './store.js';

let cached: Deps | null = null;

function createStore(env: NodeJS.ProcessEnv): Store | null {
  // Vercel's Upstash integration injects KV_REST_API_*; plain Upstash uses UPSTASH_REDIS_REST_*.
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return new UpstashStore(url, token);
  // On Vercel each request may hit a different instance, so memory is not safe there.
  if (env.VERCEL && env.ALLOW_MEMORY_STORE !== '1') return null;
  return new MemoryStore();
}

export function getDeps(): Deps {
  if (!cached) {
    cached = {
      store: createStore(process.env),
      now: Date.now,
      ipSalt: process.env.IP_HASH_SECRET || randomBytes(32).toString('hex'),
    };
  }
  return cached;
}
