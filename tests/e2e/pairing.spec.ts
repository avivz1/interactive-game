import { expect, test, type Browser, type Page } from '@playwright/test';

interface TvDebug {
  videoWidth: number;
  videoFps: number;
  poseHz: number;
  lan: boolean | null;
  works: boolean;
  scene: string;
}

async function openTv(browser: Browser, path = '/tv/'): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const tv = await ctx.newPage();
  await tv.goto(path);
  await expect(tv.getByTestId('pair-code')).toHaveText(/^\d{3} \d{3}$/, { timeout: 15_000 });
  return tv;
}

async function openPhone(browser: Browser, path: string): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ['camera'], viewport: { width: 390, height: 844 } });
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
async function pairPhone(browser: Browser, tv: Page): Promise<Page> {
  const code = (await tv.getByTestId('pair-code').textContent())!.replace(/\D/g, '');
  const phone = await openPhone(browser, '/phone/?pose=synthetic');
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
