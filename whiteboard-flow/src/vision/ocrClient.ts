import type { DetectionBox, PixelBox } from './coords';

export type OcrStatusCallback = (status: string) => void;

/**
 * Computes an inset crop rectangle inside a detected shape so PP-OCRv5 mobile
 * reads the handwritten text inside the shape without marker border noise.
 */
export function computeInsideShapeCropRect(
  box: PixelBox,
  croppedWidth: number,
  croppedHeight: number,
  insetRatio = 0.08,
): PixelBox {
  const padX = Math.round(box.width * insetRatio);
  const padY = Math.round(box.height * insetRatio);
  const x1 = Math.max(0, Math.floor(box.x + padX));
  const y1 = Math.max(0, Math.floor(box.y + padY));
  const x2 = Math.min(croppedWidth, Math.ceil(box.x + box.width - padX));
  const y2 = Math.min(croppedHeight, Math.ceil(box.y + box.height - padY));

  return {
    x: x1,
    y: y1,
    width: Math.max(8, x2 - x1),
    height: Math.max(8, y2 - y1),
  };
}

let ocrWorker: {
  isInitialized: boolean;
  init: () => Promise<void>;
  recognize: (img: HTMLCanvasElement) => Promise<{ textRecognition?: Array<{ text?: string }> }>;
  dispose: () => void;
} | null = null;

const BASE_URL = import.meta.env.BASE_URL ?? './';

function resolveAssetUrl(relativePath: string): string {
  const normalizedBase = BASE_URL.endsWith('/') ? BASE_URL : `${BASE_URL}/`;
  return `${normalizedBase}${relativePath.replace(/^\//, '')}`;
}

async function getOcrWorker(onStatus?: OcrStatusCallback) {
  if (ocrWorker && ocrWorker.isInitialized) {
    return ocrWorker;
  }

  onStatus?.('Loading PaddleOCR.js (PP-OCRv5 mobile worker)...');
  const { PaddleOcrWorker } = await import('paddleocr-js');
  ocrWorker = new PaddleOcrWorker(
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
  await ocrWorker.init();
  return ocrWorker;
}

export async function recognizeShapeLabelsInWorker(
  croppedCanvas: HTMLCanvasElement,
  detections: DetectionBox[],
  onStatus?: OcrStatusCallback,
): Promise<DetectionBox[]> {
  const shapes = detections.filter((d) => d.kind !== 'arrow' && d.kind !== 'arrowhead');
  if (shapes.length === 0) return detections;

  const worker = await getOcrWorker(onStatus);
  const updated = [...detections];

  for (let i = 0; i < updated.length; i++) {
    const det = updated[i];
    if (det.kind === 'arrow' || det.kind === 'arrowhead') continue;

    onStatus?.(`Running PP-OCRv5 on ${det.kind} (${i + 1}/${updated.length})...`);
    const crop = computeInsideShapeCropRect(det.box, croppedCanvas.width, croppedCanvas.height);

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = crop.width;
    cropCanvas.height = crop.height;
    const ctx = cropCanvas.getContext('2d');
    if (!ctx) continue;

    ctx.drawImage(
      croppedCanvas,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height,
    );

    const result = await worker.recognize(cropCanvas);
    const recognizedText = (result.textRecognition ?? [])
      .map((item) => item.text?.trim())
      .filter(Boolean)
      .join(' ')
      .trim();

    if (recognizedText.length > 0) {
      updated[i] = { ...det, label: recognizedText };
    }
  }

  onStatus?.('PP-OCRv5 complete');
  return updated;
}

export function disposeOcrWorker(): void {
  if (ocrWorker) {
    ocrWorker.dispose();
    ocrWorker = null;
  }
}
