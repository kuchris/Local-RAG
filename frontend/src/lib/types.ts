export type Language = "zh-Hant" | "en" | "ja";
export type ReadingMode = "standard" | "fiction";
export const UNCATEGORIZED = "__uncategorized__";

export interface Scope {
  category_id: string | null;
  /** null = every document in the category; [] = nothing selected (never expands to all). */
  document_ids: string[] | null;
  reading_mode: ReadingMode;
}

export interface Document {
  id: string;
  name: string;
  status: "queued" | "processing" | "ready" | "error";
  progress: number;
  pages: number;
  chunks: number;
  error: string | null;
  created: number;
  format: "pdf" | "epub";
  category_id: string | null;
}

export interface Category {
  id: string;
  name: string;
  count: number;
}

export interface FolderFile {
  path: string;
  present: number;
  document_id: string | null;
  pending_id: string | null;
  status: Document["status"] | null;
  error: string | null;
  import_error: string | null;
}

export interface Folder {
  id: string;
  path: string;
  last_scan: number | null;
  error: string | null;
  scanning: number;
  files: FolderFile[];
}

export interface Conversation {
  id: string;
  title: string;
  created: number;
}

export interface Source {
  id: number;
  chunk_id: number;
  document_id: string;
  name: string;
  page: number;
  text: string;
  format: "pdf" | "epub";
  location: string;
  score: number;
}

export interface Message {
  id?: number;
  role: "user" | "assistant";
  content: string;
  sources: Source[];
}

export interface Settings {
  model: string;
  embedding_model: string;
  top_k: number;
  max_tokens: number;
  temperature: number;
  embedding_idle_unload: boolean;
}

export interface ModelEntry {
  id: string;
  name: string;
  type: "llm" | "embedding";
  loaded: boolean;
  vision: boolean;
  size: number;
}

export interface ModelStatus {
  online: boolean;
  models: string[];
  catalog: ModelEntry[];
  error: string | null;
  configured_available: boolean;
}

export interface Preferences {
  language: Language;
  scope: Scope;
}

declare global {
  interface Window {
    desktop?: {
      chooseDocuments(language: Language): Promise<{ duplicate?: boolean }[]>;
      chooseFolder(language: Language): Promise<unknown | null>;
    };
  }
}
