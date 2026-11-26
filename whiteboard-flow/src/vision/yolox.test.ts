import { describe, expect, it } from 'vitest';
import { computeInsideShapeCropRect } from './ocrClient';
import {
  isYoloxOutputAlreadyDecoded,
  postprocessYoloxOutput,
  preprocessForYolox,
} from './yolox';
import { computeLetterboxTransform } from './coords';

describe('YOLOX preprocessing and postprocessing', () => {
  it('letterboxes RGBA image to 640x640 NCHW BGR with pad value 114', () => {
    const srcW = 320;
    const srcH = 160;
    const rgba = new Uint8ClampedArray(srcW * srcH * 4);
    // Fill solid red pixel (R=200, G=50, B=10)
    for (let i = 0; i < srcW * srcH; i++) {
      rgba[i * 4] = 200;
      rgba[i * 4 + 1] = 50;
      rgba[i * 4 + 2] = 10;
      rgba[i * 4 + 3] = 255;
    }

    const { tensorData, transform } = preprocessForYolox(rgba, srcW, srcH);
    const plane = 640 * 640;
    expect(tensorData.length).toBe(3 * plane);
    expect(transform.padY).toBe(160);

    // Top padding row should be 114
    expect(tensorData[0]).toBe(114);
    // Center pixel (x=320, y=320) should be BGR: B=10, G=50, R=200
    const centerIdx = 320 * 640 + 320;
    expect(tensorData[centerIdx]).toBeCloseTo(10, 1);
    expect(tensorData[plane + centerIdx]).toBeCloseTo(50, 1);
    expect(tensorData[2 * plane + centerIdx]).toBeCloseTo(200, 1);
  });

  it('auto-detects pre-decoded vs raw YOLOX outputs and applies NMS', () => {
    const transform = computeLetterboxTransform(640, 640, 640);
    const cols = 5 + 4; // 4 classes

    // Case 1: Pre-decoded output (--decode_in_inference)
    const preDecoded = new Float32Array(2 * cols);
    // Box 1: diamond at (320, 320, 120, 80), obj=0.9, class 1 (diamond)=0.95
    preDecoded[0] = 320;
    preDecoded[1] = 320;
    preDecoded[2] = 120;
    preDecoded[3] = 80;
    preDecoded[4] = 0.9;
    preDecoded[5 + 1] = 0.95;
    // Box 2: overlapping duplicate diamond with lower score -> should be suppressed by NMS
    preDecoded[cols + 0] = 322;
    preDecoded[cols + 1] = 318;
    preDecoded[cols + 2] = 118;
    preDecoded[cols + 3] = 82;
    preDecoded[cols + 4] = 0.8;
    preDecoded[cols + 5 + 1] = 0.7;

    expect(isYoloxOutputAlreadyDecoded(preDecoded, 2, cols)).toBe(true);
    const res1 = postprocessYoloxOutput(preDecoded, 4, transform);
    expect(res1.decodedInModel).toBe(true);
    expect(res1.detections).toHaveLength(1);
    expect(res1.detections[0].kind).toBe('diamond');
    expect(res1.detections[0].box.x).toBeCloseTo(260, 1);
    expect(res1.detections[0].box.y).toBeCloseTo(280, 1);

    // Case 2: Raw grid output (8400 anchors, stride 8 at anchor 0)
    const raw = new Float32Array(8400 * cols);
    // Anchor 0 -> grid (0, 0), stride 8 -> cx=(1.5+0)*8=12, cy=(2.0+0)*8=16, w=exp(1)*8, h=exp(1)*8
    raw[0] = 1.5;
    raw[1] = 2.0;
    raw[2] = 1.0;
    raw[3] = 1.0;
    raw[4] = 0.9;
    raw[5 + 2] = 0.9; // oval

    expect(isYoloxOutputAlreadyDecoded(raw, 8400, cols)).toBe(false);
    const res2 = postprocessYoloxOutput(raw, 4, transform);
    expect(res2.decodedInModel).toBe(false);
    expect(res2.detections).toHaveLength(1);
    expect(res2.detections[0].kind).toBe('oval');
  });

  it('computes inset crop rect inside shape bounds for OCR', () => {
    const rect = computeInsideShapeCropRect({ x: 100, y: 100, width: 200, height: 100 }, 640, 640, 'rectangle');
    expect(rect).toEqual({ x: 124, y: 116, width: 152, height: 68 });
  });
});
