// Asks the server's creature AI to name and style a drawing. Any failure (no
// key, offline, slow, limits) returns null and the game makes a creature locally.

import { sanitizeTraits, type CreatureLang, type CreatureResponse, type CreatureTraits } from '../shared/creature-api';
import { apiFetch } from '../shared/http';

export async function askCreature(image: string, lang: CreatureLang, timeoutMs: number): Promise<CreatureTraits | null> {
  try {
    const res = await apiFetch<CreatureResponse>('/api/creature', { method: 'POST', body: { lang, image }, timeoutMs });
    return res ? sanitizeTraits(res.traits) : null;
  } catch (_e) {
    return null;
  }
}
