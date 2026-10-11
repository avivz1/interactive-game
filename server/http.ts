// Adapts Node's (req, res) — used by Vercel functions and the Vite dev server —
// to the Web-standard handler in router.ts.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { getDeps } from './env.js';
import { handle } from './router.js';

const MAX_BODY_BYTES = 64 * 1024;

type NodeRequest = IncomingMessage & { body?: unknown };

async function readBody(req: NodeRequest): Promise<string> {
  // Vercel's Node helpers may have parsed the body already (and throw on bad JSON).
  let parsed: unknown;
  try {
    parsed = req.body;
  } catch {
    return '';
  }
  if (parsed !== undefined) {
    if (typeof parsed === 'string') return parsed;
    if (Buffer.isBuffer(parsed)) return parsed.toString('utf8');
    return JSON.stringify(parsed);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buf.length;
    if (size > MAX_BODY_BYTES) return '\u0000'.repeat(MAX_BODY_BYTES + 1);
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function toRequest(req: NodeRequest): Promise<Request> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  }
  const method = req.method ?? 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req);
  return new Request(url, { method, headers, body });
}

export async function nodeHandler(req: NodeRequest, res: ServerResponse): Promise<void> {
  try {
    const response = await handle(await toRequest(req), getDeps());
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error('api: adapter error', err instanceof Error ? err.message : String(err));
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'internal', message: 'Something went wrong.' }));
  }
}
