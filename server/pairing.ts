// Pairing mailbox: the TV posts a WebRTC offer and gets a 6-digit code (plus a QR
// key); one phone claims it, reads the offer and posts an answer; the TV polls for
// the answer. After that the devices talk peer-to-peer and the record expires.

import type {
  JoinResponse,
  PairResponse,
  SessionState,
  TvPollResponse,
} from '../src/shared/api.js';
import { EMOJI } from '../src/shared/api.js';
import { randomCode, randomPair, randomToken, safeEqual, sha256 } from './crypto.js';
import { ApiError } from './errors.js';
import type { Store } from './store.js';

export const CODE_TTL_SEC = 10 * 60;
export const SESSION_TTL_SEC = 15 * 60;
export const MAX_SDP_CHARS = 24_000;

export const LIMITS = {
  pairPerIp: { max: 30, windowSec: 600 },
  joinPerIp: { max: 20, windowSec: 600 },
  /** Typed-code joins are paused for everyone if this many fail in a window (brute-force breaker). */
  joinFailuresGlobal: { max: 300, windowSec: 600 },
  pollPerSession: { max: 120, windowSec: 60 },
} as const;

interface SessionRecord {
  v: 1;
  state: SessionState;
  code: string;
  keyHash: string;
  tvTokenHash: string;
  phoneTokenHash: string | null;
  offer: string;
  answer: string | null;
  emoji: [number, number];
  createdAt: number;
}

export interface Ctx {
  store: Store;
  now: () => number;
  /** Pseudonymous client id (hashed IP). */
  client: string;
}

const keys = {
  session: (sid: string) => `s:${sid}`,
  code: (code: string) => `c:${code}`,
  key: (keyHash: string) => `k:${keyHash}`,
  claim: (sid: string) => `j:${sid}`,
  limit: (name: string, id: string, window: number) => `rl:${name}:${id}:${window}`,
};

async function rateLimit(ctx: Ctx, name: string, id: string, max: number, windowSec: number): Promise<void> {
  const window = Math.floor(ctx.now() / (windowSec * 1000));
  const n = await ctx.store.incr(keys.limit(name, id, window), windowSec);
  if (n > max) {
    const retryAfter = Math.ceil(((window + 1) * windowSec * 1000 - ctx.now()) / 1000);
    throw new ApiError(429, 'rate_limited', 'Too many requests. Please wait a moment.', Math.max(retryAfter, 1));
  }
}

function failureWindowKey(ctx: Ctx): string {
  const w = Math.floor(ctx.now() / (LIMITS.joinFailuresGlobal.windowSec * 1000));
  return keys.limit('joinfail', 'global', w);
}

export function validateSdp(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length < 10 || value.length > MAX_SDP_CHARS || !value.startsWith('v=0')) {
    throw new ApiError(400, 'bad_request', `Missing or invalid ${field}.`);
  }
  return value;
}

async function loadSession(ctx: Ctx, sid: string): Promise<SessionRecord | null> {
  const raw = await ctx.store.get(keys.session(sid));
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw) as SessionRecord;
    return rec && rec.v === 1 ? rec : null;
  } catch {
    return null;
  }
}

async function saveSession(ctx: Ctx, sid: string, rec: SessionRecord): Promise<void> {
  const ageSec = Math.floor((ctx.now() - rec.createdAt) / 1000);
  const ttl = Math.max(SESSION_TTL_SEC - ageSec, 1);
  await ctx.store.set(keys.session(sid), JSON.stringify(rec), ttl);
}

function requireToken(token: string | null, hash: string | null): void {
  if (!token || !hash || !safeEqual(sha256(token), hash)) {
    throw new ApiError(401, 'unauthorized', 'Not allowed.');
  }
}

const notFound = () => new ApiError(404, 'not_found', 'Code not found or expired. Check the code on the TV.');

export async function pair(ctx: Ctx, body: Record<string, unknown>): Promise<PairResponse> {
  const offer = validateSdp(body.offer, 'offer');
  await rateLimit(ctx, 'pair', ctx.client, LIMITS.pairPerIp.max, LIMITS.pairPerIp.windowSec);

  const sid = randomToken(12);
  const tvToken = randomToken();
  const key = randomToken();
  const keyHash = sha256(key);

  let code: string | null = null;
  for (let attempt = 0; attempt < 8 && code === null; attempt++) {
    const candidate = randomCode();
    if (await ctx.store.set(keys.code(candidate), sid, CODE_TTL_SEC, { nx: true })) code = candidate;
  }
  if (code === null) throw new ApiError(503, 'busy', 'Could not create a code. Please try again.');

  const rec: SessionRecord = {
    v: 1,
    state: 'waiting',
    code,
    keyHash,
    tvTokenHash: sha256(tvToken),
    phoneTokenHash: null,
    offer,
    answer: null,
    emoji: randomPair(EMOJI.length),
    createdAt: ctx.now(),
  };
  await ctx.store.set(keys.session(sid), JSON.stringify(rec), SESSION_TTL_SEC);
  await ctx.store.set(keys.key(keyHash), sid, CODE_TTL_SEC);

  return { sid, code, key, tvToken, emoji: rec.emoji, expiresInMs: CODE_TTL_SEC * 1000, pollMs: 1000 };
}

