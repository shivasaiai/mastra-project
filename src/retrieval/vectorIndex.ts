import fs from "node:fs/promises";
import path from "node:path";
import { MDocument } from "@mastra/rag";
import { embedV1 } from "@mastra/core/vector";
import { loadOrCreateManifest, getFileOrThrow } from "../document-store/manifest.js";
import { sessionRoot } from "../document-store/paths.js";
import { getDefaultEmbeddingModel, hasEmbeddingProvider } from "../mastra/model.js";
import { documentVectorIndexName, documentVectorStore } from "../mastra/vectorStore.js";
import { EvidencePacket, UploadedDocument } from "../types.js";
import { readJson } from "../utils/fs.js";
import { safeSnippet } from "../utils/text.js";
import { buildEvidencePacket } from "./evidence.js";

type VectorMetadata = {
  text: string;
  userId: string;
  sessionId: string;
  fileId: string;
  originalFilename: string;
  documentType: UploadedDocument["kind"];
  blockId: string;
  page?: number;
  slide?: number;
  warnings?: string[];
};

type PdfDocument = {
  pages?: {
    page_number: number;
    markdown: string;
  }[];
};

type PptxDeck = {
  slides?: {
    slide_number: number;
    markdown: string;
  }[];
};

const DEFAULT_LIMIT = 8;
const MIN_VECTOR_SCORE = 0.15;

function resolveSessionPath(userId: string, sessionId: string, relativePath: string): string {
  return path.join(sessionRoot(userId, sessionId), relativePath);
}

