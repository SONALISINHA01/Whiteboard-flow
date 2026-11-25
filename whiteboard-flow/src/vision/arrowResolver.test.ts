import { describe, expect, it } from 'vitest';
import { exportToDrawio } from '../exporters/drawio';
import { exportToMermaid } from '../exporters/mermaid';
import type { DetectionBox } from './coords';
import { binarizeToInkMask, buildGraphFromDetections, resolveArrows, type InkMask } from './arrowResolver';

function createInkCanvas(width: number, height: number): InkMask {
  return { width, height, data: new Uint8Array(width * height) };
}

function drawInkLine(ink: InkMask, x0: number, y0: number, x1: number, y1: number, thickness = 2) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / steps);
    const y = Math.round(y0 + ((y1 - y0) * i) / steps);
    for (let dy = -thickness; dy <= thickness; dy++) {
      for (let dx = -thickness; dx <= thickness; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (px >= 0 && px < ink.width && py >= 0 && py < ink.height) {
          ink.data[py * ink.width + px] = 1;
        }
      }
    }
  }
}

describe('arrowResolver', () => {
  it('traces backward across a crossing stroke and tolerates small gaps', () => {
    const ink = createInkCanvas(400, 400);
    const shapes: DetectionBox[] = [
      { id: 'top', kind: 'oval', label: 'Start', confidence: 0.95, box: { x: 150, y: 20, width: 100, height: 50 } },
      { id: 'bottom', kind: 'oval', label: 'End', confidence: 0.95, box: { x: 150, y: 310, width: 100, height: 50 } },
      { id: 'left', kind: 'rectangle', label: 'Left', confidence: 0.9, box: { x: 20, y: 165, width: 70, height: 50 } },
      { id: 'right', kind: 'rectangle', label: 'Right', confidence: 0.9, box: { x: 310, y: 165, width: 70, height: 50 } },
    ];

    // Vertical shaft from top (y=78, slight 8px gap from box) to arrowhead at y=290
    // with a 10px mid-stroke gap around y=140..150
    drawInkLine(ink, 200, 78, 200, 140);
    drawInkLine(ink, 200, 150, 200, 290);

    // Crossing horizontal stroke from left to right
    drawInkLine(ink, 95, 190, 305, 190);

    const arrowheads: DetectionBox[] = [
      { id: 'ah-1', kind: 'arrowhead', confidence: 0.92, box: { x: 190, y: 286, width: 20, height: 18 } },
    ];

    const res = resolveArrows(shapes, arrowheads, ink);
    expect(res.edges).toHaveLength(1);
    expect(res.edges[0].source).toBe('top');
    expect(res.edges[0].target).toBe('bottom');
    expect(res.unresolvedArrows).toHaveLength(0);
  });

  it('surfaces an UnresolvedArrow when destination or source is missing/ambiguous', () => {
    const ink = createInkCanvas(300, 300);
    const shapes: DetectionBox[] = [
      { id: 'a', kind: 'rectangle', label: 'A', confidence: 0.9, box: { x: 30, y: 30, width: 80, height: 50 } },
      { id: 'b', kind: 'rectangle', label: 'B', confidence: 0.9, box: { x: 190, y: 30, width: 80, height: 50 } },
    ];
    // Arrowhead with no ink shaft
    const arrowheads: DetectionBox[] = [
      { id: 'ah-orphan', kind: 'arrowhead', label: 'Check?', confidence: 0.85, box: { x: 195, y: 20, width: 16, height: 16 } },
    ];

    const graph = buildGraphFromDetections([...shapes, ...arrowheads], ink);
    expect(graph.unresolvedArrows).toHaveLength(1);
    expect(graph.unresolvedArrows[0].suggestedTargetId).toBe('b');

    // Simulate user resolving the edge -> appears in both .drawio and Mermaid exports
    graph.edges.push({
      id: 'e-fixed',
      source: 'a',
      target: 'b',
      label: graph.unresolvedArrows[0].label,
    });
    graph.unresolvedArrows = [];

    expect(exportToDrawio(graph)).toContain('source="a" target="b"');
    expect(exportToMermaid(graph)).toContain('a -->|"Check?"| b');
  });

  it('binarizes RGBA whiteboard pixels into an ink mask', () => {
    const rgba = new Uint8ClampedArray(4 * 4 * 4).fill(245); // bright whiteboard
    // Make pixel (1,1) dark marker ink
    const idx = (1 * 4 + 1) * 4;
    rgba[idx] = 20;
    rgba[idx + 1] = 25;
    rgba[idx + 2] = 30;

    const mask = binarizeToInkMask(rgba, 4, 4);
    expect(mask.data[1 * 4 + 1]).toBe(1);
    expect(mask.data[0]).toBe(0);
  });
});
