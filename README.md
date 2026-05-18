# Mastra Multi-Agent Document Chatbot

Backend-first Mastra multi-agent chatbot for research and session-scoped document analysis. The document harness keeps every upload under a `user_id + session_id`, gives every file a stable content-derived `file_id`, preserves immutable originals, and exposes extracted artifacts through bounded Mastra tools instead of raw file reads.

## Architecture

```text
User
  -> HTTP API
      -> /upload queues extraction jobs
      -> /chat routes to a lean Mastra agent layer
          -> Coordinator Agent for hybrid coordination
          -> Document Analyst Agent for uploaded-file reasoning
          -> Research Agent for external lookup
      -> deterministic tools for extraction, indexing, retrieval, and citations
```

The project intentionally keeps deterministic work out of agents. Upload bookkeeping, extraction, indexing, spreadsheet querying, and citation shaping are implemented as services and Mastra tools. Agents are used only for intent handling, source selection, cross-document reasoning, research synthesis, and final answer generation.

The Mastra registry is in `src/mastra/index.ts`. The active agent set is `coordinatorAgent`, `documentAnalystAgent`, and `researchAgent`.

The HTTP backend in `src/server.ts` routes requests to the smallest useful agent. If `GEMINI_API_KEY` or `OPENAI_API_KEY` is not configured, `/chat` falls back to deterministic document retrieval so local demos still work.

For the full V2 design narrative, see `v2.md`. For visual system-design diagrams, see `docs/V2_MERMAID_ARCHITECTURE.md`.

## Agent Boundary

The project uses a small agent layer:

- `coordinatorAgent`: routes research, document, and hybrid questions.
- `documentAnalystAgent`: reasons over uploaded document evidence.
- `researchAgent`: performs external lookup and cited research synthesis.

The following are deliberately not agents:

- Upload initialization.
- File type detection.
- PDF/DOCX/PPTX/Excel/CSV extraction.
- Text indexing and chunking.
- Spreadsheet filtering, sorting, and summarization.
- Citation and evidence packet construction.

## Async Ingestion

Uploads are job-shaped:

```text
POST /upload
  -> store immutable original
  -> create queued manifest record
  -> enqueue ExtractDocumentJob
  -> return 202 with fileId/jobId

Document worker
  -> extracting
  -> indexing
  -> ready | partial | failed | unsupported
```

For the assignment, the queue is in-process and bounded. The worker contract is isolated in `src/ingestion/`, so it can later move to BullMQ, SQS, Cloud Tasks, or another durable queue without changing the agent/tool layer.

## Document Store

```text
data/
  users/<user_id>/sessions/<session_id>/
    uploads/<file_id>/original.ext
    extracted/
      excel/<file_id>/
      docx/<file_id>/
      pdf/<file_id>/
      pptx/<file_id>/
    indexes/
      text/<file_id>.chunks.jsonl
    workspace/
    manifest.json
```

`manifest.json` is the source of truth for file metadata, status, hashes, parser version, derived artifact paths, warnings, and extraction errors.

## Implemented Extractors

- Excel and CSV: workbook metadata, sheet schemas, previews, and JSONL row stores.
- DOCX: markdown, simple structure metadata, and markdown chunks.
- PDF: `unpdf` text fallback, per-page PNG rendering via `pdfjs-dist` + `@napi-rs/canvas`, and optional Gemini vision Markdown when `GEMINI_API_KEY` is configured.
- PPTX: XML-based slide markdown, slide structure JSON, extracted media, and best-effort native chart XML summaries.
- Text indexer: persisted chunk indexes for PDF, DOCX, and PPTX evidence retrieval.

## Retrieval Strategy

The system does not force every document through one generic RAG path:

- PDF/DOCX/PPTX: text chunk retrieval with file/page/slide/block locators.
- Excel/CSV: schema-aware structured querying instead of embedding raw rows.
- PPTX: slide/object/chart tools for deck-specific questions.
- Hybrid questions: combine spreadsheet rows, text chunks, slide/chart evidence, and web sources when needed.

This is the core design trade-off: use the retrieval shape that matches the document type.

## Evidence and Citations

Retrieval tools return structured evidence, not loose text blobs. The common evidence contract is `EvidencePacket` in `src/types.ts`:

