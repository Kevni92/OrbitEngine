export interface PointerCoordinates {
  readonly clientX: number;
  readonly clientY: number;
}

export const POINTER_SELECTION_DRAG_THRESHOLD_PIXELS = 4;

export function isPointerClick(
  start: PointerCoordinates,
  end: PointerCoordinates,
  thresholdPixels = POINTER_SELECTION_DRAG_THRESHOLD_PIXELS,
): boolean {
  if (!Number.isFinite(start.clientX) || !Number.isFinite(start.clientY)
      || !Number.isFinite(end.clientX) || !Number.isFinite(end.clientY)) return false;
  if (!Number.isFinite(thresholdPixels) || thresholdPixels < 0) throw new RangeError("Pointer drag threshold must be finite and non-negative");
  return Math.hypot(end.clientX - start.clientX, end.clientY - start.clientY) <= thresholdPixels;
}
