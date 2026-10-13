/**
 * Hover-to-select: progress fills while a hand stays on a target and drains
 * when it leaves. A short slip (tracking flicker at the edge of the picture, a
 * wobble off the edge of a bubble) doesn't drain it.
 */
export class Dwell {
  progress = 0;
  private offMs = 0;

  constructor(
    private readonly holdMs = 1500,
    private readonly graceMs = 600,
  ) {}

  /** Returns true once, on the frame the hold completes. */
  update(hovering: boolean, dtMs: number): boolean {
    if (hovering) {
      this.offMs = 0;
      this.progress = Math.min(1, this.progress + dtMs / this.holdMs);
      if (this.progress >= 1) {
        this.progress = 0;
        return true;
      }
    } else {
      this.offMs += dtMs;
      if (this.offMs > this.graceMs) this.progress = Math.max(0, this.progress - dtMs / this.holdMs);
    }
    return false;
  }

  reset(): void {
    this.progress = 0;
    this.offMs = 0;
  }
}
