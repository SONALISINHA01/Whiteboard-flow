import { getShapeDefinition, SHAPE_LIST } from '../graph/shapes';
import type { FlowNode, ShapeType } from '../graph/types';

interface SelectedNodePanelProps {
  node: FlowNode;
  onLabelChange: (id: string, label: string) => void;
  onShapeChange: (id: string, shape: ShapeType) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

export function SelectedNodePanel({
  node,
  onLabelChange,
  onShapeChange,
  onDuplicate,
  onDelete,
}: SelectedNodePanelProps) {
  const shapeDef = getShapeDefinition(node.shape);

  return (
    <div className="wf-inspector-section" aria-label="Selected shape inspector">
      <div className="wf-inspector-meta">
        <span className="wf-type-badge">{shapeDef.displayName}</span>
        <span className="wf-hint">ID: {node.id}</span>
      </div>

      <label className="wf-field">
        <span>Label</span>
        <input
          type="text"
          value={node.label}
          onChange={(e) => onLabelChange(node.id, e.target.value)}
        />
      </label>

      <label className="wf-field">
        <span>Shape</span>
        <select
          value={node.shape}
          onChange={(e) => onShapeChange(node.id, e.target.value as ShapeType)}
        >
          {SHAPE_LIST.map((s) => (
            <option key={s.type} value={s.type}>
              {s.displayName}
            </option>
          ))}
        </select>
      </label>

      <div className="wf-inspector-actions">
        <button type="button" onClick={() => onDuplicate(node.id)}>
          Duplicate
        </button>
        <button type="button" className="wf-danger-btn" onClick={() => onDelete(node.id)}>
          Delete
        </button>
      </div>
    </div>
  );
}
