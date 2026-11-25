import {
  computeLetterboxTransform,
  mapDetectorBoxToCroppedPhoto,
  type DetectionBox,
  type DetectionKind,
  type LetterboxTransform,
  type PixelBox,
} from './coords';

export const DEFAULT_CLASSES: DetectionKind[] = ['rectangle', 'diamond', 'oval', 'arrowhead'];

export interface YoloxPreprocessOptions {
  targetSize?: number;
  padValue?: number;
  colorOrder?: 'BGR' | 'RGB';
  normalize01?: boolean;
}

export interface YoloxPreprocessResult {
  tensorData: Float32Array;
  transform: LetterboxTransform;
  targetSize: number;
}

/**
 * Reproduces Python YOLOX ValTransform(legacy=False) letterbox resize + pad
 * (pad value 114, BGR channel order, NCHW float32).
 */
export function preprocessForYolox(
  rgba: Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  options: YoloxPreprocessOptions = {},
): YoloxPreprocessResult {
  const targetSize = options.targetSize ?? 640;
  const padValue = options.padValue ?? 114;
  const colorOrder = options.colorOrder ?? 'BGR';
  const normalize01 = options.normalize01 ?? false;

  const transform = computeLetterboxTransform(srcWidth, srcHeight, targetSize);
  const planeSize = targetSize * targetSize;
  const tensorData = new Float32Array(3 * planeSize);
  const fillVal = normalize01 ? padValue / 255.0 : padValue;
  tensorData.fill(fillVal);

  const resizedW = Math.max(1, Math.round(srcWidth * transform.scale));
  const resizedH = Math.max(1, Math.round(srcHeight * transform.scale));
  const padX = Math.floor(transform.padX);
  const padY = Math.floor(transform.padY);
  const scaleFactor = normalize01 ? 1.0 / 255.0 : 1.0;

  // Bilinear resize into the padded 640x640 NCHW buffer
  for (let dy = 0; dy < resizedH; dy++) {
    const outY = padY + dy;
    if (outY < 0 || outY >= targetSize) continue;

    const syFloat = ((dy + 0.5) / transform.scale) - 0.5;
    const sy0 = Math.max(0, Math.min(srcHeight - 1, Math.floor(syFloat)));
    const sy1 = Math.max(0, Math.min(srcHeight - 1, sy0 + 1));
    const fy = Math.max(0, syFloat - sy0);

    for (let dx = 0; dx < resizedW; dx++) {
      const outX = padX + dx;
      if (outX < 0 || outX >= targetSize) continue;

      const sxFloat = ((dx + 0.5) / transform.scale) - 0.5;
      const sx0 = Math.max(0, Math.min(srcWidth - 1, Math.floor(sxFloat)));
      const sx1 = Math.max(0, Math.min(srcWidth - 1, sx0 + 1));
      const fx = Math.max(0, sxFloat - sx0);

      const i00 = (sy0 * srcWidth + sx0) * 4;
      const i01 = (sy0 * srcWidth + sx1) * 4;
      const i10 = (sy1 * srcWidth + sx0) * 4;
      const i11 = (sy1 * srcWidth + sx1) * 4;

      const w00 = (1 - fx) * (1 - fy);
      const w01 = fx * (1 - fy);
      const w10 = (1 - fx) * fy;
      const w11 = fx * fy;

      const r = (rgba[i00] * w00 + rgba[i01] * w01 + rgba[i10] * w10 + rgba[i11] * w11) * scaleFactor;
      const g = (rgba[i00 + 1] * w00 + rgba[i01 + 1] * w01 + rgba[i10 + 1] * w10 + rgba[i11 + 1] * w11) * scaleFactor;
      const b = (rgba[i00 + 2] * w00 + rgba[i01 + 2] * w01 + rgba[i10 + 2] * w10 + rgba[i11 + 2] * w11) * scaleFactor;

      const dstIdx = outY * targetSize + outX;
      if (colorOrder === 'BGR') {
        tensorData[dstIdx] = b;
        tensorData[planeSize + dstIdx] = g;
        tensorData[2 * planeSize + dstIdx] = r;
      } else {
        tensorData[dstIdx] = r;
        tensorData[planeSize + dstIdx] = g;
        tensorData[2 * planeSize + dstIdx] = b;
      }
    }
  }

  return { tensorData, transform, targetSize };
}

/**
 * Checks whether an exported YOLOX ONNX model already includes grid decoding
 * (`--decode_in_inference`) by inspecting box center/size magnitudes.
 */
