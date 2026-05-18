import { Agent } from "@mastra/core/agent";
import {
  documentsGetStatusTool,
  documentsListTool,
  documentsSearchTextTool,
} from "../mastra/tools/documentTools.js";
import { researchSearchWebTool } from "../mastra/tools/researchTools.js";
import { getDefaultModel } from "../mastra/model.js";
import { defaultMemory } from "../mastra/memory.js";

export const coordinatorInstructions = `
You are the Coordinator / Router Agent for a session-scoped document analysis system.

Responsibilities:
- Decide whether the request needs uploaded documents, external research, or both.
- Use only high-level tools for lightweight coordination and synthesis.
- Hand document-heavy work to the Document Analyst Agent at the application routing layer.
- Hand web-heavy work to the Research Agent at the application routing layer.
- Never ask for or load raw document files directly.
- Use document listing/status tools before assuming file IDs or readiness.
- Use research.searchWeb before answering external or current-information questions.
- State missing evidence explicitly and distinguish ready, partial, failed, and unsupported files.
- Cite sources and uploaded-file locators whenever available.

Tool policy:
- Tools return { ok: true, result: ... } or { ok: false, what_failed, what_it_tried, next_best_tool, error }.
- When the user says "this document/file" and multiple uploads exist, ask a single clarifying question and include a short file list (fileId + originalFilename + status).
`.trim();

export const coordinatorAgent = new Agent({
  id: "coordinatorAgent",
  name: "CoordinatorRouterAgent",
  instructions: coordinatorInstructions,
  model: getDefaultModel(),
  memory: defaultMemory,
  tools: {
    documentsListTool,
    documentsGetStatusTool,
    documentsSearchTextTool,
    researchSearchWebTool,
  },
});

export function routeIntent(message: string): {
  route: "intake" | "excel" | "pptx" | "document_search" | "manifest" | "research" | "hybrid" | "clarify";
  rationale: string;
} {
  const lower = message.toLowerCase();
  const asksForResearch = /(research|look up|lookup|web|internet|latest|current|news|source|sources)/.test(lower);
  const asksForDocuments = /(document|file|upload|pdf|docx|word|spreadsheet|excel|xlsx|csv|sheet|ppt|pptx|powerpoint|slide|deck|evidence|session)/.test(lower);
  if (asksForResearch && asksForDocuments) {
    return { route: "hybrid", rationale: "The request needs both external research and uploaded-session evidence." };
  }
  if (/(^|\b)(analyze this|summarize this|explain this|what does this say|what is this about|in this document|in this file)(\b|$)/.test(lower)) {
    return { route: "clarify", rationale: "The request refers to 'this' without specifying which uploaded file to use." };
  }
  if (/(upload|initialize|ingest|add file|index)/.test(lower)) {
    return { route: "intake", rationale: "The request is about adding documents to a session." };
  }
  if (/(spreadsheet|excel|xlsx|csv|sheet|row|column|schema|filter|sort)/.test(lower)) {
    return { route: "excel", rationale: "The request refers to tabular spreadsheet analysis." };
  }
  if (/(ppt|pptx|powerpoint|slide|deck|chart)/.test(lower)) {
    return { route: "pptx", rationale: "The request refers to slide deck analysis." };
  }
  if (asksForResearch) {
    return { route: "research", rationale: "The request asks for external research or current information." };
  }
  if (/(^|\b)(list files|show files|manifest|session status|file status|uploaded files|documents list)(\b|$)/.test(lower)) {
    return { route: "manifest", rationale: "The request asks about session/file state." };
  }
  return { route: "document_search", rationale: "The request can be answered by searching extracted document text." };
}
