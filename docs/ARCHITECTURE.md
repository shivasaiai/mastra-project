# Architecture Note

## Goal

Build a Mastra-based multi-agent backend that answers questions over uploaded documents while keeping raw files out of the LLM context. The first version focuses on document analysis for the BPSS-style dataset, with research answering left as a later specialist agent.

## Agents

- Coordinator / Router Agent: receives user requests, chooses the specialist route, checks session state, and synthesizes answers with citations.
- Document Intake Agent: initializes uploads, records manifest state, and reports file readiness.
- Spreadsheet Agent: handles Excel/CSV schema, preview, query, and describe tools over persisted JSONL rows.
- Document Analysis Agent: handles PDF/DOCX markdown search and analysis.
- Presentation Agent: handles PPTX slide markdown, structure, image metadata, and chart data.
- Research Agent: handles web lookup for general research questions.

The coordination mechanism is explicit: the HTTP API and Coordinator route the request to a specialist agent based on intent, while the Mastra registry exposes all agents from `src/mastra/index.ts`.

## Storage Contract

Every upload is content-addressed by SHA-256. The first 24 hex characters become the stable `file_id`. The original file is copied once to `uploads/<file_id>/original.ext`. Derived artifacts are written only under `extracted/<kind>/<file_id>/`, and user-requested outputs should go under `workspace/`.

`manifest.json` records file status and paths. Failed and partial extractions keep the original upload available and include warnings or errors.

## Extraction Strategy

Excel and CSV are treated as structured data. The extractor infers a likely header row, normalizes rows to JSONL, writes a markdown preview, and computes a schema with inferred types, null counts, and sample values. Query tools enforce default limits and a hard returned-cell cap.

DOCX is converted to markdown using Mammoth, with simple block chunks for retrieval.

PDF uses `unpdf` as a local text fallback, renders each page to PNG with `unpdf.renderPageAsImage` and `@napi-rs/canvas`, and calls Gemini vision Markdown conversion when `GEMINI_API_KEY` is configured. Each page is processed independently with bounded concurrency, timeouts, and retries. Failed Gemini calls do not discard the upload or page image; the extractor writes the local text Markdown and records a page-level warning.

PPTX is parsed at the package/XML level. V1 extracts slide text, deck metadata, media binaries, and best-effort chart XML summaries. Rendering and exact geometry are marked as future optional stages instead of being faked.

## Retrieval Choices

Three approaches are intentionally supported:

- Naive markdown chunk search: useful baseline for policy text, notes, and narrative evidence.
- Structured retrieval: best for spreadsheets because it preserves exact rows, filters, sorts, and summaries.
- Hybrid retrieval: Coordinator combines structured rows and markdown evidence to reconcile contradictions.

## Production Improvements

- Add SQLite or DuckDB row stores for very large spreadsheets.
- Add provider-level retry/backoff and model fallback for Gemini PDF vision calls.
- Add queue-backed extraction workers for very large PDFs.
- Add LibreOffice-based PPTX slide rendering.
- Add true vector search over markdown chunks.
- Add a synthesis/evaluation workflow for the BPSS sample questions.
