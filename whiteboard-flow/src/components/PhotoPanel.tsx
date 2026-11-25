import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent,
} from 'react';
import type { FlowGraph, UnresolvedArrow } from '../graph/types';
import { binarizeToInkMask, buildGraphFromDetections } from '../vision/arrowResolver';
import {
  computeLabelCropRect,
  computeLetterboxTransform,
  createSampleDetections,
  type CropRect,
  type DetectionBox,
  type LetterboxTransform,
} from '../vision/coords';
import { recognizeShapeLabelsInWorker } from '../vision/ocrClient';
import type { DetectorWorkerRequest, DetectorWorkerResponse } from '../workers/detector.worker';

export interface PhotoPanelHandle {
  openFilePicker: () => void;
  convertPhoto: () => void;
  loadSamplePhoto: () => void;
}

interface PhotoPanelProps {
  onGraphBuilt?: (graph: FlowGraph, photoMeta: { dataUrl: string; width: number; height: number }) => void;
  onStatusStep?: (step: string | null) => void;
  onPhotoSelected?: (hasPhoto: boolean) => void;
  highlightedArrow?: UnresolvedArrow | null;
}

interface LoadedPhoto {
  dataUrl: string;
  width: number;
  height: number;
  name: string;
}

interface CroppedPhoto {
  dataUrl: string;
  width: number;
  height: number;
  letterbox: LetterboxTransform;
}

