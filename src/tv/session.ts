// The live link to the phone on the TV side: receives video and pose packets,
// keeps the clocks in sync, measures quality, and gives scenes a smoothed body
// aligned with the video frame currently on screen.

import { buildBody, type Body } from '../shared/body';
import { ClockSync } from '../shared/clock';
import { setLang } from '../shared/i18n';
import { PoseSmoother } from '../shared/filter';
import type { Landmark } from '../shared/landmarks';
import type { Rect } from '../shared/mapping';
import { decodePose, parseCtl } from '../shared/protocol';
import { getSelectedPair } from '../shared/rtc';
import { PoseTimeline } from '../shared/sync';
import type { Receiver } from './receiver';

export type EndReason = 'stopped' | 'lost';

export interface SessionStats {
  videoWidth: number;
  videoHeight: number;
  videoFps: number;
  codec: string;
  /** Pose packets per second that contain a body. */
  poseHz: number;
  /** All pose packets per second (with or without a body). */
  packetHz: number;
  phoneFps: number;
  phoneInferMs: number;
  phoneModel: string;
  phoneSource: string;
  rttMs: number | null;
  clockRttMs: number | null;
  delayMs: number;
  frameMetaDelayMs: number | null;
  framesShown: number;
  lan: boolean | null;
  hasVideo: boolean;
  /** Video plays and the control channel answers: this TV can run the games. */
  works: boolean;
  noVideoSeconds: number;
}

/** Phone capture + encode + TV render time not covered by WebRTC stats (rough, tuned on devices later). */
const UNMEASURED_DELAY_MS = 60;
const DEFAULT_DELAY_MS = 150;
const OFFSET_KEY = 'tv.syncOffsetMs';

interface StatsSnapshot {
  at: number;
  framesDecoded: number;
  jitterDelay: number;
  jitterCount: number;
  decodeTime: number;
}

function readOffset(): number {
  try {
    const v = Number(localStorage.getItem(OFFSET_KEY));
    return isFinite(v) ? v : 0;
  } catch (_e) {
    return 0;
  }
}

function writeOffset(v: number): void {
  try {
    localStorage.setItem(OFFSET_KEY, String(v));
  } catch (_e) {
    // storage unavailable
  }
}

type FrameCb = (now: number, meta: { captureTime?: number }) => void;

export class LiveSession {
  readonly video: HTMLVideoElement;
  readonly stats: SessionStats;
  /** Fired once when the phone leaves or the link drops. */
  onEnd: ((reason: EndReason) => void) | null = null;
  /** True while ICE is disconnected (may recover). */
  reconnecting = false;

  private readonly rx: Receiver;
  private readonly timeline = new PoseTimeline();
  private readonly clock = new ClockSync();
  private readonly smoother = new PoseSmoother();
  private userOffset = readOffset();
  private estimateMs = DEFAULT_DELAY_MS;
  private posePackets = 0;
  private poseWithBody = 0;
  private lastHzAt = performance.now();
  private lastPongAt = 0;
  private goodSeconds = 0;
  private prevStats: StatsSnapshot | null = null;
  private lostTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval>;
  private statsTimer: ReturnType<typeof setInterval>;
  private pingId = 0;
  private disposed = false;
  private readonly onIce: () => void;

