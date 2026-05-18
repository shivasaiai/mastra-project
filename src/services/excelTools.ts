import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { loadOrCreateManifest, getFileOrThrow } from "../document-store/manifest.js";
import { sessionRoot } from "../document-store/paths.js";
import { buildEvidencePacket } from "../retrieval/evidence.js";
import { readJson } from "../utils/fs.js";
import { normalizeWhitespace, safeSnippet } from "../utils/text.js";

const DEFAULT_LIMIT = 50;
const HARD_CELL_CAP = 5000;

type Filter = {
  column: string;
  op: "=" | "!=" | "<" | "<=" | ">" | ">=" | "contains" | "in";
  value?: unknown;
};

type SortSpec = {
  column: string;
  direction?: "asc" | "desc";
};

type NumberedRow = {
  rowNumber: number;
  row: Record<string, unknown>;
};

function excelRoot(userId: string, sessionId: string, fileId: string): string {
  return path.join(sessionRoot(userId, sessionId), "extracted", "excel", fileId);
}

function sheetPath(userId: string, sessionId: string, fileId: string, sheetId: string, suffix: string): string {
  return path.join(excelRoot(userId, sessionId, fileId), "sheets", `${sheetId}.${suffix}`);
}

function compareValues(left: unknown, right: unknown): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)) return leftNumber - rightNumber;
  return String(left ?? "").localeCompare(String(right ?? ""));
}

function matchesFilter(row: Record<string, unknown>, filter: Filter): boolean {
  const value = row[filter.column];
  switch (filter.op) {
    case "=":
      return String(value) === String(filter.value);
    case "!=":
      return String(value) !== String(filter.value);
    case "<":
      return compareValues(value, filter.value) < 0;
    case "<=":
      return compareValues(value, filter.value) <= 0;
    case ">":
      return compareValues(value, filter.value) > 0;
    case ">=":
      return compareValues(value, filter.value) >= 0;
    case "contains":
      return String(value ?? "").toLowerCase().includes(String(filter.value ?? "").toLowerCase());
    case "in":
      return Array.isArray(filter.value) && filter.value.map(String).includes(String(value));
  }
}

async function readRows(filePath: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const stream = fs.createReadStream(filePath, "utf8");
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim()) rows.push(JSON.parse(line));
  }
  return rows;
}

async function readNumberedRows(filePath: string): Promise<NumberedRow[]> {
  const rows: NumberedRow[] = [];
  const stream = fs.createReadStream(filePath, "utf8");
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let rowNumber = 1;
  for await (const line of rl) {
    if (line.trim()) rows.push({ rowNumber, row: JSON.parse(line) as Record<string, unknown> });
    rowNumber += 1;
  }
  return rows;
}

export async function listDocuments(input: { userId: string; sessionId: string }) {
  const manifest = await loadOrCreateManifest(input.userId, input.sessionId);
  return manifest.files.map((file) => ({
    fileId: file.file_id,
    originalFilename: file.original_filename,
    kind: file.kind,
    status: file.status,
    warnings: file.warnings,
    error: file.error,
  }));
}

export async function listSheets(input: { userId: string; sessionId: string; fileId: string }) {
  const manifest = await loadOrCreateManifest(input.userId, input.sessionId);
  getFileOrThrow(manifest, input.fileId);
  const workbook = await readJson<Record<string, unknown>>(path.join(excelRoot(input.userId, input.sessionId, input.fileId), "workbook.json"));
  return workbook;
}

export async function getSchema(input: { userId: string; sessionId: string; fileId: string; sheetId: string }) {
  return readJson<Record<string, unknown>>(sheetPath(input.userId, input.sessionId, input.fileId, input.sheetId, "schema.json"));
}

export async function previewRows(input: {
  userId: string;
  sessionId: string;
  fileId: string;
  sheetId: string;
  limit?: number;
  offset?: number;
  columns?: string[];
}) {
  const rows = await readRows(sheetPath(input.userId, input.sessionId, input.fileId, input.sheetId, "rows.jsonl"));
  const offset = input.offset ?? 0;
  const limit = Math.max(0, Math.min(input.limit ?? 20, DEFAULT_LIMIT));
  const selectedRows = rows.slice(offset, offset + limit).map((row) => selectColumns(row, input.columns));
  return { offset, limit, returned: selectedRows.length, rows: selectedRows };
}

