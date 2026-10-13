/**
 * Hover-to-select: progress fills while a hand stays on a target and drains
 * when it leaves. A hand briefly lost by tracking (flicker at the edge of the
 * picture) doesn't drain it; a hand that moved elsewhere does.
 */
export class Dwell {
  progress = 0;
  private offMs = 0;

  constructor(
    private readonly holdMs = 1500,
    private readonly graceMs = 600,
  ) {}

  /** Returns true once, on the frame the hold completes. `handLost`: no hand is tracked right now. */
  update(hovering: boolean, dtMs: number, handLost = false): boolean {
    if (hovering) {
      this.offMs = 0;
      this.progress = Math.min(1, this.progress + dtMs / this.holdMs);
      if (this.progress >= 1) {
        this.progress = 0;
        return true;
      }
    } else {
      this.offMs = handLost ? this.offMs + dtMs : Infinity;
      if (this.offMs > this.graceMs) this.progress = Math.max(0, this.progress - dtMs / this.holdMs);
    }
    return false;
  }

  reset(): void {
    this.progress = 0;
    this.offMs = 0;
  }
}
