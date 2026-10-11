import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const randomCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

export const randomToken = (bytes = 16): string => randomBytes(bytes).toString('base64url');

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('base64url');

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Pseudonymous rate-limit key for an IP address (raw IPs are never stored). */
export const hashIp = (ip: string, salt: string): string =>
  createHmac('sha256', salt).update(ip).digest('base64url').slice(0, 16);

/** Two distinct random indices in [0, n). */
export function randomPair(n: number): [number, number] {
  const a = randomInt(0, n);
  let b = randomInt(0, n - 1);
  if (b >= a) b++;
  return [a, b];
}
