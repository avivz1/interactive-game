import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

/** Every TV and phone context a test opens; closed after it, so streams don't pile up. */
const opened: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(opened.splice(0).map((ctx) => ctx.close().catch(() => undefined)));
});

interface TvDebug {
  videoWidth: number;
  videoFps: number;
  poseHz: number;
  lan: boolean | null;
  works: boolean;
  scene: string;
}

/** Most tests read English texts; the app itself defaults to Hebrew. */
const english = () => {
  try {
    localStorage.setItem('lang', 'en');
  } catch {
    // ignore
  }
};

async function openTv(browser: Browser, path = '/tv/', lang: 'en' | 'default' = 'en'): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  opened.push(ctx);
  if (lang === 'en') await ctx.addInitScript(english);
  const tv = await ctx.newPage();
  await tv.goto(path);
  await expect(tv.getByTestId('pair-code')).toHaveText(/^\d{3} \d{3}$/, { timeout: 15_000 });
  return tv;
}

async function openPhone(browser: Browser, path: string, lang: 'en' | 'default' = 'en'): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ['camera'], viewport: { width: 390, height: 844 } });
  opened.push(ctx);
  if (lang === 'en') await ctx.addInitScript(english);
  const phone = await ctx.newPage();
  await phone.goto(path);
  return phone;
}

async function expectStreaming(tv: Page): Promise<void> {
  await expect(tv.getByTestId('live')).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => tv.evaluate(() => (window as unknown as { __tvDebug?: TvDebug }).__tvDebug ?? null), { timeout: 20_000 })
    .toMatchObject({ works: true });
  const dbg = await tv.evaluate(() => (window as unknown as { __tvDebug: TvDebug }).__tvDebug);
  // The phone enforces the LAN check; the TV may see only hidden (mDNS) addresses.
  expect(dbg.lan).not.toBe(false);
  expect(dbg.videoWidth).toBeGreaterThan(0);
  expect(dbg.videoFps).toBeGreaterThan(5);
  expect(dbg.poseHz).toBeGreaterThan(10);
}

const debugValue = (tv: Page, key: string) =>
  tv.evaluate((k) => ((window as unknown as { __tvDebug?: Record<string, unknown> }).__tvDebug || {})[k], key);

/** Pairs a phone (synthetic body) with the TV using the typed code. */
async function pairPhone(browser: Browser, tv: Page, phonePath = '/phone/?pose=synthetic'): Promise<Page> {
  const code = (await tv.getByTestId('pair-code').textContent())!.replace(/\D/g, '');
  const phone = await openPhone(browser, phonePath);
  await phone.getByTestId('code-input').fill(code);
  await phone.getByTestId('join').click();
  await phone.getByTestId('confirm-yes').click();
  return phone;
}

test('phone joins with the typed code, confirms the emoji and streams to the TV', async ({ browser }) => {
  const tv = await openTv(browser);
  const code = (await tv.getByTestId('pair-code').textContent())!.replace(/\D/g, '');
  const tvEmoji = await tv.getByTestId('pair-emoji-names').textContent();

  const phone = await openPhone(browser, '/phone/?pose=synthetic');
  await phone.getByTestId('code-input').fill(code);
  await phone.getByTestId('join').click();
  await expect(phone.getByTestId('confirm-emoji-names')).toHaveText(tvEmoji!);
  await phone.getByTestId('confirm-yes').click();

  await expect(phone.getByTestId('live')).toBeVisible({ timeout: 30_000 });
  await expectStreaming(tv);

  // Stopping on the phone returns the TV to a "connect again" screen.
  await phone.getByTestId('stop').click();
  await expect(tv.getByTestId('action')).toHaveText('Connect again', { timeout: 15_000 });
});