  constructor(rx: Receiver, lan: boolean | null) {
    this.rx = rx;
    const video = document.createElement('video');
    video.className = 'live-video';
    video.setAttribute('data-testid', 'live-video');
    video.muted = true;
    video.autoplay = true;
    video.setAttribute('playsinline', '');
    this.video = video;
    this.stats = {
      videoWidth: 0,
      videoHeight: 0,
      videoFps: 0,
      codec: '?',
      poseHz: 0,
      packetHz: 0,
      phoneFps: 0,
      phoneInferMs: 0,
      phoneModel: '',
      phoneSource: '?',
      rttMs: null,
      clockRttMs: null,
      delayMs: DEFAULT_DELAY_MS,
      frameMetaDelayMs: null,
      framesShown: 0,
      lan,
      hasVideo: false,
      works: false,
      noVideoSeconds: 0,
    };

    const attach = (stream: MediaStream) => {
      video.srcObject = stream;
      const p = video.play();
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
    };
    if (rx.stream) attach(rx.stream);
    rx.onStream = attach;

    rx.pose.onmessage = (e: MessageEvent) => {
      const pkt = e.data instanceof ArrayBuffer ? decodePose(e.data) : null;
      if (!pkt) return;
      this.posePackets++;
      if (pkt.landmarks) this.poseWithBody++;
      const t = this.clock.toTv(pkt.captureTime);
      if (t !== null) this.timeline.push({ t, landmarks: pkt.landmarks });
    };

    rx.ctl.onmessage = (e: MessageEvent) => {
      const msg = parseCtl(e.data);
      if (!msg) return;
      if (msg.t === 'pong') {
        this.lastPongAt = performance.now();
        this.clock.add(msg.tv, msg.ph, this.lastPongAt);
      } else if (msg.t === 'stats') {
        this.stats.phoneFps = msg.fps;
        this.stats.phoneInferMs = msg.inferMs;
        if (msg.model) this.stats.phoneModel = msg.model;
      } else if (msg.t === 'hello') this.stats.phoneSource = msg.source;
      else if (msg.t === 'lang') setLang(msg.lang);
      else if (msg.t === 'bye') {
        rx.byeSeen = true;
        this.end('stopped');
      }
    };

    const onChannelClose = () => this.end(rx.byeSeen ? 'stopped' : 'lost');
    rx.ctl.onclose = onChannelClose;
    rx.pose.onclose = onChannelClose;
    // The phone may have left before this view started; end asynchronously.
    if (rx.byeSeen || rx.ctl.readyState === 'closing' || rx.ctl.readyState === 'closed') setTimeout(onChannelClose, 0);

    this.onIce = () => {
      const s = rx.pc.iceConnectionState;
      if (s === 'failed' || s === 'closed') this.end('lost');
      else if (s === 'disconnected') {
        this.reconnecting = true;
        if (!this.lostTimer) this.lostTimer = setTimeout(() => this.end('lost'), 10000);
      } else if (s === 'connected' || s === 'completed') {
        this.reconnecting = false;
        if (this.lostTimer) clearTimeout(this.lostTimer);
        this.lostTimer = null;
      }
    };
    rx.pc.addEventListener('iceconnectionstatechange', this.onIce);

    const ping = () => rx.sendCtl({ t: 'ping', id: ++this.pingId, tv: performance.now() });
    this.pingTimer = setInterval(() => {
      ping();
      if (this.pingId >= 5) {
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(ping, 2000);
      }
    }, 200);

    const vfc = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: FrameCb) => number };
    if (typeof vfc.requestVideoFrameCallback === 'function') {
      const onFrame: FrameCb = (now, meta) => {
        if (this.disposed) return;
        this.stats.framesShown++;
        if (typeof meta.captureTime === 'number' && meta.captureTime > 0) this.stats.frameMetaDelayMs = now - meta.captureTime;
        vfc.requestVideoFrameCallback!(onFrame);
      };
      vfc.requestVideoFrameCallback(onFrame);
    }

    this.statsTimer = setInterval(() => void this.collectStats(), 1000);
  }

  /**
   * The body as it was when the on-screen video frame was captured: smoothed
   * normalized landmarks plus the same body in screen pixels. Call once per frame.
   */
  sample(now: number, rect: Rect): { landmarks: (Landmark | null)[]; body: Body } {
    const t = now - (this.estimateMs + this.userOffset);
    const landmarks = this.smoother.update(this.timeline.sampleAt(t), t);
    return { landmarks, body: buildBody(landmarks, rect, true) };
  }

  get syncOffset(): number {
    return this.userOffset;
  }

  /** Shifts the overlay timing (remote ←/→ in the TV check screen). */
  adjustSyncOffset(deltaMs: number): void {
    this.userOffset += deltaMs;
    writeOffset(this.userOffset);
  }

  private end(reason: EndReason): void {
    if (this.disposed) return;
    const cb = this.onEnd;
    this.dispose();
    if (cb) cb(reason);
  }

  private async collectStats(): Promise<void> {
    let report: RTCStatsReport;
    try {
      report = await this.rx.pc.getStats();
    } catch (_e) {
      return;
    }
    if (this.disposed) return;
    const st = this.stats;
    const byId: Record<string, Record<string, unknown>> = {};
    const all: Record<string, unknown>[] = [];
    report.forEach((r: Record<string, unknown>) => {
      byId[String(r.id)] = r;
      all.push(r);
    });
    const inbound = all.filter((r) => r.type === 'inbound-rtp' && (r.kind === 'video' || r.mediaType === 'video'))[0];
    const now = performance.now();
    if (inbound) {
      const num = (k: string) => (typeof inbound[k] === 'number' ? (inbound[k] as number) : 0);
      const snap: StatsSnapshot = {
        at: now,
        framesDecoded: num('framesDecoded'),
        jitterDelay: num('jitterBufferDelay'),
        jitterCount: num('jitterBufferEmittedCount'),
        decodeTime: num('totalDecodeTime'),
      };
      const prev = this.prevStats;
      if (prev) {
        const dt = (snap.at - prev.at) / 1000;
        const frames = snap.framesDecoded - prev.framesDecoded;
        st.videoFps = dt > 0 ? frames / dt : 0;
        const jc = snap.jitterCount - prev.jitterCount;
        const jitterMs = jc > 0 ? ((snap.jitterDelay - prev.jitterDelay) / jc) * 1000 : 0;
        const decodeMs = frames > 0 ? ((snap.decodeTime - prev.decodeTime) / frames) * 1000 : 0;
        // Old engines lack these counters; keep the default estimate there.
        if (jc > 0) this.estimateMs = jitterMs + decodeMs + (st.rttMs !== null ? st.rttMs / 2 : 5) + UNMEASURED_DELAY_MS;
      }
      this.prevStats = snap;
      const c = typeof inbound.codecId === 'string' ? byId[inbound.codecId] : undefined;
      if (c && typeof c.mimeType === 'string') st.codec = c.mimeType.replace('video/', '');
    }
    try {
      const pair = await getSelectedPair(this.rx.pc);
      if (pair && pair.rttMs !== null) st.rttMs = pair.rttMs;
    } catch (_e) {
      // stats unavailable
    }
    if (this.disposed) return;

    const elapsed = (now - this.lastHzAt) / 1000;
    st.poseHz = elapsed > 0 ? this.poseWithBody / elapsed : 0;
    st.packetHz = elapsed > 0 ? this.posePackets / elapsed : 0;
    this.posePackets = 0;
    this.poseWithBody = 0;
    this.lastHzAt = now;

    st.videoWidth = this.video.videoWidth;
    st.videoHeight = this.video.videoHeight;
    st.clockRttMs = this.clock.rtt;
    st.delayMs = this.estimateMs + this.userOffset;
    st.hasVideo = this.video.videoWidth > 0 && st.videoFps > 5;
    const dataOk = now - this.lastPongAt < 5000;
    this.goodSeconds = st.hasVideo && dataOk ? this.goodSeconds + 1 : 0;
    if (this.goodSeconds >= 2) st.works = true;
    st.noVideoSeconds = st.hasVideo ? 0 : st.noVideoSeconds + 1;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.pingTimer);
    clearInterval(this.statsTimer);
    if (this.lostTimer) clearTimeout(this.lostTimer);
    const rx = this.rx;
    rx.pc.removeEventListener('iceconnectionstatechange', this.onIce);
    rx.onStream = null;
    rx.pose.onmessage = null;
    rx.ctl.onmessage = null;
    rx.pose.onclose = null;
    rx.ctl.onclose = null;
    this.video.srcObject = null;
    this.onEnd = null;
  }
}
