import {
  GRAPH_FORMAT_VERSION,
  type FlowEdge,
  type FlowGraph,
  type FlowNode,
  type Point,
  type ShapeType,
  type UnresolvedArrow,
} from '../graph/types';
import type { DetectionBox, PixelBox } from './coords';

export interface InkMask {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface ArrowResolverOptions {
  maxTipGapPx?: number;
  maxStrokeGapPx?: number;
  shapeSnapPx?: number;
  stepPx?: number;
  maxTraceLengthPx?: number;
}

export interface ArrowResolutionResult {
  edges: FlowEdge[];
  unresolvedArrows: UnresolvedArrow[];
  rejectedArrowIds: string[];
}

/**
 * Converts RGBA image data into a binary ink mask (1 = ink, 0 = background)
 * using a fast integral-image local adaptive threshold so shaded whiteboard
 * regions don't swallow marker strokes or produce false blobs.
 */
export function binarizeToInkMask(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  darknessMargin = 22,
): InkMask {
  const n = width * height;
  const lum = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    lum[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }

  // Build 1-padded integral image for O(1) local mean computation
  const stride = width + 1;
  const integral = new Float64Array((height + 1) * stride);
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    const rowOff = (y + 1) * stride;
    const prevOff = y * stride;
    const lumOff = y * width;
    for (let x = 0; x < width; x++) {
      rowSum += lum[lumOff + x];
      integral[rowOff + x + 1] = integral[prevOff + x + 1] + rowSum;
    }
  }

  const radius = Math.max(12, Math.round(Math.min(width, height) * 0.04));
  const data = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        integral[(y1 + 1) * stride + (x1 + 1)] -
        integral[y0 * stride + (x1 + 1)] -
        integral[(y1 + 1) * stride + x0] +
        integral[y0 * stride + x0];
      const localMean = sum / area;
      data[y * width + x] = lum[y * width + x] < localMean - darknessMargin ? 1 : 0;
    }
  }

  return { width, height, data };
}

function hasInkNear(ink: InkMask, x: number, y: number, radius = 2): boolean {
  const cx = Math.round(x);
  const cy = Math.round(y);
  for (let dy = -radius; dy <= radius; dy++) {
    const py = cy + dy;
    if (py < 0 || py >= ink.height) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      const px = cx + dx;
      if (px < 0 || px >= ink.width) continue;
      if (ink.data[py * ink.width + px] === 1) return true;
    }
  }
  return false;
}

function isInsideAnyShape(x: number, y: number, shapes: DetectionBox[], pad = -2): boolean {
  return shapes.some(
    (s) =>
      x >= s.box.x - pad &&
      x <= s.box.x + s.box.width + pad &&
      y >= s.box.y - pad &&
      y <= s.box.y + s.box.height + pad,
  );
}

function distanceToBoxBoundary(pt: Point, box: PixelBox): number {
  const cx = Math.max(box.x, Math.min(pt.x, box.x + box.width));
  const cy = Math.max(box.y, Math.min(pt.y, box.y + box.height));
  return Math.hypot(pt.x - cx, pt.y - cy);
}

function boxCenter(box: PixelBox): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

interface ShaftEstimate {
  entryPoint: Point;
  backwardDir: Point;
  forwardDir: Point;
  inkLengthPx: number;
}

/**
 * Estimates the incoming shaft direction from an arrowhead while ignoring ink
 * pixels that belong to nearby shape boundaries/interiors so touching a box
 * edge does not hijack the shaft vector.
 */
