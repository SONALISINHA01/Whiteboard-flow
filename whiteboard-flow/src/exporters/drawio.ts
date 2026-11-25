import { getShapeDefinition } from '../graph/shapes';
import type { FlowEdge, FlowGraph, FlowNode } from '../graph/types';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function renderNodeCell(node: FlowNode): string {
  const id = escapeXml(node.id);
  const label = escapeXml(node.label);
  const style = getShapeDefinition(node.shape).drawioStyle;
  const x = Math.round(node.position.x);
  const y = Math.round(node.position.y);
  const width = Math.round(node.width);
  const height = Math.round(node.height);

  return [
    `        <mxCell id="${id}" value="${label}" style="${style}" vertex="1" parent="1">`,
    `          <mxGeometry x="${x}" y="${y}" width="${width}" height="${height}" as="geometry"/>`,
    '        </mxCell>',
  ].join('\n');
}

function renderEdgeCell(edge: FlowEdge): string {
  const id = escapeXml(edge.id);
  const label = edge.label ? escapeXml(edge.label) : '';
  const source = escapeXml(edge.source);
  const target = escapeXml(edge.target);
  const style = 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;';

  if (edge.bendPoints && edge.bendPoints.length > 0) {
    const pointsXml = edge.bendPoints
      .map((pt) => `              <mxPoint x="${Math.round(pt.x)}" y="${Math.round(pt.y)}"/>`)
      .join('\n');
    return [
      `        <mxCell id="${id}" value="${label}" style="${style}" edge="1" parent="1" source="${source}" target="${target}">`,
      '          <mxGeometry relative="1" as="geometry">',
      '            <Array as="points">',
      pointsXml,
      '            </Array>',
      '          </mxGeometry>',
      '        </mxCell>',
    ].join('\n');
  }

  return [
    `        <mxCell id="${id}" value="${label}" style="${style}" edge="1" parent="1" source="${source}" target="${target}">`,
    '          <mxGeometry relative="1" as="geometry"/>',
    '        </mxCell>',
  ].join('\n');
}

export function exportToDrawio(graph: FlowGraph): string {
  const nodeCells = graph.nodes.map(renderNodeCell).join('\n');
  const edgeCells = graph.edges.map(renderEdgeCell).join('\n');

  return [
    '<mxfile host="app.diagrams.net" modified="2026-01-01T00:00:00.000Z" agent="whiteboard-flow" version="24.0.0">',
    '  <diagram id="flowchart-1" name="Flowchart">',
    '    <mxGraphModel dx="1000" dy="1000" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100">',
    '      <root>',
    '        <mxCell id="0"/>',
    '        <mxCell id="1" parent="0"/>',
    nodeCells,
    edgeCells,
    '      </root>',
    '    </mxGraphModel>',
    '  </diagram>',
    '</mxfile>',
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}
