// Phone app: joins the TV with a code (or QR link), confirms it is the right TV,
// then streams the camera and body tracking to the TV over the home Wi-Fi.
// The language chosen here (Hebrew by default) is also sent to the TV.

import type { JoinResponse } from '../shared/api';
import { h, mount } from '../shared/dom';
import { HttpError, apiFetch, sleep } from '../shared/http';
import { LANGS, apiErrorText, applyDocumentLang, emojiText, getLang, onLangChange, setLang, t } from '../shared/i18n';
import { encodePose, parseCtl } from '../shared/protocol';
import { checkLan, waitForConnected, type SelectedPair } from '../shared/rtc';
import { viewHint } from '../games/fit';
import { ScreenWakeLock, cameraErrorMessage, openCamera, type Facing } from './camera';
import type { Landmark } from '../shared/landmarks';
import { MediaPipePose, SyntheticPose, syntheticArmsUp, syntheticDancer, syntheticDrawer, syntheticStill, syntheticSweeper, syntheticSwiper, type PoseSource } from './pose';
import { NotLocalError, Sender } from './sender';

const root = document.getElementById('app') as HTMLElement;
const synthetic = new URLSearchParams(location.search).get('pose') === 'synthetic';
const wakeLock = new ScreenWakeLock();

interface Live {
  session: JoinResponse;
  sender: Sender;
  stream: MediaStream;
  video: HTMLVideoElement;
  pose: PoseSource | null;
  facing: Facing;
  timers: ReturnType<typeof setInterval>[];
  ended: boolean;
}

let live: Live | null = null;
/** Redraws the current screen (used when the language changes). */
let rerender: () => void = () => undefined;

applyDocumentLang();
onLangChange((lang) => {
  rerender();
  if (live) live.sender.sendCtl({ t: 'lang', lang });
});

function inAppBrowser(): boolean {
  return /FBAN|FBAV|Instagram|Line\/|; wv\)|GSA\//.test(navigator.userAgent);
}

function langBar(): HTMLElement {
  return h(
    'div',
    { class: 'langs', testid: 'langs' },
    ...LANGS.map((l) =>
      h('button', {
        class: l.id === getLang() ? 'lang active' : 'lang',
        text: l.name,
        attrs: { lang: l.id, 'data-lang': l.id, type: 'button' },
        on: { click: () => setLang(l.id) },
      }),
    ),
  );
}

/** Shows a screen; `draw` is called again whenever the language changes. */
function show(draw: () => (Node | null)[]): void {
  rerender = () => mount(root, h('main', { class: 'phone' }, langBar(), ...draw().filter((c): c is Node => c !== null)));
  rerender();
}

/** Turns any error into a message in the current language. */
function errorText(err: unknown): string {
  if (err instanceof HttpError) return apiErrorText(err.code, err.message);
  if (err instanceof NotLocalError) return t('ph.not_lan');
  return err instanceof Error ? err.message : String(err);
}

function showHome(error?: () => string): void {
  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    show(() => [h('h1', { text: t('ph.no_camera_title') }), h('p', { text: inAppBrowser() ? t('ph.in_app') : t('ph.open_https') })]);
    return;
  }
  let typed = '';
  show(() => {
    const input = h('input', {
      class: 'code-input',
      testid: 'code-input',
      attrs: { inputmode: 'numeric', autocomplete: 'off', maxlength: '7', placeholder: '123 456', 'aria-label': 'TV code', dir: 'ltr' },
      on: { input: () => (typed = input.value) },
    });
    input.value = typed;
    const submit = (e: Event) => {
      e.preventDefault();
      void join({ code: input.value });
    };
    setTimeout(() => input.focus(), 0);
    return [
      h('h1', { text: t('ph.connect_title') }),
      h('p', { text: t('ph.connect_body') }),
      inAppBrowser() ? h('p', { class: 'warn', text: t('ph.in_app_tip') }) : null,
      h('form', { on: { submit } }, input, h('button', { class: 'btn primary', testid: 'join', text: t('ph.connect'), attrs: { type: 'submit' } })),
      error ? h('p', { class: 'error', testid: 'error', text: error() }) : null,
    ];
  });
}

