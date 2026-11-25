import type { ShapeType } from './types';

export interface ShapeDefinition {
  type: ShapeType;
  displayName: string;
  defaultLabel: string;
  defaultWidth: number;
  defaultHeight: number;
  mermaidShape: string;
  drawioStyle: string;
}

export const SHAPE_REGISTRY: Record<ShapeType, ShapeDefinition> = {
  rectangle: {
    type: 'rectangle',
    displayName: 'Process',
    defaultLabel: 'Process',
    defaultWidth: 160,
    defaultHeight: 68,
    mermaidShape: 'rect',
    drawioStyle: 'rounded=0;whiteSpace=wrap;html=1;',
  },
  oval: {
    type: 'oval',
    displayName: 'Start / End',
    defaultLabel: 'Start / End',
    defaultWidth: 150,
    defaultHeight: 64,
    mermaidShape: 'stadium',
    drawioStyle: 'ellipse;whiteSpace=wrap;html=1;',
  },
  diamond: {
    type: 'diamond',
    displayName: 'Decision',
    defaultLabel: 'Decision?',
    defaultWidth: 180,
    defaultHeight: 110,
    mermaidShape: 'diam',
    drawioStyle: 'rhombus;whiteSpace=wrap;html=1;',
  },
  parallelogram: {
    type: 'parallelogram',
    displayName: 'Input / Output',
    defaultLabel: 'Input / Output',
    defaultWidth: 170,
    defaultHeight: 68,
    mermaidShape: 'lean-r',
    drawioStyle: 'shape=parallelogram;perimeter=parallelogramPerimeter;whiteSpace=wrap;html=1;fixedSize=1;',
  },
  database: {
    type: 'database',
    displayName: 'Database',
    defaultLabel: 'Database',
    defaultWidth: 140,
    defaultHeight: 84,
    mermaidShape: 'cyl',
    drawioStyle: 'shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;',
  },
  document: {
    type: 'document',
    displayName: 'Document',
    defaultLabel: 'Document',
    defaultWidth: 160,
    defaultHeight: 76,
    mermaidShape: 'doc',
    drawioStyle: 'shape=document;whiteSpace=wrap;html=1;boundedLbl=1;',
  },
};

export const SHAPE_LIST: ShapeDefinition[] = [
  SHAPE_REGISTRY.rectangle,
  SHAPE_REGISTRY.oval,
  SHAPE_REGISTRY.diamond,
  SHAPE_REGISTRY.parallelogram,
  SHAPE_REGISTRY.database,
  SHAPE_REGISTRY.document,
];

export function getShapeDefinition(shape: ShapeType): ShapeDefinition {
  return SHAPE_REGISTRY[shape] ?? SHAPE_REGISTRY.rectangle;
}
