// TV side of the WebRTC link: creates the offer, receives video + data channels.

import { RTC_CONFIG, preferH264, waitForIceGathering } from '../shared/rtc';

export class Receiver {
  readonly pc: RTCPeerConnection;
  readonly pose: RTCDataChannel;
  readonly ctl: RTCDataChannel;
  readonly codecPreference: string;
  stream: MediaStream | null = null;
  onStream: ((stream: MediaStream) => void) | null = null;

  constructor() {
    this.pc = new RTCPeerConnection(RTC_CONFIG);
    const transceiver = this.pc.addTransceiver('video', { direction: 'recvonly' });
    this.codecPreference = preferH264(transceiver);
    this.pose = this.pc.createDataChannel('pose', { ordered: false, maxRetransmits: 0 });
    this.pose.binaryType = 'arraybuffer';
    this.ctl = this.pc.createDataChannel('ctl', { ordered: true });
    this.pc.addEventListener('track', (e: RTCTrackEvent) => {
      const stream = e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]);
      this.stream = stream;
      if (this.onStream) this.onStream(stream);
    });
  }

  async createOffer(): Promise<string> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await waitForIceGathering(this.pc, 2500);
    const sdp = this.pc.localDescription ? this.pc.localDescription.sdp : '';
    if (!sdp) throw new Error('No local description');
    return sdp;
  }

  async acceptAnswer(sdp: string): Promise<void> {
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
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
