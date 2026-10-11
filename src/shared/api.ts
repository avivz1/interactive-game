// Types shared by the pairing API (server/) and its clients (TV and phone).

export type SessionState = 'waiting' | 'joined' | 'answered';

export interface PairRequest {
  offer: string;
}

export interface PairResponse {
  sid: string;
  code: string;
  /** 128-bit secret for the QR link; lets a phone join without typing the code. */
  key: string;
  tvToken: string;
  emoji: [number, number];
  expiresInMs: number;
  pollMs: number;
}

export interface TvPollResponse {
  state: SessionState;
  answer?: string;
  pollMs: number;
}

export interface JoinRequest {
  code?: string;
  key?: string;
}

export interface JoinResponse {
  sid: string;
  phoneToken: string;
  offer: string;
  emoji: [number, number];
}

export interface AnswerRequest {
  answer: string;
}

export interface ApiErrorBody {
  error: string;
  message: string;
}

/** Shown on both screens so the adult can confirm the phone joined *their* TV. */
export const EMOJI: ReadonlyArray<readonly [string, string]> = [
  ['🐶', 'dog'],
  ['🐱', 'cat'],
  ['🦊', 'fox'],
  ['🐸', 'frog'],
  ['🐵', 'monkey'],
  ['🐼', 'panda'],
  ['🦁', 'lion'],
  ['🐷', 'pig'],
  ['🍕', 'pizza'],
  ['🍓', 'strawberry'],
  ['🍌', 'banana'],
  ['🚀', 'rocket'],
  ['⚽', 'ball'],
  ['🌈', 'rainbow'],
  ['🎈', 'balloon'],
  ['⭐', 'star'],
];

export function emojiText(pair: [number, number]): { symbols: string; names: string } {
  const a = EMOJI[pair[0]] ?? EMOJI[0];
  const b = EMOJI[pair[1]] ?? EMOJI[1];
  return { symbols: a[0] + ' ' + b[0], names: a[1] + ' + ' + b[1] };
}

export function formatCode(code: string): string {
  return code.slice(0, 3) + ' ' + code.slice(3);
}
