import { beforeEach, describe, expect, it } from 'vitest';
import type { JoinResponse, PairResponse, TvPollResponse } from '../../src/shared/api';
import { ANSWER_KEEP_SEC, CODE_TTL_SEC, LIMITS } from '../../server/pairing';
import { handle, type Deps } from '../../server/router';
import { MemoryStore } from '../../server/store';

const OFFER = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n';
const ANSWER = 'v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n';

let clock = 1_000_000;
let deps: Deps;

beforeEach(() => {
  clock = 1_000_000;
  deps = { store: new MemoryStore(() => clock), now: () => clock, ipSalt: 'test' };
});

interface CallOpts {
  method?: string;
  body?: unknown;
  token?: string;
  ip?: string;
  raw?: string;
}

async function call(path: string, opts: CallOpts = {}) {
  const headers: Record<string, string> = { 'x-forwarded-for': opts.ip ?? '10.0.0.1' };
  if (opts.token) headers.authorization = 'Bearer ' + opts.token;
  const body = opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined);
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await handle(new Request('http://test' + path, { method: opts.method ?? 'GET', headers, body }), deps);
  const text = await res.text();
  return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null };
}

const pair = async (ip?: string) => (await call('/api/pair', { method: 'POST', body: { offer: OFFER }, ip })).json as PairResponse;

describe('pairing flow', () => {
  it('pairs a phone by code and hands the answer to the TV once', async () => {
    const tv = await pair();
    expect(tv.code).toMatch(/^\d{6}$/);
    expect(tv.key).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(tv.emoji[0]).not.toBe(tv.emoji[1]);

    let poll = (await call(`/api/session/${tv.sid}`, { token: tv.tvToken })).json as TvPollResponse;
    expect(poll.state).toBe('waiting');

    const joined = await call('/api/join', { method: 'POST', body: { code: tv.code.slice(0, 3) + ' ' + tv.code.slice(3) } });
    expect(joined.status).toBe(200);
    const phone = joined.json as JoinResponse;
    expect(phone.offer).toBe(OFFER);
    expect(phone.emoji).toEqual(tv.emoji);

    poll = (await call(`/api/session/${tv.sid}`, { token: tv.tvToken })).json as TvPollResponse;
    expect(poll.state).toBe('joined');

    const ans = await call(`/api/session/${phone.sid}/answer`, { method: 'POST', body: { answer: ANSWER }, token: phone.phoneToken });
    expect(ans.status).toBe(204);

    poll = (await call(`/api/session/${tv.sid}`, { token: tv.tvToken })).json as TvPollResponse;
    expect(poll).toMatchObject({ state: 'answered', answer: ANSWER });

    // A retried poll still gets the answer; the record expires shortly after.
    poll = (await call(`/api/session/${tv.sid}`, { token: tv.tvToken })).json as TvPollResponse;
    expect(poll).toMatchObject({ state: 'answered', answer: ANSWER });
    clock += (ANSWER_KEEP_SEC + 1) * 1000;
    expect((await call(`/api/session/${tv.sid}`, { token: tv.tvToken })).status).toBe(404);
  });

  it('pairs a phone by QR key', async () => {
    const tv = await pair();
    const res = await call('/api/join', { method: 'POST', body: { key: tv.key } });
    expect(res.status).toBe(200);
    expect((res.json as JoinResponse).sid).toBe(tv.sid);
  });

  it('lets only one phone claim a session (code and key are both single-use)', async () => {
    const tv = await pair();
    expect((await call('/api/join', { method: 'POST', body: { key: tv.key } })).status).toBe(200);
    expect((await call('/api/join', { method: 'POST', body: { code: tv.code } })).status).toBe(404);
    expect((await call('/api/join', { method: 'POST', body: { key: tv.key } })).status).toBe(404);
  });

  it('expires unused codes', async () => {
    const tv = await pair();
    clock += CODE_TTL_SEC * 1000 + 1;
    expect((await call('/api/join', { method: 'POST', body: { code: tv.code } })).status).toBe(404);
  });

  it('closes a session from either side', async () => {
    const tv = await pair();
    expect((await call(`/api/session/${tv.sid}`, { method: 'DELETE', token: tv.tvToken })).status).toBe(204);
    expect((await call('/api/join', { method: 'POST', body: { code: tv.code } })).status).toBe(404);
  });
});

