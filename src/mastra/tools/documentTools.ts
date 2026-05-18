import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { initializeUpload } from "../../document-store/intake.js";
import {
  getChartData,
  getChartEvidence,
  getDocumentStatus,
  getManifest,
  getMarkdown,
  getPptxSlideMarkdown,
  getPptxSlideEvidence,
  getPptxSlideStructure,
  listPptxSlides,
  retrieveEvidence,
  searchDocuments,
} from "../../services/documentTools.js";
import {
  describe,
  describeEvidence,
  getSchema,
  listDocuments,
  listSheets,
  previewEvidenceRows,
  previewRows,
  queryRows,
} from "../../services/excelTools.js";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function safeExecute<T>(toolId: string, fn: () => Promise<T>) {
  return (async () => {
    try {
      return { ok: true as const, result: await fn() };
    } catch (error) {
      return {
        ok: false as const,
        what_failed: toolId,
        what_it_tried: `Call ${toolId} with the provided inputs.`,
        next_best_tool: "documents.getStatus",
        error: { message: errorMessage(error) },
      };
    }
  })();
}

const sessionSchema = {
  userId: z.string().min(1),
  sessionId: z.string().min(1),
};

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

export const documentsGetMarkdownTool = createTool({
  id: "documents.getMarkdown",
  description: "Return bounded markdown for a document that exposes a markdown artifact.",
  inputSchema: z.object({ ...sessionSchema, fileId: z.string().min(1) }),
  execute: async (input) => safeExecute("documents.getMarkdown", () => getMarkdown(input)),
});

export const documentsSearchTextTool = createTool({
  id: "documents.searchText",
  description: "Search persisted text indexes and return structured evidence packets with citations.",
  inputSchema: z.object({ ...sessionSchema, fileId: z.string().optional(), query: z.string().min(1), limit: z.number().int().positive().optional() }),
  execute: async (input) => safeExecute("documents.searchText", () => searchDocuments(input)),
});

export const documentsRetrieveEvidenceTool = createTool({
  id: "documents.retrieveEvidence",
  description: "Retrieve document evidence packets plus a low-evidence guardrail hint.",
  inputSchema: z.object({ ...sessionSchema, fileId: z.string().optional(), query: z.string().min(1), limit: z.number().int().positive().optional() }),
  execute: async (input) => safeExecute("documents.retrieveEvidence", () => retrieveEvidence(input)),
});

export const excelListSheetsTool = createTool({
  id: "excel.listSheets",
  description: "List sheets and workbook metadata for an extracted Excel or CSV file.",
  inputSchema: z.object({ ...sessionSchema, fileId: z.string().min(1) }),
  execute: async (input) => safeExecute("excel.listSheets", () => listSheets(input)),
});

export const excelGetSchemaTool = createTool({
  id: "excel.getSchema",
  description: "Return persisted sheet schema including inferred types and null counts.",
  inputSchema: z.object({ ...sessionSchema, fileId: z.string().min(1), sheetId: z.string().min(1) }),
  execute: async (input) => safeExecute("excel.getSchema", () => getSchema(input)),
});

export const excelPreviewRowsTool = createTool({
  id: "excel.previewRows",
  description: "Return a bounded preview from a persisted JSONL row store.",
  inputSchema: z.object({
    ...sessionSchema,
    fileId: z.string().min(1),
    sheetId: z.string().min(1),
    limit: z.number().int().nonnegative().optional(),
    offset: z.number().int().nonnegative().optional(),
    columns: z.array(z.string()).optional(),
  }),
  execute: async (input) => safeExecute("excel.previewRows", () => previewRows(input)),
});

export const excelPreviewEvidenceTool = createTool({
  id: "excel.previewEvidence",
  description: "Return EvidencePacket[] for a bounded preview window of rows (recommended for LLM grounding).",
  inputSchema: z.object({
    ...sessionSchema,
    fileId: z.string().min(1),
    sheetId: z.string().min(1),
    limit: z.number().int().nonnegative().optional(),
    offset: z.number().int().nonnegative().optional(),
    columns: z.array(z.string()).optional(),
  }),
  execute: async (input) => safeExecute("excel.previewEvidence", () => previewEvidenceRows(input)),
});

