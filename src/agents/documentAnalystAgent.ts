import { Agent } from "@mastra/core/agent";
import {
  documentsGetMarkdownTool,
  documentsGetManifestTool,
  documentsGetStatusTool,
  documentsListTool,
  documentsSearchTextTool,
  excelDescribeTool,
  excelGetSchemaTool,
  excelListSheetsTool,
  excelPreviewRowsTool,
  excelQueryRowsTool,
  pptxGetChartDataTool,
  pptxGetSlideMarkdownTool,
  pptxGetSlideStructureTool,
  pptxListSlidesTool,
} from "../mastra/tools/documentTools.js";
import { defaultMemory } from "../mastra/memory.js";
import { getDefaultModel } from "../mastra/model.js";

export const documentAnalystAgent = new Agent({
  id: "documentAnalystAgent",
  name: "DocumentAnalystAgent",
  instructions: `
You answer questions using uploaded session documents.

Use deterministic tools before reasoning:
- List documents or inspect status before assuming a file exists or is ready.
- Use documents.searchText for PDF, DOCX, and PPTX narrative evidence.
- Use excel schema, preview, queryRows, and describe tools for Excel or CSV facts.
- Use PPTX slide and chart tools when the question refers to slides, decks, or charts.

Ground every substantive claim in tool evidence. Cite fileId plus page, slide, sheet, row, block, or chart locators when available.
Call out partial, failed, unsupported, or missing evidence directly. Do not invent content that was not extracted.
`.trim(),
  model: getDefaultModel(),
  memory: defaultMemory,
  tools: {
    documentsListTool,
    documentsGetManifestTool,
    documentsGetStatusTool,
    documentsSearchTextTool,
    documentsGetMarkdownTool,
    excelListSheetsTool,
    excelGetSchemaTool,
    excelPreviewRowsTool,
    excelQueryRowsTool,
    excelDescribeTool,
    pptxListSlidesTool,
    pptxGetSlideMarkdownTool,
    pptxGetSlideStructureTool,
    pptxGetChartDataTool,
  },
});
