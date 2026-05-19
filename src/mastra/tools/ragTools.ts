import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { searchTextEvidence } from "../../retrieval/textIndex.js";
import { searchVectorEvidence } from "../../retrieval/vectorIndex.js";
import { getMarkdown } from "../../services/documentTools.js";
import type { EvidencePacket } from "../../types.js";
import { hasEmbeddingProvider } from "../model.js";
import { safeExecute, sessionSchema } from "./shared.js";

export const documentsGetMarkdownTool = createTool({
  id: "documents.getMarkdown",
  description: "Return bounded markdown for a document that exposes a markdown artifact.",
  inputSchema: z.object({ ...sessionSchema, fileId: z.string().min(1) }),
  execute: async (input) => safeExecute("documents.getMarkdown", () => getMarkdown(input)),
});

export const documentsSearchTextTool = createTool({
  id: "documents.searchText",
  description: "Search persisted text indexes and return structured evidence packets with citations.",
  inputSchema: z.object({
    ...sessionSchema,
    fileId: z.string().optional(),
    query: z.string().min(1),
    limit: z.number().int().positive().optional(),
  }),
  execute: async (input) => safeExecute("documents.searchText", () => searchTextEvidence(input)),
});

export const documentsRetrieveEvidenceTool = createTool({
  id: "documents.retrieveEvidence",
  description: "Retrieve document evidence. Uses vector search when available, then falls back to lexical search.",
  inputSchema: z.object({
    ...sessionSchema,
    fileId: z.string().optional(),
    query: z.string().min(1),
    limit: z.number().int().positive().optional(),
  }),
  execute: async (input) =>
    safeExecute("documents.retrieveEvidence", async () => {
      let packets: EvidencePacket[] = [];
      let retrievalMode: "vector" | "lexical" = "lexical";

      if (hasEmbeddingProvider()) {
        const vectorResults = await searchVectorEvidence(input);
        if (vectorResults.length > 0) {
          packets = vectorResults;
          retrievalMode = "vector";
        }
      }

      if (packets.length === 0) {
        packets = await searchTextEvidence(input);
        retrievalMode = "lexical";
      }

      const lowEvidence = packets.length < 2;
      return {
        packets,
        retrievalMode,
        lowEvidence,
        lowEvidenceHint: lowEvidence
          ? "Low evidence: state uncertainty explicitly and consider asking for a narrower query or specific file."
          : undefined,
      };
    }),
});

export const ragTools = {
  documentsGetMarkdownTool,
  documentsSearchTextTool,
  documentsRetrieveEvidenceTool,
};
