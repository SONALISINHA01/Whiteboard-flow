import { GRAPH_FORMAT_VERSION, type FlowGraph } from './types';

export const BLANK_FLOW_GRAPH: FlowGraph = {
  version: GRAPH_FORMAT_VERSION,
  nodes: [],
  edges: [],
  unresolvedArrows: [],
};

export const SAMPLE_FLOW_GRAPH: FlowGraph = {
  version: GRAPH_FORMAT_VERSION,
  nodes: [
    {
      id: 'start',
      shape: 'oval',
      label: 'Start',
      position: { x: 245, y: 30 },
      width: 150,
      height: 64,
    },
    {
      id: 'check-input',
      shape: 'diamond',
      label: 'Check input',
      position: { x: 230, y: 145 },
      width: 180,
      height: 110,
    },
    {
      id: 'process-step',
      shape: 'rectangle',
      label: 'Process request',
      position: { x: 90, y: 315 },
      width: 160,
      height: 68,
    },
    {
      id: 'handle-error',
      shape: 'parallelogram',
      label: 'Show error',
      position: { x: 380, y: 315 },
      width: 170,
      height: 68,
    },
    {
      id: 'end',
      shape: 'oval',
      label: 'End',
      position: { x: 245, y: 445 },
      width: 150,
      height: 64,
    },
  ],
  edges: [
    {
      id: 'e-start-check',
      source: 'start',
      target: 'check-input',
    },
    {
      id: 'e-check-process',
      source: 'check-input',
      target: 'process-step',
      label: 'Valid',
    },
    {
      id: 'e-check-error',
      source: 'check-input',
      target: 'handle-error',
      label: 'Invalid',
    },
    {
      id: 'e-process-end',
      source: 'process-step',
      target: 'end',
    },
    {
      id: 'e-error-end',
      source: 'handle-error',
      target: 'end',
    },
  ],
  unresolvedArrows: [],
};

export const DECISION_TREE_GRAPH: FlowGraph = {
  version: GRAPH_FORMAT_VERSION,
  nodes: [
    {
      id: 'root',
      shape: 'diamond',
      label: 'Has account?',
      position: { x: 220, y: 40 },
      width: 180,
      height: 110,
    },
    {
      id: 'load-user',
      shape: 'database',
      label: 'User DB',
      position: { x: 80, y: 220 },
      width: 140,
      height: 84,
    },
    {
      id: 'register',
      shape: 'parallelogram',
      label: 'Sign up form',
      position: { x: 350, y: 228 },
      width: 170,
      height: 68,
    },
    {
      id: 'receipt',
      shape: 'document',
      label: 'Session log',
      position: { x: 220, y: 380 },
      width: 160,
      height: 76,
    },
  ],
  edges: [
    { id: 'e-root-db', source: 'root', target: 'load-user', label: 'Yes' },
    { id: 'e-root-reg', source: 'root', target: 'register', label: 'No' },
    { id: 'e-db-doc', source: 'load-user', target: 'receipt' },
    { id: 'e-reg-doc', source: 'register', target: 'receipt' },
  ],
  unresolvedArrows: [],
};

export type DiagramPresetKey = 'blank' | 'flowchart' | 'decision-tree';

export function getDiagramPreset(preset: DiagramPresetKey): FlowGraph {
  switch (preset) {
    case 'blank':
      return structuredClone(BLANK_FLOW_GRAPH);
    case 'decision-tree':
      return structuredClone(DECISION_TREE_GRAPH);
    case 'flowchart':
    default:
      return structuredClone(SAMPLE_FLOW_GRAPH);
  }
}
