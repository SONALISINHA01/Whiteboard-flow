import { createRef, useEffect, useRef } from 'react';
import { SAMPLE_FLOW_GRAPH } from '../graph/sample';
import { BrandIcon } from './BrandIcon';
import { CHARACTER_DEFINITIONS, Character } from './Character';
import { computePupilOffset, type LookOffset } from './characterLook';
import './LandingPage.css';

interface FaceGeometry {
  cx: number;
  cy: number;
  maxTravel: number;
}

function SampleSketchPreview() {
  return (
    <div className="wf-demo-card">
      <div className="wf-demo-card-head">
        <span className="wf-demo-card-title">Whiteboard sketch</span>
        <span className="wf-demo-tag">Sample photo</span>
      </div>
      <div className="wf-demo-surface wf-demo-surface--sketch">
        <svg viewBox="0 0 380 260" className="wf-demo-svg" role="img" aria-label="Rough whiteboard sketch of the request validation sample">
          <path
            d="M 142 18 C 166 14, 214 15, 238 19 C 252 22, 253 46, 236 50 C 212 53, 165 52, 142 49 C 127 46, 128 21, 142 18 Z"
            fill="none"
            stroke="#334155"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <text x="190" y="38" textAnchor="middle" className="wf-sketch-text">Start</text>

          <path d="M 190 52 Q 192 66 189 78" fill="none" stroke="#334155" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M 184 72 L 189 80 L 195 72" fill="none" stroke="#334155" strokeWidth="2.2" strokeLinecap="round" />

          <path
            d="M 190 83 L 264 118 L 189 154 L 116 117 Z"
            fill="none"
            stroke="#1D4ED8"
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
          <text x="190" y="122" textAnchor="middle" className="wf-sketch-text">Check input</text>

          <path d="M 164 142 Q 124 150 100 169" fill="none" stroke="#334155" strokeWidth="2.1" strokeLinecap="round" />
          <path d="M 98 161 L 99 170 L 107 167" fill="none" stroke="#334155" strokeWidth="2.1" strokeLinecap="round" />
          <text x="122" y="150" textAnchor="middle" className="wf-sketch-edge">Valid</text>

          <path d="M 216 142 Q 256 150 280 169" fill="none" stroke="#334155" strokeWidth="2.1" strokeLinecap="round" />
          <path d="M 273 167 L 281 170 L 282 161" fill="none" stroke="#334155" strokeWidth="2.1" strokeLinecap="round" />
          <text x="258" y="150" textAnchor="middle" className="wf-sketch-edge">Invalid</text>

          <path
            d="M 38 173 L 154 172 L 152 206 L 39 207 Z"
            fill="none"
            stroke="#334155"
            strokeWidth="2.3"
            strokeLinejoin="round"
          />
          <text x="96" y="194" textAnchor="middle" className="wf-sketch-text">Process request</text>

          <path
            d="M 234 172 L 344 173 L 330 206 L 220 206 Z"
            fill="none"
            stroke="#334155"
            strokeWidth="2.3"
            strokeLinejoin="round"
          />
          <text x="282" y="194" textAnchor="middle" className="wf-sketch-text">Show error</text>

          <path d="M 98 208 Q 122 225 152 232" fill="none" stroke="#334155" strokeWidth="2.1" strokeLinecap="round" />
          <path d="M 276 207 Q 252 225 228 232" fill="none" stroke="#334155" strokeWidth="2.1" strokeLinecap="round" />

          <path
            d="M 155 224 C 175 221, 206 221, 226 224 C 238 227, 238 247, 224 250 C 204 253, 174 253, 155 249 C 142 246, 143 227, 155 224 Z"
            fill="none"
            stroke="#334155"
            strokeWidth="2.4"
          />
          <text x="190" y="241" textAnchor="middle" className="wf-sketch-text">End</text>
        </svg>
      </div>
    </div>
  );
}

