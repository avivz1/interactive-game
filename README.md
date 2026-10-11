# Play on TV

Motion games for kids on the TV. A phone is the camera: it streams video and
body tracking to the TV over the home Wi-Fi.

Current milestone: **M1 — TV test**. The phone pairs with the TV (QR code or
6-digit code), the TV shows the child's mirrored video with the tracked body
drawn on top, and tells you whether this TV can run the games.

## How it works

- `/tv` — TV web app. Creates a WebRTC offer, shows a pairing code + QR, receives
  video and body landmarks, draws them.
- `/phone` — phone web app. Joins with the code, checks the TV is on the same
  network, sends the camera and runs MediaPipe Pose on the phone.
- `/api/*` — one Vercel Function (`api/main.ts` → `server/`). It only passes the
  pairing offer/answer through Upstash Redis; video never goes through the cloud.

Safety: the camera is sent only after the adult confirms the two pictures match
on both screens, and only to a TV on the same local network (no STUN/TURN; both
sides accept only local-network addresses and verify the route before media flows).

## Deploy (Vercel)

1. Vercel → **Add New → Project** → import this GitHub repo. Keep the defaults
   (`vercel.json` sets the build).
2. Vercel → **Storage → Create → Upstash for Redis** (free plan) → connect it to
   the project. This adds the `KV_REST_API_URL` / `KV_REST_API_TOKEN` variables.
3. Redeploy, then open `https://<your-project>.vercel.app/api/health`. It should show
   `{"ok":true,"store":"upstash"}`.

Preview deployments are behind Vercel login by default, which a TV browser
cannot pass. Test on the production URL (or turn off Deployment Protection).

Optional: `IP_HASH_SECRET` (any long random string) for the rate-limit key salt;
by default it is derived from the Upstash token.

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

`/phone/?pose=synthetic` replaces body tracking with a dancing stick figure.