function createSyntheticWhiteboardDataUrl(): LoadedPhoto {
  const width = 960;
  const height = 720;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 4;
  ctx.strokeRect(24, 24, width - 48, height - 48);

  ctx.strokeStyle = '#1e293b';
  ctx.fillStyle = '#1e293b';
  ctx.lineWidth = 3;
  ctx.font = '600 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.beginPath();
  ctx.ellipse(width / 2, 120, 120, 44, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillText('Start', width / 2, 120);

  ctx.beginPath();
  ctx.moveTo(width / 2, 166);
  ctx.lineTo(width / 2, 250);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(width / 2 - 8, 238);
  ctx.lineTo(width / 2, 254);
  ctx.lineTo(width / 2 + 8, 238);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(width / 2, 258);
  ctx.lineTo(width / 2 + 160, 340);
  ctx.lineTo(width / 2, 422);
  ctx.lineTo(width / 2 - 160, 340);
  ctx.closePath();
  ctx.stroke();
  ctx.fillText('Check input', width / 2, 340);

  ctx.beginPath();
  ctx.moveTo(width / 2, 424);
  ctx.lineTo(width / 2, 520);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(width / 2 - 8, 508);
  ctx.lineTo(width / 2, 524);
  ctx.lineTo(width / 2 + 8, 508);
  ctx.stroke();

  ctx.font = '500 20px sans-serif';
  ctx.fillText('Valid', width / 2 + 44, 472);

  ctx.font = '600 28px sans-serif';
  ctx.beginPath();
  ctx.ellipse(width / 2, 574, 120, 44, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillText('End', width / 2, 574);

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width,
    height,
    name: 'sample-whiteboard.png',
  };
}

export const PhotoPanel = forwardRef<PhotoPanelHandle, PhotoPanelProps>(function PhotoPanel(
  { onGraphBuilt, onStatusStep, onPhotoSelected, highlightedArrow },
  ref,
) {
  const [loadedPhoto, setLoadedPhoto] = useState<LoadedPhoto | null>(null);
  const [cropRect, setCropRect] = useState<CropRect>({ x: 0, y: 0, width: 100, height: 100 });
  const [croppedPhoto, setCroppedPhoto] = useState<CroppedPhoto | null>(null);
  const [detections, setDetections] = useState<DetectionBox[]>([]);
  const [showOverlay, setShowOverlay] = useState(true);
  const [selectedDetection, setSelectedDetection] = useState<DetectionBox | null>(null);
  const [labelCropUrl, setLabelCropUrl] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);

  const [detectorStatus, setDetectorStatus] = useState<string>('Ready');
  const [ocrStatus, setOcrStatus] = useState<string>('Ready');
  const [isBusy, setIsBusy] = useState(false);
  const [lastInferenceMeta, setLastInferenceMeta] = useState<string | null>(null);

  const cropStageRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const croppedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const detectorWorkerRef = useRef<Worker | null>(null);
  const pendingConvertResolveRef = useRef<((dets: DetectionBox[]) => void) | null>(null);
  const conversionActiveRef = useRef(false);

  useEffect(() => {
    const worker = new Worker(new URL('../workers/detector.worker.ts', import.meta.url), {
      type: 'module',
    });
    detectorWorkerRef.current = worker;

    worker.onmessage = (event: MessageEvent<DetectorWorkerResponse>) => {
      const msg = event.data;
      if (msg.type === 'status') {
        const plain =
          msg.stage === 'loading-model'
            ? 'Loading shape detector...'
            : msg.stage === 'preprocessing'
              ? 'Preparing photo...'
              : msg.stage === 'inferencing'
                ? 'Finding shapes and arrows...'
                : msg.stage === 'postprocessing'
                  ? 'Aligning boxes...'
                  : 'Detector ready';
        setDetectorStatus(plain);
        if (conversionActiveRef.current && msg.stage !== 'model-ready') {
          onStatusStep?.(plain);
        }
      } else if (msg.type === 'result') {
        setDetections(msg.detections);
        setLastInferenceMeta(
          `${msg.detections.length} detections in ${msg.inferenceMs}ms`,
        );
        setDetectorStatus('Shapes found');
        if (pendingConvertResolveRef.current) {
          const resolve = pendingConvertResolveRef.current;
          pendingConvertResolveRef.current = null;
          resolve(msg.detections);
        } else {
          conversionActiveRef.current = false;
          onStatusStep?.(null);
          setIsBusy(false);
        }
      } else if (msg.type === 'error') {
        setDetectorStatus(`Detector unavailable (${msg.message})`);
        if (pendingConvertResolveRef.current) {
          const resolve = pendingConvertResolveRef.current;
          pendingConvertResolveRef.current = null;
          resolve([]);
        } else {
          conversionActiveRef.current = false;
          onStatusStep?.(null);
          setIsBusy(false);
        }
      }
    };

    worker.postMessage({ type: 'init' } satisfies DetectorWorkerRequest);

    return () => {
      worker.terminate();
      detectorWorkerRef.current = null;
    };
  }, [onStatusStep]);

  const applyCropToPhoto = (photo: LoadedPhoto, rect: CropRect): Promise<{ cropped: CroppedPhoto; canvas: HTMLCanvasElement; initialDetections: DetectionBox[] }> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const cw = Math.max(1, Math.min(photo.width - rect.x, rect.width));
        const ch = Math.max(1, Math.min(photo.height - rect.y, rect.height));

        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, rect.x, rect.y, cw, ch, 0, 0, cw, ch);
        croppedCanvasRef.current = canvas;

        const letterbox = computeLetterboxTransform(cw, ch, 640);
        const cropped: CroppedPhoto = {
          dataUrl: canvas.toDataURL('image/png'),
          width: cw,
          height: ch,
          letterbox,
        };
        const initialDetections = createSampleDetections(cw, ch);
        setCroppedPhoto(cropped);
        setDetections(initialDetections);
        setSelectedDetection(null);
        setLabelCropUrl(null);
        resolve({ cropped, canvas, initialDetections });
      };
      img.src = photo.dataUrl;
    });
  };

  const loadImageFromDataUrl = (dataUrl: string, name: string) => {
    const img = new Image();
    img.onload = () => {
      const photo: LoadedPhoto = {
        dataUrl,
        width: img.naturalWidth,
        height: img.naturalHeight,
        name,
      };
      setLoadedPhoto(photo);
      setCropRect({
        x: Math.round(img.naturalWidth * 0.05),
        y: Math.round(img.naturalHeight * 0.05),
        width: Math.round(img.naturalWidth * 0.9),
        height: Math.round(img.naturalHeight * 0.9),
      });
      setCroppedPhoto(null);
      setDetections([]);
      setSelectedDetection(null);
      setLabelCropUrl(null);
      setLastInferenceMeta(null);
      onPhotoSelected?.(true);
    };
    img.src = dataUrl;
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        loadImageFromDataUrl(reader.result, file.name);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleUseSample = () => {
    const sample = createSyntheticWhiteboardDataUrl();
    setLoadedPhoto(sample);
    setCropRect({ x: 0, y: 0, width: sample.width, height: sample.height });
    setCroppedPhoto(null);
    setDetections([]);
    setSelectedDetection(null);
    setLabelCropUrl(null);
    setLastInferenceMeta(null);
    onPhotoSelected?.(true);
  };

  const handleConvertFlow = async () => {
    if (!loadedPhoto) return;
    setIsBusy(true);
    conversionActiveRef.current = true;
    onStatusStep?.('Preparing photo...');

    let activeCropped = croppedPhoto;
    let activeCanvas = croppedCanvasRef.current;
    let activeDetections = detections;

    if (!activeCropped || !activeCanvas) {
      const result = await applyCropToPhoto(loadedPhoto, cropRect);
      activeCropped = result.cropped;
      activeCanvas = result.canvas;
      activeDetections = result.initialDetections;
    }

    const ctx = activeCanvas.getContext('2d');
    if (ctx && detectorWorkerRef.current) {
      const imageData = ctx.getImageData(0, 0, activeCropped.width, activeCropped.height);
      const detected = await new Promise<DetectionBox[]>((resolve) => {
        pendingConvertResolveRef.current = resolve;
        detectorWorkerRef.current!.postMessage({
          type: 'detect',
          requestId: `req-${Date.now()}`,
          rgba: imageData.data,
          width: activeCropped!.width,
          height: activeCropped!.height,
        } satisfies DetectorWorkerRequest);
      });
      if (detected.length > 0) {
        activeDetections = detected;
      }
    }

    onStatusStep?.('Reading labels...');
    try {
      const withLabels = await recognizeShapeLabelsInWorker(
        activeCanvas,
        activeDetections,
        (status) => {
          setOcrStatus(status);
          onStatusStep?.('Reading labels...');
        },
      );
      activeDetections = withLabels;
      setDetections(withLabels);
    } catch {
      // Keep existing labels if PP-OCRv5 models are not present
      setOcrStatus('Using detected/default labels');
    }

    onStatusStep?.('Connecting diagram...');
    if (ctx && onGraphBuilt) {
      const imageData = ctx.getImageData(0, 0, activeCropped.width, activeCropped.height);
      const ink = binarizeToInkMask(imageData.data, activeCropped.width, activeCropped.height);
      const builtGraph = buildGraphFromDetections(activeDetections, ink);
      onGraphBuilt(builtGraph, {
        dataUrl: activeCropped.dataUrl,
        width: activeCropped.width,
        height: activeCropped.height,
      });
    }

    conversionActiveRef.current = false;
    onStatusStep?.(null);
    setIsBusy(false);
  };

  useImperativeHandle(ref, () => ({
    openFilePicker: () => fileInputRef.current?.click(),
    convertPhoto: () => {
      void handleConvertFlow();
    },
    loadSamplePhoto: handleUseSample,
  }));

  const getImagePointFromPointer = (e: PointerEvent<HTMLDivElement>) => {
    if (!cropStageRef.current || !loadedPhoto) return null;
    const rect = cropStageRef.current.getBoundingClientRect();
    const relX = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    const relY = Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1);
    return {
      x: Math.round(relX * loadedPhoto.width),
      y: Math.round(relY * loadedPhoto.height),
    };
  };

  const handleCropPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const pt = getImagePointFromPointer(e);
    if (!pt) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragStart(pt);
    setCropRect({ x: pt.x, y: pt.y, width: 1, height: 1 });
  };

  const handleCropPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragStart) return;
    const pt = getImagePointFromPointer(e);
    if (!pt) return;
    const x = Math.min(dragStart.x, pt.x);
    const y = Math.min(dragStart.y, pt.y);
    const width = Math.max(20, Math.abs(pt.x - dragStart.x));
    const height = Math.max(20, Math.abs(pt.y - dragStart.y));
    setCropRect({ x, y, width, height });
  };

  const handleCropPointerUp = () => {
    setDragStart(null);
  };

  const handleRunOnnxDetector = () => {
    if (!croppedCanvasRef.current || !croppedPhoto || !detectorWorkerRef.current) return;
    const ctx = croppedCanvasRef.current.getContext('2d');
    if (!ctx) return;

    const imageData = ctx.getImageData(0, 0, croppedPhoto.width, croppedPhoto.height);
    setIsBusy(true);
    conversionActiveRef.current = true;
    onStatusStep?.('Finding shapes and arrows...');
    detectorWorkerRef.current.postMessage({
      type: 'detect',
      requestId: `req-${Date.now()}`,
      rgba: imageData.data,
      width: croppedPhoto.width,
      height: croppedPhoto.height,
    } satisfies DetectorWorkerRequest);
  };

  const handleRunOcr = async () => {
    if (!croppedCanvasRef.current || detections.length === 0) return;
    setIsBusy(true);
    onStatusStep?.('Reading labels...');
    try {
      const withLabels = await recognizeShapeLabelsInWorker(
        croppedCanvasRef.current,
        detections,
        (status) => {
          setOcrStatus(status);
          onStatusStep?.('Reading labels...');
        },
      );
      setDetections(withLabels);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setOcrStatus(`OCR unavailable (${message})`);
    } finally {
      onStatusStep?.(null);
      setIsBusy(false);
    }
  };

  const handleBuildGraph = () => {
    if (!croppedCanvasRef.current || !croppedPhoto || !onGraphBuilt) return;
    const ctx = croppedCanvasRef.current.getContext('2d');
    if (!ctx) return;
    onStatusStep?.('Connecting diagram...');
    const imageData = ctx.getImageData(0, 0, croppedPhoto.width, croppedPhoto.height);
    const ink = binarizeToInkMask(imageData.data, croppedPhoto.width, croppedPhoto.height);
    const builtGraph = buildGraphFromDetections(detections, ink);
    onGraphBuilt(builtGraph, {
      dataUrl: croppedPhoto.dataUrl,
      width: croppedPhoto.width,
      height: croppedPhoto.height,
    });
    onStatusStep?.(null);
  };

  const handleSelectDetection = (det: DetectionBox) => {
    setSelectedDetection(det);
    if (!croppedCanvasRef.current || !croppedPhoto) return;

    const labelRect = computeLabelCropRect(det.box, croppedPhoto.width, croppedPhoto.height, 8);
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = labelRect.width;
    cropCanvas.height = labelRect.height;
    const ctx = cropCanvas.getContext('2d')!;
    ctx.drawImage(
      croppedCanvasRef.current,
      labelRect.x,
      labelRect.y,
      labelRect.width,
      labelRect.height,
      0,
      0,
      labelRect.width,
      labelRect.height,
    );
    setLabelCropUrl(cropCanvas.toDataURL('image/png'));
  };

  return (
    <section className="wf-photo-panel">
      <div className="wf-photo-header">
        <div>
          <strong className="wf-section-title">Source photo</strong>
          <span className="wf-hint">
            {croppedPhoto
              ? `${croppedPhoto.width}×${croppedPhoto.height}px`
              : loadedPhoto
                ? `Drag to crop (${loadedPhoto.width}×${loadedPhoto.height}px)`
                : 'Choose a JPEG or PNG photo'}
          </span>
        </div>
        <div className="wf-photo-controls">
          <label className="wf-file-btn">
            Choose
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png" onChange={handleFileChange} hidden />
          </label>
          <button type="button" onClick={handleUseSample}>
            Sample
          </button>
        </div>
      </div>

      {!loadedPhoto && (
        <div className="wf-photo-empty">
          <p>Open a whiteboard photo or load the sample image to convert it into an editable flowchart.</p>
        </div>
      )}

      {loadedPhoto && !croppedPhoto && (
        <div className="wf-crop-container">
          <div
            ref={cropStageRef}
            className="wf-crop-stage"
            onPointerDown={handleCropPointerDown}
            onPointerMove={handleCropPointerMove}
            onPointerUp={handleCropPointerUp}
          >
            <img src={loadedPhoto.dataUrl} alt={loadedPhoto.name} draggable={false} />
            <div
              className="wf-crop-rect"
              style={{
                left: `${(cropRect.x / loadedPhoto.width) * 100}%`,
                top: `${(cropRect.y / loadedPhoto.height) * 100}%`,
                width: `${(cropRect.width / loadedPhoto.width) * 100}%`,
                height: `${(cropRect.height / loadedPhoto.height) * 100}%`,
              }}
            />
          </div>
          <div className="wf-crop-actions">
            <span className="wf-hint">
              Crop: {cropRect.width}×{cropRect.height}px
            </span>
            <div>
              <button
                type="button"
                onClick={() =>
                  setCropRect({ x: 0, y: 0, width: loadedPhoto.width, height: loadedPhoto.height })
                }
              >
                Full Image
              </button>
              <button
                type="button"
                className="wf-primary-btn"
                onClick={() => void applyCropToPhoto(loadedPhoto, cropRect)}
              >
                Apply Crop
              </button>
            </div>
          </div>
        </div>
      )}

      {croppedPhoto && (
        <div className="wf-cropped-container">
          <div className="wf-cropped-toolbar">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" onClick={handleRunOnnxDetector} disabled={isBusy}>
                Detect shapes
              </button>
              <button type="button" onClick={handleRunOcr} disabled={isBusy || detections.length === 0}>
                Read labels
              </button>
              <button type="button" onClick={handleBuildGraph} disabled={isBusy || detections.length === 0}>
                Build diagram
              </button>
              <button type="button" onClick={() => setShowOverlay((v) => !v)}>
                {showOverlay ? 'Hide boxes' : 'Show boxes'}
              </button>
            </div>
            <button type="button" onClick={() => setCroppedPhoto(null)}>
              Re-crop
            </button>
          </div>

          <div className="wf-overlay-stage">
            <img src={croppedPhoto.dataUrl} alt="Cropped whiteboard" />
            {showOverlay && (
              <svg
                className="wf-overlay-svg"
                viewBox={`0 0 ${croppedPhoto.width} ${croppedPhoto.height}`}
                preserveAspectRatio="none"
              >
                {detections.map((det) => {
                  const isSelected = selectedDetection?.id === det.id;
                  const stroke = det.kind === 'arrow' || det.kind === 'arrowhead' ? '#ea580c' : '#2563eb';
                  return (
                    <g
                      key={det.id}
                      onClick={() => handleSelectDetection(det)}
                      style={{ cursor: 'pointer' }}
                    >
                      <rect
                        x={det.box.x}
                        y={det.box.y}
                        width={det.box.width}
                        height={det.box.height}
                        fill={isSelected ? 'rgba(37, 99, 235, 0.16)' : 'rgba(37, 99, 235, 0.06)'}
                        stroke={stroke}
                        strokeWidth={Math.max(2, croppedPhoto.width * 0.004)}
                      />
                      <text
                        x={det.box.x + 6}
                        y={Math.max(16, det.box.y - 6)}
                        fill={stroke}
                        fontSize={Math.max(12, Math.round(croppedPhoto.width * 0.022))}
                        fontWeight="600"
                      >
                        {det.kind}
                        {det.label ? `: ${det.label}` : ''} ({Math.round(det.confidence * 100)}%)
                      </text>
                    </g>
                  );
                })}
                {highlightedArrow && highlightedArrow.points.length >= 2 && (
                  <polyline
                    points={highlightedArrow.points.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke="#B45309"
                    strokeWidth={Math.max(5, croppedPhoto.width * 0.008)}
                    strokeDasharray="10 6"
                  />
                )}
              </svg>
            )}
          </div>

          {selectedDetection && (
            <div className="wf-label-crop-card">
              <div>
                <strong>Label Crop:</strong> {selectedDetection.kind}
                {selectedDetection.label ? ` — "${selectedDetection.label}"` : ''}
                <div className="wf-hint">
                  ({Math.round(selectedDetection.box.x)}, {Math.round(selectedDetection.box.y)}){' '}
                  {Math.round(selectedDetection.box.width)}×{Math.round(selectedDetection.box.height)}px
                </div>
              </div>
              {labelCropUrl && (
                <img src={labelCropUrl} alt="High-res label crop" className="wf-label-crop-img" />
              )}
            </div>
          )}

          <details className="wf-diagnostics">
            <summary>Diagnostics</summary>
            <div className="wf-status-bar">
              <span>
                <strong>Shape detector:</strong> {detectorStatus}
              </span>
              <span>
                <strong>Label reader:</strong> {ocrStatus}
              </span>
              {lastInferenceMeta && <span className="wf-hint">{lastInferenceMeta}</span>}
              <span className="wf-hint">
                Letterbox scale {croppedPhoto.letterbox.scale.toFixed(3)}, pad{' '}
                {Math.round(croppedPhoto.letterbox.padX)}×{Math.round(croppedPhoto.letterbox.padY)}
              </span>
            </div>
          </details>
        </div>
      )}

      {loadedPhoto && !croppedPhoto && (
        <details className="wf-diagnostics">
          <summary>Diagnostics</summary>
          <div className="wf-status-bar">
            <span>
              <strong>Shape detector:</strong> {detectorStatus}
            </span>
            <span>
              <strong>Label reader:</strong> {ocrStatus}
            </span>
          </div>
        </details>
      )}
    </section>
  );
});
