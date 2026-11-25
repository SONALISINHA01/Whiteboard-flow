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
  /** 1 = ink pixel, 0 = background */
  data: Uint8Array;
}

export interface ArrowResolverOptions {
  /** Max distance (px) beyond arrowhead tip to search for destination shape boundary. */
  maxTipGapPx?: number;
  /** Max gap (px) the tracer can jump along the local direction. */
  maxStrokeGapPx?: number;
  /** Distance (px) from a shape boundary that counts as reaching the shape. */
  shapeSnapPx?: number;
  /** Step size (px) when tracing the shaft backward. */
  stepPx?: number;
  /** Maximum trace length (px) to prevent runaway loops. */
  maxTraceLengthPx?: number;
}

export interface ArrowResolutionResult {
  edges: FlowEdge[];
  unresolvedArrows: UnresolvedArrow[];
}

/**
 * Converts RGBA image data into a binary ink mask (1 = ink, 0 = background)
 * using a fast luminance threshold relative to the image's bright whiteboard background.
 */
export function binarizeToInkMask(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  darknessMargin = 45,
): InkMask {
  const n = width * height;
  const lum = new Uint8Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    lum[i] = y;
    sum += y;
  }
  const meanLum = sum / Math.max(1, n);
  const threshold = Math.max(40, Math.min(200, meanLum - darknessMargin));
  const data = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    data[i] = lum[i] < threshold ? 1 : 0;
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
  /** Unit vector pointing backward along the shaft (away from tip). */
  backwardDir: Point;
  /** Unit vector pointing forward toward the tip. */
  forwardDir: Point;
}

/**
 * Finds the dominant ink shaft exiting the arrowhead bounding box to establish
 * backward tracing direction and forward tip direction.
 */
function estimateArrowShaft(arrowhead: PixelBox, ink: InkMask): ShaftEstimate | null {
  const center = boxCenter(arrowhead);
  const rx = arrowhead.width / 2 + 4;
  const ry = arrowhead.height / 2 + 4;
  const samples = 24;

  const hits: { pt: Point; dir: Point; inkCount: number }[] = [];
  for (let i = 0; i < samples; i++) {
    const angle = (i / samples) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const sx = center.x + dx * rx;
    const sy = center.y + dy * ry;

    let inkCount = 0;
    for (let step = 0; step <= 14; step += 2) {
      if (hasInkNear(ink, sx + dx * step, sy + dy * step, 2)) {
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
  };
}

interface TraceOutcome {
  points: Point[];
  candidates: { shapeId: string; dist: number }[];
  ambiguousCrossing: boolean;
}

/**
 * Traces backward along the arrow shaft using local line direction to stay on
 * the same stroke through crossings, jumping small gaps when needed.
 */
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
    // Check if we reached any shape boundary (allowing marker to stop short within shapeSnapPx)
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
    if (candidateMap.size > 0 && traveled > 10) {
      break;
    }

    // Look ahead along local direction, allowing small gaps
    let nextPt: Point | null = null;
    let nextDir: Point | null = null;
    let bestScore = -Infinity;
    let straightAheadHit = false;
    let strongBranches = 0;

    const baseAngle = Math.atan2(dir.y, dir.x);
    const angleOffsets = [0, -0.25, 0.25, -0.5, 0.5, -0.78, 0.78];

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
            // Smooth local direction update
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

  // Final proximity check if tracer stopped just short of a box
  if (candidateMap.size === 0) {
    for (const s of shapes) {
      if (s.id === excludeShapeId) continue;
      const dist = distanceToBoxBoundary(curr, s.box);
      if (dist <= opts.shapeSnapPx * 1.5) {
        candidateMap.set(s.id, dist);
      }
    }
  }

  const candidates = Array.from(candidateMap.entries())
    .map(([shapeId, dist]) => ({ shapeId, dist }))
    .sort((a, b) => a.dist - b.dist);

  return { points, candidates, ambiguousCrossing };
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
    if (dist <= maxTipGapPx) {
      scored.push({ shapeId: s.id, score: dist });
    }
  }
  scored.sort((a, b) => a.score - b.score);
  return scored;
}

/**
 * Resolves detected arrowheads and ink strokes into directed `FlowEdge`s and
 * `UnresolvedArrow` candidates when destination/source is missing or ambiguous.
 */
export function resolveArrows(
  shapes: DetectionBox[],
  arrowheads: DetectionBox[],
  ink: InkMask,
  options: ArrowResolverOptions = {},
): ArrowResolutionResult {
  const opts: Required<ArrowResolverOptions> = {
    maxTipGapPx: options.maxTipGapPx ?? 48,
    maxStrokeGapPx: options.maxStrokeGapPx ?? 24,
    shapeSnapPx: options.shapeSnapPx ?? 20,
    stepPx: options.stepPx ?? 5,
    maxTraceLengthPx: options.maxTraceLengthPx ?? 900,
  };

  const edges: FlowEdge[] = [];
  const unresolvedArrows: UnresolvedArrow[] = [];

  arrowheads.forEach((ah, idx) => {
    const shaft = estimateArrowShaft(ah.box, ink);
    const destCandidates = findDestinationCandidates(
      ah.box,
      shaft?.forwardDir ?? null,
      shapes,
      opts.maxTipGapPx,
    );

    const bestTarget = destCandidates[0];
    const ambiguousTarget =
      destCandidates.length >= 2 && destCandidates[1].score - destCandidates[0].score < 12;

    if (!shaft) {
      unresolvedArrows.push({
        id: `unresolved-${idx + 1}`,
        suggestedTargetId: bestTarget?.shapeId,
        points: [boxCenter(ah.box)],
        label: ah.label,
        confidence: ah.confidence * 0.5,
        reason: 'Could not find ink shaft entering arrowhead.',
      });
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

    const orderedPoints = [...trace.points].reverse().concat([boxCenter(ah.box)]);

    if (!bestSource || !bestTarget || ambiguousSource || ambiguousTarget || bestSource.shapeId === bestTarget.shapeId) {
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
      bendPoints: orderedPoints.length >= 3 ? [orderedPoints[Math.floor(orderedPoints.length / 2)]] : undefined,
    });
  });

  return { edges, unresolvedArrows };
}

function isShapeDetection(det: DetectionBox): det is DetectionBox & { kind: ShapeType } {
  return det.kind === 'oval' || det.kind === 'rectangle' || det.kind === 'diamond' || det.kind === 'parallelogram';
}

export function buildGraphFromDetections(detections: DetectionBox[], ink: InkMask): FlowGraph {
  const shapeDetections = detections.filter(isShapeDetection);
  const arrowheads = detections.filter((d) => d.kind === 'arrowhead' || d.kind === 'arrow');

  const nodes: FlowNode[] = shapeDetections.map((s) => ({
    id: s.id,
    shape: s.kind,
    label: s.label ?? s.kind,
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
