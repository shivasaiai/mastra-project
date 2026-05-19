import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  describe,
  describeEvidence,
  getSchema,
  listSheets,
  previewEvidenceRows,
  previewRows,
  queryRows,
} from "../../services/excelTools.js";
import { safeExecute, sessionSchema } from "./shared.js";

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

export const spreadsheetTools = {
  excelListSheetsTool,
  excelGetSchemaTool,
  excelPreviewRowsTool,
  excelPreviewEvidenceTool,
  excelQueryRowsTool,
  excelDescribeTool,
  excelDescribeEvidenceTool,
};
