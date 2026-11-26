import type { FlowEdge, FlowNode } from '../graph/types';
import { binarizeToInkMask, type InkMask } from './arrowResolver';
import type { DetectionBox, PixelBox } from './coords';

export type OcrStatusCallback = (status: string) => void;

export function computeInsideShapeCropRect(
  box: PixelBox,
  croppedWidth: number,
  croppedHeight: number,
  kind: DetectionBox['kind'] = 'rectangle',
): PixelBox {
  const insetX = kind === 'diamond' ? 0.26 : kind === 'parallelogram' ? 0.18 : 0.12;
  const insetY = kind === 'diamond' ? 0.28 : 0.16;
  const padX = Math.round(box.width * insetX);
  const padY = Math.round(box.height * insetY);
  const x1 = Math.max(0, Math.floor(box.x + padX));
  const y1 = Math.max(0, Math.floor(box.y + padY));
  const x2 = Math.min(croppedWidth, Math.ceil(box.x + box.width - padX));
  const y2 = Math.min(croppedHeight, Math.ceil(box.y + box.height - padY));

  return {
    x: x1,
    y: y1,
    width: Math.max(12, x2 - x1),
    height: Math.max(12, y2 - y1),
  };
}

function cleanOcrText(raw: string): string {
  return raw
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[^A-Za-z0-9"'?]+|[^A-Za-z0-9"'?!.]+$/g, '')
    .trim();
}

/**
 * Prepares a high-contrast upscaled crop with white padding so OCR engines read
 * handwritten whiteboard marker text reliably.
 */
function prepareHighContrastCrop(
  sourceCanvas: HTMLCanvasElement,
  rect: PixelBox,
): HTMLCanvasElement {
  const scale = rect.height < 90 ? 3 : rect.height < 150 ? 2 : 1.5;
  const targetW = Math.max(40, Math.round(rect.width * scale));
  const targetH = Math.max(40, Math.round(rect.height * scale));
  const border = 18;

  const rawCanvas = document.createElement('canvas');
  rawCanvas.width = targetW;
  rawCanvas.height = targetH;
  const rctx = rawCanvas.getContext('2d')!;
  rctx.drawImage(sourceCanvas, rect.x, rect.y, rect.width, rect.height, 0, 0, targetW, targetH);

  const imgData = rctx.getImageData(0, 0, targetW, targetH);
  const mask = binarizeToInkMask(imgData.data, targetW, targetH, 18);
  for (let i = 0; i < targetW * targetH; i++) {
    const v = mask.data[i] === 1 ? 0 : 255;
    imgData.data[i * 4] = v;
    imgData.data[i * 4 + 1] = v;
    imgData.data[i * 4 + 2] = v;
    imgData.data[i * 4 + 3] = 255;
  }
  rctx.putImageData(imgData, 0, 0);

  const padded = document.createElement('canvas');
  padded.width = targetW + border * 2;
  padded.height = targetH + border * 2;
  const pctx = padded.getContext('2d')!;
  pctx.fillStyle = '#FFFFFF';
  pctx.fillRect(0, 0, padded.width, padded.height);
  pctx.drawImage(rawCanvas, border, border);
  return padded;
}

const BASE_URL = import.meta.env.BASE_URL ?? './';

function resolveAssetUrl(relativePath: string): string {
  const normalizedBase = BASE_URL.endsWith('/') ? BASE_URL : `${BASE_URL}/`;
  return `${normalizedBase}${relativePath.replace(/^\//, '')}`;
}

type OcrEngine = {
  backend: 'paddle' | 'tesseract';
  recognize: (canvas: HTMLCanvasElement) => Promise<string>;
  dispose: () => void;
};

let cachedEngine: OcrEngine | null = null;
let ppocrAvailable: boolean | null = null;

async function checkPpocrAvailable(): Promise<boolean> {
  if (ppocrAvailable !== null) return ppocrAvailable;
  try {
    const res = await fetch(resolveAssetUrl('models/ppocrv5/detection/model.json'), {
      method: 'HEAD',
    });
    const ct = res.headers.get('content-type') ?? '';
    ppocrAvailable = res.ok && !ct.includes('text/html');
  } catch {
    ppocrAvailable = false;
  }
  return ppocrAvailable;
}

async function getOcrEngine(onStatus?: OcrStatusCallback): Promise<OcrEngine> {
  if (cachedEngine) return cachedEngine;

  const usePaddle = await checkPpocrAvailable();
  if (usePaddle) {
    onStatus?.('Loading PP-OCRv5 mobile worker...');
    const { PaddleOcrWorker } = await import('paddleocr-js');
    const worker = new PaddleOcrWorker(
      {
        modelPath: resolveAssetUrl('models/ppocrv5'),
        useTensorflow: false,
        useOnnx: true,
        useWasm: true,
        language: 'en',
        enableDetection: true,
        enableRecognition: true,
      },
      resolveAssetUrl('ocr/paddle-ocr-worker.min.js'),
    );
    await worker.init();
    cachedEngine = {
      backend: 'paddle',
      recognize: async (canvas) => {
        const res = await worker.recognize(canvas);
        return cleanOcrText(
          (res.textRecognition ?? [])
            .map((item: { text?: string }) => item.text?.trim())
            .filter(Boolean)
            .join(' '),
        );
      },
      dispose: () => worker.dispose(),
    };
    return cachedEngine;
  }

  onStatus?.('Loading on-device OCR worker...');
  const { createWorker, PSM } = await import('tesseract.js');
  const worker = await createWorker('eng');
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789?!&-_.,/ ',
  });
  cachedEngine = {
    backend: 'tesseract',
    recognize: async (canvas) => {
      const res = await worker.recognize(canvas);
      return cleanOcrText(res.data.text ?? '');
    },
    dispose: () => {
      void worker.terminate();
    },
  };
  return cachedEngine;
}

