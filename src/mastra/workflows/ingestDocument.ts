import fs from "node:fs/promises";
import path from "node:path";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { DEFAULT_SESSION_ID, DEFAULT_USER_ID } from "../../config.js";
import { detectKind } from "../../document-store/detect.js";
import { initializeUploadAndWait } from "../../document-store/intake.js";
import { loadOrCreateManifest } from "../../document-store/manifest.js";

const ingestInputSchema = z.object({
  userId: z.string().optional(),
  sessionId: z.string().optional(),
  sourcePath: z.string().min(1),
  originalFilename: z.string().optional(),
  mimeType: z.string().optional(),
});

const validatedInputSchema = z.object({
  userId: z.string(),
  sessionId: z.string(),
  sourcePath: z.string(),
  originalFilename: z.string(),
  mimeType: z.string().optional(),
  kind: z.string(),
  sizeBytes: z.number(),
});

const extractedOutputSchema = validatedInputSchema.extend({
  fileId: z.string(),
  status: z.string(),
  uploadPath: z.string(),
  derivedPaths: z.record(z.unknown()),
  warnings: z.array(z.string()),
  error: z.string().optional(),
});

const indexedOutputSchema = extractedOutputSchema.extend({
  textIndexPath: z.string().optional(),
  vectorIndexPath: z.string().optional(),
});

const validateDocumentStep = createStep({
  id: "validate-document",
  description: "Validate that the source file exists and is a supported document type.",
  inputSchema: ingestInputSchema,
  outputSchema: validatedInputSchema,
  execute: async ({ inputData }) => {
    const sourcePath = path.resolve(inputData.sourcePath);
    const stat = await fs.stat(sourcePath);
    const kind = detectKind(sourcePath, inputData.mimeType);
    if (kind === "unsupported") {
      throw new Error(`Unsupported file type for ${sourcePath}.`);
    }

    return {
      userId: inputData.userId ?? DEFAULT_USER_ID,
      sessionId: inputData.sessionId ?? DEFAULT_SESSION_ID,
      sourcePath,
      originalFilename: inputData.originalFilename ?? path.basename(sourcePath),
      mimeType: inputData.mimeType,
      kind,
      sizeBytes: stat.size,
    };
  },
});

const extractDocumentStep = createStep({
  id: "extract-document",
  description: "Run the existing ingestion worker, which extracts artifacts and builds retrieval indexes.",
  inputSchema: validatedInputSchema,
  outputSchema: extractedOutputSchema,
  execute: async ({ inputData }) => {
    const result = await initializeUploadAndWait({
      userId: inputData.userId,
      sessionId: inputData.sessionId,
      sourcePath: inputData.sourcePath,
      originalFilename: inputData.originalFilename,
      mimeType: inputData.mimeType,
    });

    return {
      ...inputData,
      fileId: result.file.file_id,
      status: result.file.status,
      uploadPath: result.file.upload_path,
      derivedPaths: result.file.derived_paths,
      warnings: result.file.warnings,
      error: result.file.error,
    };
  },
});

const confirmIndexesStep = createStep({
  id: "index-document",
  description: "Surface the retrieval index artifacts created by the document worker.",
  inputSchema: extractedOutputSchema,
  outputSchema: indexedOutputSchema,
  execute: async ({ inputData }) => ({
    ...inputData,
    textIndexPath: typeof inputData.derivedPaths.text_index === "string" ? inputData.derivedPaths.text_index : undefined,
    vectorIndexPath: typeof inputData.derivedPaths.vector_index === "string" ? inputData.derivedPaths.vector_index : undefined,
  }),
});

const updateManifestStep = createStep({
  id: "update-manifest",
  description: "Reload the session manifest and return the final document status.",
  inputSchema: indexedOutputSchema,
  outputSchema: indexedOutputSchema.extend({
    manifestFileCount: z.number(),
  }),
  execute: async ({ inputData }) => {
    const manifest = await loadOrCreateManifest(inputData.userId, inputData.sessionId);
    return {
      ...inputData,
      manifestFileCount: manifest.files.length,
    };
  },
});

export const ingestDocumentWorkflow = createWorkflow({
  id: "ingestDocument",
  description: "Validate, extract, index, and publish a document into the session manifest.",
  inputSchema: ingestInputSchema,
  outputSchema: indexedOutputSchema.extend({
    manifestFileCount: z.number(),
  }),
})
  .then(validateDocumentStep)
  .then(extractDocumentStep)
  .then(confirmIndexesStep)
  .then(updateManifestStep)
  .commit();
