// fetch wrapper for the pairing API with a timeout and typed errors.

import type { ApiErrorBody } from './api';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  token?: string;
  timeoutMs?: number;
}

export async function apiFetch<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => controller && controller.abort(), opts.timeoutMs || 10000);
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = 'Bearer ' + opts.token;
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
      signal: controller ? controller.signal : undefined,
    });
  } catch (_e) {
    throw new HttpError(0, 'network', 'Network problem. Check the Wi-Fi connection.');
  } finally {
    clearTimeout(timer);
  }
  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_e) {
      data = null;
    }
  }
  if (!res.ok) {
    const err = (data || {}) as Partial<ApiErrorBody>;
    throw new HttpError(res.status, err.error || 'http_' + res.status, err.message || 'Request failed (' + res.status + ')');
  }
  return data as T;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
