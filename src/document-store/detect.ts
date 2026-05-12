import path from "node:path";
import { DocumentKind } from "../types.js";

export function extensionOf(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

export function detectKind(filePath: string, mimeType?: string): DocumentKind {
  const extension = extensionOf(filePath);
  if (extension === ".xlsx" || extension === ".xlsm" || extension === ".xls") return "excel";
  if (extension === ".csv") return "csv";
  if (extension === ".pdf") return "pdf";
  if (extension === ".pptx") return "pptx";
  if (extension === ".docx") return "docx";
  if (mimeType?.includes("spreadsheet")) return "excel";
  if (mimeType?.includes("presentation")) return "pptx";
  if (mimeType?.includes("pdf")) return "pdf";
  if (mimeType?.includes("wordprocessingml")) return "docx";
  return "unsupported";
}

export function mimeForKind(kind: DocumentKind): string {
  switch (kind) {
    case "excel":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "csv":
      return "text/csv";
    case "pdf":
      return "application/pdf";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default:
      return "application/octet-stream";
  }
}

