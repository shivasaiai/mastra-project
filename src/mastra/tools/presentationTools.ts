import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  getChartData,
  getChartEvidence,
  getPptxSlideEvidence,
  getPptxSlideMarkdown,
  getPptxSlideStructure,
  listPptxSlides,
} from "../../services/documentTools.js";
import { safeExecute, sessionSchema } from "./shared.js";

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

export const presentationTools = {
  pptxListSlidesTool,
  pptxGetSlideMarkdownTool,
  pptxGetSlideEvidenceTool,
  pptxGetSlideStructureTool,
  pptxGetChartDataTool,
  pptxGetChartEvidenceTool,
};
