# Mastra Multi-Agent RAG Spec (Interview Demo)

This project implements a general-purpose chatbot that can:

1. Answer research questions using web lookup.
2. Analyze user-uploaded documents (PDF, PPTX, DOCX, XLSX/CSV).

It uses a multi-agent architecture with a coordinator/router and specialized agents.

## 1) Agents and Responsibilities

### Coordinator / Router Agent
- Decides whether the user request needs:
  - Uploaded document evidence
  - External research
  - Both (hybrid)
  - Clarification (“this document” with multiple uploads)
- Uses only lightweight coordination tools (document listing/status + web search).
- Hands off document-heavy work to the Document Analyst agent and research-heavy work to the Research agent at the application routing layer.

### Document Analyst Agent
- Answers using uploaded-session evidence.
- Uses evidence-producing tools first, then synthesizes an answer.
- Enforces a **low-evidence guardrail**: if retrieval returns too little evidence, it must ask for a narrower query or a specific file instead of guessing.

### Research Agent
- Answers research questions using web lookup and provides URLs/snippets.

## 2) Evidence-Aware Routing

Routing happens in two layers:

1. **Intent routing** (heuristics) classifies the request into routes like `research`, `document_search`, `excel`, `pptx`, `hybrid`, `clarify`.
2. **Evidence-aware routing** checks the session manifest before committing to a document route:
   - If there are **no uploaded files**, the router forces `intake`.
   - If files exist but **none are ready**, the router forces `manifest` (status view) instead of failing downstream.
   - If the message is “this document/file” and there are **multiple uploads** without a filename mention, the router forces `clarify`.

Implementation: `src/agents/router.ts`

## 3) Document-Type RAG Pipelines (Uploaded Docs)

### PDF + DOCX (Narrative)
Pipeline:
1. Extract Markdown artifacts per file (and per page for PDFs).
2. Chunk Markdown with **heading-aware grouping** to keep sections coherent.
3. Index chunks to a session-scoped text index.
4. Retrieve with BM25-style scoring (lexical) + lightweight diversity selection.
5. Return `EvidencePacket[]` with page/block locators for citations.

Implementation:
- Chunking: `src/retrieval/chunking.ts`
- Index + retrieve: `src/retrieval/textIndex.ts`

### PPTX (Slides)
PPTX retrieval should be slide-centric:
- Use slide evidence tools that convert slide markdown into `EvidencePacket[]` with `slide` locators.
- Use chart evidence tools that return compact, citeable summaries of extracted chart data.

Implementation:
- Slide evidence: `pptx.getSlideEvidence`
- Chart evidence: `pptx.getChartEvidence`

### Excel / CSV (Structured-First)
Excel/CSV retrieval is structured-first:
- Prefer `excel.queryRows` for filtering/sorting facts (returns row evidence).
- Use `excel.previewEvidence` to ground qualitative claims with citeable row samples.
- Use `excel.describeEvidence` when summarizing distributions; it returns a compact stats summary as an `EvidencePacket`.

Implementation:
- Evidence wrappers: `src/services/excelTools.ts` + `src/mastra/tools/documentTools.ts`

## 4) Retrieval Scoring and Diversity

`documents.searchText` is backed by:
- BM25-like lexical scoring over chunk tokens (fast, deterministic).
- Phrase boost for exact substring matches.
- Basic diversification to avoid returning many near-duplicates from the same page/slide.

Implementation: `src/retrieval/textIndex.ts`

## 5) Low-Evidence Guardrail

The Document Analyst agent follows this rule:
- If evidence retrieval returns fewer than 2 evidence packets (or indicates low evidence), it must:
  - Ask for a narrower query, or
  - Ask the user to specify which file to use, or
  - Ask the user to wait for extraction to finish.

Implementation:
- Guardrail signal: `documents.retrieveEvidence`
- Prompt requirement: `src/agents/documentAnalystAgent.ts`

## 6) Tool Output Normalization and Error Handling

### Normalized evidence outputs
For citations and consistent reasoning, this project provides evidence-producing tools that return `EvidencePacket[]`:
- `documents.searchText` → `EvidencePacket[]`
- `pptx.getSlideEvidence` → `EvidencePacket[]`
- `pptx.getChartEvidence` → `EvidencePacket[]`
- `excel.previewEvidence` → Evidence packets for preview rows
- `excel.describeEvidence` → Evidence packet containing summary stats

### Structured tool error handling
All tools are wrapped so failures return a structured payload rather than throwing:
- Success: `{ ok: true, result: ... }`
- Failure: `{ ok: false, what_failed, what_it_tried, next_best_tool, error }`

Agents are prompted to stop and return a structured error object when a tool fails.

Implementation:
- Tool wrappers: `src/mastra/tools/documentTools.ts`, `src/mastra/tools/researchTools.ts`

