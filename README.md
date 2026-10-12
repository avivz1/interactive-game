# Play on TV

Motion games for kids on the TV. A phone is the camera: it streams video and
body tracking to the TV over the home Wi-Fi.

Current state: pairing + three games. The phone pairs with the TV (QR code
or 6-digit code), the child sees themselves mirrored on the TV with glowing
"magic gloves" on their hands, then:

1. **Setup** — "step back until you fit" until the whole body is visible.
2. **Menu** — the game bubbles float above the head; raise a hand onto one and
   hold it (or use ◀ ▶ and OK on the remote).
   Remote ▼ opens the **TV check** screen (connection and tracking details).
3. **Tickle Pop** — hold a hand on the bubble-creatures to tickle them until
   they pop (a lifted foot works too). Sneezy ones pop their neighbours; sleepy
   ones nap near the floor until a kick or a hand wakes them. Only hands and
   feet count, never the head or body. 60-second rounds, always at least one star.
4. **Draw & Alive** — draw a creature in the air: a hand inside the board is
   the pen (lower it to lift the pen). Hold a hand on the green ✓ to finish
   (remote: OK; ◀ starts over), 25 seconds. The drawing comes alive — filled
   with colour, with eyes, a smile and feet or wings — and gets a name. Then
   pet it (a moving hand), jump with it, cover your eyes for peekaboo.
5. **Freeze Dance** — dance while the music plays; when it stops ("Freeze!"),
   hold still for 3 seconds while a friendly monster watches. A statue earns
   a star, a wiggle earns a giggle; nobody is ever out.

Spoken instructions in Hebrew (default), Arabic or English: choose with the
buttons on the phone, or ◀ ▶ on the TV pairing screen.

Press OK on the TV remote once to turn the sound on (browsers block audio
until a key press).

## How it works

- `/tv` — TV web app. Creates a WebRTC offer, shows a pairing code + QR, receives
  video and body landmarks, draws them.
- `/phone` — phone web app. Joins with the code, checks the TV is on the same
  network, sends the camera and runs MediaPipe Pose on the phone.
- `/api/*` — one Vercel Function (`api/main.ts` → `server/`). It passes the
  pairing offer/answer through Upstash Redis; video never goes through the cloud.
  `POST /api/creature` (Draw & Alive) sends a 256×256 picture of the drawn
  lines — never the camera — to Claude Haiku 5.5, which names the creature and
  picks its colours and personality (about $0.001 per drawing).

Safety: the camera is sent only after the adult confirms the two pictures match
on both screens, and only to a TV on the same local network (no STUN/TURN; both
sides accept only local-network addresses and verify the route before media flows).

## Deploy (Vercel)

1. Vercel → **Add New → Project** → import this GitHub repo. Keep the defaults
   (`vercel.json` sets the build).
2. Vercel → **Storage → Create → Upstash for Redis** (free plan) → connect it to
   the project. This adds the `KV_REST_API_URL` / `KV_REST_API_TOKEN` variables.
3. Redeploy, then open `https://<your-project>.vercel.app/api/health`. It should show
   `{"ok":true,"store":"upstash","ai":false}` (`"ai":true` once the key below is set).

Preview deployments are behind Vercel login by default, which a TV browser
cannot pass. Test on the production URL (or turn off Deployment Protection).

For Draw & Alive's AI, add `ANTHROPIC_API_KEY` (Settings → Environment
Variables, for the environment you test on) and redeploy; `/api/health` then
shows `"ai":true`. Without it the game still works and names creatures itself.

Optional:
- `CREATURE_DAILY_CAP` — most AI calls per day for the whole site (default 2000,
  about $2; `0` turns the AI off). Each home is also limited to 40 an hour and
  120 a day.
- `IP_HASH_SECRET` (any long random string) for the rate-limit key salt; by
  default it is derived from the Upstash token.

## Test on the TV

1. TV and phone on the **same Wi-Fi**.
2. On the TV, open the browser and go to `<your-project>.vercel.app/tv`.
   The bottom row shows the TV check (green ✓ / red ✗).
3. On the phone, scan the QR code (or open `/phone` and type the code), check the
   two pictures match, tap **Yes — start the camera**, allow the camera.
4. Stand the phone sideways 2–3 m away, back camera facing you.
5. The TV shows **✅ This TV works!** when video and data arrive. Press **OK** on
   the remote for details; ←/→ shifts the body overlay timing.

If something fails, the TV shows the reason and a red error box at the bottom.

## Develop

```sh
npm ci            # .npmrc sets legacy-peer-deps (npm 10 peer-resolution bug)
npm run dev       # http://localhost:5173/tv and /phone (in-memory pairing)
npm run dev:lan   # https on your LAN so a real phone can use its camera
npm run typecheck
npm test          # unit tests
npm run test:e2e  # Playwright: TV + phone pages with a fake camera
```

`/phone/?pose=synthetic` replaces body tracking with a dancing stick figure
(`&act=draw`: it draws a creature with one hand; `&act=still` stands still;
`&act=dance` never stops dancing). `/tv/?round=10` shortens game
rounds and `?draw=10` the drawing time (for testing).

Voice lines are listed in `scripts/voice-lines.json` and recorded with
ElevenLabs into `public/voice/<lang>/<key>.mp3`.

Code map: `src/tv/session.ts` (link to the phone, sync, stats), `src/tv/stage.ts`
(scenes + remote keys), `src/tv/scenes/*` (setup, menu, games, TV check),
`src/games/*` (game rules, unit-tested without drawing), `src/tv/audio.ts`
(sound samples in `public/sounds/` with synthesized fallbacks, voice lines),
`src/shared/i18n.ts` (texts), `src/tv/creature-art.ts` + `src/games/drawing.ts` +
`src/games/creature.ts` (Draw & Alive), `src/games/freeze-dance.ts` (Freeze
Dance rules and the movement meter), `src/games/limbs.ts` (which hands and feet
may touch creatures), `server/creature.ts` + `server/ai.ts` (creature AI endpoint).
