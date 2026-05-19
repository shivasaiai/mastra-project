You are an expert AI software engineer. I have a Mastra-based multi-agent RAG chatbot project. We have completed Phase 1, and now I need you to implement **Phase 2: Mastra RAG Pipeline** from the attached `docs/DESIGN.md`.

This phase wires up the vector indexing and updates the tools to use a hybrid (vector + lexical) retrieval approach. 

**DO NOT rewrite the existing ingestion logic, file extraction, or `vectorIndex.ts`. The scaffolding in `vectorIndex.ts` is already correct.**

Here is exactly what you need to do:

### 1. Wire Vector Ingestion into the Indexer
- Edit `src/retrieval/indexer.ts`.
- Currently, `buildRetrievalIndexesForFile` only builds the lexical text index. Update it to call `buildVectorIndexForFile` (from `src/retrieval/vectorIndex.ts`) as well.
- Merge the `derivedPaths` and `warnings` from both the text and vector indexing operations into the final returned object.

### 2. Export `searchTextEvidence`
- Edit `src/retrieval/textIndex.ts`.
- Ensure there is an exported function named `searchTextEvidence` that takes `userId`, `sessionId`, `query`, optional `fileId`, and optional `limit`. It should return `Promise<EvidencePacket[]>`. If it doesn't exist with this exact signature, wrap the existing lexical search logic to create it.

### 3. Rewrite `ragTools` for Hybrid Retrieval
- Edit `src/mastra/tools/ragTools.ts`.
- Update `documentsRetrieveEvidenceTool` to try vector search first, and fall back to lexical search if no results are found.
- Use `hasEmbeddingProvider()` from `src/mastra/model.ts` to determine if vector search can be attempted.
- Call `searchVectorEvidence` (from `vectorIndex.ts`). If it returns results, set `retrievalMode: "vector"`.
- If vector search returns 0 results (or if there's no embedding provider), call `searchTextEvidence` (from `textIndex.ts`) and set `retrievalMode: "lexical"`.
- Return the `packets`, the `retrievalMode`, and add a guardrail flag `lowEvidence: true` if fewer than 2 packets are found, along with a `lowEvidenceHint`.

### 4. Update Agent Instructions
- Edit `src/agents/documentAnalystAgent.ts`.
- Update the agent's instructions to explicitly mention that `documents.retrieveEvidence` is the primary tool and it automatically handles vector/lexical retrieval.
- Add an instruction: "For spreadsheets (Excel/CSV), use spreadsheet-specific tools. Do NOT use retrieveEvidence for tabular data."
- Add an instruction: "Always cite sources with locators from the evidence packets. If lowEvidence is true, state uncertainty."

**Constraints:**
- Do NOT move on to Phase 3 (Demo Polish). Only do Phase 2.
- Run `npm run typecheck` to ensure the build isn't broken.
- Review Phase 2 in `docs/DESIGN.md` if you need more details.
