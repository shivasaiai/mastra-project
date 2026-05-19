import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { initializeUpload } from "../../document-store/intake.js";
import { getDocumentStatus, getManifest } from "../../services/documentTools.js";
import { listDocuments } from "../../services/excelTools.js";
import { safeExecute, sessionSchema } from "./shared.js";

export const documentsInitializeUploadTool = createTool({
  id: "documents.initializeUpload",
  description: "Store an uploaded document, enqueue asynchronous extraction, and return the queued file status.",
  inputSchema: z.object({
    ...sessionSchema,
    sourcePath: z.string().min(1),
    originalFilename: z.string().optional(),
    mimeType: z.string().optional(),
  }),
  execute: async (input) => safeExecute("documents.initializeUpload", () => initializeUpload(input)),
});

export const documentsListTool = createTool({
  id: "documents.list",
  description: "List uploaded files in a user session with readiness status.",
  inputSchema: z.object(sessionSchema),
  execute: async (input) => safeExecute("documents.list", () => listDocuments(input)),
});

export const documentsGetManifestTool = createTool({
  id: "documents.getManifest",
  description: "Return the source-of-truth manifest for a session.",
  inputSchema: z.object(sessionSchema),
  execute: async (input) => safeExecute("documents.getManifest", () => getManifest(input)),
});

export const documentsGetStatusTool = createTool({
  id: "documents.getStatus",
  description: "Return extraction/indexing status for one file or all files in a user session.",
  inputSchema: z.object({ ...sessionSchema, fileId: z.string().optional() }),
  execute: async (input) => safeExecute("documents.getStatus", () => getDocumentStatus(input)),
});

export const sessionTools = {
  documentsInitializeUploadTool,
  documentsListTool,
  documentsGetManifestTool,
  documentsGetStatusTool,
};
