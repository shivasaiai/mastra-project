export type Citation = {
  file: string;
  locator?: string; // e.g. "page 3", "row 12", "sheet Cases!A2"
  excerpt?: string;
};

export type EvidenceChunk = {
  id: string;
  sourceFile: string;
  sourceType: "pdf" | "docx" | "pptx" | "xlsx" | "csv" | "md" | "txt";
  locator?: string;
  text: string;
};

export type RetrievalResult = {
  chunk: EvidenceChunk;
  score: number;
};

export type TableRow = Record<string, string>;

export type TableDoc = {
  id: string;
  sourceFile: string;
  tableName: string;
  rows: TableRow[];
};

export type DocumentKind = "excel" | "csv" | "pdf" | "pptx" | "docx" | "unsupported";

export type DocumentStatus = "queued" | "extracting" | "indexing" | "ready" | "failed" | "partial" | "unsupported";

export type UploadedDocument = {
  file_id: string;
  original_filename: string;
  mime_type: string;
  kind: DocumentKind;
  size_bytes: number;
  sha256: string;
  status: DocumentStatus;
  uploaded_at: string;
  extracted_at?: string;
  parser?: {
    name: string;
    version: string;
  };
  upload_path: string;
  derived_paths: Record<string, string | string[] | Record<string, unknown>>;
  warnings: string[];
  error?: string;
};

export type SessionManifest = {
  user_id: string;
  session_id: string;
  created_at: string;
  updated_at: string;
  files: UploadedDocument[];
};

export type InitializeUploadResult = {
  manifest: SessionManifest;
  file: UploadedDocument;
  jobId?: string;
};

export type EvidencePacket = {
  evidenceId: string;
  source: {
    userId: string;
    sessionId: string;
    fileId: string;
    originalFilename: string;
    documentType: Exclude<DocumentKind, "unsupported">;
  };
  locator: {
    page?: number;
    slide?: number;
    sheetId?: string;
    rowNumber?: number;
    column?: string;
    blockId?: string;
    chartId?: string;
  };
  content: {
    text?: string;
    row?: Record<string, unknown>;
    table?: Record<string, unknown>[];
    summary?: string;
  };
  score?: number;
  extractionStatus: DocumentStatus;
  warnings?: string[];
};
