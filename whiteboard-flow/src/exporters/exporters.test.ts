import { describe, expect, it } from 'vitest';
import { exportToDrawio } from './drawio';
import { exportToMermaid } from './mermaid';
import { SAMPLE_FLOW_GRAPH } from '../graph/sample';
import { GRAPH_FORMAT_VERSION, type FlowGraph } from '../graph/types';

describe('exporters', () => {
  it('exports sample flowchart to valid .drawio XML with nodes and connectors', () => {
    const xml = exportToDrawio(SAMPLE_FLOW_GRAPH);

    expect(xml).toContain('<mxfile');
    expect(xml).toContain('id="start" value="Start" style="ellipse;whiteSpace=wrap;html=1;" vertex="1"');
    expect(xml).toContain('id="check-input" value="Check input" style="rhombus;whiteSpace=wrap;html=1;" vertex="1"');
    expect(xml).toContain('id="process-step" value="Process request" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1"');
    expect(xml).toContain('id="handle-error" value="Show error" style="shape=parallelogram;');
    expect(xml).toContain('id="end" value="End" style="ellipse;whiteSpace=wrap;html=1;" vertex="1"');
    expect(xml).toContain('edge="1" parent="1" source="start" target="check-input"');
    expect(xml).toContain('edge="1" parent="1" source="check-input" target="process-step"');
    expect(xml).toContain('edge="1" parent="1" source="check-input" target="handle-error"');
  });

  it('exports sample flowchart to Mermaid 11.3+ expanded shape syntax', () => {
    const mmd = exportToMermaid(SAMPLE_FLOW_GRAPH);

    expect(mmd).toContain('flowchart TD');
    expect(mmd).toContain('start@{ shape: stadium, label: "Start" }');
    expect(mmd).toContain('check_input@{ shape: diam, label: "Check input" }');
    expect(mmd).toContain('process_step@{ shape: rect, label: "Process request" }');
    expect(mmd).toContain('end@{ shape: stadium, label: "End" }');
    expect(mmd).toContain('start --> check_input');
    expect(mmd).toContain('check_input -->|"Valid"| process_step');
    expect(mmd).toContain('check_input -->|"Invalid"| handle_error');
  });

  it('escapes handwriting characters like Check "A & B"? in both .drawio and Mermaid', () => {
    const graph: FlowGraph = {
      version: GRAPH_FORMAT_VERSION,
      nodes: [
        {
          id: 'n1',
          shape: 'diamond',
          label: 'Check "A & B"?',
          position: { x: 0, y: 0 },
          width: 160,
          height: 100,
        },
        {
          id: 'n2',
          shape: 'oval',
          label: 'Done <ok>',
          position: { x: 0, y: 150 },
          width: 120,
          height: 60,
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'n1',
          target: 'n2',
          label: 'Yes & "Go"',
          bendPoints: [{ x: 80, y: 120 }],
        },
      ],
      unresolvedArrows: [],
    };

    const xml = exportToDrawio(graph);
    expect(xml).toContain('value="Check &quot;A &amp; B&quot;?"');
    expect(xml).toContain('value="Done &lt;ok&gt;"');
    expect(xml).toContain('value="Yes &amp; &quot;Go&quot;"');
    expect(xml).toContain('<mxPoint x="80" y="120"/>');

    const mmd = exportToMermaid(graph);
    expect(mmd).toContain('n1@{ shape: diam, label: "Check #quot;A #amp; B#quot;?" }');
    expect(mmd).toContain('n2@{ shape: stadium, label: "Done #lt;ok#gt;" }');
    expect(mmd).toContain('n1 -->|"Yes #amp; #quot;Go#quot;"| n2');
  });

  it('acceptance: add Database, connect it, swap Process -> Decision, and export both formats', () => {
    const graph: FlowGraph = structuredClone(SAMPLE_FLOW_GRAPH);
    // Add Database node and connect process-step -> users-db
    graph.nodes.push({
      id: 'users-db',
      shape: 'database',
      label: 'Users DB',
      position: { x: 460, y: 320 },
      width: 140,
      height: 84,
    });
    graph.edges.push({
      id: 'e-process-db',
      source: 'process-step',
      target: 'users-db',
      label: 'Persist',
    });

    // Change connected Process ('process-step') into Decision ('diamond') preserving ID and connections
    graph.nodes = graph.nodes.map((n) =>
      n.id === 'process-step' ? { ...n, shape: 'diamond' } : n,
    );

    const xml = exportToDrawio(graph);
    expect(xml).toContain('id="users-db" value="Users DB" style="shape=cylinder3;');
    expect(xml).toContain('id="process-step" value="Process request" style="rhombus;');
    expect(xml).toContain('source="process-step" target="users-db"');

    const mmd = exportToMermaid(graph);
    expect(mmd).toContain('users_db@{ shape: cyl, label: "Users DB" }');
    expect(mmd).toContain('process_step@{ shape: diam, label: "Process request" }');
    expect(mmd).toContain('process_step -->|"Persist"| users_db');
  });
});
