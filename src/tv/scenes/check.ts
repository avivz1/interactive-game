// TV check: connection and tracking details for the adult (remote ▼ from the
// menu). ←/→ shift the body overlay timing; OK goes back.

import { drawBody } from '../draw';
import type { Frame, Key, Scene, Stage } from '../stage';
import { label, panel } from '../ui';

export class CheckScene implements Scene {
  readonly name = 'check';

  constructor(
    private readonly stage: Stage,
    private readonly back: () => Scene,
  ) {}

  onKey(key: Key): void {
    if (key === 'left') this.stage.session.adjustSyncOffset(-20);
    else if (key === 'right') this.stage.session.adjustSyncOffset(20);
    else if (key === 'ok' || key === 'back' || key === 'up') this.stage.go(this.back());
  }

  update(_frame: Frame): void {
    // stats refresh on their own once per second
  }

  render(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const { width, height } = frame;
    const st = this.stage.session.stats;
    drawBody(ctx, frame.body);

    let body: string;
    if (st.poseHz >= 10) body = 'Body ' + Math.round(st.poseHz) + '/s' + (st.phoneModel ? ' (' + st.phoneModel + ')' : '');
    else if (st.packetHz >= 10) body = 'Step back so the camera sees your whole body';
    else if (st.packetHz > 0) body = 'Body tracking is slow on the phone (' + st.packetHz.toFixed(0) + '/s)';
    else body = 'Waiting for body tracking from the phone…';
    let chip: string;
    if (st.works) chip = '✅ This TV works!  Video ' + Math.round(st.videoFps) + ' fps · ' + body;
    else if (st.hasVideo) chip = 'Video OK · ' + body;
    else if (st.noVideoSeconds >= 10) chip = '⚠️ Connected, but no video is showing.';
    else chip = 'Connected — waiting for video…';
    label(ctx, chip, width * 0.04, height * 0.07, height * 0.035, '#fff', 'left');

    const lines = [
      'video     ' + st.videoWidth + 'x' + st.videoHeight + ' @ ' + st.videoFps.toFixed(1) + ' fps  (' + st.codec + ')',
      'body      ' + st.poseHz.toFixed(1) + '/s   packets ' + st.packetHz.toFixed(1) + '/s   source ' + st.phoneSource,
      'phone     tracking ' + st.phoneFps.toFixed(1) + ' fps, ' + st.phoneInferMs.toFixed(1) + ' ms/frame, model ' + (st.phoneModel || '?'),
      'network   rtt ' + (st.rttMs === null ? '?' : st.rttMs.toFixed(0) + ' ms') + '   same Wi-Fi ' + (st.lan === null ? '?' : st.lan ? 'yes' : 'NO'),
      'sync      delay ' + st.delayMs.toFixed(0) + ' ms (adjust ' + this.stage.session.syncOffset + ' ms with ←/→)' +
        (st.frameMetaDelayMs === null ? '' : '   frame-meta ' + st.frameMetaDelayMs.toFixed(0) + ' ms'),
      'frames    ' + st.framesShown + ' shown        OK = back to games',
    ];
    const lh = height * 0.035;
    panel(ctx, width * 0.03, height * 0.7, width * 0.8, lh * (lines.length + 1), lh * 0.4, 'rgba(11,16,32,0.8)');
    ctx.font = Math.round(lh * 0.75) + 'px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    lines.forEach((l, i) => ctx.fillText(l, width * 0.045, height * 0.7 + lh * (i + 1)));
  }
}