function vectorIndexMarkerPath(userId: string, sessionId: string, fileId: string): string {
  return path.join(sessionRoot(userId, sessionId), "indexes", "vectors", `${fileId}.json`);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function chunkMarkdown(markdown: string, metadata: Record<string, unknown>) {
  const document = MDocument.fromMarkdown(markdown, metadata);
  return document.chunk({
    strategy: "semantic-markdown",
    maxSize: 900,
    overlap: 120,
    joinThreshold: 160,
  });
}

async function chunksFromMarkdownFile(input: {
  userId: string;
  sessionId: string;
  file: UploadedDocument;
  relativePath: string;
  locator: EvidencePacket["locator"];
  chunkPrefix: string;
}): Promise<{ id: string; text: string; metadata: VectorMetadata }[]> {
  const markdown = await fs.readFile(resolveSessionPath(input.userId, input.sessionId, input.relativePath), "utf8");
  const chunks = await chunkMarkdown(markdown, {
    userId: input.userId,
    sessionId: input.sessionId,
    fileId: input.file.file_id,
    documentType: input.file.kind,
  });

  return chunks
    .map((chunk, index) => {
      const blockId = `${input.chunkPrefix}_${String(index + 1).padStart(4, "0")}`;
      const text = chunk.text.trim();
      return {
        id: `${input.userId}:${input.sessionId}:${input.file.file_id}:${blockId}`,
        text,
        metadata: {
          text,
          userId: input.userId,
          sessionId: input.sessionId,
          fileId: input.file.file_id,
          originalFilename: input.file.original_filename,
          documentType: input.file.kind,
          blockId,
          page: input.locator.page,
          slide: input.locator.slide,
          warnings: input.file.warnings,
        },
      };
    })
    .filter((chunk) => chunk.text.length > 0);
}

async function chunksFromFile(input: {
  userId: string;
  sessionId: string;
  file: UploadedDocument;
}): Promise<{ id: string; text: string; metadata: VectorMetadata }[]> {
  if (input.file.kind === "excel" || input.file.kind === "csv" || input.file.kind === "unsupported") return [];

  if (input.file.kind === "pdf" && typeof input.file.derived_paths.document === "string") {
    const document = await readJson<PdfDocument>(resolveSessionPath(input.userId, input.sessionId, input.file.derived_paths.document));
    const chunks = [];
    for (const page of document.pages ?? []) {
      chunks.push(
        ...(await chunksFromMarkdownFile({
          ...input,
          relativePath: page.markdown,
          locator: { page: page.page_number },
          chunkPrefix: `page_${String(page.page_number).padStart(3, "0")}`,
        })),
      );
    }
    return chunks;
  }

  if (input.file.kind === "pptx" && typeof input.file.derived_paths.deck === "string") {
    const deck = await readJson<PptxDeck>(resolveSessionPath(input.userId, input.sessionId, input.file.derived_paths.deck));
    const chunks = [];
    for (const slide of deck.slides ?? []) {
      chunks.push(
        ...(await chunksFromMarkdownFile({
          ...input,
          relativePath: slide.markdown,
          locator: { slide: slide.slide_number },
          chunkPrefix: `slide_${String(slide.slide_number).padStart(3, "0")}`,
        })),
      );
    }
    return chunks;
  }

  if (typeof input.file.derived_paths.markdown === "string") {
    return chunksFromMarkdownFile({
      ...input,
      relativePath: input.file.derived_paths.markdown,
      locator: {},
      chunkPrefix: "block",
    });
  }

  return [];
}

async function ensureVectorIndex(dimension: number): Promise<void> {
  const indexes = await documentVectorStore.listIndexes();
  if (indexes.includes(documentVectorIndexName)) return;
  await documentVectorStore.createIndex({
    indexName: documentVectorIndexName,
    dimension,
    metric: "cosine",
  });
}

export async function buildVectorIndexForFile(input: {
  userId: string;
  sessionId: string;
  file: UploadedDocument;
}): Promise<{ path?: string; records: number; warnings: string[] }> {
  if (!hasEmbeddingProvider()) {
    return {
      records: 0,
      warnings: ["Vector index skipped because no embedding provider is configured; lexical retrieval fallback remains available."],
    };
  }

  const chunks = await chunksFromFile(input);
  if (chunks.length === 0) return { records: 0, warnings: [] };

  const model = getDefaultEmbeddingModel();
  const embeddings = [];
  for (const chunk of chunks) {
    const { embedding } = await embedV1({ model, value: chunk.text });
    embeddings.push(embedding);
  }

  if (embeddings.length === 0) return { records: 0, warnings: ["Embedding provider returned no vectors."] };
  await ensureVectorIndex(embeddings[0].length);

  await documentVectorStore.upsert({
    indexName: documentVectorIndexName,
    ids: chunks.map((chunk) => chunk.id),
    vectors: embeddings,
    metadata: chunks.map((chunk) => chunk.metadata),
    deleteFilter: {
      userId: input.userId,
      sessionId: input.sessionId,
      fileId: input.file.file_id,
    },
  });

  const markerPath = vectorIndexMarkerPath(input.userId, input.sessionId, input.file.file_id);
  await fs.mkdir(path.dirname(markerPath), { recursive: true });
  await fs.writeFile(
    markerPath,
    JSON.stringify(
      {
        fileId: input.file.file_id,
        indexName: documentVectorIndexName,
        records: chunks.length,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  return {
    path: path.relative(sessionRoot(input.userId, input.sessionId), markerPath),
    records: chunks.length,
    warnings: [],
  };
}

export async function searchVectorEvidence(input: {
  userId: string;
  sessionId: string;
  fileId?: string;
  query: string;
  limit?: number;
}): Promise<EvidencePacket[]> {
  if (!hasEmbeddingProvider()) return [];

  const manifest = await loadOrCreateManifest(input.userId, input.sessionId);
  const files = input.fileId ? [getFileOrThrow(manifest, input.fileId)] : manifest.files;
  const readyNarrativeFiles = files.filter((file) => !["excel", "csv", "unsupported"].includes(file.kind));
  if (readyNarrativeFiles.length === 0) return [];

  for (const file of readyNarrativeFiles) {
    const markerPath = vectorIndexMarkerPath(input.userId, input.sessionId, file.file_id);
    if (!(await fileExists(markerPath))) {
      await buildVectorIndexForFile({ userId: input.userId, sessionId: input.sessionId, file });
    }
  }

  const model = getDefaultEmbeddingModel();
  const { embedding } = await embedV1({ model, value: input.query });
  const filter: Record<string, unknown> = {
    userId: input.userId,
    sessionId: input.sessionId,
  };
  if (input.fileId) filter.fileId = input.fileId;

  const results = await documentVectorStore.query({
    indexName: documentVectorIndexName,
    queryVector: embedding,
    topK: input.limit ?? DEFAULT_LIMIT,
    filter: filter as never,
    minScore: MIN_VECTOR_SCORE,
  });

  return results
    .map((result) => {
      const metadata = result.metadata as VectorMetadata | undefined;
      if (!metadata) return null;
      const file = getFileOrThrow(manifest, metadata.fileId);
      return buildEvidencePacket({
        userId: input.userId,
        sessionId: input.sessionId,
        file,
        evidenceId: `${metadata.fileId}:${metadata.blockId}`,
        locator: {
          page: metadata.page,
          slide: metadata.slide,
          blockId: metadata.blockId,
        },
        content: { text: safeSnippet(metadata.text, 520) },
        score: result.score,
        warnings: metadata.warnings,
      });
    })
    .filter((packet): packet is EvidencePacket => packet !== null);
}