async function join(body: { code?: string; key?: string }): Promise<void> {
  show(() => [h('h1', { text: t('ph.finding') })]);
  try {
    const session = await apiFetch<JoinResponse>('/api/join', { method: 'POST', body });
    showConfirm(session);
  } catch (err) {
    showHome(() => errorText(err));
  }
}

function showConfirm(session: JoinResponse): void {
  show(() => {
    const emoji = emojiText(session.emoji);
    return [
      h('h1', { text: t('ph.confirm_title') }),
      h('p', { text: t('ph.tv_should_show') }),
      h('div', { class: 'emoji', testid: 'confirm-emoji', text: emoji.symbols }),
      h('p', { class: 'small', testid: 'confirm-emoji-names', text: emoji.names }),
      h('div', { class: 'note' }, h('p', { text: t('ph.privacy') }), h('p', { text: t('ph.placement') })),
      h('button', { class: 'btn primary', testid: 'confirm-yes', text: t('ph.yes'), on: { click: () => void start(session) } }),
      h('button', {
        class: 'btn',
        testid: 'confirm-no',
        text: t('ph.no'),
        on: {
          click: () => {
            void closeRemote(session);
            showHome(() => t('ph.cancelled'));
          },
        },
      }),
    ];
  });
}

async function closeRemote(session: JoinResponse): Promise<void> {
  try {
    await apiFetch('/api/session/' + session.sid, { method: 'DELETE', token: session.phoneToken, timeoutMs: 4000 });
  } catch {
    // the record may already be gone; it expires on its own anyway
  }
}

function showFailure(message: () => string): void {
  show(() => [
    h('h1', { text: t('ph.not_connected') }),
    h('p', { class: 'error', testid: 'error', text: message() }),
    h('button', { class: 'btn primary', text: t('btn.try_again'), on: { click: () => location.replace('/phone/') } }),
  ]);
}

function onCellular(): boolean {
  const conn = (navigator as Navigator & { connection?: { type?: string } }).connection;
  return !!conn && conn.type === 'cellular';
}

async function start(session: JoinResponse): Promise<void> {
  if (onCellular()) {
    void closeRemote(session);
    showFailure(() => t('ph.cellular'));
    return;
  }
  show(() => [h('h1', { text: t('ph.starting_camera') })]);
  let stream: MediaStream;
  try {
    stream = await openCamera('environment');
  } catch (err) {
    void closeRemote(session);
    showFailure(() => cameraErrorMessage(err));
    return;
  }

  const video = h('video', { class: 'preview', testid: 'preview' });
  video.muted = true;
  video.setAttribute('playsinline', '');
  video.srcObject = stream;
  void video.play().catch(() => undefined);

  const sender = new Sender();
  const state: Live = { session, sender, stream, video, pose: null, facing: 'environment', timers: [], ended: false };
  live = state;

  try {
    const answer = await sender.answer(session.offer);
    await apiFetch('/api/session/' + session.sid + '/answer', { method: 'POST', body: { answer }, token: session.phoneToken });
  } catch (err) {
    stopLive(false);
    showFailure(() => errorText(err));
    return;
  }

  show(() => [h('h1', { text: t('ph.connecting_tv') }), video]);
  const connected = await waitForConnected(sender.pc, 20000);
  if (live !== state) return;
  if (!connected) {
    stopLive(false);
    showFailure(() => t('ph.no_route'));
    return;
  }

  // Safety: send camera frames only to a TV on the local network.
  let lan: boolean | null = null;
  let route = 'route unknown';
  for (let i = 0; i < 10; i++) {
    const res = await checkLan(sender.pc);
    if (res.pair) {
      lan = res.lan;
      route = describePair(res.pair);
      if (lan) break;
    }
    await sleep(300);
  }
  if (live !== state) return;
  if (lan !== true) {
    stopLive(true);
    showFailure(() => t('ph.not_lan') + ' (' + route + ')');
    return;
  }

  try {
    await sender.setTrack(stream.getVideoTracks()[0]);
  } catch (err) {
    if (live !== state) return;
    stopLive(true);
    showFailure(() => errorText(err));
    return;
  }
  if (live !== state) return;
  void wakeLock.acquire();

  sender.onCtlMessage = (data) => {
    const msg = parseCtl(data);
    if (msg && msg.t === 'ping') sender.sendCtl({ t: 'pong', id: msg.id, tv: msg.tv, ph: performance.now() });
  };
  sender.onChannelClose = () => {
    if (live === state && !state.ended) {
      stopLive(false);
      showFailure(() => t('ph.tv_left'));
    }
  };
  sender.pc.addEventListener('iceconnectionstatechange', () => {
    const s = sender.pc.iceConnectionState;
    if ((s === 'failed' || s === 'closed') && live === state && !state.ended) {
      stopLive(false);
      showFailure(() => t('ph.lost'));
    }
  });

  showLive(state);
  const channelsOpen = await sender.waitForChannels(8000);
  if (live !== state) return;
  if (!channelsOpen) {
    stopLive(false);
    showFailure(() => t('ph.no_route'));
    return;
  }
  sendHello(state);
  sender.sendCtl({ t: 'lang', lang: getLang() });
  await startTracking(state);
}

