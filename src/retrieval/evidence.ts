import { EvidencePacket, UploadedDocument } from "../types.js";

export function documentTypeForEvidence(file: UploadedDocument): EvidencePacket["source"]["documentType"] | null {
  return file.kind === "unsupported" ? null : file.kind;
}

export function buildEvidencePacket(input: {
  userId: string;
  sessionId: string;
  file: UploadedDocument;
  evidenceId: string;
  locator?: EvidencePacket["locator"];
  content: EvidencePacket["content"];
  score?: number;
  warnings?: string[];
}): EvidencePacket {
  const documentType = documentTypeForEvidence(input.file);
  if (!documentType) throw new Error(`Unsupported file '${input.file.file_id}' cannot produce evidence.`);
  return {
    evidenceId: input.evidenceId,
    source: {
      userId: input.userId,
      sessionId: input.sessionId,
      fileId: input.file.file_id,
      originalFilename: input.file.original_filename,
      documentType,
    },
    locator: input.locator ?? {},
    content: input.content,
    score: input.score,
    extractionStatus: input.file.status,
    warnings: input.warnings ?? input.file.warnings,
  };
}
