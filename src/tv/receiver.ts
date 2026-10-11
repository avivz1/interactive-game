// TV side of the WebRTC link: creates the offer, receives video + data channels.

import { parseCtl } from '../shared/protocol';
import { RTC_CONFIG, preferH264, waitForIceGathering } from '../shared/rtc';
import { checkRemoteSdp, stripGlobalIPv6 } from '../shared/sdp';

export class Receiver {
  readonly pc: RTCPeerConnection;
  readonly pose: RTCDataChannel;
  readonly ctl: RTCDataChannel;
  readonly codecPreference: string;
  /** True when the engine lacks addTransceiver (Plan B) and the legacy offer option is used. */
  private readonly legacyOffer: boolean;
  stream: MediaStream | null = null;
  onStream: ((stream: MediaStream) => void) | null = null;
  /** Set when the phone said goodbye before the live view took over the channel. */
  byeSeen = false;

  constructor() {
    this.pc = new RTCPeerConnection(RTC_CONFIG);
    let legacy = false;
    let codec = 'default';
    try {
      codec = preferH264(this.pc.addTransceiver('video', { direction: 'recvonly' }));
    } catch (_e) {
      legacy = true;
    }
    this.legacyOffer = legacy;
    this.codecPreference = codec;
    this.pose = this.pc.createDataChannel('pose', { ordered: false, maxRetransmits: 0 });
    this.pose.binaryType = 'arraybuffer';
    this.ctl = this.pc.createDataChannel('ctl', { ordered: true });
    this.ctl.onmessage = (e: MessageEvent) => {
      const msg = parseCtl(e.data);
      if (msg && msg.t === 'bye') this.byeSeen = true;
    };
    this.pc.addEventListener('track', (e: RTCTrackEvent) => {
      const stream = e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]);
      this.stream = stream;
      if (this.onStream) this.onStream(stream);
    });
  }

  async createOffer(): Promise<string> {
    const offer = await this.pc.createOffer(this.legacyOffer ? ({ offerToReceiveVideo: true } as RTCOfferOptions) : undefined);
    await this.pc.setLocalDescription(offer);
    await waitForIceGathering(this.pc, 2500);
    const sdp = this.pc.localDescription ? this.pc.localDescription.sdp : '';
    if (!sdp) throw new Error('No local description');
    return stripGlobalIPv6(sdp);
  }

  /** Applies the phone's answer; refuses answers from devices outside the local network. */
  async acceptAnswer(sdp: string): Promise<void> {
    const checked = checkRemoteSdp(sdp);
    if (!checked.ok) throw new Error('The phone is ' + checked.reason + '.');
    await this.pc.setRemoteDescription({ type: 'answer', sdp: checked.sdp });
  }

  sendCtl(msg: object): void {
    if (this.ctl.readyState === 'open') this.ctl.send(JSON.stringify(msg));
  }

  close(): void {
    try {
      this.pc.close();
    } catch (_e) {
      // already closed
    }
  }
}
