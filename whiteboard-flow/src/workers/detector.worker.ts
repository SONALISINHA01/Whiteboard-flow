import * as ort from 'onnxruntime-web';
import type { DetectionBox, DetectionKind } from '../vision/coords';
import { DEFAULT_CLASSES, postprocessYoloxOutput, preprocessForYolox } from '../vision/yolox';

export type DetectorWorkerRequest =
  | { type: 'init'; modelUrl?: string; classesUrl?: string }
  | {
      type: 'detect';
      requestId: string;
      rgba: Uint8ClampedArray;
      width: number;
      height: number;
      scoreThreshold?: number;
      nmsThreshold?: number;
    };

export type DetectorWorkerResponse =
  | { type: 'status'; stage: 'loading-model' | 'model-ready' | 'preprocessing' | 'inferencing' | 'postprocessing'; message: string }
  | { type: 'error'; requestId?: string; message: string }
  | {
      type: 'result';
      requestId: string;
      detections: DetectionBox[];
      decodedInModel: boolean;
      inferenceMs: number;
    };

let session: ort.InferenceSession | null = null;
let classes: DetectionKind[] = DEFAULT_CLASSES;

const BASE_URL = import.meta.env.BASE_URL ?? './';

function resolveAssetUrl(relativePath: string): string {
  const normalizedBase = BASE_URL.endsWith('/') ? BASE_URL : `${BASE_URL}/`;
  return `${normalizedBase}${relativePath.replace(/^\//, '')}`;
}

async function initSession(
  modelUrl = resolveAssetUrl('models/yolox_tiny_whiteboard.onnx'),
  classesUrl = resolveAssetUrl('models/classes.json'),
) {
  if (session) {
    self.postMessage({ type: 'status', stage: 'model-ready', message: 'ONNX detector ready (WASM 1-thread)' } satisfies DetectorWorkerResponse);
    return;
  }

  self.postMessage({ type: 'status', stage: 'loading-model', message: 'Loading YOLOX-Tiny ONNX (CPU WASM)...' } satisfies DetectorWorkerResponse);

  // Single-threaded CPU WASM for static sites (no SharedArrayBuffer / COOP/COEP required)
  ort.env.wasm.numThreads = 1;

  try {
    const clsRes = await fetch(classesUrl);
    if (clsRes.ok) {
      const parsed = (await clsRes.json()) as { classes?: DetectionKind[] };
      if (Array.isArray(parsed.classes) && parsed.classes.length > 0) {
        classes = parsed.classes;
      }
    }
  } catch {
    // Fall back to DEFAULT_CLASSES
  }

  session = await ort.InferenceSession.create(modelUrl, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });

  self.postMessage({ type: 'status', stage: 'model-ready', message: 'ONNX detector ready (CPU WASM)' } satisfies DetectorWorkerResponse);
}

self.onmessage = async (event: MessageEvent<DetectorWorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === 'init') {
      await initSession(msg.modelUrl, msg.classesUrl);
      return;
    }

    if (msg.type === 'detect') {
      if (!session) {
        await initSession();
      }
      const t0 = performance.now();
      self.postMessage({ type: 'status', stage: 'preprocessing', message: 'Resizing & padding (640×640 BGR)...' } satisfies DetectorWorkerResponse);
      const { tensorData, transform, targetSize } = preprocessForYolox(msg.rgba, msg.width, msg.height);

      self.postMessage({ type: 'status', stage: 'inferencing', message: 'Running YOLOX-Tiny WASM inference...' } satisfies DetectorWorkerResponse);
      const inputName = session!.inputNames[0];
      const inputTensor = new ort.Tensor('float32', tensorData, [1, 3, targetSize, targetSize]);
      const outputs = await session!.run({ [inputName]: inputTensor });
      const outputName = session!.outputNames[0];
      const outputTensor = outputs[outputName];
      const outputData = outputTensor.data as Float32Array;

      self.postMessage({ type: 'status', stage: 'postprocessing', message: 'Decoding boxes & running NMS...' } satisfies DetectorWorkerResponse);
      const { detections, decodedInModel } = postprocessYoloxOutput(
        outputData,
        classes.length,
        transform,
        classes,
        msg.scoreThreshold ?? 0.35,
        msg.nmsThreshold ?? 0.45,
      );

      const inferenceMs = Math.round(performance.now() - t0);
      self.postMessage({
        type: 'result',
        requestId: msg.requestId,
        detections,
        decodedInModel,
        inferenceMs,
      } satisfies DetectorWorkerResponse);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({
      type: 'error',
      requestId: msg.type === 'detect' ? msg.requestId : undefined,
      message,
    } satisfies DetectorWorkerResponse);
  }
};
