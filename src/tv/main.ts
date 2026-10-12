// TV app: checks the browser, shows a pairing code + QR, connects to the phone
// over WebRTC and starts the live view.

import { generate } from 'lean-qr';
import { formatCode, type PairResponse, type TvPollResponse } from '../shared/api';
import { h, mount } from '../shared/dom';
import { HttpError, apiFetch, sleep } from '../shared/http';
import { LANGS, applyDocumentLang, emojiText, getLang, onLangChange, setLang, t, type TextKey } from '../shared/i18n';
import { checkLan, waitForConnected } from '../shared/rtc';
import { browserInfo, hasWebRtc, offerLooksValid, runChecks, type Check } from './checks';
import { Sound } from './audio';
import { Receiver } from './receiver';
import { CheckScene } from './scenes/check';
import { MenuScene } from './scenes/menu';
import { SetupScene } from './scenes/setup';
import { TickleScene } from './scenes/tickle';
import { LiveSession, type EndReason } from './session';
import { Stage, type Scene } from './stage';

declare global {
  interface Window {
    __tvStarted?: boolean;
    __tvShowError?: (msg: string) => void;
  }
}

window.__tvStarted = true;
applyDocumentLang();

const root = document.getElementById('app') as HTMLElement;
const browser = browserInfo();
const checks = runChecks();

const PHONE_SETUP_GRACE_MS = 3 * 60 * 1000;
/** Round length; `?round=<seconds>` shortens it for testing. */
const ROUND_SEC = Math.min(300, Math.max(5, Number(new URLSearchParams(location.search).get('round')) || 60));

// Audio may only start after a user gesture; any remote key or click unlocks it.
const sound = new Sound();
document.addEventListener('keydown', () => sound.unlock(), true);
document.addEventListener('click', () => sound.unlock(), true);

let generation = 0;
let receiver: Receiver | null = null;
let disposeLive: (() => void) | null = null;
let onOk: (() => void) | null = null;

/** The pairing screen currently shown (re-rendered when the language changes). */
let pairingView: { session: PairResponse; qrUrl: string; statusKey: TextKey; joined: boolean } | null = null;

function cycleLang(step: number): void {
  const i = LANGS.findIndex((l) => l.id === getLang());
  setLang(LANGS[(i + step + LANGS.length) % LANGS.length].id);
}

document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.keyCode === 13) && onOk) {
    e.preventDefault();
    onOk();
  } else if (pairingView && (e.keyCode === 37 || e.keyCode === 39 || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    // Hebrew and Arabic read right-to-left, so ◀ moves forward there.
    const right = e.keyCode === 39 || e.key === 'ArrowRight';
    cycleLang(right ? 1 : -1);
  }
});

onLangChange(() => {
  if (pairingView) renderPairing();
});

function cleanup(): void {
  onOk = null;
  pairingView = null;
  if (disposeLive) disposeLive();
  disposeLive = null;
  if (receiver) receiver.close();
  receiver = null;
}

function checksRow(list: Check[]): HTMLElement {
  return h(
    'div',
    { class: 'checks', testid: 'checks' },
    h('span', { class: 'checks-title', text: 'TV check: ' }),
    ...list.map((c) =>
      h('span', { class: c.ok ? 'check ok' : 'check bad', text: (c.ok ? '✓ ' : '✗ ') + c.label + (c.detail ? ' (' + c.detail + ')' : '') }),
    ),
    h('div', { class: 'browser', text: browser.name }),
  );
}

function showMessage(title: string, body: string, opts: { action?: string; onAction?: () => void; details?: boolean } = {}): void {
  pairingView = null;
  const button = opts.action
    ? h('button', { class: 'btn', testid: 'action', text: opts.action, on: { click: () => opts.onAction && opts.onAction() } })
    : null;
  mount(
    root,
    h(
      'div',
      { class: 'screen center' },
      h('div', { class: 'message' }, h('h1', { text: title }), h('p', { text: body }), button),
      opts.details ? checksRow(checks) : null,
      opts.details ? h('div', { class: 'ua', text: browser.ua }) : null,
    ),
  );
  onOk = opts.onAction || null;
  if (button) button.focus();
}

function showUnsupported(reason: string): void {
  cleanup();
  showMessage(t('tv.unsupported_title'), reason + ' ' + t('tv.unsupported_body'), {
    details: true,
    action: t('btn.try_again'),
    onAction: () => location.reload(),
  });
}

