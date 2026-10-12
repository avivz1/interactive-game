import { createHmac, randomBytes } from 'node:crypto';
import { ClaudeCreatureAI } from './ai.js';
import { CREATURE_LIMITS } from './creature.js';
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

/** Must be identical on every function instance, or per-IP limits split across instances. */
function ipSalt(env: NodeJS.ProcessEnv): string {
  if (env.IP_HASH_SECRET) return env.IP_HASH_SECRET;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (token) return createHmac('sha256', token).update('ip-rate-limit-salt').digest('hex');
  return randomBytes(32).toString('hex'); // memory store: single process
}

export function getDeps(): Deps {
  if (!cached) {
    cached = {
      store: createStore(process.env),
      now: Date.now,
      ipSalt: ipSalt(process.env),
      ai: process.env.ANTHROPIC_API_KEY ? new ClaudeCreatureAI(process.env.ANTHROPIC_API_KEY, process.env.CREATURE_MODEL || undefined) : null,
      aiDailyCap: Number(process.env.CREATURE_DAILY_CAP) > 0 ? Number(process.env.CREATURE_DAILY_CAP) : CREATURE_LIMITS.dailyDefault,
    };
  }
  return cached;
}