export async function recognizeShapeLabelsInWorker(
  croppedCanvas: HTMLCanvasElement,
  detections: DetectionBox[],
  onStatus?: OcrStatusCallback,
): Promise<DetectionBox[]> {
  const shapes = detections.filter((d) => d.kind !== 'arrow' && d.kind !== 'arrowhead');
  if (shapes.length === 0) return detections;

  const engine = await getOcrEngine(onStatus);
  const updated = [...detections];

  let shapeIdx = 0;
  for (let i = 0; i < updated.length; i++) {
    const det = updated[i];
    if (det.kind === 'arrow' || det.kind === 'arrowhead') continue;
    shapeIdx += 1;

    onStatus?.(`Reading label ${shapeIdx}/${shapes.length}...`);
    const crop = computeInsideShapeCropRect(
      det.box,
      croppedCanvas.width,
      croppedCanvas.height,
      det.kind,
    );
    const prepared = prepareHighContrastCrop(croppedCanvas, crop);
    const recognizedText = await engine.recognize(prepared);

    updated[i] = {
      ...det,
      label: recognizedText.length > 0 ? recognizedText : undefined,
    };
  }

  onStatus?.(`Labels read (${engine.backend})`);
  return updated;
}

/**
 * Finds the ink cluster belonging to an off-box branch label (like YES / NO)
 * near a resolved edge's midpoint and runs OCR on it.
 */
