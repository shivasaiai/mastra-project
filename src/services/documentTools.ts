import fs from "node:fs/promises";
import path from "node:path";
import { loadOrCreateManifest, getFileOrThrow } from "../document-store/manifest.js";
import { sessionRoot } from "../document-store/paths.js";
import { searchTextEvidence } from "../retrieval/textIndex.js";
import { normalizeWhitespace, safeSnippet } from "../utils/text.js";

function resolveSessionPath(userId: string, sessionId: string, relativePath: string): string {
  return path.join(sessionRoot(userId, sessionId), relativePath);
}

export async function getManifest(input: { userId: string; sessionId: string }) {
  return loadOrCreateManifest(input.userId, input.sessionId);
}

export async function getDocumentStatus(input: { userId: string; sessionId: string; fileId?: string }) {
  const manifest = await loadOrCreateManifest(input.userId, input.sessionId);
  const files = input.fileId ? [getFileOrThrow(manifest, input.fileId)] : manifest.files;
  return files.map((file) => ({
    fileId: file.file_id,
    originalFilename: file.original_filename,
    kind: file.kind,
    status: file.status,
    extractedAt: file.extracted_at,
    parser: file.parser,
    derivedPaths: file.derived_paths,
    warnings: file.warnings,
    error: file.error,
  }));
}

export async function getMarkdown(input: { userId: string; sessionId: string; fileId: string }) {
  const manifest = await loadOrCreateManifest(input.userId, input.sessionId);
  const file = getFileOrThrow(manifest, input.fileId);
  const markdownPath = file.derived_paths.markdown;
  if (typeof markdownPath !== "string") throw new Error(`File '${input.fileId}' does not expose a markdown artifact.`);
  return fs.readFile(resolveSessionPath(input.userId, input.sessionId, markdownPath), "utf8");
}

export async function searchMarkdown(input: { userId: string; sessionId: string; fileId?: string; query: string; limit?: number }) {
  const evidence = await searchTextEvidence(input);
  if (evidence.length > 0) {
    return evidence.map((packet) => ({
      fileId: packet.source.fileId,
      originalFilename: packet.source.originalFilename,
      kind: packet.source.documentType,
      block: Number(packet.locator.blockId?.match(/(\d+)$/)?.[1] ?? packet.locator.page ?? packet.locator.slide ?? 0),
      page: packet.locator.page,
      slide: packet.locator.slide,
      score: packet.score ?? 0,
      excerpt: packet.content.text ?? packet.content.summary ?? "",
      evidence: packet,
    }));
  }

  const manifest = await loadOrCreateManifest(input.userId, input.sessionId);
  const terms = input.query.toLowerCase().split(/\s+/).filter(Boolean);
  const limit = input.limit ?? 10;
  const files = input.fileId ? [getFileOrThrow(manifest, input.fileId)] : manifest.files;
  const results = [];

  for (const file of files) {
    const markdownPath = file.derived_paths.markdown;
    if (typeof markdownPath !== "string") continue;
    const absolutePath = resolveSessionPath(input.userId, input.sessionId, markdownPath);
    const markdown = await fs.readFile(absolutePath, "utf8");
    const blocks = markdown.split(/\n{2,}/).map((block) => normalizeWhitespace(block)).filter(Boolean);
    for (const [index, block] of blocks.entries()) {
      const lower = block.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0);
      if (score > 0) {
        results.push({
          fileId: file.file_id,
          originalFilename: file.original_filename,
          kind: file.kind,
          block: index + 1,
          score,
          excerpt: safeSnippet(block, 320),
        });
      }
    }
  }

  return results.sort((left, right) => right.score - left.score).slice(0, limit);
}

export async function searchDocuments(input: { userId: string; sessionId: string; fileId?: string; query: string; limit?: number }) {
  return searchTextEvidence(input);
}

export async function listPptxSlides(input: { userId: string; sessionId: string; fileId: string }) {
  const manifest = await loadOrCreateManifest(input.userId, input.sessionId);
  const file = getFileOrThrow(manifest, input.fileId);
  const deckPath = file.derived_paths.deck;
  if (typeof deckPath !== "string") throw new Error(`File '${input.fileId}' does not expose a deck artifact.`);
  const raw = await fs.readFile(resolveSessionPath(input.userId, input.sessionId, deckPath), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

export async function getPptxSlideMarkdown(input: { userId: string; sessionId: string; fileId: string; slideNumber: number }) {
  const slideId = `slide_${String(input.slideNumber).padStart(3, "0")}`;
  const filePath = path.join(sessionRoot(input.userId, input.sessionId), "extracted", "pptx", input.fileId, "slides", `${slideId}.md`);
  return fs.readFile(filePath, "utf8");
}

export async function getPptxSlideStructure(input: { userId: string; sessionId: string; fileId: string; slideNumber: number }) {
  const slideId = `slide_${String(input.slideNumber).padStart(3, "0")}`;
  const filePath = path.join(sessionRoot(input.userId, input.sessionId), "extracted", "pptx", input.fileId, "slides", `${slideId}.structure.json`);
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

export async function getChartData(input: { userId: string; sessionId: string; fileId: string; chartId: string }) {
  const filePath = path.join(sessionRoot(input.userId, input.sessionId), "extracted", "pptx", input.fileId, "charts", `${input.chartId}.json`);
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}
