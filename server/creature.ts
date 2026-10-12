// Draw & Alive: POST /api/creature. The TV sends a small PNG of the child's
// drawing (lines only, never the camera); an AI names the creature and picks
// its colours and personality. Spend is bounded per IP and per day.

import {
  isCreatureLang,
  MAX_IMAGE_CHARS,
  PNG_DATA_PREFIX,
  sanitizeTraits,
  type CreatureLang,
  type CreatureResponse,
} from '../src/shared/creature-api.js';
import { ApiError } from './errors.js';
import { rateLimit, type Ctx } from './pairing.js';

export interface CreatureAI {
  /** Returns the model's raw JSON answer (validated by the caller). */
  describe(pngBase64: string, lang: CreatureLang): Promise<unknown>;
}

export const CREATURE_LIMITS = {
  perIp: { max: 40, windowSec: 3600 },
  /** Default number of AI calls per day for the whole site (about $0.001 each). */
  dailyDefault: 2000,
} as const;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Checks the data URL is a real, small PNG and returns its base64 part. */
export function readDrawing(image: unknown): string {
  if (typeof image !== 'string' || image.length > MAX_IMAGE_CHARS || image.indexOf(PNG_DATA_PREFIX) !== 0) {
    throw new ApiError(400, 'bad_request', 'Expected a small PNG drawing.');
  }
  const b64 = image.slice(PNG_DATA_PREFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new ApiError(400, 'bad_request', 'Expected a small PNG drawing.');
  const bytes = Buffer.from(b64, 'base64');
  const isPng = bytes.length > 24 && PNG_SIGNATURE.every((v, i) => bytes[i] === v) && bytes.toString('ascii', 12, 16) === 'IHDR';
  const width = isPng ? bytes.readUInt32BE(16) : 0;
  const height = isPng ? bytes.readUInt32BE(20) : 0;
  if (!isPng || width < 32 || height < 32 || width > 512 || height > 512) {
    throw new ApiError(400, 'bad_request', 'Expected a small PNG drawing.');
  }
  return b64;
}

function dayKey(now: number): string {
  return 'rl:ai-day:' + new Date(now).toISOString().slice(0, 10);
}

export async function makeCreature(
  ctx: Ctx,
  ai: CreatureAI | null,
  dailyCap: number,
  body: Record<string, unknown>,
): Promise<CreatureResponse> {
  if (!ai) throw new ApiError(503, 'ai_not_configured', 'The creature AI is not set up (ANTHROPIC_API_KEY).');
  const lang = body.lang;
  if (!isCreatureLang(lang)) throw new ApiError(400, 'bad_request', 'Unknown language.');
  const png = readDrawing(body.image);

  await rateLimit(ctx, 'creature', ctx.client, CREATURE_LIMITS.perIp.max, CREATURE_LIMITS.perIp.windowSec);
  const today = await ctx.store.incr(dayKey(ctx.now()), 2 * 24 * 3600);
  if (today > dailyCap) throw new ApiError(429, 'busy', 'The creature maker is resting for today.', 3600);

  let raw: unknown;
  try {
    raw = await ai.describe(png, lang);
  } catch (err) {
    const name = err instanceof Error ? err.name : typeof err;
    const msg = err instanceof Error ? err.message.slice(0, 120) : '';
    console.error('creature: AI call failed', name, msg);
    throw new ApiError(502, 'ai_failed', 'The creature maker could not answer.');
  }
  const traits = sanitizeTraits(raw);
  if (!traits) throw new ApiError(502, 'ai_failed', 'The creature maker could not answer.');
  return { traits };
}
