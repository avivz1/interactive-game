import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LANGS, apiErrorText, emojiText, getLang, setLang, t } from '../../src/shared/i18n';
import { parseCtl } from '../../src/shared/protocol';
import { VOICE_KEYS } from '../../src/tv/audio';

describe('i18n', () => {
  it('defaults to Hebrew', () => {
    expect(getLang()).toBe('he');
    expect(t('menu.title')).toBe('שלחו יד אל משחק כדי לשחק!');
  });

  it('switches language and fills placeholders', () => {
    setLang('en');
    expect(t('tickle.popped', { n: 7 })).toBe('Bubbles popped: 7');
    setLang('ar');
    expect(t('tickle.popped', { n: 7 })).toContain('7');
    setLang('he');
  });

  it('maps pairing-service errors to localized text', () => {
    setLang('en');
    expect(apiErrorText('not_found', 'x')).toContain('Code not found');
    expect(apiErrorText('weird', 'server text')).toBe('server text');
    setLang('he');
  });

  it('names the pairing pictures in the current language', () => {
    setLang('en');
    expect(emojiText([0, 8])).toEqual({ symbols: '🐶 🍕', names: 'dog + pizza' });
    setLang('he');
    expect(emojiText([0, 8]).names).toBe('כלב + פיצה');
  });

  it('offers exactly Hebrew, Arabic and English, Hebrew first', () => {
    expect(LANGS.map((l) => l.id)).toEqual(['he', 'ar', 'en']);
  });
});

describe('voice lines', () => {
  const script = JSON.parse(readFileSync('scripts/voice-lines.json', 'utf8')) as { lines: Record<string, Record<string, string>> };

  it('match the keys the game speaks', () => {
    expect(Object.keys(script.lines).sort()).toEqual([...VOICE_KEYS].sort());
  });

  it('have a recorded file for every language', () => {
    for (const lang of LANGS) for (const key of VOICE_KEYS) expect(existsSync(`public/voice/${lang.id}/${key}.mp3`), `${lang.id}/${key}`).toBe(true);
  });
});

describe('lang control message', () => {
  it('parses valid languages only', () => {
    expect(parseCtl('{"t":"lang","lang":"ar"}')).toEqual({ t: 'lang', lang: 'ar' });
    expect(parseCtl('{"t":"lang","lang":"fr"}')).toBeNull();
  });
});