function SampleEditablePreview() {
  const nodeMap = new Map(SAMPLE_FLOW_GRAPH.nodes.map((n) => [n.id, n]));

  return (
    <div className="wf-demo-card">
      <div className="wf-demo-card-head">
        <span className="wf-demo-card-title">Editable diagram</span>
        <a href="#/editor" className="wf-demo-open-link">
          Open in editor →
        </a>
      </div>
      <div className="wf-demo-surface wf-demo-surface--canvas">
        <svg viewBox="0 0 640 535" className="wf-demo-svg" role="img" aria-label="Clean editable flowchart output of the sample">
          <defs>
            <pattern id="wf-demo-dots" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="12" cy="12" r="1.4" fill="#D8DEEC" />
            </pattern>
            <marker id="wf-demo-arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
              <path d="M 0 1 L 8 5 L 0 9 z" fill="#73829F" />
            </marker>
          </defs>
          <rect width="640" height="535" fill="#F7F8FD" />
          <rect width="640" height="535" fill="url(#wf-demo-dots)" />

          {SAMPLE_FLOW_GRAPH.edges.map((edge) => {
            const src = nodeMap.get(edge.source);
            const tgt = nodeMap.get(edge.target);
            if (!src || !tgt) return null;
            const x1 = src.position.x + src.width / 2;
            const y1 = src.position.y + src.height;
            const x2 = tgt.position.x + tgt.width / 2;
            const y2 = tgt.position.y - 3;
            const cy1 = y1 + (y2 - y1) * 0.45;
            const cy2 = y2 - (y2 - y1) * 0.45;
            const lx = (x1 + x2) / 2;
            const ly = (y1 + y2) / 2;

            return (
              <g key={edge.id}>
                <path
                  d={`M ${x1} ${y1} C ${x1} ${cy1}, ${x2} ${cy2}, ${x2} ${y2}`}
                  fill="none"
                  stroke="#73829F"
                  strokeWidth="2.2"
                  markerEnd="url(#wf-demo-arrow)"
                />
                {edge.label && (
                  <g>
                    <rect
                      x={lx - 28}
                      y={ly - 12}
                      width="56"
                      height="24"
                      rx="6"
                      fill="#FFFFFF"
                      stroke="#E2E5F0"
                      strokeWidth="1.2"
                    />
                    <text x={lx} y={ly + 4} textAnchor="middle" className="wf-demo-edge-label">
                      {edge.label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {SAMPLE_FLOW_GRAPH.nodes.map((node) => {
            const { x, y } = node.position;
            const w = node.width;
            const h = node.height;
            const isSelected = node.id === 'check-input';
            const stroke = isSelected ? '#5145CD' : '#73829F';

            return (
              <g key={node.id}>
                {node.shape === 'oval' && (
                  <rect x={x} y={y} width={w} height={h} rx={h / 2} fill="#FFFFFF" stroke={stroke} strokeWidth="2" />
                )}
                {node.shape === 'rectangle' && (
                  <rect x={x} y={y} width={w} height={h} rx="8" fill="#FFFFFF" stroke={stroke} strokeWidth="2" />
                )}
                {node.shape === 'diamond' && (
                  <polygon
                    points={`${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`}
                    fill="#FFFFFF"
                    stroke={stroke}
                    strokeWidth="2.4"
                    strokeLinejoin="round"
                  />
                )}
                {node.shape === 'parallelogram' && (
                  <polygon
                    points={`${x + w * 0.14},${y} ${x + w},${y} ${x + w * 0.86},${y + h} ${x},${y + h}`}
                    fill="#FFFFFF"
                    stroke={stroke}
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                )}
                <text x={x + w / 2} y={y + h / 2 + 5} textAnchor="middle" className="wf-demo-node-label">
                  {node.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

export function LandingPage() {
  const stageRef = useRef<HTMLDivElement>(null);
  const faceRefs = useRef(CHARACTER_DEFINITIONS.map(() => createRef<HTMLDivElement>()));

  const pointerRef = useRef<{ x: number; y: number; active: boolean }>({
    x: 0,
    y: 0,
    active: false,
  });
  const faceGeometriesRef = useRef<FaceGeometry[]>(
    CHARACTER_DEFINITIONS.map((d) => ({ cx: 0, cy: 0, maxTravel: d.maxTravelPx })),
  );
  const currentOffsetsRef = useRef<LookOffset[]>(
    CHARACTER_DEFINITIONS.map(() => ({ x: 0, y: 0 })),
  );
  const targetOffsetsRef = useRef<LookOffset[]>(
    CHARACTER_DEFINITIONS.map(() => ({ x: 0, y: 0 })),
  );
  const dirtyBoundsRef = useRef(true);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isTouchPrimary = window.matchMedia('(pointer: coarse)').matches;
    if (prefersReducedMotion || isTouchPrimary) {
      return;
    }

    const measureFaces = () => {
      faceRefs.current.forEach((ref, idx) => {
        const el = ref.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const eyeScale = Math.min(1, Math.max(0.55, rect.width / 52));
        faceGeometriesRef.current[idx] = {
          cx: rect.left + rect.width / 2,
          cy: rect.top + rect.height / 2,
          maxTravel: CHARACTER_DEFINITIONS[idx].maxTravelPx * eyeScale,
        };
      });
      dirtyBoundsRef.current = false;
    };

    const updateTargets = () => {
      if (dirtyBoundsRef.current) {
        measureFaces();
      }
      const ptr = pointerRef.current;
      CHARACTER_DEFINITIONS.forEach((_def, idx) => {
        if (!ptr.active) {
          targetOffsetsRef.current[idx] = { x: 0, y: 0 };
          return;
        }
        const geom = faceGeometriesRef.current[idx];
        targetOffsetsRef.current[idx] = computePupilOffset(
          ptr.x,
          ptr.y,
          geom.cx,
          geom.cy,
          geom.maxTravel,
        );
      });
    };

    const tick = () => {
      updateTargets();
      let stillMoving = false;
      const ease = 0.22;

      faceRefs.current.forEach((ref, idx) => {
        const el = ref.current;
        if (!el) return;
        const curr = currentOffsetsRef.current[idx];
        const target = targetOffsetsRef.current[idx];

        const dx = target.x - curr.x;
        const dy = target.y - curr.y;

        if (Math.abs(dx) > 0.02 || Math.abs(dy) > 0.02) {
          curr.x += dx * ease;
          curr.y += dy * ease;
          stillMoving = true;
        } else {
          curr.x = target.x;
          curr.y = target.y;
        }

        el.style.setProperty('--look-x', `${curr.x.toFixed(2)}px`);
        el.style.setProperty('--look-y', `${curr.y.toFixed(2)}px`);
      });

      if (stillMoving) {
        rafIdRef.current = window.requestAnimationFrame(tick);
      } else {
        rafIdRef.current = null;
      }
    };

    const scheduleFrame = () => {
      if (rafIdRef.current === null) {
        rafIdRef.current = window.requestAnimationFrame(tick);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        pointerRef.current.active = false;
        scheduleFrame();
        return;
      }
      pointerRef.current = { x: e.clientX, y: e.clientY, active: true };
      scheduleFrame();
    };

    const onResetEyes = () => {
      pointerRef.current.active = false;
      scheduleFrame();
    };

    const onLayoutChange = () => {
      dirtyBoundsRef.current = true;
      if (pointerRef.current.active) {
        scheduleFrame();
      }
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onResetEyes);
    window.addEventListener('blur', onResetEyes);
    window.addEventListener('resize', onLayoutChange, { passive: true });
    window.addEventListener('scroll', onLayoutChange, { passive: true });

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && stageRef.current) {
      observer = new ResizeObserver(onLayoutChange);
      observer.observe(stageRef.current);
    }

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      document.documentElement.removeEventListener('pointerleave', onResetEyes);
      window.removeEventListener('blur', onResetEyes);
      window.removeEventListener('resize', onLayoutChange);
      window.removeEventListener('scroll', onLayoutChange);
      observer?.disconnect();
      if (rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  return (
    <div className="wf-landing">
      <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>
        <defs>
          <clipPath id="wf-doc-wave" clipPathUnits="objectBoundingBox">
            <path d="M 0,0.12 Q 0,0 0.12,0 L 0.88,0 Q 1,0 1,0.12 L 1,0.84 Q 0.75,0.72 0.5,0.86 Q 0.25,1.0 0,0.86 Z" />
          </clipPath>
        </defs>
      </svg>

      <div className="wf-landing-container">
        <header className="wf-landing-nav">
          <a href="#/" className="wf-brand-link">
            <BrandIcon />
            <span className="wf-landing-wordmark">Whiteboard Flow</span>
          </a>

          <a href="#/editor" className="wf-nav-editor-link">
            Editor
          </a>
        </header>

        <main className="wf-landing-main">
          <section className="wf-hero">
            <div className="wf-hero-copy">
              <h1 className="wf-hero-heading">
                <span className="wf-hero-break">From whiteboard </span>
                <span className="wf-hero-break">to flowchart.</span>
              </h1>
              <p className="wf-hero-subtitle">
                Turn a whiteboard photo into an editable diagram. Fix the shapes and arrows, then export to draw.io or Mermaid.
              </p>
              <div className="wf-hero-cta">
                <a href="#/editor" className="wf-hero-primary-btn">
                  Open editor
                </a>
              </div>
            </div>

            <div ref={stageRef} className="wf-hero-stage" aria-hidden="true">
              <div className="wf-character-grid">
                {CHARACTER_DEFINITIONS.map((def, idx) => (
                  <Character key={def.id} def={def} faceRef={faceRefs.current[idx]} />
                ))}
              </div>
            </div>
          </section>

          <section className="wf-demo-section" aria-labelledby="wf-demo-heading">
            <div className="wf-demo-header">
              <h2 id="wf-demo-heading" className="wf-demo-heading">
                From sketch to editable diagram.
              </h2>
              <p className="wf-demo-sub">
                Example conversion using the built-in request-validation sample.
              </p>
            </div>

            <div className="wf-demo-grid">
              <SampleSketchPreview />
              <SampleEditablePreview />
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
