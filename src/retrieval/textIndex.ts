import fs from "node:fs/promises";
import path from "node:path";
import { getFileOrThrow, loadOrCreateManifest } from "../document-store/manifest.js";
import { sessionRoot } from "../document-store/paths.js";
import { EvidencePacket, UploadedDocument } from "../types.js";
import { ensureDir, fileExists, readJson, writeText } from "../utils/fs.js";
import { normalizeWhitespace, safeSnippet } from "../utils/text.js";
import { buildEvidencePacket } from "./evidence.js";
import { chunkMarkdownByHeadings } from "./chunking.js";

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

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => token.length > 1);
}

function bm25Scores(records: TextIndexRecord[], query: string): Map<string, number> {
  const queryTokens = tokenize(query);
  const scoreByChunk = new Map<string, number>();
  if (queryTokens.length === 0 || records.length === 0) return scoreByChunk;

  const N = records.length;
  const docFreq = new Map<string, number>();
  const docLens: number[] = [];
  const tokenCache = new Map<string, string[]>();

  for (const record of records) {
    const tokens = tokenize(record.searchText);
    tokenCache.set(record.chunkId, tokens);
    docLens.push(tokens.length || 1);
    const seen = new Set(tokens);
    for (const token of seen) docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
  }

  const avgLen = docLens.reduce((sum, value) => sum + value, 0) / Math.max(docLens.length, 1);
  const k1 = 1.2;
  const b = 0.75;

  for (const record of records) {
    const tokens = tokenCache.get(record.chunkId) ?? [];
    const len = tokens.length || 1;
    const tf = new Map<string, number>();
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);

    let score = 0;
    for (const token of queryTokens) {
      const df = docFreq.get(token) ?? 0;
      if (df === 0) continue;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      const freq = tf.get(token) ?? 0;
      if (freq === 0) continue;
      const denom = freq + k1 * (1 - b + (b * len) / Math.max(avgLen, 1));
      score += idf * ((freq * (k1 + 1)) / denom);
    }

    // Phrase/substring boost for exact matches.
    const lowerQuery = query.toLowerCase().trim();
    if (lowerQuery.length >= 4 && record.searchText.includes(lowerQuery)) score += 1.75;

    if (score > 0) scoreByChunk.set(record.chunkId, score);
  }

  return scoreByChunk;
}

function diversify(matches: EvidencePacket[], limit: number): EvidencePacket[] {
  const perGroupLimit = 3;
  const groupCounts = new Map<string, number>();
  const chosen: EvidencePacket[] = [];

  for (const packet of matches) {
    if (chosen.length >= limit) break;
    const group =
      packet.locator.page !== undefined
        ? `${packet.source.fileId}:page:${packet.locator.page}`
        : packet.locator.slide !== undefined
          ? `${packet.source.fileId}:slide:${packet.locator.slide}`
          : packet.locator.sheetId
            ? `${packet.source.fileId}:sheet:${packet.locator.sheetId}`
            : packet.locator.blockId
              ? `${packet.source.fileId}:block:${String(packet.locator.blockId).split("_").slice(0, 2).join("_")}`
              : `${packet.source.fileId}:misc`;

    const count = groupCounts.get(group) ?? 0;
    if (count >= perGroupLimit) continue;
    groupCounts.set(group, count + 1);
    chosen.push(packet);
  }
  return chosen;
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
  const chunks = chunkMarkdownByHeadings(markdown);
  const fallback = chunks.length ? chunks.map((chunk) => chunk.text) : splitMarkdownBlocks(markdown);
  return fallback.map((text, index) => ({
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
    const scoreMap = bm25Scores(records, input.query);
    for (const record of records) {
      const score = scoreMap.get(record.chunkId) ?? 0;
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

  const sorted = matches.sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
  return diversify(sorted, input.limit ?? DEFAULT_LIMIT);
}
