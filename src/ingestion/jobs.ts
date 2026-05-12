import { DocumentKind } from "../types.js";

export type ExtractDocumentJob = {
  jobId: string;
  userId: string;
  sessionId: string;
  fileId: string;
  kind: Exclude<DocumentKind, "unsupported">;
  sourcePath: string;
  queuedAt: string;
};

export function createExtractDocumentJob(input: Omit<ExtractDocumentJob, "jobId" | "queuedAt">): ExtractDocumentJob {
  return {
    ...input,
    jobId: `extract_${input.fileId}_${Date.now()}`,
    queuedAt: new Date().toISOString(),
  };
}
