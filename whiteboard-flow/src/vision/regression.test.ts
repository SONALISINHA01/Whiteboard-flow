import { describe, expect, it } from 'vitest';
import { exportToDrawio } from '../exporters/drawio';
import { exportToMermaid } from '../exporters/mermaid';
import { buildGraphFromDetections, type InkMask } from './arrowResolver';
import type { DetectionBox } from './coords';
import { filterAndDeduplicateDetections } from './shapeFilter';

function makeMask(width: number, height: number): InkMask {
  return { width, height, data: new Uint8Array(width * height) };
}

function drawSeg(ink: InkMask, x0: number, y0: number, x1: number, y1: number, radius = 2) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / steps);
    const y = Math.round(y0 + ((y1 - y0) * i) / steps);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (px >= 0 && px < ink.width && py >= 0 && py < ink.height) {
          ink.data[py * ink.width + px] = 1;
        }
      }
    }
  }
}

function drawBoxBorder(ink: InkMask, x: number, y: number, w: number, h: number) {
  drawSeg(ink, x, y, x + w, y);
  drawSeg(ink, x + w, y, x + w, y + h);
  drawSeg(ink, x + w, y + h, x, y + h);
  drawSeg(ink, x, y + h, x, y);
}

describe('end-to-end decision & linear flowchart regression', () => {
  it('filters tiny false-positive ovals & interior arrowheads and resolves START->VALID?->SAVE/FIX', () => {
    const W = 1303;
    const H = 977;
    const ink = makeMask(W, H);

    // Draw 4 real shape borders
    drawBoxBorder(ink, 480, 60, 340, 140); // START oval
    drawBoxBorder(ink, 430, 320, 440, 220); // VALID? diamond
    drawBoxBorder(ink, 120, 700, 320, 160); // SAVE rect
    drawBoxBorder(ink, 860, 700, 320, 160); // FIX rect

    // Draw 3 connector shafts touching destination borders
    drawSeg(ink, 650, 200, 650, 316, 3); // START -> VALID?
    drawSeg(ink, 540, 490, 280, 696, 3); // VALID? -> SAVE
    drawSeg(ink, 760, 490, 1020, 696, 3); // VALID? -> FIX

    const rawDetections: DetectionBox[] = [
      { id: 's-start', kind: 'oval', label: 'START', confidence: 0.94, box: { x: 480, y: 60, width: 340, height: 140 } },
      { id: 's-valid', kind: 'diamond', label: 'VALID?', confidence: 0.91, box: { x: 430, y: 320, width: 440, height: 220 } },
      { id: 's-save', kind: 'rectangle', label: 'SAVE', confidence: 0.96, box: { x: 120, y: 700, width: 320, height: 160 } },
      { id: 's-fix', kind: 'rectangle', label: 'FIX', confidence: 0.95, box: { x: 860, y: 700, width: 320, height: 160 } },
      // False-positive tiny ovals from 'D' in VALID? and 'O' in NO
      { id: 'fp-oval-d', kind: 'oval', confidence: 0.58, box: { x: 675, y: 405, width: 42, height: 48 } },
      { id: 'fp-oval-o', kind: 'oval', confidence: 0.55, box: { x: 960, y: 585, width: 32, height: 34 } },
      // False-positive arrowheads inside handwritten words
      { id: 'fp-ah-start', kind: 'arrowhead', confidence: 0.61, box: { x: 620, y: 110, width: 28, height: 28 } },
      { id: 'fp-ah-valid', kind: 'arrowhead', confidence: 0.64, box: { x: 580, y: 410, width: 30, height: 30 } },
      { id: 'fp-ah-no', kind: 'arrowhead', confidence: 0.52, box: { x: 910, y: 580, width: 24, height: 24 } },
      // Real 3 arrowheads
      { id: 'ah-1', kind: 'arrowhead', confidence: 0.88, box: { x: 632, y: 282, width: 36, height: 36 } },
      { id: 'ah-2', kind: 'arrowhead', label: 'YES', confidence: 0.86, box: { x: 266, y: 660, width: 36, height: 36 } },
      { id: 'ah-3', kind: 'arrowhead', label: 'NO', confidence: 0.85, box: { x: 998, y: 660, width: 36, height: 36 } },
    ];

    const filtered = filterAndDeduplicateDetections(rawDetections, ink, W, H);
    expect(filtered.acceptedShapes).toHaveLength(4);
    expect(filtered.doubtfulShapes.map((d) => d.id)).toContain('fp-oval-d');
    expect(filtered.doubtfulShapes.map((d) => d.id)).toContain('fp-oval-o');
    expect(filtered.rejectedArrowheads.map((d) => d.id)).toContain('fp-ah-start');
    expect(filtered.rejectedArrowheads.map((d) => d.id)).toContain('fp-ah-valid');

    const graph = buildGraphFromDetections(
      [...filtered.acceptedShapes, ...filtered.plausibleArrowheads],
      ink,
    );

    expect(graph.nodes).toHaveLength(4);
    expect(graph.edges).toHaveLength(3);
    expect(graph.unresolvedArrows).toHaveLength(0);

    const edgePairs = graph.edges.map((e) => `${e.source}->${e.target}:${e.label ?? ''}`);
    expect(edgePairs).toContain('s-start->s-valid:');
    expect(edgePairs).toContain('s-valid->s-save:YES');
    expect(edgePairs).toContain('s-valid->s-fix:NO');

    const xml = exportToDrawio(graph);
    expect(xml).toContain('value="START"');
    expect(xml).toContain('value="VALID?"');
    expect(xml).toContain('value="YES"');
    expect(xml).toContain('value="NO"');

    const mmd = exportToMermaid(graph);
    expect(mmd).toContain('s_start@{ shape: stadium, label: "START" }');
    expect(mmd).toContain('s_valid@{ shape: diam, label: "VALID?" }');
    expect(mmd).toContain('s_valid -->|"YES"| s_save');
    expect(mmd).toContain('s_valid -->|"NO"| s_fix');
  });

  it('resolves linear START -> READ -> END diagram into 3 shapes and 2 directed edges', () => {
    const W = 960;
    const H = 720;
    const ink = makeMask(W, H);

    drawBoxBorder(ink, 360, 60, 240, 100);
    drawBoxBorder(ink, 340, 290, 280, 120);
    drawBoxBorder(ink, 360, 540, 240, 100);

    drawSeg(ink, 480, 160, 480, 286, 3);
    drawSeg(ink, 480, 410, 480, 536, 3);

    const rawDetections: DetectionBox[] = [
      { id: 'n1', kind: 'oval', label: 'START', confidence: 0.95, box: { x: 360, y: 60, width: 240, height: 100 } },
      { id: 'n2', kind: 'rectangle', label: 'READ', confidence: 0.94, box: { x: 340, y: 290, width: 280, height: 120 } },
      { id: 'n3', kind: 'oval', label: 'END', confidence: 0.95, box: { x: 360, y: 540, width: 240, height: 100 } },
      { id: 'a1', kind: 'arrowhead', confidence: 0.9, box: { x: 465, y: 256, width: 30, height: 30 } },
      { id: 'a2', kind: 'arrowhead', confidence: 0.9, box: { x: 465, y: 506, width: 30, height: 30 } },
    ];

    const filtered = filterAndDeduplicateDetections(rawDetections, ink, W, H);
    const graph = buildGraphFromDetections(
      [...filtered.acceptedShapes, ...filtered.plausibleArrowheads],
      ink,
    );

    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges.map((e) => `${e.source}->${e.target}`)).toEqual(['n1->n2', 'n2->n3']);
  });
});
