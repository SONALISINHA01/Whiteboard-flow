import { describe, expect, it } from 'vitest';
import { SAMPLE_FLOW_GRAPH } from './sample';
import { parseFlowGraphJson, serializeFlowGraph } from './serializer';

describe('FlowGraph JSON serializer', () => {
  it('round-trips a FlowGraph including unresolvedArrows', () => {
    const withUnresolved = {
      ...SAMPLE_FLOW_GRAPH,
      unresolvedArrows: [
        {
          id: 'u1',
          suggestedSourceId: 'start',
          suggestedTargetId: 'check-input',
          points: [
            { x: 290, y: 104 },
            { x: 290, y: 170 },
          ],
          confidence: 0.6,
          reason: 'Two plausible paths',
        },
      ],
    };

    const json = serializeFlowGraph(withUnresolved);
    const parsed = parseFlowGraphJson(json);
    expect(parsed).toEqual(withUnresolved);
  });

  it('rejects unsupported graph versions', () => {
    expect(() => parseFlowGraphJson('{"version": 99, "nodes": [], "edges": []}')).toThrow(
      /Unsupported graph version/,
    );
  });
});
