/** Annotation layer (spec 5). Kept separate from content. */
export type AnnotationKind = "note" | "highlight" | "tag" | "confidence" | "ink" | "voice";
export type Lane = "trigger" | "pf" | "pm" | "action";
export type HighlightColor = "yellow" | "green" | "blue" | "red" | "purple";
export type Confidence = "weak" | "ok" | "solid";

export interface Stroke {
  points: [x: number, y: number, pressure: number][];
  color: string;
  size: number;
  /** "pen" | "highlighter" (highlighter rendered translucent). */
  tool?: "pen" | "highlighter";
}

export interface AnnotationTarget {
  procedureId: string;
  gateId?: string;
  rowId?: string;
  lane?: Lane;
}

export interface Annotation {
  id: string;
  target: AnnotationTarget;
  kind: AnnotationKind;
  text?: string;
  color?: HighlightColor;
  tag?: string;
  confidence?: Confidence;
  strokes?: Stroke[];
  blobId?: string;
  durationMs?: number;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
}

export const HIGHLIGHT_COLORS: HighlightColor[] = ["yellow", "green", "blue", "red", "purple"];
export const CONFIDENCES: Confidence[] = ["weak", "ok", "solid"];
