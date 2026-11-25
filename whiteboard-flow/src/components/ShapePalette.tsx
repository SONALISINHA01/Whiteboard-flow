import { SHAPE_LIST } from '../graph/shapes';
import type { ShapeType } from '../graph/types';
import { ShapeSvgBackdrop } from './FlowNodeCard';

interface ShapePaletteProps {
  onAddShape: (shape: ShapeType) => void;
}

export function ShapePalette({ onAddShape }: ShapePaletteProps) {
  return (
    <aside className="wf-palette" aria-label="Add shape palette">
      <div className="wf-palette-title">Shapes</div>
      <div className="wf-palette-list">
        {SHAPE_LIST.map((entry) => (
          <button
            key={entry.type}
            type="button"
            className="wf-palette-item"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/whiteboard-shape', entry.type);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() => onAddShape(entry.type)}
            title={`Click or drag to add ${entry.displayName}`}
          >
            <span className="wf-palette-preview" aria-hidden="true">
              <ShapeSvgBackdrop shape={entry.type} width={30} height={22} tinted />
            </span>
            <span className="wf-palette-label">{entry.displayName}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
