import { extractDocx } from "../extractors/docx.js";
import { extractCsvLikeWorkbook, extractExcelWorkbook } from "../extractors/excel.js";
import { extractPdf } from "../extractors/pdf.js";
import { extractPptx } from "../extractors/pptx.js";
import { ExtractionResult } from "../extractors/types.js";
import { getFileOrThrow, loadOrCreateManifest, updateFile } from "../document-store/manifest.js";
import { buildRetrievalIndexesForFile } from "../retrieval/indexer.js";
import { UploadedDocument } from "../types.js";
import { ExtractDocumentJob } from "./jobs.js";

async function runExtractor(job: ExtractDocumentJob): Promise<ExtractionResult> {
  if (job.kind === "excel") return extractExcelWorkbook(job.userId, job.sessionId, job.fileId, job.sourcePath);
  if (job.kind === "csv") return extractCsvLikeWorkbook(job.userId, job.sessionId, job.fileId, job.sourcePath);
  if (job.kind === "docx") return extractDocx(job.userId, job.sessionId, job.fileId, job.sourcePath);
  if (job.kind === "pdf") return extractPdf(job.userId, job.sessionId, job.fileId, job.sourcePath);
  return extractPptx(job.userId, job.sessionId, job.fileId, job.sourcePath);
}

export async function processExtractDocumentJob(job: ExtractDocumentJob): Promise<UploadedDocument> {
  await updateFile(job.userId, job.sessionId, job.fileId, { status: "extracting" });

  try {
    const extraction = await runExtractor(job);
    const extractedFile = await updateFile(job.userId, job.sessionId, job.fileId, {
      status: "indexing",
      extracted_at: new Date().toISOString(),
      derived_paths: extraction.derivedPaths,
      warnings: extraction.warnings,
      error: extraction.error,
    });

    const indexResult = await buildRetrievalIndexesForFile({
      userId: job.userId,
      sessionId: job.sessionId,
      file: extractedFile,
    });

    return updateFile(job.userId, job.sessionId, job.fileId, {
      status: extraction.status,
      derived_paths: {
        ...extractedFile.derived_paths,
        ...indexResult.derivedPaths,
      },
      warnings: [...extraction.warnings, ...indexResult.warnings],
      error: extraction.error,
    });
  } catch (error) {
    return updateFile(job.userId, job.sessionId, job.fileId, {
      status: "failed",
      extracted_at: new Date().toISOString(),
      warnings: [],
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    const manifest = await loadOrCreateManifest(job.userId, job.sessionId);
    getFileOrThrow(manifest, job.fileId);
  }
}
