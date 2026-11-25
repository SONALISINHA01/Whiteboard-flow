import type { ShapeType } from '../graph/types';

export interface PixelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LetterboxTransform {
  srcWidth: number;
  srcHeight: number;
  targetSize: number;
  scale: number;
  padX: number;
  padY: number;
}

export type DetectionKind = ShapeType | 'arrow' | 'arrowhead';

export interface DetectionBox {
  id: string;
  kind: DetectionKind;
  label?: string;
  confidence: number;
  /** Bounding box in cropped photo pixel coordinates. */
  box: PixelBox;
}

/**
 * Computes the letterbox scale and padding needed to resize and pad a cropped
 * photo (`srcWidth` x `srcHeight`) into a square `targetSize` x `targetSize`
 * detector input while preserving aspect ratio.
 */
export function computeLetterboxTransform(
  srcWidth: number,
  srcHeight: number,
  targetSize = 640,
): LetterboxTransform {
  if (srcWidth <= 0 || srcHeight <= 0 || targetSize <= 0) {
    throw new Error('Dimensions and targetSize must be positive numbers.');
  }
  const scale = Math.min(targetSize / srcWidth, targetSize / srcHeight);
  const scaledWidth = srcWidth * scale;
  const scaledHeight = srcHeight * scale;
  const padX = (targetSize - scaledWidth) / 2;
  const padY = (targetSize - scaledHeight) / 2;

  return {
    srcWidth,
    srcHeight,
    targetSize,
    scale,
    padX,
    padY,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Maps a bounding box from detector input coordinates (0..targetSize) back
 * into the cropped photo's pixel coordinate system using the saved scale and padding.
 */
export function mapDetectorBoxToCroppedPhoto(
  detectorBox: PixelBox,
  transform: LetterboxTransform,
): PixelBox {
  const x1 = clamp((detectorBox.x - transform.padX) / transform.scale, 0, transform.srcWidth);
  const y1 = clamp((detectorBox.y - transform.padY) / transform.scale, 0, transform.srcHeight);
  const x2 = clamp(
    (detectorBox.x + detectorBox.width - transform.padX) / transform.scale,
    0,
    transform.srcWidth,
  );
  const y2 = clamp(
    (detectorBox.y + detectorBox.height - transform.padY) / transform.scale,
    0,
    transform.srcHeight,
  );

  return {
    x: x1,
    y: y1,
    width: Math.max(0, x2 - x1),
    height: Math.max(0, y2 - y1),
  };
}

/**
 * Maps a bounding box in cropped photo pixel coordinates into the letterboxed
 * detector input space.
 */
export function mapCroppedBoxToDetector(
  croppedBox: PixelBox,
  transform: LetterboxTransform,
): PixelBox {
  return {
    x: croppedBox.x * transform.scale + transform.padX,
    y: croppedBox.y * transform.scale + transform.padY,
    width: croppedBox.width * transform.scale,
    height: croppedBox.height * transform.scale,
  };
}

/**
 * Computes a padded integer pixel crop rectangle on the high-resolution
 * cropped photo so small handwriting stays readable for OCR.
 */
export function computeLabelCropRect(
  box: PixelBox,
  croppedWidth: number,
  croppedHeight: number,
  paddingPx = 8,
): PixelBox {
  const x1 = Math.max(0, Math.floor(box.x - paddingPx));
  const y1 = Math.max(0, Math.floor(box.y - paddingPx));
  const x2 = Math.min(croppedWidth, Math.ceil(box.x + box.width + paddingPx));
  const y2 = Math.min(croppedHeight, Math.ceil(box.y + box.height + paddingPx));

  return {
    x: x1,
    y: y1,
    width: Math.max(1, x2 - x1),
    height: Math.max(1, y2 - y1),
  };
}

/**
 * Generates sample detection boxes in cropped photo pixel coordinates
 * matching the sample Start -> Check input -> End flowchart.
 */
export function createSampleDetections(croppedWidth: number, croppedHeight: number): DetectionBox[] {
  const cx = croppedWidth * 0.5;
  const startW = Math.round(croppedWidth * 0.28);
  const startH = Math.round(croppedHeight * 0.13);
  const checkW = Math.round(croppedWidth * 0.36);
  const checkH = Math.round(croppedHeight * 0.2);
  const endW = Math.round(croppedWidth * 0.28);
  const endH = Math.round(croppedHeight * 0.13);

  return [
    {
      id: 'det-start',
      kind: 'oval',
      label: 'Start',
      confidence: 0.96,
      box: {
        x: Math.round(cx - startW / 2),
        y: Math.round(croppedHeight * 0.1),
        width: startW,
        height: startH,
      },
    },
    {
      id: 'det-arrow-1',
      kind: 'arrow',
      confidence: 0.91,
      box: {
        x: Math.round(cx - croppedWidth * 0.04),
        y: Math.round(croppedHeight * 0.23),
        width: Math.round(croppedWidth * 0.08),
        height: Math.round(croppedHeight * 0.14),
      },
    },
    {
      id: 'det-check',
      kind: 'diamond',
      label: 'Check input',
      confidence: 0.93,
      box: {
        x: Math.round(cx - checkW / 2),
        y: Math.round(croppedHeight * 0.37),
        width: checkW,
        height: checkH,
      },
    },
    {
      id: 'det-arrow-2',
      kind: 'arrow',
      label: 'Valid',
      confidence: 0.89,
      box: {
        x: Math.round(cx - croppedWidth * 0.04),
        y: Math.round(croppedHeight * 0.57),
        width: Math.round(croppedWidth * 0.08),
        height: Math.round(croppedHeight * 0.16),
      },
    },
    {
      id: 'det-end',
      kind: 'oval',
      label: 'End',
      confidence: 0.95,
      box: {
        x: Math.round(cx - endW / 2),
        y: Math.round(croppedHeight * 0.73),
        width: endW,
        height: endH,
      },
    },
  ];
}
