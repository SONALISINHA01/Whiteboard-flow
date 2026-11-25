import { getShapeDefinition } from '../graph/shapes';
import type { FlowGraph, FlowNode } from '../graph/types';

export function escapeMermaidLabel(label: string): string {
  return label
    .replace(/&/g, '#amp;')
    .replace(/"/g, '#quot;')
    .replace(/</g, '#lt;')
    .replace(/>/g, '#gt;')
    .replace(/\r?\n/g, '<br/>');
}

function toStableMermaidId(rawId: string, usedIds: Set<string>): string {
  let base = rawId.replace(/[^A-Za-z0-9_]/g, '_');
  if (!/^[A-Za-z_]/.test(base)) {
    base = `n_${base}`;
  }
  if (!usedIds.has(base)) {
    usedIds.add(base);
    return base;
  }
  let suffix = 2;
  while (usedIds.has(`${base}_${suffix}`)) {
    suffix += 1;
  }
  const unique = `${base}_${suffix}`;
  usedIds.add(unique);
  return unique;
}

function formatMermaidNode(id: string, node: FlowNode): string {
  const escaped = escapeMermaidLabel(node.label);
  const { mermaidShape } = getShapeDefinition(node.shape);
  return `  ${id}@{ shape: ${mermaidShape}, label: "${escaped}" }`;
}

export function exportToMermaid(graph: FlowGraph): string {
  const usedIds = new Set<string>();
  const idMap = new Map<string, string>();

  for (const node of graph.nodes) {
    idMap.set(node.id, toStableMermaidId(node.id, usedIds));
  }

  const lines: string[] = ['flowchart TD'];

  for (const node of graph.nodes) {
    const mermaidId = idMap.get(node.id)!;
    lines.push(formatMermaidNode(mermaidId, node));
  }

  for (const edge of graph.edges) {
    const sourceId = idMap.get(edge.source) ?? edge.source;
    const targetId = idMap.get(edge.target) ?? edge.target;
    if (edge.label && edge.label.trim().length > 0) {
      lines.push(`  ${sourceId} -->|"${escapeMermaidLabel(edge.label)}"| ${targetId}`);
    } else {
      lines.push(`  ${sourceId} --> ${targetId}`);
    }
  }

  return lines.join('\n');
}