function estimateArrowShaft(
  arrowhead: PixelBox,
  shapes: DetectionBox[],
  ink: InkMask,
): ShaftEstimate | null {
  const center = boxCenter(arrowhead);
  const rx = arrowhead.width / 2 + 4;
  const ry = arrowhead.height / 2 + 4;
  const samples = 32;
  const maxProbe = Math.max(24, Math.round(Math.max(arrowhead.width, arrowhead.height) * 1.4));

  const hits: { pt: Point; dir: Point; inkCount: number }[] = [];
  for (let i = 0; i < samples; i++) {
    const angle = (i / samples) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const sx = center.x + dx * rx;
    const sy = center.y + dy * ry;

    let inkCount = 0;
    for (let step = 2; step <= maxProbe; step += 2) {
      const px = sx + dx * step;
      const py = sy + dy * step;
      if (isInsideAnyShape(px, py, shapes, 2)) break;
      if (hasInkNear(ink, px, py, 2)) {
        inkCount += 1;
      }
    }
    if (inkCount >= 3) {
      hits.push({ pt: { x: sx, y: sy }, dir: { x: dx, y: dy }, inkCount });
    }
  }

  if (hits.length === 0) return null;
  hits.sort((a, b) => b.inkCount - a.inkCount);
  const best = hits[0];
  return {
    entryPoint: best.pt,
    backwardDir: best.dir,
    forwardDir: { x: -best.dir.x, y: -best.dir.y },
    inkLengthPx: best.inkCount * 2,
  };
}

interface TraceOutcome {
  points: Point[];
  candidates: { shapeId: string; dist: number }[];
  ambiguousCrossing: boolean;
  traveledPx: number;
}

function traceShaftBackward(
  start: Point,
  initialDir: Point,
  shapes: DetectionBox[],
  excludeShapeId: string | undefined,
  ink: InkMask,
  opts: Required<ArrowResolverOptions>,
): TraceOutcome {
  const points: Point[] = [{ ...start }];
  let curr = { ...start };
  let dir = { ...initialDir };
  let traveled = 0;
  let ambiguousCrossing = false;
  const candidateMap = new Map<string, number>();

  while (traveled < opts.maxTraceLengthPx) {
    for (const s of shapes) {
      if (s.id === excludeShapeId && traveled < 24) continue;
      const dist = distanceToBoxBoundary(curr, s.box);
      if (dist <= opts.shapeSnapPx) {
        const prev = candidateMap.get(s.id);
        if (prev === undefined || dist < prev) {
          candidateMap.set(s.id, dist);
        }
      }
    }
    if (candidateMap.size > 0 && traveled > 8) {
      break;
    }

    let nextPt: Point | null = null;
    let nextDir: Point | null = null;
    let bestScore = -Infinity;
    let straightAheadHit = false;
    let strongBranches = 0;

    const baseAngle = Math.atan2(dir.y, dir.x);
    const angleOffsets = [0, -0.22, 0.22, -0.45, 0.45, -0.75, 0.75];

    for (let gapMult = 1; gapMult * opts.stepPx <= opts.maxStrokeGapPx; gapMult++) {
      const stepDist = gapMult * opts.stepPx;
      for (const offset of angleOffsets) {
        const ang = baseAngle + offset;
        const candDir = { x: Math.cos(ang), y: Math.sin(ang) };
        const candPt = {
          x: curr.x + candDir.x * stepDist,
          y: curr.y + candDir.y * stepDist,
        };
        if (candPt.x < 0 || candPt.x >= ink.width || candPt.y < 0 || candPt.y >= ink.height) {
          continue;
        }
        if (hasInkNear(ink, candPt.x, candPt.y, 2)) {
          const alignment = Math.cos(offset);
          const score = alignment * 10 - gapMult * 1.5;
          if (gapMult === 1 && Math.abs(offset) <= 0.25) {
            straightAheadHit = true;
          }
          if (gapMult === 1 && Math.abs(offset) >= 0.45 && alignment > 0.6) {
            strongBranches += 1;
          }
          if (score > bestScore) {
            bestScore = score;
            nextPt = candPt;
            nextDir = {
              x: dir.x * 0.65 + candDir.x * 0.35,
              y: dir.y * 0.65 + candDir.y * 0.35,
            };
            const norm = Math.hypot(nextDir.x, nextDir.y) || 1;
            nextDir.x /= norm;
            nextDir.y /= norm;
          }
        }
      }
      if (nextPt) break;
    }

    if (!straightAheadHit && strongBranches >= 2) {
      ambiguousCrossing = true;
    }

    if (!nextPt || !nextDir) {
      break;
    }

    traveled += Math.hypot(nextPt.x - curr.x, nextPt.y - curr.y);
    curr = nextPt;
    dir = nextDir;
    points.push({ ...curr });
  }

  if (candidateMap.size === 0) {
    for (const s of shapes) {
      if (s.id === excludeShapeId) continue;
      const dist = distanceToBoxBoundary(curr, s.box);
      if (dist <= opts.shapeSnapPx * 1.6) {
        candidateMap.set(s.id, dist);
      }
    }
  }

  const candidates = Array.from(candidateMap.entries())
    .map(([shapeId, dist]) => ({ shapeId, dist }))
    .sort((a, b) => a.dist - b.dist);

  return { points, candidates, ambiguousCrossing, traveledPx: traveled };
}

