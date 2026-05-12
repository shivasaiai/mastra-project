import fs from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";
import { extractedRoot, relativeToSession } from "../document-store/paths.js";
import { ensureDir, writeJson, writeText } from "../utils/fs.js";
import { slugify, toMarkdownTable } from "../utils/text.js";
import { ExtractionResult } from "./types.js";

type ColumnSchema = {
  name: string;
  inferred_type: "string" | "number" | "boolean" | "date" | "mixed" | "empty";
  null_count: number;
  non_null_count: number;
  sample_values: unknown[];
};

type SheetSchema = {
  sheet_id: string;
  sheet_name: string;
  row_count: number;
  column_count: number;
  header_row_index: number;
  table_confidence: "high" | "medium" | "low";
  columns: ColumnSchema[];
};

function uniqueSheetIds(sheetNames: string[]): Map<string, string> {
  const seen = new Map<string, number>();
  const result = new Map<string, string>();
  for (const name of sheetNames) {
    const base = slugify(name, "sheet");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    result.set(name, count === 0 ? base : `${base}-${count + 1}`);
  }
  return result;
}

function scoreHeaderRow(row: unknown[]): number {
  const values = row.map((value) => String(value ?? "").trim()).filter(Boolean);
  if (values.length === 0) return 0;
  const unique = new Set(values.map((value) => value.toLowerCase())).size;
  const stringish = values.filter((value) => /[a-zA-Z_]/.test(value)).length;
  const uniquenessRatio = unique / values.length;
  return values.length * 2 + uniquenessRatio * 5 + stringish;
}

function findHeaderRow(rows: unknown[][]): number {
  const candidates = rows.slice(0, 30);
  let bestIndex = 0;
  let bestScore = -Infinity;
  candidates.forEach((row, index) => {
    const score = scoreHeaderRow(row);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function normalizeColumnName(value: unknown, index: number): string {
  const raw = String(value ?? "").trim();
  return raw || `column_${index + 1}`;
}

function inferValueType(value: unknown): ColumnSchema["inferred_type"] {
  if (value === null || value === undefined || value === "") return "empty";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (value instanceof Date) return "date";
  const text = String(value).trim();
  if (!text) return "empty";
  if (!Number.isNaN(Number(text)) && text.match(/^-?\d+(\.\d+)?$/)) return "number";
  const timestamp = Date.parse(text);
  if (!Number.isNaN(timestamp) && /\d{4}|\d{1,2}[/-]\d{1,2}/.test(text)) return "date";
  return "string";
}

function mergeTypes(types: Set<ColumnSchema["inferred_type"]>): ColumnSchema["inferred_type"] {
  types.delete("empty");
  if (types.size === 0) return "empty";
  if (types.size === 1) return [...types][0];
  return "mixed";
}

function normalizeRows(rawRows: unknown[][]): { headerRowIndex: number; columns: string[]; records: Record<string, unknown>[] } {
  if (rawRows.length === 0) return { headerRowIndex: 0, columns: [], records: [] };
  const headerRowIndex = findHeaderRow(rawRows);
  const header = rawRows[headerRowIndex] ?? [];
  const columns = header.map(normalizeColumnName);
  const seen = new Map<string, number>();
  const uniqueColumns = columns.map((column) => {
    const normalized = slugify(column, "column").replace(/-/g, "_");
    const count = seen.get(normalized) ?? 0;
    seen.set(normalized, count + 1);
    return count === 0 ? normalized : `${normalized}_${count + 1}`;
  });
  const records = rawRows.slice(headerRowIndex + 1).map((row) => {
    const record: Record<string, unknown> = {};
    uniqueColumns.forEach((column, index) => {
      record[column] = row[index] ?? null;
    });
    return record;
  });
  return { headerRowIndex, columns: uniqueColumns, records };
}

function buildSchema(sheetId: string, sheetName: string, headerRowIndex: number, rows: Record<string, unknown>[]): SheetSchema {
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const schemas: ColumnSchema[] = columns.map((column) => {
    const types = new Set<ColumnSchema["inferred_type"]>();
    let nullCount = 0;
    const samples: unknown[] = [];
    for (const row of rows) {
      const value = row[column];
      const valueType = inferValueType(value);
      types.add(valueType);
      if (valueType === "empty") nullCount += 1;
      else if (samples.length < 5 && !samples.includes(value)) samples.push(value);
    }
    return {
      name: column,
      inferred_type: mergeTypes(types),
      null_count: nullCount,
      non_null_count: rows.length - nullCount,
      sample_values: samples,
    };
  });

  const confidence = columns.length === 0 ? "low" : headerRowIndex <= 5 && rows.length > 0 ? "high" : "medium";
  return {
    sheet_id: sheetId,
    sheet_name: sheetName,
    row_count: rows.length,
    column_count: columns.length,
    header_row_index: headerRowIndex + 1,
    table_confidence: confidence,
    columns: schemas,
  };
}

async function persistWorkbook(
  userId: string,
  sessionId: string,
  fileId: string,
  workbook: XLSX.WorkBook,
): Promise<ExtractionResult> {
  const root = extractedRoot(userId, sessionId, "excel", fileId);
  const sheetsRoot = path.join(root, "sheets");
  await ensureDir(sheetsRoot);

  const sheetIds = uniqueSheetIds(workbook.SheetNames);
  const workbookMeta = {
    file_id: fileId,
    sheet_count: workbook.SheetNames.length,
    sheets: workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : undefined;
      return {
        sheet_id: sheetIds.get(sheetName),
        sheet_name: sheetName,
        hidden: Boolean(workbook.Workbook?.Sheets?.find((entry) => entry.name === sheetName)?.Hidden),
        dimensions: range
          ? { first_row: range.s.r + 1, last_row: range.e.r + 1, first_col: range.s.c + 1, last_col: range.e.c + 1 }
          : null,
      };
    }),
  };
  await writeJson(path.join(root, "workbook.json"), workbookMeta);

  const warnings: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheetId = sheetIds.get(sheetName) ?? slugify(sheetName);
    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: null });
    const { headerRowIndex, columns, records } = normalizeRows(rawRows);
    const schema = buildSchema(sheetId, sheetName, headerRowIndex, records);
    if (schema.table_confidence === "low") warnings.push(`Sheet '${sheetName}' appears non-tabular or empty.`);

    await writeJson(path.join(sheetsRoot, `${sheetId}.schema.json`), schema);
    await writeText(path.join(sheetsRoot, `${sheetId}.preview.md`), toMarkdownTable(records, columns, 20));
    await writeText(path.join(sheetsRoot, `${sheetId}.rows.jsonl`), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  }

  return {
    status: warnings.length > 0 ? "partial" : "ready",
    derivedPaths: {
      workbook: relativeToSession(userId, sessionId, path.join(root, "workbook.json")),
      sheets_dir: relativeToSession(userId, sessionId, sheetsRoot),
    },
    warnings,
  };
}

export async function extractExcelWorkbook(
  userId: string,
  sessionId: string,
  fileId: string,
  sourcePath: string,
): Promise<ExtractionResult> {
  const workbook = XLSX.read(await fs.readFile(sourcePath), { type: "buffer", cellDates: true });
  return persistWorkbook(userId, sessionId, fileId, workbook);
}

export async function extractCsvLikeWorkbook(
  userId: string,
  sessionId: string,
  fileId: string,
  sourcePath: string,
): Promise<ExtractionResult> {
  const csv = await fs.readFile(sourcePath, "utf8");
  const workbook = XLSX.read(csv, { type: "string", raw: false });
  return persistWorkbook(userId, sessionId, fileId, workbook);
}