export async function previewEvidenceRows(input: {
  userId: string;
  sessionId: string;
  fileId: string;
  sheetId: string;
  limit?: number;
  offset?: number;
  columns?: string[];
}) {
  const manifest = await loadOrCreateManifest(input.userId, input.sessionId);
  const file = getFileOrThrow(manifest, input.fileId);
  const rows = await readNumberedRows(sheetPath(input.userId, input.sessionId, input.fileId, input.sheetId, "rows.jsonl"));
  const offset = input.offset ?? 0;
  const limit = Math.max(0, Math.min(input.limit ?? 20, DEFAULT_LIMIT));
  const selected = rows.slice(offset, offset + limit);
  return {
    offset,
    limit,
    returned: selected.length,
    evidence: selected.map((item) =>
      buildEvidencePacket({
        userId: input.userId,
        sessionId: input.sessionId,
        file,
        evidenceId: `${input.fileId}:${input.sheetId}:row_${item.rowNumber}`,
        locator: { sheetId: input.sheetId, rowNumber: item.rowNumber },
        content: { row: selectColumns(item.row, input.columns) },
      }),
    ),
  };
}

function selectColumns(row: Record<string, unknown>, columns?: string[]): Record<string, unknown> {
  if (!columns || columns.length === 0) return row;
  return Object.fromEntries(columns.map((column) => [column, row[column] ?? null]));
}

export async function queryRows(input: {
  userId: string;
  sessionId: string;
  fileId: string;
  sheetId: string;
  select?: string[];
  filters?: Filter[];
  sort?: SortSpec;
  limit?: number;
}) {
  const manifest = await loadOrCreateManifest(input.userId, input.sessionId);
  const file = getFileOrThrow(manifest, input.fileId);
  const allRows = await readNumberedRows(sheetPath(input.userId, input.sessionId, input.fileId, input.sheetId, "rows.jsonl"));
  const filtered = input.filters?.length
    ? allRows.filter((item) => input.filters?.every((filter) => matchesFilter(item.row, filter)))
    : allRows;
  if (input.sort) {
    filtered.sort((left, right) => compareValues(left.row[input.sort!.column], right.row[input.sort!.column]));
    if (input.sort.direction === "desc") filtered.reverse();
  }
  const columnCount = input.select?.length || Object.keys(filtered[0]?.row ?? {}).length || 1;
  const requestedLimit = input.limit ?? DEFAULT_LIMIT;
  const cappedLimit = Math.max(0, Math.min(requestedLimit, Math.floor(HARD_CELL_CAP / Math.max(columnCount, 1))));
  const selected = filtered.slice(0, cappedLimit);
  const rows = selected.map((item) => selectColumns(item.row, input.select));
  return {
    totalMatched: filtered.length,
    returned: rows.length,
    truncated: filtered.length > rows.length,
    hardCellCap: HARD_CELL_CAP,
    rows,
    evidence: selected.map((item) =>
      buildEvidencePacket({
        userId: input.userId,
        sessionId: input.sessionId,
        file,
        evidenceId: `${input.fileId}:${input.sheetId}:row_${item.rowNumber}`,
        locator: { sheetId: input.sheetId, rowNumber: item.rowNumber },
        content: { row: selectColumns(item.row, input.select) },
      }),
    ),
  };
}

export async function describe(input: { userId: string; sessionId: string; fileId: string; sheetId: string; columns?: string[] }) {
  const schema = await getSchema(input);
  const rows = await readRows(sheetPath(input.userId, input.sessionId, input.fileId, input.sheetId, "rows.jsonl"));
  const columns = input.columns?.length ? input.columns : (schema.columns as { name: string }[]).map((column) => column.name);
  const stats = columns.map((column) => {
    const values = rows.map((row) => row[column]).filter((value) => value !== null && value !== undefined && value !== "");
    const numbers = values.map(Number).filter((value) => !Number.isNaN(value));
    return {
      column,
      count: values.length,
      nullCount: rows.length - values.length,
      uniqueCount: new Set(values.map(String)).size,
      min: numbers.length ? Math.min(...numbers) : undefined,
      max: numbers.length ? Math.max(...numbers) : undefined,
      mean: numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : undefined,
    };
  });
  return { rowCount: rows.length, stats };
}

export async function describeEvidence(input: { userId: string; sessionId: string; fileId: string; sheetId: string; columns?: string[] }) {
  const manifest = await loadOrCreateManifest(input.userId, input.sessionId);
  const file = getFileOrThrow(manifest, input.fileId);
  const described = await describe(input);
  const summary = safeSnippet(normalizeWhitespace(JSON.stringify(described)), 900);
  return [
    buildEvidencePacket({
      userId: input.userId,
      sessionId: input.sessionId,
      file,
      evidenceId: `${input.fileId}:${input.sheetId}:describe`,
      locator: { sheetId: input.sheetId, blockId: "describe" },
      content: { summary },
    }),
  ];
}

export async function getPreviewMarkdown(input: { userId: string; sessionId: string; fileId: string; sheetId: string }) {
  return fsp.readFile(sheetPath(input.userId, input.sessionId, input.fileId, input.sheetId, "preview.md"), "utf8");
}