function describePair(pair: SelectedPair): string {
  const side = (c: SelectedPair['local']) => c.candidateType + ' ' + (c.address || 'hidden');
  return 'phone ' + side(pair.local) + ' → TV ' + side(pair.remote);
}

function sendHello(state: Live): void {
  const s = state.stream.getVideoTracks()[0]?.getSettings() ?? {};
  state.sender.sendCtl({
    t: 'hello',
    v: 1,
    width: s.width ?? state.video.videoWidth,
    height: s.height ?? state.video.videoHeight,
    facing: state.facing,
    source: synthetic ? 'synthetic' : 'mediapipe',
  });
}

/** Status line on the live screen, kept across language re-renders. */
let trackStatus: () => string = () => t('ph.starting');

function setTrackStatus(text: () => string): void {
  trackStatus = text;
  const el = document.getElementById('track-status');
  if (el) el.textContent = text();
}

async function startTracking(state: Live): Promise<void> {
  const act = new URLSearchParams(location.search).get('act');
  const figures: Record<string, (tSec: number) => Landmark[]> = { draw: syntheticDrawer, still: syntheticStill, dance: syntheticDancer, armsup: syntheticArmsUp, sweep: syntheticSweeper, swipe: syntheticSwiper };
  const figure = act ? figures[act] : undefined;
  const pose: PoseSource = synthetic ? new SyntheticPose(figure) : new MediaPipePose();
  state.pose = pose;
  let seq = 0;
  // what the camera sees, for the set-up hint (nobody there, head or hands cut off)
  let lastPose: Landmark[] | null = null;
  let lastBodyAt = 0;
  try {
    setTrackStatus(() => t('ph.loading_tracking'));
    await pose.start(state.video, (landmarks, captureTime) => {
      if (landmarks) {
        lastPose = landmarks;
        lastBodyAt = performance.now();
      }
      const ch = state.sender.pose;
      if (!ch || ch.readyState !== 'open' || ch.bufferedAmount > 8192) return;
      ch.send(encodePose(seq++, captureTime, landmarks));
    });
  } catch (err) {
    setTrackStatus(() => t('ph.tracking_failed', { msg: errorText(err) }));
    return;
  }
  if (live !== state) {
    pose.stop();
    return;
  }
  state.timers.push(
    setInterval(() => {
      state.sender.sendCtl({ t: 'stats', fps: pose.fps, inferMs: pose.inferMs, model: pose.model });
      const fps = pose.fps.toFixed(0);
      const ms = pose.inferMs ? ' · ' + pose.inferMs.toFixed(0) + ' ms' : '';
      const hint = viewHint(lastPose, performance.now() - lastBodyAt);
      const upright = state.video.videoHeight > state.video.videoWidth;
      setTrackStatus(() => {
        const lines = [t('ph.tracking', { fps }) + ms + ' · ' + pose.model];
        if (hint) lines.unshift(t(hint === 'no-one' ? 'ph.no_one' : 'ph.cut'));
        if (upright) lines.push(t('ph.sideways'));
        return lines.join(' · ');
      });
    }, 2000),
  );
}

