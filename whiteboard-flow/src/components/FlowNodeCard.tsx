import { useEffect, useRef, useState } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import type { ShapeType } from '../graph/types';

export interface FlowNodeData extends Record<string, unknown> {
  label: string;
  shape: ShapeType;
  width: number;
  height: number;
  connectMode?: boolean;
  onLabelChange: (id: string, newLabel: string) => void;
}

export function ShapeSvgBackdrop({
  shape,
  width,
  height,
  selected,
  tinted = false,
}: {
  shape: ShapeType;
  width: number;
  height: number;
  selected?: boolean;
  tinted?: boolean;
}) {
  const stroke = selected ? '#5145CD' : tinted ? '#5145CD' : '#73829F';
  const strokeWidth = selected ? 2.25 : 1.6;
  const fill = tinted ? '#EEF0FC' : '#FFFFFF';
  const pad = 2;
  const w = Math.max(16, width - pad * 2);
  const h = Math.max(14, height - pad * 2);

  return (
    <svg
      className="wf-node-svg"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden="true"
    >
      {shape === 'rectangle' && (
        <rect
          x={pad}
          y={pad}
          width={w}
          height={h}
          rx={6}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      )}
      {shape === 'oval' && (
        <rect
          x={pad}
          y={pad}
          width={w}
          height={h}
          rx={h / 2}
          ry={h / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      )}
      {shape === 'diamond' && (
        <polygon
          points={`${width / 2},${pad} ${width - pad},${height / 2} ${width / 2},${height - pad} ${pad},${height / 2}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      )}
      {shape === 'parallelogram' && (
        <polygon
          points={`${pad + w * 0.16},${pad} ${width - pad},${pad} ${width - pad - w * 0.16},${height - pad} ${pad},${height - pad}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      )}
      {shape === 'database' && (
        <g>
          <path
            d={`M ${pad} ${pad + Math.min(11, h * 0.28)} L ${pad} ${height - pad - Math.min(11, h * 0.28)} A ${w / 2} ${Math.min(11, h * 0.28)} 0 0 0 ${width - pad} ${height - pad - Math.min(11, h * 0.28)} L ${width - pad} ${pad + Math.min(11, h * 0.28)} Z`}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
          <ellipse
            cx={width / 2}
            cy={pad + Math.min(11, h * 0.28)}
            rx={w / 2}
            ry={Math.min(11, h * 0.28)}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        </g>
      )}
      {shape === 'document' && (
        <path
          d={`M ${pad} ${pad} L ${width - pad} ${pad} L ${width - pad} ${height - pad - Math.min(9, h * 0.24)} Q ${width * 0.75} ${height - pad - Math.min(16, h * 0.42)} ${width / 2} ${height - pad - Math.min(7, h * 0.18)} Q ${width * 0.25} ${height - pad + Math.min(3, h * 0.1)} ${pad} ${height - pad - Math.min(9, h * 0.24)} Z`}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

export function FlowNodeCard({ id, data, selected }: NodeProps) {
  const nodeData = data as FlowNodeData;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(nodeData.label);
  const inputRef = useRef<HTMLInputElement>(null);
  const updateNodeInternals = useUpdateNodeInternals();

  useEffect(() => {
    setDraft(nodeData.label);
  }, [nodeData.label]);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, nodeData.shape, nodeData.width, nodeData.height, updateNodeInternals]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== nodeData.label) {
      nodeData.onLabelChange(id, trimmed || nodeData.label);
    }
  };

  return (
    <div
      tabIndex={0}
      className={`wf-node ${selected ? 'wf-node--selected' : ''} ${nodeData.connectMode ? 'wf-node--connecting' : ''}`}
      style={{ width: nodeData.width, height: nodeData.height }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      title="Double-click to edit label"
    >
      <ShapeSvgBackdrop
        shape={nodeData.shape}
        width={nodeData.width}
        height={nodeData.height}
        selected={selected}
      />

      <Handle type="target" position={Position.Top} id="top" className="wf-handle" />
      <Handle type="target" position={Position.Left} id="left" className="wf-handle" />
      <div className="wf-node-content">
        {editing ? (
          <input
            ref={inputRef}
            className="wf-node-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setDraft(nodeData.label);
                setEditing(false);
              }
            }}
          />
        ) : (
          <span className="wf-node-label">{nodeData.label}</span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} id="bottom" className="wf-handle" />
      <Handle type="source" position={Position.Right} id="right" className="wf-handle" />
    </div>
  );
}