describe('authorization and validation', () => {
  it('requires the right token for each role', async () => {
    const tv = await pair();
    const phone = (await call('/api/join', { method: 'POST', body: { code: tv.code } })).json as JoinResponse;
    expect((await call(`/api/session/${tv.sid}`)).status).toBe(401);
    expect((await call(`/api/session/${tv.sid}`, { token: phone.phoneToken })).status).toBe(401);
    const asTv = await call(`/api/session/${tv.sid}/answer`, { method: 'POST', body: { answer: ANSWER }, token: tv.tvToken });
    expect(asTv.status).toBe(401);
    expect((await call(`/api/session/${tv.sid}`, { method: 'DELETE', token: 'x'.repeat(22) })).status).toBe(401);
  });

  it('rejects a second answer', async () => {
    const tv = await pair();
    const phone = (await call('/api/join', { method: 'POST', body: { code: tv.code } })).json as JoinResponse;
    const send = () => call(`/api/session/${tv.sid}/answer`, { method: 'POST', body: { answer: ANSWER }, token: phone.phoneToken });
    expect((await send()).status).toBe(204);
    expect((await send()).status).toBe(409);
  });

  it('validates bodies', async () => {
    expect((await call('/api/pair', { method: 'POST', body: { offer: 'hello' } })).status).toBe(400);
    expect((await call('/api/pair', { method: 'POST', body: { offer: 'v=0' + 'x'.repeat(30_000) } })).status).toBe(400);
    expect((await call('/api/pair', { method: 'POST', raw: '{bad json' })).status).toBe(400);
    expect((await call('/api/pair', { method: 'POST', raw: '[1,2]' })).status).toBe(400);
    expect((await call('/api/pair', { method: 'POST', raw: 'x'.repeat(70_000) })).status).toBe(413);
    expect((await call('/api/join', { method: 'POST', body: { code: '12345' } })).status).toBe(400);
    expect((await call('/api/join', { method: 'POST', body: { key: 'short' } })).status).toBe(400);
    expect((await call('/api/join', { method: 'POST', body: {} })).status).toBe(400);
  });

  it('rejects non-JSON POSTs (no cross-site simple requests)', async () => {
    const res = await handle(
      new Request('http://test/api/join', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"code":"123456"}' }),
      deps,
    );
    expect(res.status).toBe(415);
  });

  it('returns 404/405 for unknown routes and wrong methods', async () => {
    expect((await call('/api/nope')).status).toBe(404);
    expect((await call('/api/pair')).status).toBe(405);
    expect((await call('/api/health', { method: 'POST', body: {} })).status).toBe(405);
  });

  it('supports the Vercel rewrite form (?route=)', async () => {
    const res = await call('/api/main?route=health');
    expect(res.json).toEqual({ ok: true, store: 'memory', ai: false });
  });

  it('reports missing storage instead of failing silently', async () => {
    deps = { ...deps, store: null };
    expect((await call('/api/health')).json).toEqual({ ok: false, store: 'not_configured', ai: false });
    expect((await call('/api/pair', { method: 'POST', body: { offer: OFFER } })).status).toBe(503);
  });
});

describe('abuse limits', () => {
  it('rate-limits code guessing per client', async () => {
    let last = 0;
    for (let i = 0; i <= LIMITS.joinPerIp.max; i++) {
      last = (await call('/api/join', { method: 'POST', body: { code: '000000' }, ip: '1.1.1.1' })).status;
    }
    expect(last).toBe(429);
    // other clients are unaffected
    expect((await call('/api/join', { method: 'POST', body: { code: '000000' }, ip: '2.2.2.2' })).status).toBe(404);
  });

  it('does not count stale QR scans toward the global breaker', async () => {
    for (let i = 0; i < LIMITS.joinFailuresGlobal.max; i++) {
      await call('/api/join', { method: 'POST', body: { key: 'A'.repeat(22) }, ip: `6.6.${Math.floor(i / 200)}.${i % 200}` });
    }
    const tv = await pair('9.9.9.8');
    expect((await call('/api/join', { method: 'POST', body: { code: tv.code }, ip: '7.7.7.8' })).status).toBe(200);
  });

  it('pauses typed codes globally after many failures, but QR keys keep working', async () => {
    const tv = await pair('9.9.9.9');
    for (let i = 0; i < LIMITS.joinFailuresGlobal.max; i++) {
      await call('/api/join', { method: 'POST', body: { code: '000001' }, ip: `5.5.${Math.floor(i / 200)}.${i % 200}` });
    }
    const typed = await call('/api/join', { method: 'POST', body: { code: tv.code }, ip: '7.7.7.7' });
    expect(typed.status).toBe(503);
    const viaQr = await call('/api/join', { method: 'POST', body: { key: tv.key }, ip: '7.7.7.7' });
    expect(viaQr.status).toBe(200);
  });

  it('sends Retry-After with 429', async () => {
    let res = await call('/api/pair', { method: 'POST', body: { offer: OFFER }, ip: '3.3.3.3' });
    for (let i = 0; i < LIMITS.pairPerIp.max; i++) res = await call('/api/pair', { method: 'POST', body: { offer: OFFER }, ip: '3.3.3.3' });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});
