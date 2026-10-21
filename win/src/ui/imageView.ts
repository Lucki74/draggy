/** Zoom and pan maths for the image viewer. The picture sits centred; `x` and `y` move it from there. */

export const MIN_SCALE = 0.01;
export const MAX_SCALE = 8;

export interface View {
  scale: number;
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export const clampScale = (scale: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

/** The scale at which the whole picture fits the box. A small picture is not blown up to fill it. */
export function fitScale(image: Size, box: Size): number {
  if (image.width <= 0 || image.height <= 0) return 1;
  return clampScale(Math.min(1, box.width / image.width, box.height / image.height));
}

/** A picture smaller than the box stays centred; a larger one may move only until its edge meets the box's. */
export function clampPan(view: View, image: Size, box: Size): View {
  const reach = (shown: number, room: number) => Math.max(0, (shown - room) / 2);
  const limitX = reach(image.width * view.scale, box.width);
  const limitY = reach(image.height * view.scale, box.height);
  return {
    scale: view.scale,
    // Adding 0 turns a negative zero into a plain one.
    x: Math.min(limitX, Math.max(-limitX, view.x)) + 0,
    y: Math.min(limitY, Math.max(-limitY, view.y)) + 0,
  };
}

/** Zooms by `factor` keeping the point under `anchor` (measured from the box centre) where it was. */
export function zoomAt(view: View, factor: number, anchor: { x: number; y: number }, image: Size, box: Size): View {
  const scale = clampScale(view.scale * factor);
  const ratio = scale / view.scale;
  return clampPan(
    { scale, x: anchor.x - (anchor.x - view.x) * ratio, y: anchor.y - (anchor.y - view.y) * ratio },
    image,
    box,
  );
}

/** Wheel clicks make steps of the same proportion in either direction, so in and out cancel. */
export const wheelFactor = (deltaY: number): number => Math.exp(-deltaY * 0.0015);