function languageButtons(): HTMLElement {
  return h(
    'div',
    { class: 'langs', testid: 'langs' },
    ...LANGS.map((l) =>
      h('button', {
        class: l.id === getLang() ? 'lang active' : 'lang',
        text: l.name,
        attrs: { lang: l.id, 'data-lang': l.id },
        on: { click: () => setLang(l.id) },
      }),
    ),
    h('span', { class: 'lang-hint', text: t('tv.language_hint') }),
  );
}

/** Draws the pairing screen from pairingView (QR, code, pictures, status). */
function renderPairing(): void {
  const view = pairingView;
  if (!view) return;
  const { session, qrUrl } = view;
  const qr = h('canvas', { class: 'qr', testid: 'pair-qr', attrs: { 'data-url': qrUrl } });
  try {
    generate(qrUrl).toCanvas(qr, { pad: 2 });
  } catch (_e) {
    qr.className = 'qr hidden';
  }
  const emoji = emojiText(session.emoji);
  const phoneUrl = location.host + '/phone';
  mount(
    root,
    h(
      'div',
      { class: 'screen pairing' },
      languageButtons(),
      h('h1', { class: 'title', text: t('tv.title') }),
      h(
        'div',
        { class: view.joined ? 'pair-row hidden' : 'pair-row' },
        h('div', { class: 'pair-col' }, qr, h('p', { class: 'small', text: t('tv.scan') })),
        h(
          'div',
          { class: 'pair-col' },
          h('p', { class: 'small', text: t('tv.or_open', { url: phoneUrl }), attrs: { dir: 'auto' } }),
          // digits stay left-to-right even inside Hebrew/Arabic text
          h('div', { class: 'code', testid: 'pair-code', text: formatCode(session.code), attrs: { dir: 'ltr' } }),
          h('p', { class: 'small', text: t('tv.phone_will_show') }),
          h('div', { class: 'emoji', testid: 'pair-emoji', text: emoji.symbols }),
          h('div', { class: 'small', testid: 'pair-emoji-names', text: emoji.names }),
        ),
      ),
      h('div', { class: 'status', testid: 'pair-status', text: t(view.statusKey) }),
      checksRow(checks),
    ),
  );
}

function setStatus(key: TextKey): void {
  if (!pairingView) return;
  pairingView.statusKey = key;
  const el = root.querySelector('[data-testid="pair-status"]');
  if (el) el.textContent = t(key);
}

async function createPairing(offer: string, gen: number): Promise<PairResponse | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await apiFetch<PairResponse>('/api/pair', { method: 'POST', body: { offer } });
    } catch (err) {
      if (gen !== generation) return null;
      const e = err as HttpError;
      if (e.status === 0 || e.status >= 500 || e.status === 429) {
        if (e.code === 'storage_not_configured') {
          showMessage(t('tv.setup_needed'), e.message);
          return null;
        }
        showMessage(t('tv.offline'), e.message);
        await sleep(Math.min(30000, 2000 * Math.pow(2, attempt)));
        if (gen !== generation) return null;
        continue;
      }
      throw err;
    }
  }
}

