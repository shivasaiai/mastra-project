import path from "node:path";
import { LibSQLVector } from "@mastra/libsql";
import { DATA_DIR } from "../config.js";
import { getEmbeddingDimension } from "./model.js";

export const documentVectorIndexName = "document_chunks";

export const documentVectorStore = new LibSQLVector({
  id: "document-vector-store",
  url: `file:${path.join(DATA_DIR, "document-vectors.db")}`,
});

export async function initializeVectorIndex(): Promise<void> {
  const indexes = await documentVectorStore.listIndexes();
  if (indexes.includes(documentVectorIndexName)) return;

  await documentVectorStore.createIndex({
    indexName: documentVectorIndexName,
    dimension: getEmbeddingDimension(),
    metric: "cosine",
  });
}
