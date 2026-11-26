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
import { recognizeBranchLabelsInWorker, recognizeShapeLabelsInWorker } from '../vision/ocrClient';
import { filterAndDeduplicateDetections, type FilteredDetections } from '../vision/shapeFilter';
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
  const [rawDetections, setRawDetections] = useState<DetectionBox[]>([]);
  const [filteredSummary, setFilteredSummary] = useState<FilteredDetections | null>(null);
  const [showPhoto, setShowPhoto] = useState(true);
  const [showBoxes, setShowBoxes] = useState(true);
  const [selectedDetection, setSelectedDetection] = useState<DetectionBox | null>(null);
  const [labelCropUrl, setLabelCropUrl] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);

  const [detectorStatus, setDetectorStatus] = useState<string>('Ready');
  const [ocrStatus, setOcrStatus] = useState<string>('Ready');
  const [activeStage, setActiveStage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [lastInferenceMeta, setLastInferenceMeta] = useState<string | null>(null);

  const cropStageRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const croppedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const detectorWorkerRef = useRef<Worker | null>(null);
  const pendingDetectResolveRef = useRef<((dets: DetectionBox[]) => void) | null>(null);
  const conversionActiveRef = useRef(false);

  const reportStage = (stage: string | null) => {
    setActiveStage(stage);
    onStatusStep?.(stage);
  };

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
                ? 'Detecting shapes...'
                : msg.stage === 'postprocessing'
                  ? 'Aligning detections...'
                  : 'Detector ready';
        setDetectorStatus(plain);
        if (conversionActiveRef.current && msg.stage !== 'model-ready') {
          reportStage(plain);
        }
      } else if (msg.type === 'result') {
        setRawDetections(msg.detections);
        setLastInferenceMeta(`${msg.detections.length} raw detections in ${msg.inferenceMs}ms`);
        setDetectorStatus(`Detected ${msg.detections.length} raw boxes`);
        if (pendingDetectResolveRef.current) {
          const resolve = pendingDetectResolveRef.current;
          pendingDetectResolveRef.current = null;
          resolve(msg.detections);
        } else {
          conversionActiveRef.current = false;
          reportStage(null);
          setIsBusy(false);
        }
      } else if (msg.type === 'error') {
        setDetectorStatus(`Detector error: ${msg.message}`);
        if (pendingDetectResolveRef.current) {
          const resolve = pendingDetectResolveRef.current;
          pendingDetectResolveRef.current = null;
          resolve([]);
        } else {
          conversionActiveRef.current = false;
          reportStage(null);
          setIsBusy(false);
        }
      }
    };

    worker.postMessage({ type: 'init' } satisfies DetectorWorkerRequest);

    return () => {
      worker.terminate();
      detectorWorkerRef.current = null;
    };
  }, []);

  const applyCropToPhoto = (
    photo: LoadedPhoto,
    rect: CropRect,
  ): Promise<{ cropped: CroppedPhoto; canvas: HTMLCanvasElement; initialDetections: DetectionBox[] }> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const cw = Math.max(1, Math.min(photo.width - rect.x, rect.width));
        const ch = Math.max(1, Math.min(photo.height - rect.y, rect.height));

        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
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
        setRawDetections(initialDetections);
        setFilteredSummary(null);
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
      setRawDetections([]);
      setFilteredSummary(null);
      setSelectedDetection(null);
      setLabelCropUrl(null);
      setLastInferenceMeta(null);
      setShowPhoto(true);
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
    setRawDetections([]);
    setFilteredSummary(null);
    setSelectedDetection(null);
    setLabelCropUrl(null);
    setLastInferenceMeta(null);
    setShowPhoto(true);
    onPhotoSelected?.(true);
  };

  const runDetectorOnCanvas = async (
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
  ): Promise<DetectionBox[]> => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || !detectorWorkerRef.current) return rawDetections;
    const imageData = ctx.getImageData(0, 0, width, height);
    return new Promise<DetectionBox[]>((resolve) => {
      pendingDetectResolveRef.current = resolve;
      detectorWorkerRef.current!.postMessage({
        type: 'detect',
        requestId: `req-${Date.now()}`,
        rgba: imageData.data,
        width,
        height,
      } satisfies DetectorWorkerRequest);
    });
  };

  const handleConvertFlow = async () => {
    if (!loadedPhoto) return;
    setIsBusy(true);
    conversionActiveRef.current = true;
    reportStage('Preparing photo...');

    try {
      let activeCropped = croppedPhoto;
      let activeCanvas = croppedCanvasRef.current;
      let activeRaw = rawDetections;

      if (!activeCropped || !activeCanvas) {
        const res = await applyCropToPhoto(loadedPhoto, cropRect);
        activeCropped = res.cropped;
        activeCanvas = res.canvas;
        activeRaw = res.initialDetections;
      }

      reportStage('Detecting shapes...');
      const detected = await runDetectorOnCanvas(
        activeCanvas,
        activeCropped.width,
        activeCropped.height,
      );
      if (detected.length > 0) {
        activeRaw = detected;
        setRawDetections(detected);
      }

      const ctx = activeCanvas.getContext('2d', { willReadFrequently: true })!;
      const imageData = ctx.getImageData(0, 0, activeCropped.width, activeCropped.height);
      const ink = binarizeToInkMask(imageData.data, activeCropped.width, activeCropped.height);

      const filtered = filterAndDeduplicateDetections(
        activeRaw,
        ink,
        activeCropped.width,
        activeCropped.height,
      );
      setFilteredSummary(filtered);

      reportStage('Reading labels...');
      let labeledShapes = filtered.acceptedShapes;
      try {
        labeledShapes = await recognizeShapeLabelsInWorker(
          activeCanvas,
          filtered.acceptedShapes,
          (status) => {
            setOcrStatus(status);
            reportStage(status);
          },
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setOcrStatus(`OCR error: ${message}`);
      }

      reportStage('Resolving arrows...');
      const combined = [...labeledShapes, ...filtered.plausibleArrowheads];
      setRawDetections([...combined, ...filtered.doubtfulShapes, ...filtered.rejectedArrowheads]);
      const builtGraph = buildGraphFromDetections(combined, ink);

      try {
        const edgesWithBranchLabels = await recognizeBranchLabelsInWorker(
          activeCanvas,
          builtGraph.edges,
          builtGraph.nodes,
          labeledShapes,
          ink,
          (status) => {
            setOcrStatus(status);
            reportStage(status);
          },
        );
        builtGraph.edges = edgesWithBranchLabels;
      } catch {
        // Keep edges even if branch OCR fails
      }

      onGraphBuilt?.(builtGraph, {
        dataUrl: activeCropped.dataUrl,
        width: activeCropped.width,
        height: activeCropped.height,
      });
    } finally {
      conversionActiveRef.current = false;
      reportStage(null);
      setIsBusy(false);
    }
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

  const handleDiagDetect = async () => {
    if (!croppedCanvasRef.current || !croppedPhoto) return;
    setIsBusy(true);
    conversionActiveRef.current = true;
    reportStage('Detecting shapes...');
    try {
      const detected = await runDetectorOnCanvas(
        croppedCanvasRef.current,
        croppedPhoto.width,
        croppedPhoto.height,
      );
      if (detected.length > 0) {
        setRawDetections(detected);
      }
    } finally {
      conversionActiveRef.current = false;
      reportStage(null);
      setIsBusy(false);
    }
  };

  const handleDiagOcr = async () => {
    if (!croppedCanvasRef.current || !croppedPhoto || rawDetections.length === 0) return;
    setIsBusy(true);
    conversionActiveRef.current = true;
    reportStage('Reading labels...');
    try {
      const ctx = croppedCanvasRef.current.getContext('2d', { willReadFrequently: true })!;
      const imageData = ctx.getImageData(0, 0, croppedPhoto.width, croppedPhoto.height);
      const ink = binarizeToInkMask(imageData.data, croppedPhoto.width, croppedPhoto.height);
      const filtered = filterAndDeduplicateDetections(
        rawDetections,
        ink,
        croppedPhoto.width,
        croppedPhoto.height,
      );
      setFilteredSummary(filtered);
      const labeled = await recognizeShapeLabelsInWorker(
        croppedCanvasRef.current,
        filtered.acceptedShapes,
        (status) => {
          setOcrStatus(status);
          reportStage(status);
        },
      );
      setRawDetections([
        ...labeled,
        ...filtered.plausibleArrowheads,
        ...filtered.doubtfulShapes,
        ...filtered.rejectedArrowheads,
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setOcrStatus(`OCR error: ${message}`);
    } finally {
      conversionActiveRef.current = false;
      reportStage(null);
      setIsBusy(false);
    }
  };

  const handleDiagBuild = async () => {
    if (!croppedCanvasRef.current || !croppedPhoto || !onGraphBuilt) return;
    const ctx = croppedCanvasRef.current.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    reportStage('Resolving arrows...');
    const imageData = ctx.getImageData(0, 0, croppedPhoto.width, croppedPhoto.height);
    const ink = binarizeToInkMask(imageData.data, croppedPhoto.width, croppedPhoto.height);
    const filtered = filterAndDeduplicateDetections(
      rawDetections,
      ink,
      croppedPhoto.width,
      croppedPhoto.height,
    );
    setFilteredSummary(filtered);
    const builtGraph = buildGraphFromDetections(
      [...filtered.acceptedShapes, ...filtered.plausibleArrowheads],
      ink,
    );
    try {
      builtGraph.edges = await recognizeBranchLabelsInWorker(
        croppedCanvasRef.current,
        builtGraph.edges,
        builtGraph.nodes,
        filtered.acceptedShapes,
        ink,
        setOcrStatus,
      );
    } catch {
      // Keep edges if branch OCR unavailable
    }
    onGraphBuilt(builtGraph, {
      dataUrl: croppedPhoto.dataUrl,
      width: croppedPhoto.width,
      height: croppedPhoto.height,
    });
    reportStage(null);
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

  const doubtfulIds = new Set([
    ...(filteredSummary?.doubtfulShapes.map((d) => d.id) ?? []),
    ...(filteredSummary?.rejectedArrowheads.map((d) => d.id) ?? []),
  ]);

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
            <button
              type="button"
              className="wf-primary-btn"
              onClick={() => void handleConvertFlow()}
              disabled={isBusy}
            >
              {activeStage ? activeStage : 'Convert photo'}
            </button>
            <button type="button" onClick={() => setShowPhoto((v) => !v)}>
              {showPhoto ? 'Hide photo' : 'Show photo'}
            </button>
            <button type="button" onClick={() => setShowBoxes((v) => !v)}>
              {showBoxes ? 'Hide boxes' : 'Show boxes'}
            </button>
            <button type="button" onClick={() => setCroppedPhoto(null)}>
              Re-crop
            </button>
          </div>

          {showPhoto && (
            <div className="wf-overlay-stage">
              <img src={croppedPhoto.dataUrl} alt="Cropped whiteboard" />
              {showBoxes && (
                <svg
                  className="wf-overlay-svg"
                  viewBox={`0 0 ${croppedPhoto.width} ${croppedPhoto.height}`}
                  preserveAspectRatio="none"
                >
                  {rawDetections.map((det) => {
                    const isSelected = selectedDetection?.id === det.id;
                    const isDoubtful = doubtfulIds.has(det.id);
                    const stroke = isDoubtful
                      ? '#94A3B8'
                      : det.kind === 'arrow' || det.kind === 'arrowhead'
                        ? '#EA580C'
                        : '#2563EB';
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
                          fill={isSelected ? 'rgba(37, 99, 235, 0.16)' : 'rgba(37, 99, 235, 0.04)'}
                          stroke={stroke}
                          strokeDasharray={isDoubtful ? '6 4' : undefined}
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
          )}

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
            <div className="wf-diag-controls">
              <button type="button" onClick={() => void handleDiagDetect()} disabled={isBusy}>
                Detect shapes
              </button>
              <button
                type="button"
                onClick={() => void handleDiagOcr()}
                disabled={isBusy || rawDetections.length === 0}
              >
                Read labels
              </button>
              <button
                type="button"
                onClick={() => void handleDiagBuild()}
                disabled={isBusy || rawDetections.length === 0}
              >
                Build diagram
              </button>
            </div>
            <div className="wf-status-bar">
              <span>
                <strong>Shape detector:</strong> {detectorStatus}
              </span>
              <span>
                <strong>Label reader:</strong> {ocrStatus}
              </span>
              {lastInferenceMeta && <span className="wf-hint">{lastInferenceMeta}</span>}
              {filteredSummary && (
                <span className="wf-hint">
                  Accepted shapes: {filteredSummary.acceptedShapes.length} · Doubtful:{' '}
                  {filteredSummary.doubtfulShapes.length} · Rejected marks:{' '}
                  {filteredSummary.rejectedArrowheads.length}
                </span>
              )}
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