test('phone joins through the QR link', async ({ browser }) => {
  const tv = await openTv(browser);
  const qrUrl = await tv.getByTestId('pair-qr').getAttribute('data-url');
  expect(qrUrl).toMatch(/\/phone\/#k=[A-Za-z0-9_-]{22}$/);
  const url = new URL(qrUrl!);

  const phone = await openPhone(browser, '/phone/?pose=synthetic' + url.hash);
  await phone.getByTestId('confirm-yes').click();
  await expectStreaming(tv);
});

test('wrong code shows a friendly error', async ({ browser }) => {
  await openTv(browser);
  const phone = await openPhone(browser, '/phone/');
  await phone.getByTestId('code-input').fill('000000');
  await phone.getByTestId('join').click();
  await expect(phone.getByTestId('error')).toContainText('Code not found');
});

test('phone refuses a "TV" that points outside the local network', async ({ browser, request }) => {
  const offer = [
    'v=0',
    'o=- 1 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'm=video 9 UDP/TLS/RTP/SAVPF 96',
    'a=candidate:1 1 udp 2122260223 81.2.3.4 50000 typ prflx generation 0',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    '',
  ].join('\r\n');
  const res = await request.post('/api/pair', { data: { offer } });
  expect(res.status()).toBe(201);
  const { code } = (await res.json()) as { code: string };

  const phone = await openPhone(browser, '/phone/?pose=synthetic');
  await phone.getByTestId('code-input').fill(code);
  await phone.getByTestId('join').click();
  await phone.getByTestId('confirm-yes').click();
  await expect(phone.getByTestId('error')).toContainText('For safety');
});

test('setup leads to the menu, a full Tickle Pop round, and back', async ({ browser }) => {
  const tv = await openTv(browser, '/tv/?round=6');
  await pairPhone(browser, tv);
  await expectStreaming(tv);

  // The synthetic body is fully visible, so setup completes on its own.
  await expect.poll(() => debugValue(tv, 'scene'), { timeout: 15_000 }).toBe('menu');

  // TV check opens with ▼ and closes with OK.
  await tv.keyboard.press('ArrowDown');
  await expect.poll(() => debugValue(tv, 'scene')).toBe('check');
  await tv.keyboard.press('Enter');
  await expect.poll(() => debugValue(tv, 'scene')).toBe('menu');

  // The first OK may only unlock sound; press until the game starts.
  await expect
    .poll(
      async () => {
        await tv.keyboard.press('Enter');
        return debugValue(tv, 'scene');
      },
      { timeout: 10_000, intervals: [500] },
    )
    .toBe('tickle-pop');

  await expect.poll(() => debugValue(tv, 'ended'), { timeout: 20_000 }).toBe(true);
  expect(await debugValue(tv, 'stars')).toBeGreaterThanOrEqual(1);
  await expect.poll(() => debugValue(tv, 'scene'), { timeout: 15_000 }).toBe('menu');
});

test('Hebrew by default, and the language chosen on the phone reaches the TV', async ({ browser }) => {
  const tv = await openTv(browser, '/tv/', 'default');
  expect(await tv.evaluate(() => document.documentElement.dir)).toBe('rtl');
  await expect(tv.locator('h1.title')).toHaveText(/בואו נשחק/);

  // ◀ ▶ on the remote switches the TV language on the pairing screen.
  await tv.keyboard.press('ArrowRight');
  await expect(tv.locator('h1.title')).toHaveText(/هيا نلعب/);
  await tv.keyboard.press('ArrowLeft');
  await expect(tv.locator('h1.title')).toHaveText(/בואו נשחק/);

  const code = (await tv.getByTestId('pair-code').textContent())!.replace(/\D/g, '');
  const phone = await openPhone(browser, '/phone/?pose=synthetic', 'default');
  await expect(phone.locator('h1')).toHaveText(/מתחברים לטלוויזיה/);
  await phone.getByTestId('code-input').fill(code);
  await phone.getByTestId('join').click();
  await phone.getByTestId('confirm-yes').click();
  await expectStreaming(tv);

  await phone.locator('[data-lang="en"]').click();
  await expect(phone.getByTestId('live')).toHaveText(/Camera is on/);
  await expect.poll(() => debugValue(tv, 'lang')).toBe('en');
});

/** The synthetic figure that draws a creature (body, ears, legs) with its left hand, in a 16 s loop. */
const DRAWING_PHONE = '/phone/?pose=synthetic&act=draw';

/** Opens Draw & Alive from the menu with the remote (◀ to its tile, left of the child, then OK). */
async function openDrawGame(tv: Page): Promise<void> {
  // the drawing figure's hand may already have picked it from the menu
  await expect.poll(() => debugValue(tv, 'scene'), { timeout: 15_000 }).toMatch(/^(menu|draw-alive)$/);
  if ((await debugValue(tv, 'scene')) === 'menu') {
    await tv.waitForTimeout(300); // tiles settle above the child
    await tv.keyboard.press('ArrowLeft');
  }
  await expect
    .poll(
      async () => {
        if ((await debugValue(tv, 'scene')) === 'menu') await tv.keyboard.press('Enter');
        return debugValue(tv, 'scene');
      },
      { timeout: 10_000, intervals: [500] },
    )
    .toBe('draw-alive');
}

/** Resolves once the ink stays the same for `ms` with at least `minInk` drawn (the hand rests). */
async function inkRests(tv: Page, ms: number, minInk: number): Promise<void> {
  let last = -1;
  let since = Date.now();
  await expect
    .poll(
      async () => {
        const ink = ((await debugValue(tv, 'ink')) as number) || 0;
        if (ink !== last) {
          last = ink;
          since = Date.now();
        }
        return ink >= minInk && Date.now() - since >= ms;
      },
      { timeout: 45_000, intervals: [250] },
    )
    .toBe(true);
}

/** Seconds since the phone's synthetic figure started (its drawing script loops every 16 s). */
const synthTime = (phone: Page) =>
  phone.evaluate(() => (performance.now() - ((window as unknown as { __synthStart?: number }).__synthStart || 0)) / 1000);

/**
 * Finish with OK once there is enough ink. With `phone` (the drawing figure):
 * start over (◀) in the pause at the start of its 16 s loop and finish after
 * that loop's last line, so exactly one whole creature is drawn.
 */
async function drawAndFinish(tv: Page, phone?: Page): Promise<void> {
  if (phone) {
    // wait for the pause at the start of a loop (the hand rests until 2.4 s)
    await expect.poll(async () => (await synthTime(phone)) % 16, { timeout: 20_000, intervals: [100] }).toBeLessThan(1.2);
    await tv.keyboard.press('ArrowLeft');
    const startAt = await synthTime(phone);
    const finishAt = startAt - (startAt % 16) + 15.7; // after the last leg and the hand's swoop out
    await expect.poll(() => synthTime(phone), { timeout: 25_000, intervals: [200] }).toBeGreaterThanOrEqual(finishAt);
    await inkRests(tv, 500, 2);
  } else {
    await expect.poll(() => debugValue(tv, 'ink'), { timeout: 20_000 }).toBeGreaterThanOrEqual(0.6);
  }
  await tv.keyboard.press('Enter');
  await expect.poll(() => debugValue(tv, 'drawPhase'), { timeout: 5_000 }).not.toBe('draw');
}

test('Draw & Alive: the drawing goes to the creature AI and comes alive with its name', async ({ browser }) => {
  test.setTimeout(120_000); // waits for one whole 16 s drawing loop, sometimes two
  const tv = await openTv(browser, '/tv/?round=6&draw=90');
  let sent: { lang?: string; image?: string } = {};
  await tv.route('**/api/creature', async (route) => {
    sent = JSON.parse(route.request().postData() || '{}');
    if (sent.image) await test.info().attach('drawing.png', { body: Buffer.from(sent.image.split(',')[1], 'base64'), contentType: 'image/png' });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ traits: { looksLike: 'fish', name: 'Bubbles', greeting: 'Hello!', personality: 'silly', move: 'swim', bodyColor: '#7ee0ff', accentColor: '#ffd23f', face: { x: 0.5, y: 0.4 } } }),
    });
  });
  const phone = await pairPhone(browser, tv, DRAWING_PHONE);
  await expectStreaming(tv);
  await openDrawGame(tv);
  await drawAndFinish(tv, phone);

  await expect.poll(() => debugValue(tv, 'drawPhase'), { timeout: 10_000 }).toBe('play');
  expect(await debugValue(tv, 'creatureSource')).toBe('ai');
  // body, two ears, two legs (one more if a slow frame split a line)
  expect(await debugValue(tv, 'strokes')).toBeGreaterThanOrEqual(5);
  expect(await debugValue(tv, 'strokes')).toBeLessThanOrEqual(6);
  expect(await debugValue(tv, 'fills')).toBeGreaterThanOrEqual(1); // the round body was recognised and filled
  expect(await debugValue(tv, 'creatureName')).toBe('Bubbles');
  expect(sent.lang).toBe('en');
  expect(sent.image).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
  expect(sent.image!.length).toBeLessThan(56_000);

  await expect.poll(() => debugValue(tv, 'ended'), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => debugValue(tv, 'scene'), { timeout: 20_000 }).toBe('menu');
});

