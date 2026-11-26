import type { InkMask } from './arrowResolver';
import type { DetectionBox, PixelBox } from './coords';

export interface FilteredDetections {
  acceptedShapes: DetectionBox[];
  doubtfulShapes: DetectionBox[];
  plausibleArrowheads: DetectionBox[];
  rejectedArrowheads: DetectionBox[];
}

function isShapeKind(kind: DetectionBox['kind']): boolean {
  return kind === 'oval' || kind === 'rectangle' || kind === 'diamond' || kind === 'parallelogram';
}

function boxArea(b: PixelBox): number {
  return Math.max(0, b.width) * Math.max(0, b.height);
}

function intersectionArea(a: PixelBox, b: PixelBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function boxIou(a: PixelBox, b: PixelBox): number {
  const inter = intersectionArea(a, b);
  if (inter <= 0) return 0;
  const union = boxArea(a) + boxArea(b) - inter;
  return union > 0 ? inter / union : 0;
}

function isPointInsideBox(x: number, y: number, b: PixelBox, insetRatio = 0): boolean {
  const mx = b.width * insetRatio;
  const my = b.height * insetRatio;
  return x >= b.x + mx && x <= b.x + b.width - mx && y >= b.y + my && y <= b.y + b.height - my;
}

/**
 * Checks whether a candidate bounding box has ink evidence along its perimeter
 * (characteristic of a drawn flowchart shape rather than a single letter).
 */
function perimeterInkRatio(box: PixelBox, ink: InkMask): number {
  const x1 = Math.max(0, Math.floor(box.x));
  const y1 = Math.max(0, Math.floor(box.y));
  const x2 = Math.min(ink.width - 1, Math.ceil(box.x + box.width));
  const y2 = Math.min(ink.height - 1, Math.ceil(box.y + box.height));
  if (x2 <= x1 || y2 <= y1) return 0;

  const band = Math.max(3, Math.round(Math.min(box.width, box.height) * 0.14));
  let hits = 0;
  let total = 0;

  // Sample perimeter band (top, bottom, left, right)
  for (let x = x1; x <= x2; x += 2) {
    total += 2;
    let topHit = false;
    let botHit = false;
    for (let d = 0; d < band; d++) {
      if (y1 + d < ink.height && ink.data[(y1 + d) * ink.width + x] === 1) topHit = true;
      if (y2 - d >= 0 && ink.data[(y2 - d) * ink.width + x] === 1) botHit = true;
    }
    if (topHit) hits += 1;
    if (botHit) hits += 1;
  }
  for (let y = y1; y <= y2; y += 2) {
    total += 2;
    let leftHit = false;
    let rightHit = false;
    for (let d = 0; d < band; d++) {
      if (x1 + d < ink.width && ink.data[y * ink.width + (x1 + d)] === 1) leftHit = true;
      if (x2 - d >= 0 && ink.data[y * ink.width + (x2 - d)] === 1) rightHit = true;
    }
    if (leftHit) hits += 1;
    if (rightHit) hits += 1;
  }

  return total > 0 ? hits / total : 0;
}

/**
 * Separates raw model detections into verified flowchart shapes, doubtful small
 * candidates (kept in Diagnostics), plausible connector arrowheads, and rejected
 * handwriting marks.
 */
export function filterAndDeduplicateDetections(
  rawDetections: DetectionBox[],
  ink: InkMask,
  imageWidth: number,
  imageHeight: number,
): FilteredDetections {
  const imageArea = Math.max(1, imageWidth * imageHeight);
  const rawShapes = rawDetections
    .filter((d) => isShapeKind(d.kind))
    .sort((a, b) => b.confidence - a.confidence);
  const rawArrows = rawDetections.filter((d) => d.kind === 'arrowhead' || d.kind === 'arrow');

  // 1. Cross-class NMS to remove duplicate overlapping shape predictions
  const dedupedShapes: DetectionBox[] = [];
  for (const cand of rawShapes) {
    const overlapsExisting = dedupedShapes.some((kept) => boxIou(kept.box, cand.box) > 0.42);
    if (!overlapsExisting) {
      dedupedShapes.push(cand);
    }
  }

  // 2. Reject tiny false-positive shapes inside larger shapes or from single letters (e.g. 'D', 'O')
  const sortedByAreaDesc = [...dedupedShapes].sort((a, b) => boxArea(b.box) - boxArea(a.box));
  const acceptedShapes: DetectionBox[] = [];
  const doubtfulShapes: DetectionBox[] = [];

  for (const shape of sortedByAreaDesc) {
    const area = boxArea(shape.box);
    const areaFrac = area / imageArea;
    const minDim = Math.min(shape.box.width, shape.box.height);

    // Check if strictly contained inside an already-accepted larger shape (e.g. tiny oval on 'D' in VALID?)
    const containedInParent = acceptedShapes.some((parent) => {
      const inter = intersectionArea(shape.box, parent.box);
      return inter / Math.max(1, area) >= 0.7 && area < boxArea(parent.box) * 0.4;
    });
    if (containedInParent) {
      doubtfulShapes.push(shape);
      continue;
    }

    // Tiny detections (< 0.8% of image area or < 28px) are typically handwritten letters ('O', 'D')
    // unless they are clearly a drawn small shape (>= 28px with strong boundary & high confidence).
    const perimScore = perimeterInkRatio(shape.box, ink);
    const tooTiny = minDim < 28 || (areaFrac < 0.008 && (shape.confidence < 0.72 || perimScore < 0.35));
    const weakBoundary = perimScore < 0.12 && shape.confidence < 0.65;

    if (tooTiny || weakBoundary) {
      doubtfulShapes.push(shape);
      continue;
    }

    acceptedShapes.push(shape);
  }

  // 3. Filter arrowheads: reject marks deep inside shapes (e.g. 'A', 'V', 'R' in handwriting)
  const plausibleArrowheads: DetectionBox[] = [];
  const rejectedArrowheads: DetectionBox[] = [];

  for (const ah of rawArrows) {
    const cx = ah.box.x + ah.box.width / 2;
    const cy = ah.box.y + ah.box.height / 2;

    const insideShape = acceptedShapes.some((s) => isPointInsideBox(cx, cy, s.box, 0.14));
    if (insideShape) {
      rejectedArrowheads.push(ah);
      continue;
    }

    // Check if there is any ink outside shape boxes supporting the arrowhead
    plausibleArrowheads.push(ah);
  }

  return {
    acceptedShapes,
    doubtfulShapes,
    plausibleArrowheads,
    rejectedArrowheads,
  };
}