```text
EvidencePacket
  -> source: userId, sessionId, fileId, originalFilename, documentType
  -> locator: page, slide, sheetId, rowNumber, blockId, chartId
  -> content: text, row, table, summary
  -> extractionStatus
  -> warnings
```

Final answers should cite file identity and location, for example:

```text
[candidate_tracker.xlsx | sheet=tracker | row=42]
[policy.pdf | page=7 | block=page_007_0003]
[deck.pptx | slide=12 | chart=chart_002]
```

## Tool Surface

Mastra tool wrappers live in `src/mastra/tools/documentTools.ts`:

- `documents.initializeUpload`
- `documents.list`
- `documents.getManifest`
- `documents.getStatus`
- `documents.searchText`
- `excel.listSheets`
- `excel.getSchema`
- `excel.previewRows`
- `excel.queryRows`
- `excel.describe`
- `pptx.listSlides`
- `pptx.getSlideMarkdown`
- `pptx.getSlideStructure`
- `pptx.getChartData`

## Local Commands

Install dependencies:

```bash
npm install
```

Start Mastra Studio (recommended for chat UI / testing agents):

```bash
export GEMINI_API_KEY=...
export GEMINI_MODEL=gemini-3-flash-preview
export GEMINI_VISION_MODEL=gemini-3.1-pro-preview
npm run dev
```

Open the Studio UI:

```bash
open http://localhost:4111/
```

Start the minimal JSON API server (legacy):

```bash
export GEMINI_API_KEY=...
export GEMINI_MODEL=gemini-3-flash-preview
export GEMINI_VISION_MODEL=gemini-3.1-pro-preview
npm run server
```

Health check:

```bash
curl http://localhost:4111/health
```

Chat:

```bash
curl -X POST http://localhost:4111/chat \
  -H 'content-type: application/json' \
  -d '{"userId":"local-user","sessionId":"bpss-demo","message":"Which candidate files are not ready for BPSS closure?"}'
```

Upload:

```bash
curl -X POST http://localhost:4111/upload \
  -H 'content-type: application/json' \
  -d '{"userId":"local-user","sessionId":"bpss-demo","sourcePath":"/absolute/path/to/file.pdf"}'
```

Check extraction status:

```bash
curl http://localhost:4111/documents/<fileId>/status
```

Ingest the included BPSS dataset:

```bash
npm run index
```

Run PDF vision extraction with Gemini:

```bash
GEMINI_API_KEY=... GEMINI_MODEL=gemini-3-flash-preview GEMINI_VISION_MODEL=gemini-3.1-pro-preview npm run index
```

Model split:

- `GEMINI_MODEL=gemini-3-flash-preview` for chat and agents.
- `GEMINI_VISION_MODEL=gemini-3.1-pro-preview` for PDF page vision: better for OCR-like extraction, dense tables, and multimodal document reasoning.
- Gemini 3 preview models can require "thought signatures" for tool calls; this repo injects a documented dummy signature when missing.

If `GEMINI_API_KEY` is missing or the model call fails, page PNGs and local text Markdown are still persisted and the manifest records `partial` with page-level warnings.

PDF production controls:

```bash
PDF_MAX_PAGES=250
PDF_PAGE_CONCURRENCY=2
PDF_RENDER_SCALE=2
GEMINI_TIMEOUT_MS=60000
GEMINI_RETRIES=2
GEMINI_VISION_MODEL=gemini-3.1-pro-preview
PDF_MIN_TEXT_CHARS=40
```

The extractor processes each page independently. Large, scanned, corrupt, or partially unreadable PDFs still produce whatever page artifacts can be safely generated, with warnings stored in `document.json` and `page_XXX.structure.json`.

Start a local CLI chat/router:

```bash
npm run chat
```

Generate evidence candidates for the BPSS sample questions:

```bash
npm run bpss:answers
```

Type-check:

```bash
npm run typecheck
```

## RAG Trade-Offs

The project is designed to support multiple retrieval approaches:

- Markdown chunk retrieval for DOCX/PDF/PPTX narrative evidence.
- Structured spreadsheet retrieval for Excel/CSV facts, dates, statuses, and row-level contradictions.
- Hybrid retrieval where the Coordinator combines markdown citations with exact spreadsheet rows.

This is deliberate: Excel questions should not be answered by embedding raw sheets when schema-aware querying is more reliable.
