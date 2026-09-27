export type ToolCategoryId = 'organize' | 'optimize' | 'convert-to' | 'convert-from' | 'edit' | 'image';

export interface ToolCategory {
  id: ToolCategoryId;
  name: string;
  slug: string;
  description: string;
  color: string;
}

export type AcceptKind = 'pdf' | 'image' | 'jpg' | 'png' | 'heic' | 'word' | 'powerpoint' | 'excel' | 'html' | 'any';

export interface ToolDefinition {
  id: string;
  slug: string;
  name: string;
  shortName?: string;
  description: string;
  longDescription: string;
  category: ToolCategoryId;
  icon: string;
  /** which kinds of file the tool accepts as input */
  accept: AcceptKind[];
  multiple: boolean;
  /** max number of input files */
  maxFiles?: number;
  /** Search keywords */
  keywords: string[];
  /** CTA label for the main action */
  actionLabel: string;
}

export type WorkflowStep = 'upload' | 'configure' | 'processing' | 'done';

export type ProcessingStage =
  | 'Analyzing...'
  | 'Processing...'
  | 'Converting...'
  | 'Optimizing...'
  | 'Generating PDF...'
  | 'Recognizing text...'
  | 'Rendering pages...'
  | 'Finalizing...';

export interface FileMeta {
  id: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  addedAt: number;
  /** number of pages if known (PDF) */
  pageCount?: number;
  /** For images: width/height */
  width?: number;
  height?: number;
  /** user-set clockwise rotation in degrees */
  rotation: number;
  error?: string;
}

export interface OutputFileMeta {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  pageCount?: number;
}

export interface ToolResultMeta {
  toolId: string;
  outputs: OutputFileMeta[];
  inputs: { name: string; size: number }[];
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  /** Tool specific extra info (compression stats, OCR text, validation status...) */
  extra?: Record<string, unknown>;
  warnings?: string[];
}

export interface HistoryItem {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: number;
  toolId: string;
  toolName: string;
  pageCount?: number;
}

export interface AppError {
  code: string;
  message: string;
  details?: string;
}
