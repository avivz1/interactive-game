// Phone app: joins the TV with a code (or QR link), confirms it is the right TV,
// then streams the camera and body tracking to the TV over the home Wi-Fi.

import { emojiText, type JoinResponse } from '../shared/api';
import { h, mount } from '../shared/dom';
import { HttpError, apiFetch, sleep } from '../shared/http';
import { encodePose, parseCtl } from '../shared/protocol';
import { checkLan, waitForConnected, type SelectedPair } from '../shared/rtc';
import { ScreenWakeLock, cameraErrorMessage, openCamera, type Facing } from './camera';
import { MediaPipePose, SyntheticPose, type PoseSource } from './pose';
import { Sender } from './sender';

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

function inAppBrowser(): boolean {
  return /FBAN|FBAV|Instagram|Line\/|; wv\)|GSA\//.test(navigator.userAgent);
}

function screen(...children: (Node | null)[]): void {
  mount(root, h('main', { class: 'phone' }, ...children.filter((c): c is Node => c !== null)));
}

function errorText(err: unknown): string {
  return err instanceof HttpError || err instanceof Error ? err.message : String(err);
}

function showHome(error?: string): void {
  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    screen(
      h('h1', { text: 'Camera not available' }),
      h('p', {
        text: inAppBrowser()
          ? 'This app opened inside another app. Open the link in Chrome or Safari instead.'
          : 'Open this page in Chrome or Safari using the https:// link.',
      }),
    );
    return;
  }
  const input = h('input', {
    class: 'code-input',
    testid: 'code-input',
    attrs: { inputmode: 'numeric', autocomplete: 'off', maxlength: '7', placeholder: '123 456', 'aria-label': 'TV code' },
  });
  const submit = (e: Event) => {
    e.preventDefault();
    void join({ code: input.value });
  };
  screen(
    h('h1', { text: 'Connect to the TV 📺' }),
    h('p', { text: 'Open this game on the TV and type the code it shows.' }),
    inAppBrowser() ? h('p', { class: 'warn', text: 'Tip: for the camera to work, open this link in Chrome or Safari.' }) : null,
    h(
      'form',
      { on: { submit } },
      input,
      h('button', { class: 'btn primary', testid: 'join', text: 'Connect', attrs: { type: 'submit' } }),
    ),
    error ? h('p', { class: 'error', testid: 'error', text: error }) : null,
  );
  input.focus();
}

async function join(body: { code?: string; key?: string }): Promise<void> {
  screen(h('h1', { text: 'Finding the TV…' }));
  try {
    const session = await apiFetch<JoinResponse>('/api/join', { method: 'POST', body });
    showConfirm(session);
  } catch (err) {
    showHome(errorText(err));
  }
}

function showConfirm(session: JoinResponse): void {
  const emoji = emojiText(session.emoji);
  screen(
    h('h1', { text: 'Is this your TV?' }),
    h('p', { text: 'The TV should show:' }),
    h('div', { class: 'emoji', testid: 'confirm-emoji', text: emoji.symbols }),
    h('p', { class: 'small', testid: 'confirm-emoji-names', text: emoji.names }),
    h(
      'div',
      { class: 'note' },
      h('p', { text: '🔒 The camera video goes straight to your TV over your home Wi-Fi. It is not uploaded or recorded.' }),
      h('p', { text: '📐 Stand the phone sideways, 2–3 meters from the play area, with the back camera facing the child.' }),
    ),
    h('button', { class: 'btn primary', testid: 'confirm-yes', text: 'Yes — start the camera', on: { click: () => void start(session) } }),
    h('button', {
      class: 'btn',
      testid: 'confirm-no',
      text: 'No, that’s not my TV',
      on: {
        click: () => {
          void closeRemote(session);
          showHome('Cancelled. Check the code on your TV and try again.');
        },
      },
    }),
  );
}

async function closeRemote(session: JoinResponse): Promise<void> {
  try {
    await apiFetch('/api/session/' + session.sid, { method: 'DELETE', token: session.phoneToken, timeoutMs: 4000 });
  } catch {
    // the record may already be gone; it expires on its own anyway
  }
}

function showFailure(message: string): void {
  screen(
    h('h1', { text: 'Not connected' }),
    h('p', { class: 'error', testid: 'error', text: message }),
    h('button', { class: 'btn primary', text: 'Try again', on: { click: () => location.replace('/phone/') } }),
  );
}

