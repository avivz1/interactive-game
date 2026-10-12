import { beforeEach, describe, expect, it } from 'vitest';
import { CREATURE_LIMITS, readDrawing, type CreatureAI } from '../../server/creature';
import { dailyCap } from '../../server/env';
import { handle, type Deps } from '../../server/router';
import { MemoryStore } from '../../server/store';
import { PNG_DATA_PREFIX, type CreatureLang } from '../../src/shared/creature-api';

/** A PNG header (signature + IHDR) is all the server checks before the AI sees it. */
function png(width: number, height: number): string {
  const b = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return PNG_DATA_PREFIX + b.toString('base64');
}

class FakeAI implements CreatureAI {
  calls: Array<{ png: string; lang: CreatureLang }> = [];
  answer: unknown = { looks_like: 'fish', name: 'Bubbles', greeting: 'Hello!', personality: 'silly', move: 'swim', body_color: '#7ee0ff', accent_color: '#ffd23f', face_x: 0.7, face_y: 0.4 };
  fail = false;
  async describe(pngBase64: string, lang: CreatureLang): Promise<unknown> {
    this.calls.push({ png: pngBase64, lang });
    if (this.fail) throw new Error('boom');
    return this.answer;
  }
}

let clock = 1_000_000;
let ai: FakeAI;
let deps: Deps;

beforeEach(() => {
  clock = Date.UTC(2026, 9, 12, 10);
  ai = new FakeAI();
  deps = { store: new MemoryStore(() => clock), now: () => clock, ipSalt: 'test', ai, aiDailyCap: 5 };
});

async function create(body: unknown, ip = '10.0.0.1', contentType = 'application/json') {
  const res = await handle(
    new Request('http://test/api/creature', { method: 'POST', headers: { 'content-type': contentType, 'x-forwarded-for': ip }, body: JSON.stringify(body) }),
    deps,
  );
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

describe('POST /api/creature', () => {
  it('returns cleaned traits from the AI', async () => {
    const res = await create({ lang: 'he', image: png(256, 256) });
    expect(res.status).toBe(200);
    expect(res.json.traits).toMatchObject({ name: 'Bubbles', move: 'swim', personality: 'silly', face: { x: 0.7, y: 0.4 } });
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0].lang).toBe('he');
    expect(ai.calls[0].png).not.toContain('data:');
  });

  it('says when the AI is not set up', async () => {
    deps = { ...deps, ai: null };
    const res = await create({ lang: 'en', image: png(256, 256) });
    expect(res.status).toBe(503);
    expect(res.json.error).toBe('ai_not_configured');
  });

  it('accepts only small PNG drawings and known languages', async () => {
    expect((await create({ lang: 'fr', image: png(256, 256) })).status).toBe(400);
    expect((await create({ lang: 'en', image: 'data:image/jpeg;base64,AAAA' })).status).toBe(400);
    expect((await create({ lang: 'en', image: png(2000, 2000) })).status).toBe(400);
    expect((await create({ lang: 'en', image: PNG_DATA_PREFIX + 'not base64!' })).status).toBe(400);
    expect((await create({ lang: 'en', image: PNG_DATA_PREFIX + Buffer.from('hello world, not a png at all').toString('base64') })).status).toBe(400);
    expect((await create({ lang: 'en' })).status).toBe(400);
    expect((await create({ lang: 'en', image: png(256, 256) }, '10.0.0.1', 'text/plain')).status).toBe(415);
    expect(ai.calls).toHaveLength(0);
    expect(() => readDrawing(png(64, 64))).not.toThrow();
  });

  it('turns AI failures and unusable answers into a clean error', async () => {
    ai.fail = true;
    const failed = await create({ lang: 'en', image: png(256, 256) });
    expect(failed.status).toBe(502);
    expect(failed.json.error).toBe('ai_failed');
    ai.fail = false;
    ai.answer = { name: '' };
    expect((await create({ lang: 'en', image: png(256, 256) })).status).toBe(502);
  });

  it('limits calls per day for the whole site', async () => {
    for (let i = 0; i < 5; i++) expect((await create({ lang: 'en', image: png(256, 256) }, '10.0.0.' + i)).status).toBe(200);
    const res = await create({ lang: 'en', image: png(256, 256) }, '10.0.1.1');
    expect(res.status).toBe(429);
    expect(res.json.error).toBe('busy');
    expect(ai.calls).toHaveLength(5);
    // a new day resets the budget
    clock += 24 * 3600 * 1000;
    expect((await create({ lang: 'en', image: png(256, 256) }, '10.0.1.1')).status).toBe(200);
  });

  it('limits calls per client', async () => {
    deps = { ...deps, aiDailyCap: 10_000 };
    let last = 0;
    for (let i = 0; i <= CREATURE_LIMITS.perIp.max; i++) last = (await create({ lang: 'en', image: png(256, 256) })).status;
    expect(last).toBe(429);
    expect(ai.calls).toHaveLength(CREATURE_LIMITS.perIp.max);
  });

  it('limits calls per client per day', async () => {
    deps = { ...deps, aiDailyCap: 10_000 };
    let ok = 0;
    for (let hour = 0; hour < 4; hour++) {
      for (let i = 0; i < CREATURE_LIMITS.perIp.max; i++) if ((await create({ lang: 'en', image: png(256, 256) })).status === 200) ok++;
      clock += 3600 * 1000;
    }
    expect(ok).toBe(CREATURE_LIMITS.perIpDaily.max);
  });

  it('CREATURE_DAILY_CAP=0 turns the AI off; bad values keep the default', async () => {
    expect(dailyCap('0')).toBe(0);
    expect(dailyCap('50.7')).toBe(50);
    expect(dailyCap(undefined)).toBe(CREATURE_LIMITS.dailyDefault);
    expect(dailyCap('')).toBe(CREATURE_LIMITS.dailyDefault);
    expect(dailyCap('lots')).toBe(CREATURE_LIMITS.dailyDefault);
    expect(dailyCap('-5')).toBe(CREATURE_LIMITS.dailyDefault);
    expect(dailyCap('Infinity')).toBe(CREATURE_LIMITS.dailyDefault);
    deps = { ...deps, aiDailyCap: 0 };
    const res = await create({ lang: 'en', image: png(256, 256) });
    expect(res.status).toBe(503);
    expect(ai.calls).toHaveLength(0);
  });

  it('reports whether the AI key is set in /api/health', async () => {
    const res = await handle(new Request('http://test/api/health'), deps);
    expect(await res.json()).toEqual({ ok: true, store: 'memory', ai: true });
  });
});
