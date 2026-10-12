// The creature AI: Claude looks at the child's drawing and invents a friendly
// creature (name, greeting, colours, personality, where its face goes).

import type { CreatureLang } from '../src/shared/creature-api.js';
import { MOVES, PERSONALITIES } from '../src/shared/creature-api.js';
import type { CreatureAI } from './creature.js';

/** The request below (thinking off, effort low) is valid for this model. */
export const CREATURE_MODEL = 'claude-haiku-5-5';

const LANG_NAMES: Record<CreatureLang, string> = {
  he: 'Hebrew (he), in Hebrew script',
  ar: 'Arabic (ar), in Arabic script',
  en: 'English (en)',
};

const SYSTEM = `You bring children's drawings to life in a kids' TV game. A child aged 3 to 9 drew the picture in the air with their hand, so the lines are wobbly and simple. Look at the drawing and invent a cute, friendly creature based on it.

- looks_like: 1 to 4 English words for what the drawing most resembles (for example "cat", "fish", "flower", "house", "scribble").
- name: a cute, short, made-up name for the creature (one or two words, at most 12 letters) in the requested language and script.
- greeting: what the creature says when it wakes up: cheerful, at most 5 words, in the requested language and script.
- personality: bouncy, shy, silly or sleepy, whatever fits the drawing.
- move: swim for fish and sea animals, fly for birds, butterflies, bees and other flying things, hop for frogs, bunnies and kangaroos, otherwise walk.
- body_color and accent_color: bright, cheerful hex colours (#rrggbb) that suit the creature. Never dark colours.
- face_x and face_y: where the creature's eyes should go, as fractions of the image width and height (0 to 1). Put them on the drawing: on the head if there is one, otherwise on the upper middle of the body.

Always be gentle and positive. Never use scary, rude, sad or grown-up words. If the drawing looks like something scary, make it a friendly, silly version.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['looks_like', 'name', 'greeting', 'personality', 'move', 'body_color', 'accent_color', 'face_x', 'face_y'],
  properties: {
    looks_like: { type: 'string' },
    name: { type: 'string' },
    greeting: { type: 'string' },
    personality: { type: 'string', enum: PERSONALITIES.slice() },
    move: { type: 'string', enum: MOVES.slice() },
    body_color: { type: 'string' },
    accent_color: { type: 'string' },
    face_x: { type: 'number' },
    face_y: { type: 'number' },
  },
};

type AnthropicClient = import('@anthropic-ai/sdk').default;

export class ClaudeCreatureAI implements CreatureAI {
  private client: Promise<AnthropicClient> | null = null;

  constructor(private readonly apiKey: string) {}

  /** The SDK loads on the first drawing, so pairing requests never pay for it. */
  private getClient(): Promise<AnthropicClient> {
    if (!this.client) {
      this.client = import('@anthropic-ai/sdk').then((mod) => new mod.default({ apiKey: this.apiKey, timeout: 6000, maxRetries: 0 }));
      // a failed load is retried on the next drawing instead of being remembered
      this.client.catch(() => {
        this.client = null;
      });
    }
    return this.client;
  }

  async describe(pngBase64: string, lang: CreatureLang): Promise<unknown> {
    const client = await this.getClient();
    const response = await client.messages.create({
      model: CREATURE_MODEL,
      max_tokens: 400,
      thinking: { type: 'disabled' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: pngBase64 } },
            { type: 'text', text: `Requested language: ${LANG_NAMES[lang]}. Bring this drawing to life.` },
          ],
        },
      ],
    });
    if (response.stop_reason !== 'end_turn') throw new Error('stop_reason ' + response.stop_reason);
    let text = '';
    for (const block of response.content) if (block.type === 'text') text += block.text;
    return JSON.parse(text);
  }
}