test('Draw & Alive works without the AI (made locally)', async ({ browser }) => {
  // No ANTHROPIC_API_KEY in tests: the server answers 503 and the TV names the creature itself.
  const tv = await openTv(browser, '/tv/?round=5&draw=30');
  await pairPhone(browser, tv, DRAWING_PHONE);
  await expectStreaming(tv);
  await openDrawGame(tv);
  await drawAndFinish(tv);
  await expect.poll(() => debugValue(tv, 'drawPhase'), { timeout: 10_000 }).toBe('play');
  expect(await debugValue(tv, 'creatureSource')).toBe('local');
  expect(['Bloop', 'Ziggy', 'Pip', 'Wobbles', 'Noodle', 'Fizz', 'Mochi', 'Boo']).toContain(await debugValue(tv, 'creatureName'));
  // Back on the remote returns to the menu at any time.
  await tv.keyboard.press('Escape');
  await expect.poll(() => debugValue(tv, 'scene'), { timeout: 10_000 }).toBe('menu');
});

/** Opens Freeze Dance from the menu with the remote (◀ ◀ to the leftmost bubble, then OK). */
async function openFreezeDance(tv: Page): Promise<void> {
  await expect.poll(() => debugValue(tv, 'scene'), { timeout: 15_000 }).toBe('menu');
  await tv.waitForTimeout(300); // bubbles settle above the child
  await tv.keyboard.press('ArrowLeft');
  await tv.keyboard.press('ArrowLeft');
  await expect
    .poll(
      async () => {
        if ((await debugValue(tv, 'scene')) === 'menu') await tv.keyboard.press('Enter');
        return debugValue(tv, 'scene');
      },
      { timeout: 10_000, intervals: [500] },
    )
    .toBe('freeze-dance');
}

