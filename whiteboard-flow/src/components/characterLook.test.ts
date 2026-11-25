import { describe, expect, it } from 'vitest';
import { computePupilOffset } from './characterLook';

describe('computePupilOffset', () => {
  it('points pupils toward the cursor and clamps travel to maxTravel', () => {
    const right = computePupilOffset(500, 100, 200, 100, 3.5);
    expect(right.x).toBeCloseTo(3.5, 4);
    expect(right.y).toBeCloseTo(0, 4);

    const upLeft = computePupilOffset(100, 100, 300, 300, 3.5);
    expect(upLeft.x).toBeLessThan(0);
    expect(upLeft.y).toBeLessThan(0);
    expect(Math.hypot(upLeft.x, upLeft.y)).toBeCloseTo(3.5, 4);
  });

  it('makes left character look right and right character look left when cursor is between them', () => {
    const cursorX = 300;
    const cursorY = 150;
    const leftLook = computePupilOffset(cursorX, cursorY, 200, 150, 3.5);
    const rightLook = computePupilOffset(cursorX, cursorY, 400, 150, 3.5);

    expect(leftLook.x).toBeGreaterThan(0);
    expect(rightLook.x).toBeLessThan(0);
  });

  it('returns zero offset when pointer equals face center', () => {
    expect(computePupilOffset(150, 150, 150, 150, 3.5)).toEqual({ x: 0, y: 0 });
  });
});
