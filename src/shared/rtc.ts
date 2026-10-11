// WebRTC helpers shared by the TV (offerer, receive-only) and the phone (answerer, send-only).
// Only APIs available in Chromium 69+ and Safari 15+ are used.

import { isLanPair, type CandidateInfo } from './lan';

/**
 * No STUN/TURN: connections are only possible inside the local network.
 * sdpSemantics: Chromium 69-71 (2020 Samsung TVs) default to Plan B, where
 * addTransceiver throws; newer browsers accept or ignore the key.
 */
export const RTC_CONFIG = { iceServers: [], sdpSemantics: 'unified-plan' } as RTCConfiguration;

/** Resolves when ICE gathering completes or after timeoutMs (non-trickle signaling). */
export function waitForIceGathering(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

/** Moves H.264 to the front of the codec list (TVs usually decode it in hardware). */
export function preferH264(transceiver: RTCRtpTransceiver): 'h264' | 'default' {
  try {
    const caps = typeof RTCRtpReceiver !== 'undefined' && RTCRtpReceiver.getCapabilities
      ? RTCRtpReceiver.getCapabilities('video')
      : null;
    if (!caps || typeof transceiver.setCodecPreferences !== 'function') return 'default';
    const h264 = caps.codecs.filter((c) => c.mimeType.toLowerCase() === 'video/h264');
    if (h264.length === 0) return 'default';
    const rank = (c: RTCRtpCodec): number => {
      const fmtp = c.sdpFmtpLine || '';
      let r = 0;
      if (fmtp.indexOf('packetization-mode=1') >= 0) r -= 2;
      if (fmtp.indexOf('profile-level-id=42e01f') >= 0) r -= 1;
      return r;
    };
    h264.sort((a, b) => rank(a) - rank(b));
    const others = caps.codecs.filter((c) => c.mimeType.toLowerCase() !== 'video/h264');
    transceiver.setCodecPreferences(h264.concat(others));
    return 'h264';
  } catch (_e) {
    return 'default';
  }
}

interface StatsLike {
  type: string;
  id: string;
  [key: string]: unknown;
}

function statsList(report: RTCStatsReport): StatsLike[] {
  const out: StatsLike[] = [];
  report.forEach((r: StatsLike) => out.push(r));
  return out;
}

function candidateInfo(r: StatsLike | undefined): CandidateInfo | null {
  if (!r) return null;
  const address = typeof r.address === 'string' ? r.address : typeof r.ip === 'string' ? r.ip : '';
  const candidateType = typeof r.candidateType === 'string' ? r.candidateType : '';
  return { address, candidateType };
}

export interface SelectedPair {
  local: CandidateInfo;
  remote: CandidateInfo;
  rttMs: number | null;
}

export async function getSelectedPair(pc: RTCPeerConnection): Promise<SelectedPair | null> {
  const list = statsList(await pc.getStats());
  const byId: Record<string, StatsLike> = {};
  for (const r of list) byId[r.id] = r;
  let pair: StatsLike | undefined;
  for (const r of list) {
    if (r.type === 'transport' && typeof r.selectedCandidatePairId === 'string') {
      pair = byId[r.selectedCandidatePairId];
      break;
    }
  }
  if (!pair) {
    for (const r of list) {
      if (r.type === 'candidate-pair' && (r.selected === true || (r.nominated === true && r.state === 'succeeded'))) {
        pair = r;
        break;
      }
    }
  }
  if (!pair) return null;
  const local = candidateInfo(byId[String(pair.localCandidateId)]);
  const remote = candidateInfo(byId[String(pair.remoteCandidateId)]);
  if (!local || !remote) return null;
  const rtt = typeof pair.currentRoundTripTime === 'number' ? pair.currentRoundTripTime * 1000 : null;
  return { local, remote, rttMs: rtt };
}

export async function checkLan(pc: RTCPeerConnection): Promise<{ lan: boolean; pair: SelectedPair | null }> {
  const pair = await getSelectedPair(pc);
  return { lan: pair ? isLanPair(pair.local, pair.remote) : false, pair };
}

/** Resolves true once ICE connects, false on failure or timeout. */
export function waitForConnected(pc: RTCPeerConnection, timeoutMs: number): Promise<boolean> {
  const ok = () => pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed';
  if (ok()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (v: boolean) => {
      clearTimeout(timer);
      pc.removeEventListener('iceconnectionstatechange', onChange);
      resolve(v);
    };
    const onChange = () => {
      if (ok()) finish(true);
      else if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') finish(false);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    pc.addEventListener('iceconnectionstatechange', onChange);
  });
}