test('Freeze Dance: a child who stands still is a statue', async ({ browser }) => {
  test.setTimeout(90_000);
  const tv = await openTv(browser, '/tv/?round=8');
  await pairPhone(browser, tv, '/phone/?pose=synthetic&act=still');
  await expectStreaming(tv);
  await openFreezeDance(tv);
  await expect.poll(() => debugValue(tv, 'freezes'), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  await expect.poll(() => debugValue(tv, 'ended'), { timeout: 20_000 }).toBe(true);
  expect(await debugValue(tv, 'statues')).toBeGreaterThanOrEqual(1);
  expect(await debugValue(tv, 'stars')).toBeGreaterThanOrEqual(1);
  await expect.poll(() => debugValue(tv, 'scene'), { timeout: 20_000 }).toBe('menu');
});

test('Freeze Dance: a child who keeps dancing gets a giggle, not a statue', async ({ browser }) => {
  test.setTimeout(90_000);
  const tv = await openTv(browser, '/tv/?round=8');
  await pairPhone(browser, tv, '/phone/?pose=synthetic&act=dance');
  await expectStreaming(tv);
  await openFreezeDance(tv);
  await expect.poll(() => debugValue(tv, 'ended'), { timeout: 30_000 }).toBe(true);
  expect(await debugValue(tv, 'wiggles')).toBeGreaterThanOrEqual(1);
  expect(await debugValue(tv, 'statues')).toBe(0);
});
