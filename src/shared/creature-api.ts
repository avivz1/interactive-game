// Draw & Alive: what the TV sends to /api/creature (a picture of the child's
// drawing, never the camera) and the creature traits that come back. The same
// sanitizer runs on the server (on the AI output) and on the TV (on the reply).

export const CREATURE_LANGS = ['he', 'ar', 'en'] as const;
export type CreatureLang = (typeof CREATURE_LANGS)[number];

export const PERSONALITIES = ['bouncy', 'shy', 'silly', 'sleepy'] as const;
export type Personality = (typeof PERSONALITIES)[number];

export const MOVES = ['walk', 'hop', 'fly', 'swim'] as const;
export type Move = (typeof MOVES)[number];

/** The drawing is sent as a small PNG data URL (black lines on white). */
export const DRAWING_IMAGE_SIZE = 256;
export const PNG_DATA_PREFIX = 'data:image/png;base64,';
export const MAX_IMAGE_CHARS = 56_000;

export interface CreatureRequest {
  lang: CreatureLang;
  image: string;
}

export interface CreatureTraits {
  /** A short English description of what the drawing looks like (for logs/tests). */
  looksLike: string;
  name: string;
  greeting: string;
  personality: Personality;
  move: Move;
  bodyColor: string;
  accentColor: string;
  /** Where the eyes go, as fractions of the drawing image (null: let the TV decide). */
  face: { x: number; y: number } | null;
}

export interface CreatureResponse {
  traits: CreatureTraits;
}

export const NAME_MAX = 14;
export const GREETING_MAX = 40;
const LOOKS_LIKE_MAX = 40;

const HEX = /^#[0-9a-f]{6}$/i;

export function isCreatureLang(v: unknown): v is CreatureLang {
  return v === 'he' || v === 'ar' || v === 'en';
}

/**
 * Removes control and bidi-override characters, collapses spaces and cuts to
 * `max` characters (by code point, so emoji and Hebrew/Arabic are not split).
 */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  const cleaned = v
    .replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(cleaned);
  return chars.length > max ? chars.slice(0, max).join('').trim() : cleaned;
}

/** Relative luminance (0 black .. 1 white) of a #rrggbb colour. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

/** Bright, cheerful colours only: dark or malformed colours become the fallback. */
function cleanColor(v: unknown, fallback: string): string {
  if (typeof v !== 'string' || !HEX.test(v)) return fallback;
  return luminance(v) < 0.12 ? fallback : v.toLowerCase();
}

function fraction(v: unknown): number | null {
  return typeof v === 'number' && isFinite(v) && v >= 0 && v <= 1 ? v : null;
}

function pick<T extends string>(v: unknown, options: ReadonlyArray<T>, fallback: T): T {
  return typeof v === 'string' && (options as ReadonlyArray<string>).indexOf(v) >= 0 ? (v as T) : fallback;
}

/**
 * Validates traits from the AI (snake_case fields) or from the server reply
 * (camelCase). Returns null when there is no usable name.
 */
export function sanitizeTraits(raw: unknown): CreatureTraits | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = cleanText(r.name, NAME_MAX);
  if (!name) return null;
  const fx = fraction(r.face_x !== undefined ? r.face_x : r.face && (r.face as Record<string, unknown>).x);
  const fy = fraction(r.face_y !== undefined ? r.face_y : r.face && (r.face as Record<string, unknown>).y);
  return {
    looksLike: cleanText(r.looks_like !== undefined ? r.looks_like : r.looksLike, LOOKS_LIKE_MAX),
    name,
    greeting: cleanText(r.greeting, GREETING_MAX),
    personality: pick(r.personality, PERSONALITIES, 'bouncy'),
    move: pick(r.move, MOVES, 'hop'),
    bodyColor: cleanColor(r.body_color !== undefined ? r.body_color : r.bodyColor, '#7ee0ff'),
    accentColor: cleanColor(r.accent_color !== undefined ? r.accent_color : r.accentColor, '#ff7eb6'),
    face: fx !== null && fy !== null ? { x: fx, y: fy } : null,
  };
}
