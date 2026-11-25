import { useState } from 'react';
import type { FlowNode, UnresolvedArrow } from '../graph/types';

interface UnresolvedArrowsPanelProps {
  unresolvedArrows: UnresolvedArrow[];
  nodes: FlowNode[];
  croppedPhotoUrl: string | null;
  photoWidth: number;
  photoHeight: number;
  onResolve: (arrowId: string, sourceId: string, targetId: string, label?: string) => void;
  onDismiss: (arrowId: string) => void;
}

function getArrowViewport(arrow: UnresolvedArrow, photoWidth: number, photoHeight: number) {
  const xs = arrow.points.map((p) => p.x);
  const ys = arrow.points.map((p) => p.y);
  const minX = Math.max(0, Math.min(...xs) - 48);
  const minY = Math.max(0, Math.min(...ys) - 48);
  const maxX = Math.min(photoWidth, Math.max(...xs) + 48);
  const maxY = Math.min(photoHeight, Math.max(...ys) + 48);
  return {
    x: minX,
    y: minY,
    width: Math.max(80, maxX - minX),
    height: Math.max(80, maxY - minY),
  };
}

export function UnresolvedArrowsPanel({
  unresolvedArrows,
  nodes,
  croppedPhotoUrl,
  photoWidth,
  photoHeight,
  onResolve,
  onDismiss,
}: UnresolvedArrowsPanelProps) {
  const [selections, setSelections] = useState<
    Record<string, { source: string; target: string; label: string }>
  >({});

  if (unresolvedArrows.length === 0) return null;

  return (
    <section className="wf-unresolved-panel">
      <div className="wf-unresolved-header">
        <strong>Uncertain Arrows ({unresolvedArrows.length})</strong>
        <span className="wf-hint">Review the photo crop and select source &amp; destination</span>
      </div>

      <div className="wf-unresolved-list">
        {unresolvedArrows.map((arrow) => {
          const current = selections[arrow.id] ?? {
            source: arrow.suggestedSourceId ?? nodes[0]?.id ?? '',
            target: arrow.suggestedTargetId ?? nodes[1]?.id ?? nodes[0]?.id ?? '',
            label: arrow.label ?? '',
          };
          const vp = getArrowViewport(arrow, photoWidth, photoHeight);
          const polyPoints = arrow.points.map((p) => `${p.x},${p.y}`).join(' ');

          return (
            <div key={arrow.id} className="wf-unresolved-card">
              {croppedPhotoUrl && (
                <svg
                  className="wf-unresolved-crop"
                  viewBox={`${vp.x} ${vp.y} ${vp.width} ${vp.height}`}
                >
                  <image href={croppedPhotoUrl} x={0} y={0} width={photoWidth} height={photoHeight} />
                  {arrow.points.length >= 2 && (
                    <polyline
                      points={polyPoints}
                      fill="none"
                      stroke="#ea580c"
                      strokeWidth={Math.max(3, vp.width * 0.02)}
                      strokeDasharray="6 4"
                    />
                  )}
                </svg>
              )}

              <div className="wf-unresolved-controls">
                <div className="wf-hint">{arrow.reason ?? 'Ambiguous connection'}</div>

                <label>
                  Source:
                  <select
                    value={current.source}
                    onChange={(e) =>
                      setSelections((prev) => ({
                        ...prev,
                        [arrow.id]: { ...current, source: e.target.value },
                      }))
                    }
                  >
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.label} ({n.id})
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Destination:
                  <select
                    value={current.target}
                    onChange={(e) =>
                      setSelections((prev) => ({
                        ...prev,
                        [arrow.id]: { ...current, target: e.target.value },
                      }))
                    }
                  >
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.label} ({n.id})
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Label:
                  <input
                    type="text"
                    value={current.label}
                    placeholder="Optional"
                    onChange={(e) =>
                      setSelections((prev) => ({
                        ...prev,
                        [arrow.id]: { ...current, label: e.target.value },
                      }))
                    }
                  />
                </label>

                <div className="wf-unresolved-btns">
                  <button
                    type="button"
                    className="wf-primary-btn"
                    disabled={!current.source || !current.target}
                    onClick={() =>
                      onResolve(
                        arrow.id,
                        current.source,
                        current.target,
                        current.label.trim() || undefined,
                      )
                    }
                  >
                    Confirm Edge
                  </button>
                  <button type="button" onClick={() => onDismiss(arrow.id)}>
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
