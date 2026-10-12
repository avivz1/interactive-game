/** Hover-to-select: progress fills while a hand stays on a target and drains when it leaves. */
export class Dwell {
  progress = 0;

  constructor(private readonly holdMs = 1500) {}

  /** Returns true once, on the frame the hold completes. */
  update(hovering: boolean, dtMs: number): boolean {
    if (hovering) {
      this.progress = Math.min(1, this.progress + dtMs / this.holdMs);
      if (this.progress >= 1) {
        this.progress = 0;
        return true;
      }
    } else {
      this.progress = Math.max(0, this.progress - dtMs / (this.holdMs * 0.5));
    }
    return false;
  }

  reset(): void {
    this.progress = 0;
  }
}
