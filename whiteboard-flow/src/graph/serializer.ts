import { GRAPH_FORMAT_VERSION, type FlowGraph } from './types';

export function serializeFlowGraph(graph: FlowGraph): string {
  return JSON.stringify(graph, null, 2);
}

export function parseFlowGraphJson(raw: string): FlowGraph {
  const parsed = JSON.parse(raw) as Partial<FlowGraph>;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid graph JSON: expected an object.');
  }
  if (parsed.version !== GRAPH_FORMAT_VERSION) {
    throw new Error(`Unsupported graph version: ${String(parsed.version)}. Expected ${GRAPH_FORMAT_VERSION}.`);
  }
  if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
    throw new Error('Invalid graph JSON: missing nodes or edges array.');
  }
  return {
    version: GRAPH_FORMAT_VERSION,
    nodes: parsed.nodes,
    edges: parsed.edges,
    unresolvedArrows: Array.isArray(parsed.unresolvedArrows) ? parsed.unresolvedArrows : [],
  };
}