async function startPairing(): Promise<void> {
  cleanup();
  const gen = ++generation;
  showMessage(t('tv.getting_ready'), t('tv.preparing_code'));

  if (!hasWebRtc()) {
    showUnsupported('WebRTC is missing.');
    return;
  }
  let rx: Receiver;
  let offer: string;
  try {
    rx = new Receiver();
    receiver = rx;
    offer = await rx.createOffer();
  } catch (err) {
    showUnsupported('Could not prepare video (' + (err instanceof Error ? err.message : String(err)) + ').');
    return;
  }
  if (!offerLooksValid(offer)) {
    showUnsupported('Video or data channel is not supported.');
    return;
  }

  let pairing: PairResponse | null;
  try {
    pairing = await createPairing(offer, gen);
  } catch (err) {
    showMessage(t('tv.error'), (err as Error).message, { action: t('btn.try_again'), onAction: startPairing });
    return;
  }
  if (!pairing || gen !== generation) return;

  const session = pairing;
  const qrUrl = location.origin + '/phone/#k=' + session.key;
  pairingView = { session, qrUrl, statusKey: 'tv.waiting', joined: false };
  renderPairing();
  let deadline = Date.now() + session.expiresInMs;
  let pollMs = session.pollMs;
  let answer: string | null = null;
  let phoneJoined = false;

  while (answer === null) {
    await sleep(pollMs);
    if (gen !== generation) return;
    if (Date.now() > deadline) break;
    try {
      const res = await apiFetch<TvPollResponse>('/api/session/' + session.sid, { token: session.tvToken });
      if (gen !== generation) return;
      pollMs = Math.max(500, res.pollMs || 1000);
      if (res.state === 'joined' && !phoneJoined) {
        phoneJoined = true;
        // Give the adult time to confirm and allow the camera; OK abandons a stuck phone.
        deadline = Math.max(deadline, Date.now() + PHONE_SETUP_GRACE_MS);
        if (pairingView) pairingView.joined = true;
        const row = root.querySelector('.pair-row');
        if (row) row.className = 'pair-row hidden';
        setStatus('tv.phone_found');
        onOk = () => void startPairing();
      }
      if (res.state === 'answered' && res.answer) answer = res.answer;
    } catch (err) {
      if (gen !== generation) return;
      const e = err as HttpError;
      if (e.status === 404) break;
      pollMs = 3000; // network hiccup: keep trying until the code expires
    }
  }
  if (answer === null) {
    // Tell the server we gave up so a late phone gets a clear "expired" error.
    void apiFetch('/api/session/' + session.sid, { method: 'DELETE', token: session.tvToken, timeoutMs: 4000 }).catch(
      () => undefined,
    );
    cleanup();
    if (phoneJoined) {
      showMessage(t('tv.not_connected_title'), t('tv.not_connected_body'), { action: t('btn.new_code'), onAction: startPairing });
    } else {
      showMessage(t('tv.expired_title'), t('tv.expired_body'), { action: t('btn.new_code'), onAction: startPairing });
    }
    return;
  }

  onOk = null;
  setStatus('tv.connecting');
  try {
    await rx.acceptAnswer(answer);
  } catch (err) {
    cleanup();
    showMessage(t('tv.cannot_connect'), (err as Error).message, { action: t('btn.try_again'), onAction: startPairing });
    return;
  }
  const connected = await waitForConnected(rx.pc, 20000);
  if (gen !== generation) return;
  if (!connected) {
    cleanup();
    showMessage(t('tv.no_route_title'), t('tv.no_route_body'), { action: t('btn.try_again'), onAction: startPairing });
    return;
  }

  // Defense in depth: acceptAnswer already refused non-local addresses. When the
  // browser hides both addresses the result is unknown and the TV continues.
  let lan: boolean | null = null;
  let route = '';
  for (let i = 0; i < 8; i++) {
    const res = await checkLan(rx.pc);
    if (res.pair) {
      route = ' (TV ' + (res.pair.local.address || 'hidden') + ' ← phone ' + (res.pair.remote.address || 'hidden') + ')';
      lan = !res.pair.local.address && !res.pair.remote.address ? null : res.lan;
      if (lan !== false) break;
    }
    await sleep(300);
  }
  if (gen !== generation) return;
  if (lan === false) {
    cleanup();
    showMessage(t('tv.not_lan_title'), t('tv.not_lan_body') + route, { action: t('btn.try_again'), onAction: startPairing });
    return;
  }

  onOk = null;
  pairingView = null;
  disposeLive = startGames(rx, lan, (reason: EndReason) => {
    disposeLive = null;
    cleanup();
    if (reason === 'stopped') {
      showMessage(t('tv.stopped_title'), t('tv.stopped_body'), { action: t('btn.connect_again'), onAction: startPairing });
    } else {
      showMessage(t('tv.lost_title'), t('tv.lost_body'), { action: t('btn.connect_again'), onAction: startPairing });
    }
  });
}

/** Starts the play area once the phone is connected: setup → menu → games. */
function startGames(rx: Receiver, lan: boolean | null, onEnd: (reason: EndReason) => void): () => void {
  const session = new LiveSession(rx, lan);
  const stage = new Stage(root, session, sound);
  let menu: MenuScene | null = null;
  const toMenu = (): Scene => menu as MenuScene;
  menu = new MenuScene(
    stage,
    [{ id: 'tickle-pop', title: 'game.tickle', color: 1, start: () => new TickleScene(stage, toMenu, ROUND_SEC) }],
    () => new CheckScene(stage, toMenu),
  );
  stage.go(new SetupScene(stage, toMenu));
  session.onEnd = (reason) => {
    stage.dispose();
    onEnd(reason);
  };
  return () => {
    stage.dispose();
    session.dispose();
  };
}

void startPairing().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  if (window.__tvShowError) window.__tvShowError(msg);
  showMessage(t('tv.error'), msg, { action: t('btn.try_again'), onAction: () => location.reload(), details: true });
});
