import { Agent } from "@mastra/core/agent";
import {
  documentsGetMarkdownTool,
  documentsGetManifestTool,
  documentsGetStatusTool,
  documentsListTool,
  documentsRetrieveEvidenceTool,
  excelDescribeTool,
  excelDescribeEvidenceTool,
  excelGetSchemaTool,
  excelListSheetsTool,
  excelPreviewEvidenceTool,
  excelPreviewRowsTool,
  excelQueryRowsTool,
  pptxGetChartDataTool,
  pptxGetChartEvidenceTool,
  pptxGetSlideMarkdownTool,
  pptxGetSlideEvidenceTool,
  pptxGetSlideStructureTool,
  pptxListSlidesTool,
} from "../mastra/tools/documentTools.js";
import { defaultMemory } from "../mastra/memory.js";
import { getDefaultModel } from "../mastra/model.js";

export const documentAnalystAgent = new Agent({
  id: "documentAnalystAgent",
  name: "DocumentAnalystAgent",
  description:
    "Analyzes uploaded documents (PDF, DOCX, PPTX, Excel, CSV). Returns evidence-backed answers with file/page/slide/sheet/row citations.",
  instructions: `
You answer questions using uploaded session documents.

Tool policy (mandatory):
- All tools return either { ok: true, result: ... } or { ok: false, what_failed, what_it_tried, next_best_tool, error }.
- If a tool returns ok:false, stop and respond with a JSON object:
  { "what_failed": "...", "what_it_tried": "...", "next_best_tool": "...", "error": "..." }
- Prefer EvidencePacket-backed tools for factual claims. Do not make factual assertions without evidence.

Use deterministic tools before reasoning:
- List documents or inspect status before assuming a file exists or is ready.
- Use documents.retrieveEvidence as the primary evidence tool for PDF/DOCX/PPTX narrative evidence; it automatically handles vector retrieval and lexical fallback.
- For spreadsheets (Excel/CSV), use spreadsheet-specific tools. Do NOT use retrieveEvidence for tabular data.
- Use excel schema, preview, queryRows, and describe tools for Excel or CSV facts.
- Prefer excel.previewEvidence and excel.describeEvidence for citation-safe grounding.
- Prefer pptx.getSlideEvidence and pptx.getChartEvidence for citation-safe grounding.

Always cite sources with locators from the evidence packets. Cite fileId plus page, slide, sheet, row, block, or chart locators when available.
If documents.retrieveEvidence returns lowEvidence: true, state uncertainty and do not overclaim.
Call out partial, failed, unsupported, or missing evidence directly. Do not invent content that was not extracted.
`.trim(),
  model: getDefaultModel(),
  memory: defaultMemory,
  tools: {
    documentsListTool,
    documentsGetManifestTool,
    documentsGetStatusTool,
    documentsRetrieveEvidenceTool,
    documentsGetMarkdownTool,
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
  },
});
