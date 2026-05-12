import fs from "node:fs/promises";
import path from "node:path";
import { getFileOrThrow, loadOrCreateManifest } from "../document-store/manifest.js";
import { sessionRoot } from "../document-store/paths.js";
import { EvidencePacket, UploadedDocument } from "../types.js";
import { ensureDir, fileExists, readJson, writeText } from "../utils/fs.js";
import { normalizeWhitespace, safeSnippet } from "../utils/text.js";
import { buildEvidencePacket } from "./evidence.js";

type TextIndexRecord = {
  chunkId: string;
  fileId: string;
  originalFilename: string;
  documentType: UploadedDocument["kind"];
  locator: EvidencePacket["locator"];
  text: string;
  searchText: string;
  warnings: string[];
};

type PdfDocument = {
  pages?: {
    page_number: number;
    markdown: string;
    markdown_source?: string;
  }[];
};

type PptxDeck = {
  slides?: {
    slide_number: number;
    markdown: string;
  }[];
};

const DEFAULT_LIMIT = 10;

function textIndexRoot(userId: string, sessionId: string): string {
  return path.join(sessionRoot(userId, sessionId), "indexes", "text");
}

function textIndexPath(userId: string, sessionId: string, fileId: string): string {
  return path.join(textIndexRoot(userId, sessionId), `${fileId}.chunks.jsonl`);
}

function resolveSessionPath(userId: string, sessionId: string, relativePath: string): string {
  return path.join(sessionRoot(userId, sessionId), relativePath);
}

function splitMarkdownBlocks(markdown: string): string[] {
  return markdown
    .split(/\n{2,}/)
    .map((block) => normalizeWhitespace(block))
    .filter(Boolean);
}

function scoreText(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  return terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0);
}

async function recordsFromMarkdownFile(input: {
  userId: string;
  sessionId: string;
  file: UploadedDocument;
  relativePath: string;
  locator: EvidencePacket["locator"];
  chunkPrefix: string;
}): Promise<TextIndexRecord[]> {
  const markdown = await fs.readFile(resolveSessionPath(input.userId, input.sessionId, input.relativePath), "utf8");
  return splitMarkdownBlocks(markdown).map((text, index) => ({
    chunkId: `${input.chunkPrefix}_${String(index + 1).padStart(4, "0")}`,
    fileId: input.file.file_id,
    originalFilename: input.file.original_filename,
    documentType: input.file.kind,
    locator: { ...input.locator, blockId: `${input.chunkPrefix}_${String(index + 1).padStart(4, "0")}` },
    text,
    searchText: text.toLowerCase(),
    warnings: input.file.warnings,
  }));
}

async function recordsFromPdf(input: { userId: string; sessionId: string; file: UploadedDocument }): Promise<TextIndexRecord[]> {
  const documentPath = input.file.derived_paths.document;
  if (typeof documentPath !== "string") return [];
  const document = await readJson<PdfDocument>(resolveSessionPath(input.userId, input.sessionId, documentPath));
  const records: TextIndexRecord[] = [];
  for (const page of document.pages ?? []) {
    const pageRecords = await recordsFromMarkdownFile({
      userId: input.userId,
      sessionId: input.sessionId,
      file: input.file,
      relativePath: page.markdown,
      locator: { page: page.page_number },
      chunkPrefix: `page_${String(page.page_number).padStart(3, "0")}`,
    });
    records.push(...pageRecords);
  }
  return records;
}

async function recordsFromPptx(input: { userId: string; sessionId: string; file: UploadedDocument }): Promise<TextIndexRecord[]> {
  const deckPath = input.file.derived_paths.deck;
  if (typeof deckPath !== "string") return [];
  const deck = await readJson<PptxDeck>(resolveSessionPath(input.userId, input.sessionId, deckPath));
  const records: TextIndexRecord[] = [];
  for (const slide of deck.slides ?? []) {
    const slideRecords = await recordsFromMarkdownFile({
      userId: input.userId,
      sessionId: input.sessionId,
      file: input.file,
      relativePath: slide.markdown,
      locator: { slide: slide.slide_number },
      chunkPrefix: `slide_${String(slide.slide_number).padStart(3, "0")}`,
    });
    records.push(...slideRecords);
  }
  return records;
}

export async function buildTextIndexForFile(input: {
  userId: string;
  sessionId: string;
  file: UploadedDocument;
}): Promise<{ path?: string; records: number; warnings: string[] }> {
  if (input.file.kind === "excel" || input.file.kind === "csv" || input.file.kind === "unsupported") {
    return { records: 0, warnings: [] };
  }

  let records: TextIndexRecord[] = [];
  if (input.file.kind === "pdf") records = await recordsFromPdf(input);
  else if (input.file.kind === "pptx") records = await recordsFromPptx(input);
  else if (typeof input.file.derived_paths.markdown === "string") {
    records = await recordsFromMarkdownFile({
      userId: input.userId,
      sessionId: input.sessionId,
      file: input.file,
      relativePath: input.file.derived_paths.markdown,
      locator: {},
      chunkPrefix: "block",
    });
  }

  if (records.length === 0) return { records: 0, warnings: [`No text chunks were indexed for ${input.file.file_id}.`] };
  const outputPath = textIndexPath(input.userId, input.sessionId, input.file.file_id);
  await ensureDir(path.dirname(outputPath));
  await writeText(outputPath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  return {
    path: path.relative(sessionRoot(input.userId, input.sessionId), outputPath),
    records: records.length,
    warnings: [],
  };
}

async function readTextIndex(filePath: string): Promise<TextIndexRecord[]> {
  const raw = await fs.readFile(filePath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TextIndexRecord);
}

export async function searchTextEvidence(input: {
  userId: string;
  sessionId: string;
  fileId?: string;
  query: string;
  limit?: number;
}): Promise<EvidencePacket[]> {
  const manifest = await loadOrCreateManifest(input.userId, input.sessionId);
  const files = input.fileId ? [getFileOrThrow(manifest, input.fileId)] : manifest.files;
  const terms = input.query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches: EvidencePacket[] = [];

  for (const file of files) {
    if (file.kind === "unsupported") continue;
    let indexPath = textIndexPath(input.userId, input.sessionId, file.file_id);
    if (!(await fileExists(indexPath))) {
      const indexResult = await buildTextIndexForFile({ userId: input.userId, sessionId: input.sessionId, file });
      if (!indexResult.path) continue;
      indexPath = resolveSessionPath(input.userId, input.sessionId, indexResult.path);
    }
    const records = await readTextIndex(indexPath);
    for (const record of records) {
      const score = scoreText(record.searchText, terms);
      if (score <= 0) continue;
      matches.push(
        buildEvidencePacket({
          userId: input.userId,
          sessionId: input.sessionId,
          file,
          evidenceId: `${file.file_id}:${record.chunkId}`,
          locator: record.locator,
          content: {
            text: safeSnippet(record.text, 520),
          },
          score,
          warnings: record.warnings,
        }),
      );
    }
  }

  return matches.sort((left, right) => (right.score ?? 0) - (left.score ?? 0)).slice(0, input.limit ?? DEFAULT_LIMIT);
}
