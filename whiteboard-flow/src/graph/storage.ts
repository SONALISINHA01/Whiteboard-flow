import { SAMPLE_FLOW_GRAPH } from './sample';
import { parseFlowGraphJson, serializeFlowGraph } from './serializer';
import type { FlowGraph } from './types';

const GRAPH_STORAGE_KEY = 'whiteboard_flow_workspace_v2';
const TITLE_STORAGE_KEY = 'whiteboard_flow_title_v2';

export interface SavedWorkspace {
  graph: FlowGraph;
  title: string;
}

export function loadSavedWorkspace(): SavedWorkspace {
  try {
    const rawGraph = window.localStorage.getItem(GRAPH_STORAGE_KEY);
    const savedTitle = window.localStorage.getItem(TITLE_STORAGE_KEY);
    if (rawGraph) {
      return {
        graph: parseFlowGraphJson(rawGraph),
        title: savedTitle || 'Flowchart sample',
      };
    }
  } catch {
    // Ignore storage errors or malformed saved state
  }
  return {
    graph: structuredClone(SAMPLE_FLOW_GRAPH),
    title: 'Flowchart sample',
  };
}

export function saveWorkspace(graph: FlowGraph, title: string): void {
  try {
    window.localStorage.setItem(GRAPH_STORAGE_KEY, serializeFlowGraph(graph));
    window.localStorage.setItem(TITLE_STORAGE_KEY, title);
  } catch {
    // Ignore quota/private-mode errors
  }
}