const stopStream = (s: MediaStream) => s.getTracks().forEach((t) => t.stop());

/** Replaces the camera; returns false (and releases `next`) if the session ended meanwhile. */
async function useStream(state: Live, next: MediaStream, facing: Facing): Promise<boolean> {
  if (live !== state) {
    stopStream(next);
    return false;
  }
  try {
    await state.sender.setTrack(next.getVideoTracks()[0]);
  } catch (err) {
    stopStream(next);
    throw err;
  }
  if (live !== state) {
    stopStream(next);
    return false;
  }
  state.stream = next;
  state.facing = facing;
  state.video.srcObject = next;
  void state.video.play().catch(() => undefined);
  return true;
}

function showLive(state: Live): void {
  let switching = false;
  const flip = async () => {
    if (switching || live !== state) return;
    switching = true;
    const previous = state.facing;
    const facing: Facing = previous === 'environment' ? 'user' : 'environment';
    // Many Android phones cannot open two cameras at once: release the current one first.
    stopStream(state.stream);
    try {
      if (await useStream(state, await openCamera(facing), facing)) sendHello(state);
    } catch (err) {
      setTrackStatus(() => cameraErrorMessage(err));
      try {
        await useStream(state, await openCamera(previous), previous);
      } catch {
        // camera unavailable; the TV shows no video until the next restart
      }
    } finally {
      switching = false;
    }
  };
  show(() => [
    h('h1', { testid: 'live', text: t('ph.live_title') }),
    h('p', { text: t('ph.live_body') }),
    state.video,
    h('p', { class: 'small', id: 'track-status', text: trackStatus() }),
    h('button', { class: 'btn', text: t('ph.switch_camera'), on: { click: () => void flip() } }),
    h('button', {
      class: 'btn danger',
      testid: 'stop',
      text: t('ph.stop'),
      on: {
        click: () => {
          stopLive(true);
          show(() => [
            h('h1', { text: t('ph.stopped_title') }),
            h('p', { text: t('ph.stopped_body') }),
            h('button', { class: 'btn primary', text: t('btn.connect_again'), on: { click: () => location.replace('/phone/') } }),
          ]);
        },
      },
    }),
  ]);
  // re-mounting moves the <video> element, which pauses it on some browsers
  void state.video.play().catch(() => undefined);
}

function stopLive(notifyTv: boolean): void {
  const state = live;
  if (!state || state.ended) return;
  state.ended = true;
  live = null;
  if (notifyTv) state.sender.sendCtl({ t: 'bye' });
  state.timers.forEach((t) => clearInterval(t));
  if (state.pose) state.pose.stop();
  stopStream(state.stream);
  state.video.srcObject = null;
  // Give the 'bye' message a moment to leave before closing.
  setTimeout(() => state.sender.close(), notifyTv ? 300 : 0);
  wakeLock.release();
  void closeRemote(state.session);
}

// Phones may stop the camera while the page is in the background; restart it on return.
document.addEventListener('visibilitychange', () => {
  const state = live;
  if (!state || document.visibilityState !== 'visible') return;
  const track = state.stream.getVideoTracks()[0];
  if (track && track.readyState === 'live') return;
  void openCamera(state.facing)
    .then((next) => useStream(state, next, state.facing))
    .catch(() => undefined);
});

window.addEventListener('pagehide', () => stopLive(true));

const keyMatch = /(?:^#|&)k=([A-Za-z0-9_-]{22})/.exec(location.hash);
if (keyMatch) {
  // The QR link is single-use; drop it from the address bar so a reload doesn't retry it.
  history.replaceState(null, '', location.pathname + location.search);
  void join({ key: keyMatch[1] });
} else {
  showHome();
}
