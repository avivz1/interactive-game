// Estimates the offset between the phone's and the TV's performance.now() clocks
// from ping/pong round trips, trusting the sample with the smallest round trip.

interface Sample {
  rtt: number;
  offset: number;
}

const MAX_SAMPLES = 20;
const MAX_RTT_MS = 2000;

export class ClockSync {
  private samples: Sample[] = [];

  /** tvSend/tvRecv: TV clock; phoneTime: phone clock when it answered. */
  add(tvSend: number, phoneTime: number, tvRecv: number): void {
    const rtt = tvRecv - tvSend;
    if (!(rtt >= 0 && rtt <= MAX_RTT_MS)) return;
    this.samples.push({ rtt, offset: phoneTime - (tvSend + rtt / 2) });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  private best(): Sample | null {
    let best: Sample | null = null;
    for (const s of this.samples) if (!best || s.rtt < best.rtt) best = s;
    return best;
  }

  /** phone clock minus TV clock, or null before the first sample. */
  get offset(): number | null {
    const b = this.best();
    return b ? b.offset : null;
  }

  get rtt(): number | null {
    const b = this.best();
    return b ? b.rtt : null;
  }

  toTv(phoneTime: number): number | null {
    const off = this.offset;
    return off === null ? null : phoneTime - off;
  }
}
