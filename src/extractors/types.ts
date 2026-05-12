import { DocumentStatus } from "../types.js";

export type ExtractionResult = {
  status: Extract<DocumentStatus, "ready" | "failed" | "partial">;
  derivedPaths: Record<string, string | string[] | Record<string, unknown>>;
  warnings: string[];
  error?: string;
};

