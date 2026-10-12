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

/** Shown on both screens so the adult can confirm the phone joined *their* TV (names are in i18n). */
export const EMOJI: ReadonlyArray<string> = ['🐶', '🐱', '🦊', '🐸', '🐵', '🐼', '🦁', '🐷', '🍕', '🍓', '🍌', '🚀', '⚽', '🌈', '🎈', '⭐'];

export function formatCode(code: string): string {
  return code.slice(0, 3) + ' ' + code.slice(3);
}
