// Routes /api/* requests (Web-standard Request/Response) to the pairing logic.

import { hashIp } from './crypto.js';
import { ApiError } from './errors.js';
import { closeSession, join, pair, pollForTv, submitAnswer, type Ctx } from './pairing.js';
import type { Store } from './store.js';

export interface Deps {
  store: Store | null;
  now: () => number;
  ipSalt: string;
}

const MAX_BODY_CHARS = 64 * 1024;

function json(status: number, body: unknown, extra?: Record<string, string>): Response {
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...extra,
  };
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

function errorResponse(err: ApiError): Response {
  const extra: Record<string, string> = {};
  if (err.retryAfterSec) extra['retry-after'] = String(err.retryAfterSec);
  return json(err.status, { error: err.code, message: err.message }, extra);
}

function routePath(url: URL): string {
  // Vercel rewrites /api/<path> to /api/main?route=<path>.
  const route = url.searchParams.get('route');
  if (route !== null) return '/' + route.replace(/^\/+/, '').replace(/\/+$/, '');
  return url.pathname.replace(/^\/api/, '').replace(/\/+$/, '') || '/';
}

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

function bearer(req: Request): string | null {
  const m = /^Bearer\s+([A-Za-z0-9_-]{16,64})$/.exec(req.headers.get('authorization') ?? '');
  return m ? m[1] : null;
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > MAX_BODY_CHARS) throw new ApiError(413, 'too_large', 'Request too large.');
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new ApiError(400, 'bad_request', 'Body must be a JSON object.');
}

function allow(req: Request, ...methods: string[]): void {
  if (!methods.includes(req.method)) throw new ApiError(405, 'method_not_allowed', 'Method not allowed.');
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const path = routePath(new URL(req.url));
  try {
    if (path === '/health') {
      allow(req, 'GET');
      return json(200, { ok: deps.store !== null, store: deps.store?.kind ?? 'not_configured' });
    }
    if (!deps.store) {
      throw new ApiError(503, 'storage_not_configured', 'Pairing storage is not set up (connect Upstash Redis in Vercel).');
    }
    const ctx: Ctx = { store: deps.store, now: deps.now, client: hashIp(clientIp(req), deps.ipSalt) };

    if (path === '/pair') {
      allow(req, 'POST');
      return json(201, await pair(ctx, await readJson(req)));
    }
    if (path === '/join') {
      allow(req, 'POST');
      return json(200, await join(ctx, await readJson(req)));
    }
    const m = /^\/session\/([A-Za-z0-9_-]{16})(\/answer)?$/.exec(path);
    if (m) {
      const sid = m[1];
      if (m[2]) {
        allow(req, 'POST');
        await submitAnswer(ctx, sid, bearer(req), await readJson(req));
        return json(204, null);
      }
      allow(req, 'GET', 'DELETE');
      if (req.method === 'GET') return json(200, await pollForTv(ctx, sid, bearer(req)));
      await closeSession(ctx, sid, bearer(req));
      return json(204, null);
    }
    throw new ApiError(404, 'not_found', 'Unknown endpoint.');
  } catch (err) {
    if (err instanceof ApiError) return errorResponse(err);
    console.error('api: unhandled error', err instanceof Error ? err.message : String(err));
    return json(500, { error: 'internal', message: 'Something went wrong. Please try again.' });
  }
}