async function start(session: JoinResponse): Promise<void> {
  screen(h('h1', { text: 'Starting the camera…' }));
  let stream: MediaStream;
  try {
    stream = await openCamera('environment');
  } catch (err) {
    void closeRemote(session);
    showFailure(cameraErrorMessage(err));
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
    showFailure(errorText(err));
    return;
  }

  screen(h('h1', { text: 'Connecting to the TV…' }), video);
  const connected = await waitForConnected(sender.pc, 20000);
  if (live !== state) return;
  if (!connected) {
    stopLive(false);
    showFailure('Could not reach the TV. Make sure the phone and the TV are on the same Wi-Fi network.');
    return;
  }

  // Safety: send camera frames only to a TV on the local network.
  let lan: boolean | null = null;
  let route = 'route unknown';
  for (let i = 0; i < 10 && lan === null; i++) {
    const res = await checkLan(sender.pc);
    if (res.pair) {
      lan = res.lan;
      route = describePair(res.pair);
    } else await sleep(300);
  }
  if (live !== state) return;
  if (lan !== true) {
    stopLive(true);
    showFailure('For safety, the camera only works when the phone and the TV are on the same home Wi-Fi. (' + route + ')');
    return;
  }

  try {
    await sender.setTrack(stream.getVideoTracks()[0]);
  } catch (err) {
    stopLive(true);
    showFailure(errorText(err));
    return;
  }
  void wakeLock.acquire();

  sender.onCtlMessage = (data) => {
    const msg = parseCtl(data);
    if (msg && msg.t === 'ping') sender.sendCtl({ t: 'pong', id: msg.id, tv: msg.tv, ph: performance.now() });
  };
  sender.onChannelClose = () => {
    if (live === state && !state.ended) {
      stopLive(false);
      showFailure('The TV disconnected.');
    }
  };
  sender.pc.addEventListener('iceconnectionstatechange', () => {
    const s = sender.pc.iceConnectionState;
    if ((s === 'failed' || s === 'closed') && live === state && !state.ended) {
      stopLive(false);
      showFailure('Lost the connection to the TV.');
    }
  });

  showLive(state);
  await sender.waitForChannels(5000);
  if (live !== state) return;
  sendHello(state);
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

async function startTracking(state: Live): Promise<void> {
  const pose: PoseSource = synthetic ? new SyntheticPose() : new MediaPipePose();
  state.pose = pose;
  let seq = 0;
  const status = document.getElementById('track-status');
  try {
    if (status) status.textContent = 'Loading body tracking…';
    await pose.start(state.video, (landmarks, captureTime) => {
      const ch = state.sender.pose;
      if (!ch || ch.readyState !== 'open' || ch.bufferedAmount > 8192) return;
      ch.send(encodePose(seq++, captureTime, landmarks));
    });
  } catch (err) {
    if (status) status.textContent = 'Body tracking failed to start: ' + errorText(err);
    return;
  }
  if (live !== state) {
    pose.stop();
    return;
  }
  state.timers.push(
    setInterval(() => {
      state.sender.sendCtl({ t: 'stats', fps: pose.fps, inferMs: pose.inferMs });
      if (status) {
        status.textContent =
          'Tracking ' + pose.fps.toFixed(0) + ' fps' + (pose.inferMs ? ' · ' + pose.inferMs.toFixed(0) + ' ms' : '');
      }
    }, 2000),
  );
}

function showLive(state: Live): void {
  const flip = async () => {
    const facing: Facing = state.facing === 'environment' ? 'user' : 'environment';
    try {
      const next = await openCamera(facing);
      await state.sender.setTrack(next.getVideoTracks()[0]);
      state.stream.getTracks().forEach((t) => t.stop());
      state.stream = next;
      state.facing = facing;
      state.video.srcObject = next;
      void state.video.play().catch(() => undefined);
      sendHello(state);
    } catch (err) {
      const status = document.getElementById('track-status');
      if (status) status.textContent = cameraErrorMessage(err);
    }
  };
  screen(
    h('h1', { testid: 'live', text: '📷 Camera is on' }),
    h('p', { text: 'Look at the TV! Keep this phone still and plugged in.' }),
    state.video,
    h('p', { class: 'small', id: 'track-status', text: 'Starting…' }),
    h('button', { class: 'btn', text: 'Switch camera', on: { click: () => void flip() } }),
    h('button', {
      class: 'btn danger',
      testid: 'stop',
      text: 'Stop',
      on: {
        click: () => {
          stopLive(true);
          screen(
            h('h1', { text: 'Stopped' }),
            h('p', { text: 'The camera is off.' }),
            h('button', { class: 'btn primary', text: 'Connect again', on: { click: () => location.replace('/phone/') } }),
          );
        },
      },
    }),
  );
}

function stopLive(notifyTv: boolean): void {
  const state = live;
  if (!state || state.ended) return;
  state.ended = true;
  live = null;
  if (notifyTv) state.sender.sendCtl({ t: 'bye' });
  state.timers.forEach((t) => clearInterval(t));
  if (state.pose) state.pose.stop();
  state.stream.getTracks().forEach((t) => t.stop());
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
    .then(async (next) => {
      if (live !== state) {
        next.getTracks().forEach((t) => t.stop());
        return;
      }
      await state.sender.setTrack(next.getVideoTracks()[0]);
      state.stream = next;
      state.video.srcObject = next;
      void state.video.play().catch(() => undefined);
    })
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
