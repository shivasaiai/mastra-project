# Mastra Multi-Agent RAG Chatbot

General-purpose Mastra chatbot for web research and session-scoped document analysis. It can ingest PDFs, Word docs, PowerPoints, Excel workbooks, and CSVs, then answer questions with evidence packets and file/page/slide/sheet/row citations.

## What It Shows

- Mastra-native multi-agent architecture with a coordinator, document analyst, and research agent.
- Hybrid RAG: vector retrieval for narrative documents, lexical fallback when embeddings are unavailable, and structured tools for spreadsheets.
- Async document ingestion with immutable uploads, extracted artifacts, retrieval indexes, and a manifest per `userId/sessionId`.
- Mastra workflows for document ingestion and question answering.
- Mastra scorers for citation coverage and groundedness.
- Mastra observability in Studio: traces, logs, auto-extracted metrics, and scorer events.

## 5-Minute Demo

```bash
npm install
cp .env.example .env
```

Add one model API key to `.env`:

```bash
GEMINI_API_KEY=...
# or
OPENAI_API_KEY=...
```

Seed the default session with small generic sample files:

```bash
npm run seed
```

Start Mastra Studio:

```bash
npm run dev
```

Open [http://localhost:4111](http://localhost:4111), select the coordinator or document analyst agent, and ask:

```text
Summarize the uploaded documents with citations.
Which sample records need follow-up?
What does the deck say about the demo workflow?
```

In Studio, the `ingestDocumentWorkflow` and `answerQuestionWorkflow` are available from the Workflows tab. Running `answerQuestionWorkflow` also exercises the citation and groundedness scorers.

To show observability in Studio, ask an agent a question or run `answerQuestionWorkflow`, then open the Observability section. The trace list shows agent, workflow, model, and tool spans. The Metrics view is populated from auto-extracted duration/token metrics, and score events appear after a scorer-backed workflow or run emits scorer results.

## Architecture

```text
User
  -> Mastra Studio or HTTP API
      -> Coordinator Agent
          -> Document Analyst Agent
              -> RAG, spreadsheet, and presentation tools
          -> Research Agent
              -> web research tool
      -> workflows and scorers for repeatable demos
```

The deterministic services own file storage, extraction, indexing, spreadsheet querying, and evidence packet construction. Agents focus on routing, source selection, reasoning, and final answer generation.

## Ingestion Flow

```text
upload
  -> store immutable original
  -> create or update manifest record
  -> extract PDF/DOCX/PPTX/Excel/CSV artifacts
  -> build text index and optional vector index
  -> mark ready, partial, failed, or unsupported
```

Session data is stored under:

```text
data/users/<user_id>/sessions/<session_id>/
  uploads/<file_id>/original.ext
  extracted/
  indexes/
  manifest.json
```

## Retrieval Strategy

- PDF/DOCX/PPTX: narrative chunks with page, slide, and block locators.
- Excel/CSV: schema-aware row tools for exact filtering and row-level citations.
- Hybrid answers: combine evidence packets from multiple tools.
- No embedding provider: lexical retrieval remains available for local demos.

## Useful Commands

```bash
npm run seed        # ingest data/samples into local-user/default-session
npm run dev         # Mastra Studio
npm run server      # minimal JSON API
npm run chat        # local CLI chat
npm run test        # smoke test over generic samples
npm run typecheck   # TypeScript check
```

You can ingest any supported folder:

```bash
npm run index -- --source=/absolute/path/to/documents --user=local-user --session=default-session
```

Minimal API examples:

```bash
curl http://localhost:4111/health

curl -X POST http://localhost:4111/upload \
  -H 'content-type: application/json' \
  -d '{"userId":"local-user","sessionId":"default-session","sourcePath":"/absolute/path/to/file.pdf"}'

curl -X POST http://localhost:4111/chat \
  -H 'content-type: application/json' \
  -d '{"userId":"local-user","sessionId":"default-session","message":"Summarize the uploaded files with citations."}'
```

