// Phone side of the WebRTC link: answers the TV's offer and sends the camera.

import { RTC_CONFIG, preferH264, waitForIceGathering } from '../shared/rtc';

const MAX_BITRATE = 2_500_000;
const MAX_LONG_SIDE = 960;

export class Sender {
  readonly pc = new RTCPeerConnection(RTC_CONFIG);
  pose: RTCDataChannel | null = null;
  ctl: RTCDataChannel | null = null;
  onCtlMessage: ((data: unknown) => void) | null = null;
  onChannelClose: (() => void) | null = null;
  private transceiver: RTCRtpTransceiver | null = null;

  constructor() {
    this.pc.addEventListener('datachannel', (e: RTCDataChannelEvent) => {
      const ch = e.channel;
      if (ch.label === 'pose') {
        ch.binaryType = 'arraybuffer';
        this.pose = ch;
      } else if (ch.label === 'ctl') {
        this.ctl = ch;
        ch.onmessage = (m) => this.onCtlMessage && this.onCtlMessage(m.data);
        ch.onclose = () => this.onChannelClose && this.onChannelClose();
      }
    });
  }

  async answer(offer: string): Promise<string> {
    await this.pc.setRemoteDescription({ type: 'offer', sdp: offer });
    const tr = this.pc.getTransceivers().find((t) => t.receiver.track && t.receiver.track.kind === 'video');
    if (!tr) throw new Error('The TV did not ask for video.');
    tr.direction = 'sendonly';
    preferH264(tr);
    this.transceiver = tr;
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await waitForIceGathering(this.pc, 2500);
    const sdp = this.pc.localDescription ? this.pc.localDescription.sdp : '';
    if (!sdp) throw new Error('Could not create an answer.');
    return sdp;
  }

  /** Starts (or switches) the video sent to the TV. Call only after the LAN check. */
  async setTrack(track: MediaStreamTrack | null): Promise<void> {
    if (!this.transceiver) throw new Error('Not negotiated');
    const sender = this.transceiver.sender;
    await sender.replaceTrack(track);
    if (!track) return;
    const s = track.getSettings();
    const longSide = Math.max(s.width || 1280, s.height || 720);
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) return;
    params.encodings[0].maxBitrate = MAX_BITRATE;
    params.encodings[0].maxFramerate = 30;
    params.encodings[0].scaleResolutionDownBy = Math.max(1, longSide / MAX_LONG_SIDE);
    try {
      await sender.setParameters(params);
    } catch {
      // keep browser defaults
    }
  }

  channelsOpen(): boolean {
    return !!this.pose && this.pose.readyState === 'open' && !!this.ctl && this.ctl.readyState === 'open';
  }

  async waitForChannels(timeoutMs: number): Promise<boolean> {
    const until = performance.now() + timeoutMs;
    while (!this.channelsOpen()) {
      if (performance.now() > until) return false;
      await new Promise((r) => setTimeout(r, 100));
    }
    return true;
  }

  sendCtl(msg: object): void {
    if (this.ctl && this.ctl.readyState === 'open') this.ctl.send(JSON.stringify(msg));
  }

  close(): void {
    try {
      this.pc.close();
    } catch {
      // already closed
    }
  }
}