function findBranchLabelCrop(
  edge: FlowEdge,
  nodeMap: Map<string, FlowNode>,
  shapes: DetectionBox[],
  ink: InkMask,
): PixelBox | null {
  const src = nodeMap.get(edge.source);
  const tgt = nodeMap.get(edge.target);
  if (!src || !tgt) return null;

  const mid = edge.bendPoints?.[0] ?? {
    x: (src.position.x + src.width / 2 + tgt.position.x + tgt.width / 2) / 2,
    y: (src.position.y + src.height / 2 + tgt.position.y + tgt.height / 2) / 2,
  };

  // Search a window around the edge midpoint for text ink outside all shape boxes
  const halfW = Math.round(Math.max(95, ink.width * 0.1));
  const halfH = Math.round(Math.max(55, ink.height * 0.08));
  const x0 = Math.max(0, Math.floor(mid.x - halfW));
  const x1 = Math.min(ink.width - 1, Math.ceil(mid.x + halfW));
  const y0 = Math.max(0, Math.floor(mid.y - halfH));
  const y1 = Math.min(ink.height - 1, Math.ceil(mid.y + halfH));

  // Bucket ink into 8px cells outside shapes to find compact word regions (ignoring thin 1-cell shafts)
  const cell = 8;
  const cols = Math.max(1, Math.ceil((x1 - x0 + 1) / cell));
  const rows = Math.max(1, Math.ceil((y1 - y0 + 1) / cell));
  const dense = new Uint8Array(cols * rows);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = x0 + c * cell + cell / 2;
      const py = y0 + r * cell + cell / 2;
      const insideShape = shapes.some(
        (s) =>
          px >= s.box.x - 4 &&
          px <= s.box.x + s.box.width + 4 &&
          py >= s.box.y - 4 &&
          py <= s.box.y + s.box.height + 4,
      );
      if (insideShape) continue;

      let count = 0;
      for (let dy = 0; dy < cell && y0 + r * cell + dy <= y1; dy++) {
        for (let dx = 0; dx < cell && x0 + c * cell + dx <= x1; dx++) {
          if (ink.data[(y0 + r * cell + dy) * ink.width + (x0 + c * cell + dx)] === 1) {
            count += 1;
          }
        }
      }
      if (count >= 10) {
        dense[r * cols + c] = 1;
      }
    }
  }

  // Find connected dense-cell clusters
  const visited = new Uint8Array(cols * rows);
  const clusters: { minC: number; maxC: number; minR: number; maxR: number; cells: number }[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (!dense[idx] || visited[idx]) continue;
      const stack = [[r, c]];
      visited[idx] = 1;
      let minC = c;
      let maxC = c;
      let minR = r;
      let maxR = r;
      let cells = 0;

      while (stack.length > 0) {
        const [cr, cc] = stack.pop()!;
        cells += 1;
        minC = Math.min(minC, cc);
        maxC = Math.max(maxC, cc);
        minR = Math.min(minR, cr);
        maxR = Math.max(maxR, cr);
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const nr = cr + dr;
            const nc = cc + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
              const nIdx = nr * cols + nc;
              if (dense[nIdx] && !visited[nIdx]) {
                visited[nIdx] = 1;
                stack.push([nr, nc]);
              }
            }
          }
        }
      }

      const w = (maxC - minC + 1) * cell;
      const h = (maxR - minR + 1) * cell;
      // Text labels have multiple cells and compact aspect (not a tall narrow shaft)
      if (cells >= 3 && w >= 18 && h >= 14 && w <= 160 && h <= 80) {
        clusters.push({ minC, maxC, minR, maxR, cells });
      }
    }
  }

  if (clusters.length === 0) return null;
  clusters.sort((a, b) => b.cells - a.cells);
  const best = clusters[0];
  return {
    x: Math.max(0, x0 + best.minC * cell - 6),
    y: Math.max(0, y0 + best.minR * cell - 6),
    width: Math.min(ink.width - (x0 + best.minC * cell - 6), (best.maxC - best.minC + 1) * cell + 12),
    height: Math.min(ink.height - (y0 + best.minR * cell - 6), (best.maxR - best.minR + 1) * cell + 12),
  };
}

export async function recognizeBranchLabelsInWorker(
  croppedCanvas: HTMLCanvasElement,
  edges: FlowEdge[],
  nodes: FlowNode[],
  shapes: DetectionBox[],
  ink: InkMask,
  onStatus?: OcrStatusCallback,
): Promise<FlowEdge[]> {
  if (edges.length === 0) return edges;
  const engine = await getOcrEngine(onStatus);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const updatedEdges = [...edges];

  for (let i = 0; i < updatedEdges.length; i++) {
    const edge = updatedEdges[i];
    if (edge.label && edge.label.trim().length > 0) continue;

    const crop = findBranchLabelCrop(edge, nodeMap, shapes, ink);
    if (!crop) continue;

    onStatus?.(`Reading branch label ${i + 1}/${updatedEdges.length}...`);
    const prepared = prepareHighContrastCrop(croppedCanvas, crop);
    const text = await engine.recognize(prepared);
    if (text.length >= 2 && text.length <= 18) {
      updatedEdges[i] = { ...edge, label: text };
    }
  }

  return updatedEdges;
}

export function disposeOcrWorker(): void {
  if (cachedEngine) {
    cachedEngine.dispose();
    cachedEngine = null;
  }
}
