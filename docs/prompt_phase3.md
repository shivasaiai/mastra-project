You are an expert AI software engineer. I have a Mastra-based multi-agent RAG chatbot project. We have completed Phases 1 and 2, and now I need you to implement **Phase 3: Demo Polish, Workflows & Evals** from the attached `docs/DESIGN.md`.

This is the final phase to make the project interview-ready. 

Here is exactly what you need to do:

### 1. Remove BPSS References
- Edit `package.json`: Change the `name` field to `"mastra-multi-agent-chatbot"`.
- Edit `package.json`: Remove the `bpss:answers` script.
- Edit `src/config.ts`: Remove the `DATASET_ROOT` export that points to `"bpss_agentic_dataset"`.

### 2. Add Sample Data and a Seed Script
- Create a new directory: `data/samples/`.
- Add a few small, generic sample files to this directory: a tiny PDF, a small DOCX, a basic CSV, and a small PPTX. (You can generate these programmatically or use simple text files renamed for testing).
- Create a script `src/cli/seed.ts` that uploads these sample files to the default session using the existing ingestion logic.
- Add `"seed": "node --import tsx src/cli/seed.ts"` to the `scripts` in `package.json`.

### 3. Add Mastra Workflows
- Create `src/mastra/workflows/ingestDocument.ts`. Implement a simple Mastra workflow (using `createWorkflow`) that defines the steps for ingesting a document (validate, extract, index, update manifest). You don't need to rewrite the ingestion logic, just wrap the existing `documentWorker.ts` process in workflow steps.
- Create `src/mastra/workflows/answerQuestion.ts`. Implement a simple workflow outlining the steps for answering a question (classify intent, retrieve evidence, generate answer).
- Edit `src/mastra/index.ts` to register both workflows in the `Mastra` constructor under the `workflows` property so they appear in Mastra Studio.

### 4. Add Evals (Scorers)
- Create `src/mastra/evals/citationCoverage.ts`. Implement a basic Mastra scorer that evaluates what fraction of claims in an answer are backed by evidence packets.
- Create `src/mastra/evals/groundedness.ts`. Implement a scorer that evaluates if the answer contains information not present in the retrieved evidence.
- You don't need to build perfect NLP for these right now; a structural implementation using an LLM as a judge via Mastra's evaluation framework is sufficient.

### 5. Update README
- Edit `README.md`. Remove any BPSS-specific language.
- Frame the project as a general-purpose multi-agent research and document RAG chatbot.
- Add a "5-Minute Demo" section explaining how to run the project (`cp .env.example .env`, add API key, `npm run seed`, `npm run dev`, and chat in Studio).

**Constraints:**
- Run `npm run typecheck` to ensure everything compiles correctly.
- Review Phase 3 in `docs/DESIGN.md` for any additional context.
