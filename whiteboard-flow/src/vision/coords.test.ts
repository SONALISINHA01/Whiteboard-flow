import { describe, expect, it } from 'vitest';
import {
  computeLabelCropRect,
  computeLetterboxTransform,
  createSampleDetections,
  mapCroppedBoxToDetector,
  mapDetectorBoxToCroppedPhoto,
} from './coords';

describe('vision coordinate mapping', () => {
  it('computes letterbox scale and padding for non-square cropped photos', () => {
    const transform = computeLetterboxTransform(1200, 800, 640);

    expect(transform.scale).toBeCloseTo(640 / 1200, 6);
    expect(transform.padX).toBeCloseTo(0, 6);
    expect(transform.padY).toBeCloseTo((640 - 800 * (640 / 1200)) / 2, 6);
  });

  it('round-trips boxes between cropped photo pixels and detector letterbox coordinates', () => {
    const transform = computeLetterboxTransform(960, 720, 640);
    const originalBox = { x: 180, y: 120, width: 240, height: 110 };

    const detectorBox = mapCroppedBoxToDetector(originalBox, transform);
    const mappedBack = mapDetectorBoxToCroppedPhoto(detectorBox, transform);

    expect(mappedBack.x).toBeCloseTo(originalBox.x, 4);
    expect(mappedBack.y).toBeCloseTo(originalBox.y, 4);
    expect(mappedBack.width).toBeCloseTo(originalBox.width, 4);
    expect(mappedBack.height).toBeCloseTo(originalBox.height, 4);
  });

  it('clamps detector boxes mapped outside the cropped photo bounds', () => {
    const transform = computeLetterboxTransform(1000, 500, 640);
    const mapped = mapDetectorBoxToCroppedPhoto(
      { x: -20, y: 0, width: 700, height: 640 },
      transform,
    );

    expect(mapped.x).toBe(0);
    expect(mapped.y).toBe(0);
    expect(mapped.width).toBeLessThanOrEqual(1000);
    expect(mapped.height).toBeLessThanOrEqual(500);
  });

  it('computes padded high-resolution label crop rects clamped to cropped photo', () => {
    const rect = computeLabelCropRect({ x: 3, y: 4, width: 100, height: 40 }, 960, 720, 8);
    expect(rect).toEqual({ x: 0, y: 0, width: 111, height: 52 });

    const detections = createSampleDetections(960, 720);
    expect(detections.length).toBeGreaterThanOrEqual(3);
  });
});