export async function join(ctx: Ctx, body: Record<string, unknown>): Promise<JoinResponse> {
  await rateLimit(ctx, 'join', ctx.client, LIMITS.joinPerIp.max, LIMITS.joinPerIp.windowSec);

  let sid: string | null;
  if (typeof body.key === 'string') {
    if (!/^[A-Za-z0-9_-]{22}$/.test(body.key)) throw new ApiError(400, 'bad_request', 'Invalid link.');
    sid = await ctx.store.getdel(keys.key(sha256(body.key)));
  } else if (typeof body.code === 'string') {
    const code = body.code.replace(/\D/g, '');
    if (!/^\d{6}$/.test(code)) throw new ApiError(400, 'bad_request', 'Enter the 6-digit code shown on the TV.');
    const failures = Number((await ctx.store.get(failureWindowKey(ctx))) ?? 0);
    if (failures >= LIMITS.joinFailuresGlobal.max) {
      throw new ApiError(503, 'busy', 'Typed codes are paused for a few minutes. Scan the QR code instead.');
    }
    sid = await ctx.store.getdel(keys.code(code));
  } else {
    throw new ApiError(400, 'bad_request', 'Enter the 6-digit code shown on the TV.');
  }

  if (!sid) {
    await ctx.store.incr(failureWindowKey(ctx), LIMITS.joinFailuresGlobal.windowSec);
    throw notFound();
  }
  // The code and the QR key both lead here; only the first claim wins.
  if (!(await ctx.store.set(keys.claim(sid), '1', SESSION_TTL_SEC, { nx: true }))) throw notFound();

  const rec = await loadSession(ctx, sid);
  if (!rec || rec.state !== 'waiting') throw notFound();
  await ctx.store.del([keys.code(rec.code), keys.key(rec.keyHash)]);

  const phoneToken = randomToken();
  rec.state = 'joined';
  rec.phoneTokenHash = sha256(phoneToken);
  await saveSession(ctx, sid, rec);
  return { sid, phoneToken, offer: rec.offer, emoji: rec.emoji };
}

export async function submitAnswer(ctx: Ctx, sid: string, token: string | null, body: Record<string, unknown>): Promise<void> {
  const rec = await loadSession(ctx, sid);
  if (!rec) throw new ApiError(404, 'expired', 'The TV code expired. Start again.');
  requireToken(token, rec.phoneTokenHash);
  if (rec.state !== 'joined') throw new ApiError(409, 'conflict', 'Already answered.');
  rec.answer = validateSdp(body.answer, 'answer');
  rec.state = 'answered';
  await saveSession(ctx, sid, rec);
}

export async function pollForTv(ctx: Ctx, sid: string, token: string | null): Promise<TvPollResponse> {
  const rec = await loadSession(ctx, sid);
  if (!rec) throw new ApiError(404, 'expired', 'The code expired.');
  requireToken(token, rec.tvTokenHash);
  await rateLimit(ctx, 'poll', sid, LIMITS.pollPerSession.max, LIMITS.pollPerSession.windowSec);
  if (rec.state === 'answered' && rec.answer) {
    // Signaling is finished; nothing about this session needs to be kept.
    await ctx.store.del([keys.session(sid), keys.claim(sid)]);
    return { state: 'answered', answer: rec.answer, pollMs: 0 };
  }
  const age = ctx.now() - rec.createdAt;
  return { state: rec.state, pollMs: rec.state === 'joined' || age < 60_000 ? 1000 : 2500 };
}

export async function closeSession(ctx: Ctx, sid: string, token: string | null): Promise<void> {
  const rec = await loadSession(ctx, sid);
  if (!rec) return;
  const isTv = token !== null && safeEqual(sha256(token), rec.tvTokenHash);
  const isPhone = token !== null && rec.phoneTokenHash !== null && safeEqual(sha256(token), rec.phoneTokenHash);
  if (!isTv && !isPhone) throw new ApiError(401, 'unauthorized', 'Not allowed.');
  await ctx.store.del([keys.session(sid), keys.code(rec.code), keys.key(rec.keyHash), keys.claim(sid)]);
}
