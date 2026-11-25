import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  reconnectEdge,
  useReactFlow,
  useViewport,
  type Connection,
  type Edge,
  type Node,
  type OnEdgesChange,
  type OnNodesChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './App.css';
import { BrandIcon } from './components/BrandIcon';
import { FlowNodeCard, type FlowNodeData } from './components/FlowNodeCard';
import { PhotoPanel, type PhotoPanelHandle } from './components/PhotoPanel';
import { SelectedNodePanel } from './components/SelectedNodePanel';
import { ShapePalette } from './components/ShapePalette';
import { UnresolvedArrowsPanel } from './components/UnresolvedArrowsPanel';
import { exportToDrawio } from './exporters/drawio';
import { exportToMermaid } from './exporters/mermaid';
import { getDiagramPreset, type DiagramPresetKey } from './graph/sample';
import { parseFlowGraphJson, serializeFlowGraph } from './graph/serializer';
import { getShapeDefinition } from './graph/shapes';
import { loadSavedWorkspace, saveWorkspace } from './graph/storage';
import type { FlowGraph, ShapeType, UnresolvedArrow } from './graph/types';

const nodeTypes = {
  flowShape: FlowNodeCard,
};

function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function WhiteboardFlowEditor() {
  const initialWorkspace = useMemo(() => loadSavedWorkspace(), []);
  const [graph, setGraph] = useState<FlowGraph>(initialWorkspace.graph);
  const [diagramTitle, setDiagramTitle] = useState(initialWorkspace.title);
  const [past, setPast] = useState<FlowGraph[]>([]);
  const [future, setFuture] = useState<FlowGraph[]>([]);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(() =>
    initialWorkspace.graph.nodes.some((n) => n.id === 'check-input') ? 'check-input' : null,
  );
  const [diagramLoadKey, setDiagramLoadKey] = useState(0);
  const rfInstanceRef = useRef<{ fitView: (opts?: { padding?: number; maxZoom?: number; duration?: number }) => void } | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null);
  const [highlightedArrow, setHighlightedArrow] = useState<UnresolvedArrow | null>(null);

  const [hasPhoto, setHasPhoto] = useState(false);
  const [rightTab, setRightTab] = useState<'inspector' | 'photo'>('inspector');
  const [mobileSection, setMobileSection] = useState<'canvas' | 'inspector' | 'photo'>('canvas');
  const [showMinimap, setShowMinimap] = useState(false);

  const [statusStep, setStatusStep] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<'file' | 'export' | null>(null);
  const [exportPreview, setExportPreview] = useState<{ title: string; content: string } | null>(null);
  const [photoMeta, setPhotoMeta] = useState<{ dataUrl: string; width: number; height: number } | null>(null);

  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const photoPanelRef = useRef<PhotoPanelHandle>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLElement>(null);
  const { screenToFlowPosition, zoomIn, zoomOut, fitView } = useReactFlow();
  const viewport = useViewport();

  useEffect(() => {
    saveWorkspace(graph, diagramTitle);
  }, [graph, diagramTitle]);

  useEffect(() => {
    const closeMenus = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as globalThis.Node)) {
        setOpenMenu(null);
      }
    };
    window.addEventListener('mousedown', closeMenus);
    return () => window.removeEventListener('mousedown', closeMenus);
  }, []);

  const commitGraph = useCallback((updater: (prev: FlowGraph) => FlowGraph) => {
    setGraph((prev) => {
      const next = updater(prev);
      if (next === prev) return prev;
      setPast((p) => [...p.slice(-29), prev]);
      setFuture([]);
      return next;
    });
  }, []);

  const handleUndo = () => {
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [graph, ...f]);
    setGraph(previous);
  };

  const handleRedo = () => {
    if (future.length === 0) return;
    const next = future[0];
    setFuture((f) => f.slice(1));
    setPast((p) => [...p, graph]);
    setGraph(next);
  };

  const handleLabelChange = useCallback(
    (nodeId: string, newLabel: string) => {
      commitGraph((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, label: newLabel } : n)),
      }));
    },
    [commitGraph],
  );

  const handleShapeChange = useCallback(
    (nodeId: string, newShape: ShapeType) => {
      // Preserve ID, label, position, and all connected edges
      commitGraph((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, shape: newShape } : n)),
      }));
    },
    [commitGraph],
  );

  const handleDuplicateNode = useCallback(
    (nodeId: string) => {
      const src = graph.nodes.find((n) => n.id === nodeId);
      if (!src) return;
      const copyId = `${src.shape}-${Date.now().toString(36)}`;
      commitGraph((prev) => ({
        ...prev,
        nodes: [
          ...prev.nodes,
          {
            ...src,
            id: copyId,
            position: { x: src.position.x + 28, y: src.position.y + 28 },
          },
        ],
      }));
      setSelectedNodeId(copyId);
    },
    [commitGraph, graph.nodes],
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      commitGraph((prev) => ({
        ...prev,
        nodes: prev.nodes.filter((n) => n.id !== nodeId),
        edges: prev.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
      }));
      setSelectedNodeId((curr) => (curr === nodeId ? null : curr));
    },
    [commitGraph],
  );

  const addShapeAt = useCallback(
    (shape: ShapeType, position?: { x: number; y: number }) => {
      const def = getShapeDefinition(shape);
      let targetPos = position;
      if (!targetPos && canvasWrapperRef.current) {
        const rect = canvasWrapperRef.current.getBoundingClientRect();
        const stagger = (graph.nodes.length % 5) * 24;
        targetPos = screenToFlowPosition({
          x: rect.left + rect.width / 2 - def.defaultWidth / 2 + stagger,
          y: rect.top + rect.height / 2 - def.defaultHeight / 2 + stagger,
        });
      }
      const newId = `${shape}-${Date.now().toString(36)}`;
      commitGraph((prev) => ({
        ...prev,
        nodes: [
          ...prev.nodes,
          {
            id: newId,
            shape,
            label: def.defaultLabel,
            position: targetPos ?? { x: 180, y: 140 },
            width: def.defaultWidth,
            height: def.defaultHeight,
          },
        ],
      }));
      setSelectedNodeId(newId);
    },
    [commitGraph, graph.nodes.length, screenToFlowPosition],
  );

  const handleDropOnCanvas = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const shape = event.dataTransfer.getData('application/whiteboard-shape') as ShapeType;
      if (!shape) return;
      const def = getShapeDefinition(shape);
      const pos = screenToFlowPosition({
        x: event.clientX - def.defaultWidth / 2,
        y: event.clientY - def.defaultHeight / 2,
      });
      addShapeAt(shape, pos);
    },
    [addShapeAt, screenToFlowPosition],
  );

  const rfNodes: Node<FlowNodeData>[] = useMemo(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: 'flowShape',
        position: n.position,
        selected: n.id === selectedNodeId || n.id === connectSourceId,
        data: {
          label: n.label,
          shape: n.shape,
          width: n.width,
          height: n.height,
          connectMode,
          onLabelChange: handleLabelChange,
        },
      })),
    [connectMode, connectSourceId, graph.nodes, handleLabelChange, selectedNodeId],
  );

  const rfEdges: Edge[] = useMemo(
    () => [
      ...graph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        reconnectable: true,
        style: { stroke: '#73829F', strokeWidth: 1.9 },
        labelStyle: {
          fill: '#20263C',
          fontWeight: 600,
          fontSize: 13,
          fontFamily: 'Inter, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
        },
        labelBgStyle: { fill: '#FFFFFF', fillOpacity: 0.96, stroke: '#E2E5F0', strokeWidth: 1 },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 6,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#73829F', width: 16, height: 16 },
      })),
      ...graph.unresolvedArrows
        .filter((u) => u.suggestedSourceId && u.suggestedTargetId)
        .map((u) => ({
          id: `amber-${u.id}`,
          source: u.suggestedSourceId!,
          target: u.suggestedTargetId!,
          label: u.label ? `Review: ${u.label}` : 'Needs review',
          animated: true,
          style: { stroke: '#B45309', strokeWidth: 2, strokeDasharray: '5 4' },
          labelStyle: {
            fill: '#B45309',
            fontWeight: 600,
            fontSize: 13,
            fontFamily: 'Inter, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
          },
          labelBgStyle: { fill: '#FFFBEB', fillOpacity: 0.98, stroke: '#FCD34D', strokeWidth: 1 },
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 6,
          markerEnd: { type: MarkerType.ArrowClosed, color: '#B45309', width: 16, height: 16 },
        })),
    ],
    [graph.edges, graph.unresolvedArrows],
  );

  const onNodesChange: OnNodesChange<Node<FlowNodeData>> = useCallback((changes) => {
    setGraph((prev) => {
      let updatedNodes = prev.nodes;
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          updatedNodes = updatedNodes.map((n) =>
            n.id === change.id ? { ...n, position: change.position! } : n,
          );
        } else if (change.type === 'remove') {
          updatedNodes = updatedNodes.filter((n) => n.id !== change.id);
        } else if (change.type === 'select' && change.selected) {
          setSelectedNodeId(change.id);
        }
      }
      return { ...prev, nodes: updatedNodes };
    });
  }, []);

  const onEdgesChange: OnEdgesChange<Edge> = useCallback(
    (changes) => {
      const removals: string[] = [];
      for (const change of changes) {
        if (change.type === 'remove') removals.push(change.id);
      }
      if (removals.length === 0) return;
      commitGraph((prev) => ({
        ...prev,
        edges: prev.edges.filter((e) => !removals.includes(e.id)),
      }));
    },
    [commitGraph],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      commitGraph((prev) => {
        const next = addEdge(
          {
            ...connection,
            id: `e-${connection.source}-${connection.target}-${Date.now()}`,
          },
          prev.edges.map((e): Edge => ({ id: e.id, source: e.source, target: e.target, label: e.label })),
        );
        return {
          ...prev,
          edges: next.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            label: typeof e.label === 'string' ? e.label : undefined,
          })),
        };
      });
    },
    [commitGraph],
  );

  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      commitGraph((prev) => {
        const reconnected = reconnectEdge(
          oldEdge,
          newConnection,
          prev.edges.map((e): Edge => ({ id: e.id, source: e.source, target: e.target, label: e.label })),
        );
        return {
          ...prev,
          edges: reconnected.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            label: typeof e.label === 'string' ? e.label : undefined,
          })),
        };
      });
    },
    [commitGraph],
  );

  const handlePhotoSelected = useCallback((selected: boolean) => {
    setHasPhoto(selected);
    if (selected) {
      setRightTab('photo');
      setMobileSection('photo');
    }
  }, []);

  const handleGraphBuilt = useCallback(
    (built: FlowGraph, meta: { dataUrl: string; width: number; height: number }) => {
      commitGraph(() => built);
      setDiagramTitle('Converted diagram');
      setPhotoMeta(meta);
      setSelectedNodeId(null);
      setHighlightedArrow(built.unresolvedArrows[0] ?? null);
      setRightTab('inspector');
      setMobileSection('canvas');
      setDiagramLoadKey((k) => k + 1);
    },
    [commitGraph],
  );

  const handleResolveArrow = useCallback(
    (arrowId: string, sourceId: string, targetId: string, label?: string) => {
      commitGraph((prev) => {
        const arrow = prev.unresolvedArrows.find((a) => a.id === arrowId);
        const midPoint =
          arrow && arrow.points.length >= 3
            ? [arrow.points[Math.floor(arrow.points.length / 2)]]
            : undefined;
        return {
          ...prev,
          edges: [
            ...prev.edges,
            {
              id: `e-resolved-${arrowId}-${Date.now()}`,
              source: sourceId,
              target: targetId,
              label,
              bendPoints: midPoint,
            },
          ],
          unresolvedArrows: prev.unresolvedArrows.filter((a) => a.id !== arrowId),
        };
      });
      setHighlightedArrow(null);
    },
    [commitGraph],
  );

  const handleDismissArrow = useCallback(
    (arrowId: string) => {
      commitGraph((prev) => ({
        ...prev,
        unresolvedArrows: prev.unresolvedArrows.filter((a) => a.id !== arrowId),
      }));
      setHighlightedArrow((curr) => (curr?.id === arrowId ? null : curr));
    },
    [commitGraph],
  );

  const handleOpenJson = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      try {
        const loaded = parseFlowGraphJson(reader.result);
        commitGraph(() => loaded);
        setDiagramTitle(file.name.replace(/\.json$/i, ''));
        setSelectedNodeId(loaded.nodes[0]?.id ?? null);
        setDiagramLoadKey((k) => k + 1);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setExportPreview({ title: 'Project Load Error', content: message });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const applyPreset = (preset: DiagramPresetKey) => {
    const nextGraph = getDiagramPreset(preset);
    commitGraph(() => nextGraph);
    setDiagramTitle(
      preset === 'blank' ? 'Untitled diagram' : preset === 'decision-tree' ? 'Decision tree' : 'Flowchart sample',
    );
    setSelectedNodeId(preset === 'flowchart' ? 'check-input' : null);
    setOpenMenu(null);
    setDiagramLoadKey((k) => k + 1);
  };

  useEffect(() => {
    if (diagramLoadKey === 0) return;
    const raf = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        rfInstanceRef.current?.fitView({ padding: 0.18, maxZoom: 1.1, duration: 150 });
      });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [diagramLoadKey]);

  const selectedNode = useMemo(
    () => graph.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [graph.nodes, selectedNodeId],
  );

  const reviewCount = graph.unresolvedArrows.length;

  return (
    <div className="wf-app">
      <header ref={toolbarRef} className="wf-header">
        <a href="#/" className="wf-brand wf-brand-link" title="Back to Whiteboard Flow home">
          <BrandIcon />
          <span className="wf-brand-title">Whiteboard Flow</span>
        </a>

        <div className="wf-header-actions">
          <div className="wf-btn-group">
            <button type="button" onClick={handleUndo} disabled={past.length === 0}>
              Undo
            </button>
            <button type="button" onClick={handleRedo} disabled={future.length === 0}>
              Redo
            </button>
          </div>

          <div className="wf-menu-wrap">
            <button
              type="button"
              aria-expanded={openMenu === 'file'}
              onClick={() => setOpenMenu((m) => (m === 'file' ? null : 'file'))}
            >
              File ▾
            </button>
            {openMenu === 'file' && (
              <div className="wf-dropdown" role="menu">
                <div className="wf-dropdown-label">New diagram</div>
                <button type="button" role="menuitem" onClick={() => applyPreset('blank')}>
                  Blank
                </button>
                <button type="button" role="menuitem" onClick={() => applyPreset('flowchart')}>
                  Flowchart
                </button>
                <button type="button" role="menuitem" onClick={() => applyPreset('decision-tree')}>
                  Decision tree
                </button>
                <hr className="wf-dropdown-sep" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpenMenu(null);
                    jsonInputRef.current?.click();
                  }}
                >
                  Open project
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpenMenu(null);
                    downloadFile('whiteboard-graph.json', serializeFlowGraph(graph), 'application/json');
                  }}
                >
                  Save project
                </button>
              </div>
            )}
          </div>

          <div className="wf-photo-action-group">
            <button
              type="button"
              className={!hasPhoto ? 'wf-primary-btn' : ''}
              onClick={() => {
                setRightTab('photo');
                setMobileSection('photo');
                photoPanelRef.current?.openFilePicker();
              }}
            >
              Open photo
            </button>

            {hasPhoto && (
              <button
                type="button"
                className="wf-primary-btn"
                disabled={statusStep !== null}
                onClick={() => photoPanelRef.current?.convertPhoto()}
              >
                Convert
              </button>
            )}

            {statusStep && <span className="wf-status-pill">{statusStep}</span>}
          </div>

          <div className="wf-menu-wrap">
            <button
              type="button"
              aria-expanded={openMenu === 'export'}
              onClick={() => setOpenMenu((m) => (m === 'export' ? null : 'export'))}
            >
              Export ▾
            </button>
            {openMenu === 'export' && (
              <div className="wf-dropdown wf-dropdown--right" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpenMenu(null);
                    const xml = exportToDrawio(graph);
                    setExportPreview({ title: 'flowchart.drawio', content: xml });
                    downloadFile('flowchart.drawio', xml, 'application/xml');
                  }}
                >
                  draw.io
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpenMenu(null);
                    const mmd = exportToMermaid(graph);
                    setExportPreview({ title: 'flowchart.mmd', content: mmd });
                    downloadFile('flowchart.mmd', mmd, 'text/plain');
                  }}
                >
                  Mermaid
                </button>
              </div>
            )}
          </div>

          <input
            ref={jsonInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleOpenJson}
            hidden
          />
        </div>
      </header>

      <div className="wf-mobile-tabs" role="tablist" aria-label="Mobile workspace view">
        <button
          type="button"
          role="tab"
          aria-selected={mobileSection === 'canvas'}
          className={mobileSection === 'canvas' ? 'wf-tab-active' : ''}
          onClick={() => setMobileSection('canvas')}
        >
          Diagram
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobileSection === 'inspector'}
          className={mobileSection === 'inspector' ? 'wf-tab-active' : ''}
          onClick={() => {
            setRightTab('inspector');
            setMobileSection('inspector');
          }}
        >
          Inspector{reviewCount > 0 ? ` (${reviewCount})` : ''}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobileSection === 'photo'}
          className={mobileSection === 'photo' ? 'wf-tab-active' : ''}
          onClick={() => {
            setRightTab('photo');
            setMobileSection('photo');
          }}
        >
          Photo
        </button>
      </div>

      <div className="wf-workspace">
        <div className={`wf-left-col ${mobileSection === 'canvas' ? 'wf-mobile-show-block' : 'wf-mobile-hide'}`}>
          <ShapePalette onAddShape={(shape) => addShapeAt(shape)} />
        </div>

        <section
          className={`wf-canvas-panel ${mobileSection === 'canvas' ? 'wf-mobile-show-flex' : 'wf-mobile-hide'}`}
        >
          <div className="wf-canvas-header">
            <div className="wf-canvas-title-wrap">
              <span className="wf-canvas-title">{diagramTitle}</span>
              <span className="wf-hint">
                {graph.nodes.length} shapes · {graph.edges.length} arrows
              </span>
              {reviewCount > 0 && (
                <button
                  type="button"
                  className="wf-review-pill"
                  onClick={() => {
                    setRightTab('inspector');
                    setMobileSection('inspector');
                  }}
                >
                  {reviewCount} to review
                </button>
              )}
            </div>

            <button
              type="button"
              className={`wf-connect-btn ${connectMode ? 'wf-connect-btn--active' : ''}`}
              onClick={() => {
                setConnectMode((v) => !v);
                setConnectSourceId(null);
              }}
            >
              {connectMode
                ? connectSourceId
                  ? 'Click target…'
                  : 'Click source…'
                : 'Connect'}
            </button>
          </div>

          <div
            ref={canvasWrapperRef}
            className="wf-canvas"
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }}
            onDrop={handleDropOnCanvas}
          >
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={nodeTypes}
              onInit={(instance) => {
                rfInstanceRef.current = instance;
                window.requestAnimationFrame(() => {
                  window.requestAnimationFrame(() => {
                    instance.fitView({ padding: 0.18, maxZoom: 1.1 });
                  });
                });
              }}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onReconnect={onReconnect}
              onNodeClick={(_e, node) => {
                if (connectMode) {
                  if (!connectSourceId) {
                    setConnectSourceId(node.id);
                  } else if (connectSourceId !== node.id) {
                    onConnect({
                      source: connectSourceId,
                      target: node.id,
                      sourceHandle: null,
                      targetHandle: null,
                    });
                    setConnectSourceId(null);
                    setConnectMode(false);
                  }
                  return;
                }
                setSelectedNodeId(node.id);
              }}
              onPaneClick={() => {
                setSelectedNodeId(null);
                setConnectSourceId(null);
              }}
              onEdgeClick={(_e, edge) => {
                if (edge.id.startsWith('amber-')) {
                  const arrowId = edge.id.replace('amber-', '');
                  const arrow = graph.unresolvedArrows.find((a) => a.id === arrowId) ?? null;
                  setHighlightedArrow(arrow);
                  setRightTab('photo');
                  setMobileSection('photo');
                }
              }}
              fitView
              fitViewOptions={{ padding: 0.18, maxZoom: 1.1 }}
              minZoom={0.25}
              maxZoom={1.5}
            >
              <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} color="#D8DEEC" />
              {showMinimap && <MiniMap pannable zoomable />}
            </ReactFlow>
          </div>

          <footer className="wf-canvas-footer">
            <div className="wf-zoom-controls">
              <button type="button" onClick={() => zoomOut({ duration: 150 })} aria-label="Zoom out">
                −
              </button>
              <span className="wf-zoom-readout">{Math.round(viewport.zoom * 100)}%</span>
              <button type="button" onClick={() => zoomIn({ duration: 150 })} aria-label="Zoom in">
                +
              </button>
              <button
                type="button"
                onClick={() => fitView({ padding: 0.18, maxZoom: 1.1, duration: 200 })}
              >
                Fit
              </button>
            </div>
            <button
              type="button"
              className="wf-minimap-toggle"
              onClick={() => setShowMinimap((v) => !v)}
            >
              {showMinimap ? 'Hide map' : 'Map'}
            </button>
          </footer>
        </section>

        <aside
          className={`wf-right-panel ${mobileSection === 'inspector' || mobileSection === 'photo'
            ? 'wf-mobile-show-flex'
            : 'wf-mobile-hide'
            }`}
        >
          <div className="wf-right-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={rightTab === 'inspector'}
              className={rightTab === 'inspector' ? 'wf-right-tab--active' : ''}
              onClick={() => setRightTab('inspector')}
            >
              Inspector
              {reviewCount > 0 && <span className="wf-tab-badge">{reviewCount}</span>}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={rightTab === 'photo'}
              className={rightTab === 'photo' ? 'wf-right-tab--active' : ''}
              onClick={() => setRightTab('photo')}
            >
              Photo
            </button>
          </div>

          <div className={`wf-right-body ${rightTab === 'inspector' ? '' : 'wf-hidden'}`}>
            {selectedNode ? (
              <SelectedNodePanel
                node={selectedNode}
                onLabelChange={handleLabelChange}
                onShapeChange={handleShapeChange}
                onDuplicate={handleDuplicateNode}
                onDelete={handleDeleteNode}
              />
            ) : (
              <div className="wf-empty-inspector">
                Select a shape on the canvas to edit its label or type, or click a shape in the palette to add one.
              </div>
            )}

            <UnresolvedArrowsPanel
              unresolvedArrows={graph.unresolvedArrows}
              nodes={graph.nodes}
              croppedPhotoUrl={photoMeta?.dataUrl ?? null}
              photoWidth={photoMeta?.width ?? 640}
              photoHeight={photoMeta?.height ?? 640}
              onResolve={handleResolveArrow}
              onDismiss={handleDismissArrow}
            />
          </div>

          <div className={`wf-right-body ${rightTab === 'photo' ? '' : 'wf-hidden'}`}>
            <PhotoPanel
              ref={photoPanelRef}
              onGraphBuilt={handleGraphBuilt}
              onStatusStep={setStatusStep}
              onPhotoSelected={handlePhotoSelected}
              highlightedArrow={highlightedArrow}
            />
          </div>
        </aside>
      </div>

      {exportPreview && (
        <aside className="wf-preview">
          <div className="wf-preview-header">
            <span>{exportPreview.title}</span>
            <button type="button" onClick={() => setExportPreview(null)}>
              Close
            </button>
          </div>
          <pre>{exportPreview.content}</pre>
        </aside>
      )}
    </div>
  );
}

export function App() {
  return (
    <ReactFlowProvider>
      <WhiteboardFlowEditor />
    </ReactFlowProvider>
  );
}

export default App;