export const excelQueryRowsTool = createTool({
  id: "excel.queryRows",
  description: "Perform bounded structured retrieval over persisted sheet rows.",
  inputSchema: z.object({
    ...sessionSchema,
    fileId: z.string().min(1),
    sheetId: z.string().min(1),
    select: z.array(z.string()).optional(),
    filters: z
      .array(z.object({ column: z.string(), op: z.enum(["=", "!=", "<", "<=", ">", ">=", "contains", "in"]), value: z.any() }))
      .optional(),
    sort: z.object({ column: z.string(), direction: z.enum(["asc", "desc"]).optional() }).optional(),
    limit: z.number().int().positive().optional(),
  }),
  execute: async (input) => safeExecute("excel.queryRows", () => queryRows(input)),
});

export const excelDescribeTool = createTool({
  id: "excel.describe",
  description: "Return pandas-style summary stats for selected sheet columns.",
  inputSchema: z.object({ ...sessionSchema, fileId: z.string().min(1), sheetId: z.string().min(1), columns: z.array(z.string()).optional() }),
  execute: async (input) => safeExecute("excel.describe", () => describe(input)),
});

export const excelDescribeEvidenceTool = createTool({
  id: "excel.describeEvidence",
  description: "Return EvidencePacket[] containing a compact summary of describe() results for citation-safe reasoning.",
  inputSchema: z.object({ ...sessionSchema, fileId: z.string().min(1), sheetId: z.string().min(1), columns: z.array(z.string()).optional() }),
  execute: async (input) => safeExecute("excel.describeEvidence", () => describeEvidence(input)),
});

export const pptxListSlidesTool = createTool({
  id: "pptx.listSlides",
  description: "List slide metadata, extracted markdown paths, and warnings for a PPTX deck.",
  inputSchema: z.object({ ...sessionSchema, fileId: z.string().min(1) }),
  execute: async (input) => safeExecute("pptx.listSlides", () => listPptxSlides(input)),
});

export const pptxGetSlideMarkdownTool = createTool({
  id: "pptx.getSlideMarkdown",
  description: "Return LLM-readable markdown for one slide.",
  inputSchema: z.object({ ...sessionSchema, fileId: z.string().min(1), slideNumber: z.number().int().positive() }),
  execute: async (input) => safeExecute("pptx.getSlideMarkdown", () => getPptxSlideMarkdown(input)),
});

export const pptxGetSlideEvidenceTool = createTool({
  id: "pptx.getSlideEvidence",
  description: "Return EvidencePacket[] grounded in a slide's extracted markdown (recommended for citations).",
  inputSchema: z.object({ ...sessionSchema, fileId: z.string().min(1), slideNumber: z.number().int().positive() }),
  execute: async (input) => safeExecute("pptx.getSlideEvidence", () => getPptxSlideEvidence(input)),
});

export const pptxGetSlideStructureTool = createTool({
  id: "pptx.getSlideStructure",
  description: "Return structured object metadata for one slide.",
  inputSchema: z.object({ ...sessionSchema, fileId: z.string().min(1), slideNumber: z.number().int().positive() }),
  execute: async (input) => safeExecute("pptx.getSlideStructure", () => getPptxSlideStructure(input)),
});

export const pptxGetChartDataTool = createTool({
  id: "pptx.getChartData",
  description: "Return best-effort native PowerPoint chart data extraction.",
  inputSchema: z.object({ ...sessionSchema, fileId: z.string().min(1), chartId: z.string().min(1) }),
  execute: async (input) => safeExecute("pptx.getChartData", () => getChartData(input)),
});

export const pptxGetChartEvidenceTool = createTool({
  id: "pptx.getChartEvidence",
  description: "Return EvidencePacket[] containing a compact summary of chart data for citation-safe reasoning.",
  inputSchema: z.object({ ...sessionSchema, fileId: z.string().min(1), chartId: z.string().min(1) }),
  execute: async (input) => safeExecute("pptx.getChartEvidence", () => getChartEvidence(input)),
});

export const documentHarnessTools = {
  documentsInitializeUploadTool,
  documentsListTool,
  documentsGetManifestTool,
  documentsGetStatusTool,
  documentsGetMarkdownTool,
  documentsSearchTextTool,
  documentsRetrieveEvidenceTool,
  excelListSheetsTool,
  excelGetSchemaTool,
  excelPreviewRowsTool,
  excelPreviewEvidenceTool,
  excelQueryRowsTool,
  excelDescribeTool,
  excelDescribeEvidenceTool,
  pptxListSlidesTool,
  pptxGetSlideMarkdownTool,
  pptxGetSlideEvidenceTool,
  pptxGetSlideStructureTool,
  pptxGetChartDataTool,
  pptxGetChartEvidenceTool,
};
