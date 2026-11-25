export const GRAPH_FORMAT_VERSION = 1 as const;

export type ShapeType =
  | 'rectangle'
  | 'oval'
  | 'diamond'
  | 'parallelogram'
  | 'database'
  | 'document';

export interface Point {
  x: number;
  y: number;
}

export interface FlowNode {
  id: string;
  shape: ShapeType;
  label: string;
  position: Point;
  width: number;
  height: number;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  bendPoints?: Point[];
}

export interface UnresolvedArrow {
  id: string;
  suggestedSourceId?: string;
  suggestedTargetId?: string;
  points: Point[];
  label?: string;
  confidence: number;
  reason?: string;
}

export interface FlowGraph {
  version: typeof GRAPH_FORMAT_VERSION;
  nodes: FlowNode[];
  edges: FlowEdge[];
  unresolvedArrows: UnresolvedArrow[];
}
