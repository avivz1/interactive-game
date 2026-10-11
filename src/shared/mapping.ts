// Maps normalized camera coordinates to screen pixels.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Rect of a srcW x srcH image fitted inside dstW x dstH without cropping (object-fit: contain). */
export function containRect(srcW: number, srcH: number, dstW: number, dstH: number): Rect {
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) return { x: 0, y: 0, w: dstW, h: dstH };
  const scale = Math.min(dstW / srcW, dstH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
}

/** Converts a normalized point to screen space; `mirror` flips horizontally like a mirror. */
export function toScreen(nx: number, ny: number, rect: Rect, mirror: boolean): { x: number; y: number } {
  return { x: rect.x + (mirror ? 1 - nx : nx) * rect.w, y: rect.y + ny * rect.h };
}