function findDestinationCandidates(
  arrowhead: PixelBox,
  forwardDir: Point | null,
  shapes: DetectionBox[],
  maxTipGapPx: number,
): { shapeId: string; score: number }[] {
  const center = boxCenter(arrowhead);
  const probe = forwardDir
    ? {
        x: center.x + forwardDir.x * (Math.max(arrowhead.width, arrowhead.height) * 0.5 + 8),
        y: center.y + forwardDir.y * (Math.max(arrowhead.width, arrowhead.height) * 0.5 + 8),
      }
    : center;

  const scored: { shapeId: string; score: number }[] = [];
  for (const s of shapes) {
    const dist = distanceToBoxBoundary(probe, s.box);
    const centerDist = distanceToBoxBoundary(center, s.box);
    const effective = Math.min(dist, centerDist + 6);
    if (effective <= maxTipGapPx) {
      scored.push({ shapeId: s.id, score: effective });
    }
  }
  scored.sort((a, b) => a.score - b.score);
  return scored;
}

export function resolveArrows(
  shapes: DetectionBox[],
  arrowheads: DetectionBox[],
  ink: InkMask,
  options: ArrowResolverOptions = {},
): ArrowResolutionResult {
  const scaleRef = Math.max(1, Math.min(ink.width, ink.height) / 640);
  const opts: Required<ArrowResolverOptions> = {
    maxTipGapPx: options.maxTipGapPx ?? Math.round(48 * scaleRef),
    maxStrokeGapPx: options.maxStrokeGapPx ?? Math.round(24 * scaleRef),
    shapeSnapPx: options.shapeSnapPx ?? Math.round(22 * scaleRef),
    stepPx: options.stepPx ?? Math.max(4, Math.round(5 * scaleRef)),
    maxTraceLengthPx: options.maxTraceLengthPx ?? Math.round(900 * scaleRef),
  };

  const edges: FlowEdge[] = [];
  const unresolvedArrows: UnresolvedArrow[] = [];
  const rejectedArrowIds: string[] = [];

  arrowheads.forEach((ah, idx) => {
    const shaft = estimateArrowShaft(ah.box, shapes, ink);
    const destCandidates = findDestinationCandidates(
      ah.box,
      shaft?.forwardDir ?? null,
      shapes,
      opts.maxTipGapPx,
    );

    const bestTarget = destCandidates[0];
    const ambiguousTarget =
      destCandidates.length >= 2 && destCandidates[1].score - destCandidates[0].score < 10;

    // Reject spurious arrowhead detections inside handwritten words (no supporting shaft & no nearby destination)
    if (!shaft && !bestTarget) {
      rejectedArrowIds.push(ah.id);
      return;
    }

    if (!shaft) {
      if (bestTarget && bestTarget.score < opts.maxTipGapPx * 0.7 && ah.confidence >= 0.72) {
        unresolvedArrows.push({
          id: `unresolved-${idx + 1}`,
          suggestedTargetId: bestTarget.shapeId,
          points: [boxCenter(ah.box)],
          label: ah.label,
          confidence: ah.confidence * 0.5,
          reason: 'Could not trace connector shaft backward from arrowhead.',
        });
      } else {
        rejectedArrowIds.push(ah.id);
      }
      return;
    }

    const trace = traceShaftBackward(
      shaft.entryPoint,
      shaft.backwardDir,
      shapes,
      bestTarget?.shapeId,
      ink,
      opts,
    );

    const bestSource = trace.candidates[0];
    const ambiguousSource =
      trace.ambiguousCrossing ||
      (trace.candidates.length >= 2 && trace.candidates[1].dist - trace.candidates[0].dist < 10);

    // Reject stray handwriting marks (e.g. 'Y'/'N' in YES/NO) that lack distinct endpoints
    if (
      (!bestTarget && (!bestSource || ah.confidence < 0.75)) ||
      (bestSource && bestTarget && bestSource.shapeId === bestTarget.shapeId && ah.confidence < 0.75)
    ) {
      rejectedArrowIds.push(ah.id);
      return;
    }

    const orderedPoints = [...trace.points].reverse().concat([boxCenter(ah.box)]);

    if (
      !bestSource ||
      !bestTarget ||
      ambiguousSource ||
      ambiguousTarget ||
      bestSource.shapeId === bestTarget.shapeId
    ) {
      if (ah.confidence < 0.65) {
        rejectedArrowIds.push(ah.id);
        return;
      }
      const reasons: string[] = [];
      if (!bestSource) reasons.push('No source shape reached along traced stroke');
      if (!bestTarget) reasons.push('No destination shape found near arrow tip');
      if (ambiguousSource) reasons.push('Two plausible source paths at crossing/branch');
      if (ambiguousTarget) reasons.push('Two plausible destination shapes near tip');
      if (bestSource && bestTarget && bestSource.shapeId === bestTarget.shapeId) {
        reasons.push('Source and destination resolved to the same shape');
      }

      unresolvedArrows.push({
        id: `unresolved-${idx + 1}`,
        suggestedSourceId: bestSource?.shapeId,
        suggestedTargetId: bestTarget?.shapeId,
        points: orderedPoints,
        label: ah.label,
        confidence: Math.min(ah.confidence, 0.65),
        reason: reasons.join('; '),
      });
      return;
    }

    edges.push({
      id: `edge-${idx + 1}`,
      source: bestSource.shapeId,
      target: bestTarget.shapeId,
      label: ah.label,
      bendPoints:
        orderedPoints.length >= 3
          ? [orderedPoints[Math.floor(orderedPoints.length / 2)]]
          : undefined,
    });
  });

  return { edges, unresolvedArrows, rejectedArrowIds };
}

function isShapeDetection(det: DetectionBox): det is DetectionBox & { kind: ShapeType } {
  return (
    det.kind === 'oval' ||
    det.kind === 'rectangle' ||
    det.kind === 'diamond' ||
    det.kind === 'parallelogram' ||
    det.kind === 'database' ||
    det.kind === 'document'
  );
}

export function buildGraphFromDetections(detections: DetectionBox[], ink: InkMask): FlowGraph {
  const shapeDetections = detections.filter(isShapeDetection);
  const arrowheads = detections.filter((d) => d.kind === 'arrowhead' || d.kind === 'arrow');

  const nodes: FlowNode[] = shapeDetections.map((s) => ({
    id: s.id,
    shape: s.kind,
    label: s.label && s.label.trim().length > 0 ? s.label : 'Label needed',
    position: { x: Math.round(s.box.x), y: Math.round(s.box.y) },
    width: Math.round(s.box.width),
    height: Math.round(s.box.height),
  }));

  const { edges, unresolvedArrows } = resolveArrows(shapeDetections, arrowheads, ink);

  return {
    version: GRAPH_FORMAT_VERSION,
    nodes,
    edges,
    unresolvedArrows,
  };
}
