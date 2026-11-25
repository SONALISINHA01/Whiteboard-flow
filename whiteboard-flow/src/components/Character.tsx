import type { RefObject } from 'react';

export type CharacterShapeId =
  | 'process'
  | 'start-end'
  | 'decision'
  | 'input-output'
  | 'database'
  | 'document';

export interface CharacterDefinition {
  id: CharacterShapeId;
  label: string;
  expression: 'cheerful' | 'relaxed' | 'curious';
  maxTravelPx: number;
}

export const CHARACTER_DEFINITIONS: CharacterDefinition[] = [
  { id: 'process', label: 'Process', expression: 'cheerful', maxTravelPx: 3.5 },
  { id: 'start-end', label: 'Start / End', expression: 'relaxed', maxTravelPx: 3.2 },
  { id: 'decision', label: 'Decision', expression: 'curious', maxTravelPx: 3.2 },
  { id: 'input-output', label: 'Input / Output', expression: 'cheerful', maxTravelPx: 3.4 },
  { id: 'database', label: 'Database', expression: 'cheerful', maxTravelPx: 3.5 },
  { id: 'document', label: 'Document', expression: 'relaxed', maxTravelPx: 3.4 },
];

interface CharacterProps {
  def: CharacterDefinition;
  faceRef: RefObject<HTMLDivElement | null>;
}

export function Character({ def, faceRef }: CharacterProps) {
  return (
    <div className="wf-char-slot">
      <div className={`wf-char wf-char--${def.id}`} aria-hidden="true">
        <div className="wf-char-shadow-wrap">
          <div className="wf-char-shadow-ambient" />
          <div className="wf-char-shadow-contact" />
        </div>

        <div className="wf-char-body-wrap">
          <div className="wf-char-depth" />
          <div className="wf-char-body">
            {def.id === 'database' && <div className="wf-char-lid" />}
            <div className="wf-char-highlight" />
          </div>
        </div>

        <div ref={faceRef} className={`wf-char-face wf-char-face--${def.expression}`}>
          <div className="wf-char-eyes">
            <span className="wf-char-eye">
              <span className="wf-char-pupil" />
            </span>
            <span className="wf-char-eye">
              <span className="wf-char-pupil" />
            </span>
          </div>
          <div className="wf-char-cheeks">
            <span className="wf-char-cheek" />
            <span className="wf-char-cheek" />
          </div>
          <div className="wf-char-mouth" />
        </div>
      </div>
    </div>
  );
}