export function isYoloxOutputAlreadyDecoded(
  outputData: Float32Array,
  numAnchors: number,
  strideCols: number,
): boolean {
  let maxCoord = 0;
  const sampleCount = Math.min(numAnchors, 512);
  for (let i = 0; i < sampleCount; i++) {
    const base = i * strideCols;
    const cx = Math.abs(outputData[base]);
    const cy = Math.abs(outputData[base + 1]);
    if (cx > maxCoord) maxCoord = cx;
    if (cy > maxCoord) maxCoord = cy;
  }
  // Raw grid offsets are small (~ -2..5), whereas decoded pixel centers reach ~ 600+
  return maxCoord > 25;
}

interface RawCandidate {
  box: PixelBox;
  classIdx: number;
  score: number;
}

function iou(a: PixelBox, b: PixelBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter <= 0) return 0;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

export function applyClassAwareNms(
  candidates: RawCandidate[],
  nmsThreshold = 0.45,
): RawCandidate[] {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const kept: RawCandidate[] = [];

  for (const cand of sorted) {
    let suppressed = false;
    for (const prev of kept) {
      if (prev.classIdx === cand.classIdx && iou(prev.box, cand.box) > nmsThreshold) {
        suppressed = true;
        break;
      }
    }
    if (!suppressed) {
      kept.push(cand);
    }
  }
  return kept;
}

export interface YoloxDecodeResult {
  detections: DetectionBox[];
  decodedInModel: boolean;
}

/**
 * Decodes YOLOX ONNX output [1, numAnchors, 5 + numClasses], applies class-aware NMS,
 * and maps boxes back into cropped-photo pixel coordinates.
 */
export function postprocessYoloxOutput(
  outputData: Float32Array,
  numClasses: number,
  transform: LetterboxTransform,
  classes: DetectionKind[] = DEFAULT_CLASSES,
  scoreThreshold = 0.35,
  nmsThreshold = 0.45,
): YoloxDecodeResult {
  const cols = 5 + numClasses;
  const numAnchors = Math.floor(outputData.length / cols);
  const decodedInModel = isYoloxOutputAlreadyDecoded(outputData, numAnchors, cols);

  // Build YOLOX FPN grid coordinates + strides if model output is not pre-decoded
  const strides = [8, 16, 32];
  const gridX = new Float32Array(numAnchors);
  const gridY = new Float32Array(numAnchors);
  const gridStride = new Float32Array(numAnchors);

  if (!decodedInModel) {
    let offset = 0;
    for (const s of strides) {
      const gh = Math.floor(transform.targetSize / s);
      const gw = Math.floor(transform.targetSize / s);
      for (let y = 0; y < gh; y++) {
        for (let x = 0; x < gw; x++) {
          if (offset >= numAnchors) break;
          gridX[offset] = x;
          gridY[offset] = y;
          gridStride[offset] = s;
          offset += 1;
        }
      }
    }
  }

  const candidates: RawCandidate[] = [];
  for (let i = 0; i < numAnchors; i++) {
    const base = i * cols;
    const objConf = outputData[base + 4];
    if (objConf < scoreThreshold) continue;

    let bestCls = 0;
    let bestClsScore = -Infinity;
    for (let c = 0; c < numClasses; c++) {
      const s = outputData[base + 5 + c];
      if (s > bestClsScore) {
        bestClsScore = s;
        bestCls = c;
      }
    }

    const score = objConf * bestClsScore;
    if (score < scoreThreshold) continue;

    let cx = outputData[base];
    let cy = outputData[base + 1];
    let w = outputData[base + 2];
    let h = outputData[base + 3];

    if (!decodedInModel) {
      const s = gridStride[i] || 8;
      cx = (cx + gridX[i]) * s;
      cy = (cy + gridY[i]) * s;
      w = Math.exp(w) * s;
      h = Math.exp(h) * s;
    }

    const detectorBox: PixelBox = {
      x: cx - w / 2,
      y: cy - h / 2,
      width: Math.max(0, w),
      height: Math.max(0, h),
    };

    candidates.push({
      box: mapDetectorBoxToCroppedPhoto(detectorBox, transform),
      classIdx: bestCls,
      score,
    });
  }

  const kept = applyClassAwareNms(candidates, nmsThreshold);
  const detections: DetectionBox[] = kept.map((k, idx) => ({
    id: `det-${idx + 1}`,
    kind: classes[k.classIdx] ?? 'rectangle',
    confidence: k.score,
    box: k.box,
  }));

  return { detections, decodedInModel };
}
