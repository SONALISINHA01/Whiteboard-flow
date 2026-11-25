export interface LookOffset {
  x: number;
  y: number;
}

/**
 * Computes pupil translation offset in pixels toward `(pointerX, pointerY)`
 * from a character's face center, clamped within `maxTravel`.
 */
export function computePupilOffset(
  pointerX: number,
  pointerY: number,
  faceCenterX: number,
  faceCenterY: number,
  maxTravel = 3.5,
): LookOffset {
  const dx = pointerX - faceCenterX;
  const dy = pointerY - faceCenterY;
  const distance = Math.hypot(dx, dy);
  if (!distance) {
    return { x: 0, y: 0 };
  }
  const travel = maxTravel * Math.min(distance / 110, 1);
  return {
    x: (dx / distance) * travel,
    y: (dy / distance) * travel,
  };
}
