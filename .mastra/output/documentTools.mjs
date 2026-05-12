import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import fs$1, { createReadStream } from 'node:fs';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { renderPageAsImage, getDocumentProxy, extractText } from 'unpdf';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import readline from 'node:readline';

const PROJECT_ROOT = path.resolve(process.cwd());
path.resolve(PROJECT_ROOT, "bpss_agentic_dataset");
const DATA_DIR = path.resolve(PROJECT_ROOT, "data");
path.resolve(PROJECT_ROOT, ".cache");
const PARSER_VERSION = "2026-05-11";
const DEFAULT_GEMINI_CHAT_MODEL = "gemini-3-flash-preview";
const DEFAULT_GEMINI_VISION_MODEL = "gemini-3.1-pro-preview";
const GEMINI_MODEL_ALIASES = /* @__PURE__ */ new Map([
  ["gemini-3-flash", "gemini-3-flash-preview"],
  ["gemini-pro", DEFAULT_GEMINI_CHAT_MODEL]
]);
function normalizeGeminiModel(configured, fallback) {
  if (!configured?.trim()) return fallback;
  const model = configured.replace(/^models\//, "");
  return GEMINI_MODEL_ALIASES.get(model) ?? model;
}
function getConfiguredGeminiChatModel() {
  return normalizeGeminiModel(process.env.GEMINI_MODEL, DEFAULT_GEMINI_CHAT_MODEL);
}
function getConfiguredGeminiVisionModel() {
  return normalizeGeminiModel(process.env.GEMINI_VISION_MODEL ?? process.env.GEMINI_MODEL, DEFAULT_GEMINI_VISION_MODEL);
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
async function sha256File(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}
async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}
async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}
`, "utf8");
  await fs.rename(temporaryPath, filePath);
}
async function writeText(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, value, "utf8");
}

function extensionOf(filePath) {
  return path.extname(filePath).toLowerCase();
}
function detectKind(filePath, mimeType) {
  const extension = extensionOf(filePath);
  if (extension === ".xlsx" || extension === ".xlsm" || extension === ".xls") return "excel";
  if (extension === ".csv") return "csv";
  if (extension === ".pdf") return "pdf";
  if (extension === ".pptx") return "pptx";
  if (extension === ".docx") return "docx";
  if (mimeType?.includes("spreadsheet")) return "excel";
  if (mimeType?.includes("presentation")) return "pptx";
  if (mimeType?.includes("pdf")) return "pdf";
  if (mimeType?.includes("wordprocessingml")) return "docx";
  return "unsupported";
}
function mimeForKind(kind) {
  switch (kind) {
    case "excel":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "csv":
      return "text/csv";
    case "pdf":
      return "application/pdf";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default:
      return "application/octet-stream";
  }
}

function sessionRoot(userId, sessionId) {
  return path.join(DATA_DIR, "users", userId, "sessions", sessionId);
}
function manifestPath(userId, sessionId) {
  return path.join(sessionRoot(userId, sessionId), "manifest.json");
}
function uploadDir(userId, sessionId, fileId) {
  return path.join(sessionRoot(userId, sessionId), "uploads", fileId);
}
function uploadPath(userId, sessionId, fileId, extension) {
  return path.join(uploadDir(userId, sessionId, fileId), `original${extension}`);
}
function extractedRoot(userId, sessionId, kind, fileId) {
  return path.join(sessionRoot(userId, sessionId), "extracted", kind, fileId);
}
function workspaceRoot(userId, sessionId) {
  return path.join(sessionRoot(userId, sessionId), "workspace");
}
function relativeToSession(userId, sessionId, filePath) {
  return path.relative(sessionRoot(userId, sessionId), filePath);
}

function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
async function loadOrCreateManifest(userId, sessionId) {
  const filePath = manifestPath(userId, sessionId);
  if (await fileExists(filePath)) {
    return readJson(filePath);
  }
  const manifest = {
    user_id: userId,
    session_id: sessionId,
    created_at: nowIso(),
    updated_at: nowIso(),
    files: []
  };
  await ensureDir(sessionRoot(userId, sessionId));
  await ensureDir(workspaceRoot(userId, sessionId));
  await saveManifest(manifest);
  return manifest;
}
async function saveManifest(manifest) {
  manifest.updated_at = nowIso();
  await writeJson(manifestPath(manifest.user_id, manifest.session_id), manifest);
}
async function upsertFile(manifest, file) {
  const index = manifest.files.findIndex((candidate) => candidate.file_id === file.file_id);
  if (index >= 0) manifest.files[index] = file;
  else manifest.files.push(file);
  await saveManifest(manifest);
  return manifest;
}
function getFileOrThrow(manifest, fileId) {
  const file = manifest.files.find((candidate) => candidate.file_id === fileId);
  if (!file) throw new Error(`No file '${fileId}' found in session '${manifest.session_id}'.`);
  return file;
}
async function updateFile(userId, sessionId, fileId, patch) {
  const manifest = await loadOrCreateManifest(userId, sessionId);
  const existing = getFileOrThrow(manifest, fileId);
  const updated = { ...existing, ...patch };
  await upsertFile(manifest, updated);
  return updated;
}

async function extractDocx(userId, sessionId, fileId, sourcePath) {
  const root = extractedRoot(userId, sessionId, "docx", fileId);
  const result = await mammoth.convertToMarkdown({ path: sourcePath });
  const markdownPath = path.join(root, "document.md");
  const structurePath = path.join(root, "structure.json");
  const chunksPath = path.join(root, "chunks.jsonl");
  const lines = result.value.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const chunks = lines.map((text, index) => ({ chunk_id: `docx_${String(index + 1).padStart(4, "0")}`, text }));
  await writeText(markdownPath, result.value.trim() + "\n");
  await writeJson(structurePath, {
    file_id: fileId,
    block_count: chunks.length,
    warnings: result.messages.map((message) => message.message)
  });
  await writeText(chunksPath, chunks.map((chunk) => JSON.stringify(chunk)).join("\n") + "\n");
  const warnings = result.messages.map((message) => message.message);
  return {
    status: warnings.length > 0 ? "partial" : "ready",
    derivedPaths: {
      markdown: relativeToSession(userId, sessionId, markdownPath),
      structure: relativeToSession(userId, sessionId, structurePath),
      chunks: relativeToSession(userId, sessionId, chunksPath)
    },
    warnings
  };
}

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}
function safeSnippet(text, maxLen = 240) {
  const t = normalizeWhitespace(text);
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}\u2026`;
}
function slugify(input, fallback = "sheet") {
  const slug = input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return slug || fallback;
}
function toMarkdownTable(rows, columns, limit = 20) {
  const visibleRows = rows.slice(0, limit);
  if (columns.length === 0) return "_No columns detected._\n";
  const clean = (value) => String(value ?? "").replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
  const header = `| ${columns.map(clean).join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = visibleRows.map((row) => `| ${columns.map((column) => clean(row[column])).join(" | ")} |`);
  return [header, divider, ...body].join("\n") + "\n";
}

function uniqueSheetIds(sheetNames) {
  const seen = /* @__PURE__ */ new Map();
  const result = /* @__PURE__ */ new Map();
  for (const name of sheetNames) {
    const base = slugify(name, "sheet");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    result.set(name, count === 0 ? base : `${base}-${count + 1}`);
  }
  return result;
}
function scoreHeaderRow(row) {
  const values = row.map((value) => String(value ?? "").trim()).filter(Boolean);
  if (values.length === 0) return 0;
  const unique = new Set(values.map((value) => value.toLowerCase())).size;
  const stringish = values.filter((value) => /[a-zA-Z_]/.test(value)).length;
  const uniquenessRatio = unique / values.length;
  return values.length * 2 + uniquenessRatio * 5 + stringish;
}
function findHeaderRow(rows) {
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
function normalizeColumnName(value, index) {
  const raw = String(value ?? "").trim();
  return raw || `column_${index + 1}`;
}
function inferValueType(value) {
  if (value === null || value === void 0 || value === "") return "empty";
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
function mergeTypes(types) {
  types.delete("empty");
  if (types.size === 0) return "empty";
  if (types.size === 1) return [...types][0];
  return "mixed";
}
function normalizeRows(rawRows) {
  if (rawRows.length === 0) return { headerRowIndex: 0, columns: [], records: [] };
  const headerRowIndex = findHeaderRow(rawRows);
  const header = rawRows[headerRowIndex] ?? [];
  const columns = header.map(normalizeColumnName);
  const seen = /* @__PURE__ */ new Map();
  const uniqueColumns = columns.map((column) => {
    const normalized = slugify(column, "column").replace(/-/g, "_");
    const count = seen.get(normalized) ?? 0;
    seen.set(normalized, count + 1);
    return count === 0 ? normalized : `${normalized}_${count + 1}`;
  });
  const records = rawRows.slice(headerRowIndex + 1).map((row) => {
    const record = {};
    uniqueColumns.forEach((column, index) => {
      record[column] = row[index] ?? null;
    });
    return record;
  });
  return { headerRowIndex, columns: uniqueColumns, records };
}
function buildSchema(sheetId, sheetName, headerRowIndex, rows) {
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const schemas = columns.map((column) => {
    const types = /* @__PURE__ */ new Set();
    let nullCount = 0;
    const samples = [];
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
      sample_values: samples
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
    columns: schemas
  };
}
async function persistWorkbook(userId, sessionId, fileId, workbook) {
  const root = extractedRoot(userId, sessionId, "excel", fileId);
  const sheetsRoot = path.join(root, "sheets");
  await ensureDir(sheetsRoot);
  const sheetIds = uniqueSheetIds(workbook.SheetNames);
  const workbookMeta = {
    file_id: fileId,
    sheet_count: workbook.SheetNames.length,
    sheets: workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : void 0;
      return {
        sheet_id: sheetIds.get(sheetName),
        sheet_name: sheetName,
        hidden: Boolean(workbook.Workbook?.Sheets?.find((entry) => entry.name === sheetName)?.Hidden),
        dimensions: range ? { first_row: range.s.r + 1, last_row: range.e.r + 1, first_col: range.s.c + 1, last_col: range.e.c + 1 } : null
      };
    })
  };
  await writeJson(path.join(root, "workbook.json"), workbookMeta);
  const warnings = [];
  for (const sheetName of workbook.SheetNames) {
    const sheetId = sheetIds.get(sheetName) ?? slugify(sheetName);
    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: null });
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
      sheets_dir: relativeToSession(userId, sessionId, sheetsRoot)
    },
    warnings
  };
}
async function extractExcelWorkbook(userId, sessionId, fileId, sourcePath) {
  const workbook = XLSX.read(await fs.readFile(sourcePath), { type: "buffer", cellDates: true });
  return persistWorkbook(userId, sessionId, fileId, workbook);
}
async function extractCsvLikeWorkbook(userId, sessionId, fileId, sourcePath) {
  const csv = await fs.readFile(sourcePath, "utf8");
  const workbook = XLSX.read(csv, { type: "string", raw: false });
  return persistWorkbook(userId, sessionId, fileId, workbook);
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    for (; ; ) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function envInt(name, fallback, min, max) {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}
function envFloat(name, fallback, min, max) {
  const raw = process.env[name];
  const parsed = raw ? Number.parseFloat(raw) : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}
function getPdfExtractionConfig() {
  return {
    renderScale: envFloat("PDF_RENDER_SCALE", 2, 0.5, 4),
    maxPages: envInt("PDF_MAX_PAGES", 250, 1, 5e3),
    pageConcurrency: envInt("PDF_PAGE_CONCURRENCY", 2, 1, 8),
    geminiModel: getConfiguredGeminiVisionModel(),
    geminiTimeoutMs: envInt("GEMINI_TIMEOUT_MS", 6e4, 1e3, 3e5),
    geminiRetries: envInt("GEMINI_RETRIES", 2, 0, 5),
    minTextCharsForTextFallback: envInt("PDF_MIN_TEXT_CHARS", 40, 0, 500)
  };
}

function isGeminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function isRetryableStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}
async function convertPageImageToMarkdown(input) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
  const model = input.model ?? getConfiguredGeminiVisionModel();
  const image = await fs.readFile(input.imagePath);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const prompt = [
    `Convert PDF page ${input.pageNumber} into faithful Markdown.`,
    "Preserve headings, bullets, tables, field labels, dates, IDs, and footnotes.",
    "Do not summarize. Do not invent missing text. If a region is unreadable, write [unreadable].",
    "Return only Markdown."
  ].join(" ");
  const retries = input.retries ?? 2;
  const timeoutMs = input.timeoutMs ?? 6e4;
  let lastError = null;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: "image/png",
                    data: image.toString("base64")
                  }
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0
          }
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        const message = payload.error?.message ?? `Gemini request failed with HTTP ${response.status}.`;
        if (attempt <= retries && isRetryableStatus(response.status)) {
          lastError = new Error(message);
          await sleep(500 * 2 ** (attempt - 1));
          continue;
        }
        throw new Error(message);
      }
      const markdown = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
      if (!markdown) throw new Error("Gemini returned no markdown text.");
      return { markdown, model, attempts: attempt };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt > retries) break;
      await sleep(500 * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError ?? new Error("Gemini request failed.");
}

async function renderPdfPageToPng(input) {
  const data = new Uint8Array(await fs.readFile(input.sourcePath));
  const image = await renderPageAsImage(data, input.pageNumber, {
    scale: input.scale ?? 2,
    canvasImport: () => import('@napi-rs/canvas')
  });
  const bytes = Buffer.from(image);
  await fs.writeFile(input.outputPath, bytes);
  return {
    byteLength: bytes.byteLength
  };
}

async function extractPdf(userId, sessionId, fileId, sourcePath) {
  const root = extractedRoot(userId, sessionId, "pdf", fileId);
  const pagesRoot = path.join(root, "pages");
  await ensureDir(pagesRoot);
  const config = getPdfExtractionConfig();
  const pdf = await getDocumentProxy(new Uint8Array(await fs.readFile(sourcePath)));
  const extracted = await extractText(pdf, { mergePages: false });
  const pagesToProcess = Array.from(
    { length: Math.min(extracted.totalPages, config.maxPages) },
    (_, index) => index + 1
  );
  async function processPage(pageNumber) {
    const pageId = `page_${String(pageNumber).padStart(3, "0")}`;
    const markdownPath = path.join(pagesRoot, `${pageId}.md`);
    const structurePath = path.join(pagesRoot, `${pageId}.structure.json`);
    const imagePath = path.join(pagesRoot, `${pageId}.png`);
    const text = normalizeWhitespace(extracted.text[pageNumber - 1] ?? "");
    const pageWarnings = [];
    let markdownSource = text ? "unpdf_text" : "empty";
    let markdown = [`# Page ${pageNumber}`, "", text || "_No extractable text found on this page._", ""].join("\n");
    let render = null;
    let geminiModel = null;
    let geminiAttempts = 0;
    try {
      render = await renderPdfPageToPng({ sourcePath, pageNumber, outputPath: imagePath, scale: config.renderScale });
    } catch (error) {
      pageWarnings.push(`Page PNG rendering failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (render && isGeminiConfigured()) {
      try {
        const gemini = await convertPageImageToMarkdown({
          imagePath,
          pageNumber,
          model: config.geminiModel,
          timeoutMs: config.geminiTimeoutMs,
          retries: config.geminiRetries
        });
        markdown = gemini.markdown.endsWith("\n") ? gemini.markdown : `${gemini.markdown}
`;
        markdownSource = "gemini_vision";
        geminiModel = gemini.model;
        geminiAttempts = gemini.attempts;
      } catch (error) {
        pageWarnings.push(`Gemini vision markdown failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (render) {
      pageWarnings.push("Gemini vision markdown skipped because GEMINI_API_KEY is not configured.");
    }
    if (!text && markdownSource !== "gemini_vision") {
      pageWarnings.push("No embedded text was available; page requires successful vision extraction for reliable Markdown.");
    } else if (text.length < config.minTextCharsForTextFallback && markdownSource !== "gemini_vision") {
      pageWarnings.push("Embedded text is sparse; vision extraction is recommended for reliable Markdown.");
    }
    await writeText(markdownPath, markdown);
    await writeJson(structurePath, {
      page_number: pageNumber,
      text_length: text.length,
      image_path: render ? relativeToSession(userId, sessionId, imagePath) : null,
      render,
      markdown_source: markdownSource,
      gemini_model: geminiModel,
      gemini_attempts: geminiAttempts,
      warnings: pageWarnings
    });
    return {
      page_number: pageNumber,
      markdown,
      markdownPath,
      structurePath,
      imagePath: render ? imagePath : null,
      markdownSource,
      rendered: Boolean(render),
      geminiSucceeded: markdownSource === "gemini_vision",
      warnings: pageWarnings
    };
  }
  const pageResults = await mapWithConcurrency(pagesToProcess, config.pageConcurrency, (pageNumber) => processPage(pageNumber));
  const allMarkdown = pageResults.map((page) => page.markdown);
  const renderedPages = pageResults.filter((page) => page.rendered).length;
  const geminiPages = pageResults.filter((page) => page.geminiSucceeded).length;
  const warnings = pageResults.flatMap((page) => page.warnings.map((warning) => `Page ${page.page_number}: ${warning}`));
  if (extracted.totalPages > config.maxPages) {
    warnings.push(`PDF has ${extracted.totalPages} pages; only first ${config.maxPages} pages were processed due to PDF_MAX_PAGES.`);
  }
  const pages = pageResults.map((page) => ({
    page_number: page.page_number,
    markdown: relativeToSession(userId, sessionId, page.markdownPath),
    structure: relativeToSession(userId, sessionId, page.structurePath),
    image: page.imagePath ? relativeToSession(userId, sessionId, page.imagePath) : null,
    markdown_source: page.markdownSource
  }));
  const documentPath = path.join(root, "document.md");
  const documentJsonPath = path.join(root, "document.json");
  await writeText(documentPath, allMarkdown.join("\n"));
  await writeJson(documentJsonPath, {
    file_id: fileId,
    page_count: extracted.totalPages,
    processed_pages: pagesToProcess.length,
    rendered_pages: renderedPages,
    gemini_markdown_pages: geminiPages,
    config: {
      render_scale: config.renderScale,
      max_pages: config.maxPages,
      page_concurrency: config.pageConcurrency,
      gemini_model: config.geminiModel,
      gemini_timeout_ms: config.geminiTimeoutMs,
      gemini_retries: config.geminiRetries
    },
    pages,
    warnings
  });
  const status = warnings.length === 0 ? "ready" : "partial";
  return {
    status,
    derivedPaths: {
      markdown: relativeToSession(userId, sessionId, documentPath),
      document: relativeToSession(userId, sessionId, documentJsonPath),
      pages_dir: relativeToSession(userId, sessionId, pagesRoot)
    },
    warnings
  };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "text"
});
function collectText(node) {
  if (!node || typeof node !== "object") return [];
  const record = node;
  const ownText = typeof record.text === "string" ? [record.text] : [];
  return Object.values(record).reduce((acc, value) => {
    if (typeof value === "object") acc.push(...collectText(value));
    return acc;
  }, ownText);
}
async function readXml(zip, filePath) {
  const file = zip.file(filePath);
  if (!file) return null;
  return parser.parse(await file.async("text"));
}
function extractSlideNumber(fileName) {
  const match = fileName.match(/slide(\d+)\.xml$/);
  return match ? Number(match[1]) : 0;
}
async function extractChart(zip, chartPath, chartId, chartsRoot) {
  const chartXml = await readXml(zip, chartPath);
  const text = normalizeWhitespace(collectText(chartXml).join(" "));
  const chart = {
    chart_id: chartId,
    source_part: chartPath,
    data_status: text ? "partial_xml_text" : "unavailable",
    extracted_text: text,
    warning: "Native chart XML was parsed best-effort; embedded workbook extraction is not implemented in V1."
  };
  const output = path.join(chartsRoot, `${chartId}.json`);
  await writeJson(output, chart);
  return output;
}
async function extractPptx(userId, sessionId, fileId, sourcePath) {
  const root = extractedRoot(userId, sessionId, "pptx", fileId);
  const slidesRoot = path.join(root, "slides");
  const mediaRoot = path.join(root, "media");
  const chartsRoot = path.join(root, "charts");
  await ensureDir(slidesRoot);
  await ensureDir(mediaRoot);
  await ensureDir(chartsRoot);
  const zip = await JSZip.loadAsync(await fs.readFile(sourcePath));
  const slideFiles = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((left, right) => extractSlideNumber(left) - extractSlideNumber(right));
  const mediaFiles = Object.keys(zip.files).filter((name) => /^ppt\/media\//.test(name));
  const extractedMedia = [];
  for (const mediaFile of mediaFiles) {
    const file = zip.file(mediaFile);
    if (!file) continue;
    const outputPath = path.join(mediaRoot, path.basename(mediaFile));
    await fs.writeFile(outputPath, await file.async("nodebuffer"));
    extractedMedia.push(relativeToSession(userId, sessionId, outputPath));
  }
  const chartFiles = Object.keys(zip.files).filter((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name));
  const charts = [];
  for (const [index, chartFile] of chartFiles.entries()) {
    const chartId = `chart_${String(index + 1).padStart(3, "0")}`;
    const output = await extractChart(zip, chartFile, chartId, chartsRoot);
    charts.push({ chart_id: chartId, path: relativeToSession(userId, sessionId, output), source_part: chartFile });
  }
  const slides = [];
  for (const [index, slideFile] of slideFiles.entries()) {
    const slideNumber = index + 1;
    const slideId = `slide_${String(slideNumber).padStart(3, "0")}`;
    const slideXml = await readXml(zip, slideFile);
    const texts = collectText(slideXml).map(normalizeWhitespace).filter(Boolean);
    const title = texts[0] ?? `Slide ${slideNumber}`;
    const markdownPath = path.join(slidesRoot, `${slideId}.md`);
    const structurePath = path.join(slidesRoot, `${slideId}.structure.json`);
    const markdown = [
      `# Slide ${slideNumber}: ${title}`,
      "",
      "## Text",
      ...texts.length ? texts.map((text) => `- ${text}`) : ["_No extractable text found._"],
      "",
      "## Images",
      extractedMedia.length ? "_Images are extracted at deck level; relationship-level slide mapping is best-effort in V1._" : "_No embedded images extracted._",
      "",
      "## Charts",
      charts.length ? charts.map((chart) => `- ${chart.path}: ${chart.source_part}`).join("\n") : "_No native chart XML detected._",
      "",
      "## Warnings",
      "- Slide rendering is not enabled in this local runtime.",
      ""
    ].join("\n");
    await writeText(markdownPath, markdown);
    await writeJson(structurePath, {
      slide_number: slideNumber,
      source_part: slideFile,
      title_candidate: title,
      render_path: null,
      object_count: texts.length,
      objects: texts.map((text, objectIndex) => ({
        object_id: `text_${String(objectIndex + 1).padStart(3, "0")}`,
        type: "text",
        text
      })),
      warnings: ["Slide rendering and precise relationship-level object geometry are not implemented in V1."]
    });
    slides.push({
      slide_number: slideNumber,
      title,
      markdown: relativeToSession(userId, sessionId, markdownPath),
      structure: relativeToSession(userId, sessionId, structurePath)
    });
  }
  const deckPath = path.join(root, "deck.json");
  const warnings = ["PPTX extraction is XML-based; slide PNG rendering and precise geometry are optional future stages."];
  await writeJson(deckPath, {
    file_id: fileId,
    slide_count: slideFiles.length,
    media_count: extractedMedia.length,
    chart_count: charts.length,
    slides,
    media: extractedMedia,
    charts,
    warnings
  });
  return {
    status: "partial",
    derivedPaths: {
      deck: relativeToSession(userId, sessionId, deckPath),
      slides_dir: relativeToSession(userId, sessionId, slidesRoot),
      media_dir: relativeToSession(userId, sessionId, mediaRoot),
      charts_dir: relativeToSession(userId, sessionId, chartsRoot)
    },
    warnings
  };
}

function documentTypeForEvidence(file) {
  return file.kind === "unsupported" ? null : file.kind;
}
function buildEvidencePacket(input) {
  const documentType = documentTypeForEvidence(input.file);
  if (!documentType) throw new Error(`Unsupported file '${input.file.file_id}' cannot produce evidence.`);
  return {
    evidenceId: input.evidenceId,
    source: {
      userId: input.userId,
      sessionId: input.sessionId,
      fileId: input.file.file_id,
      originalFilename: input.file.original_filename,
      documentType
    },
    locator: input.locator ?? {},
    content: input.content,
    score: input.score,
    extractionStatus: input.file.status,
    warnings: input.warnings ?? input.file.warnings
  };
}

const DEFAULT_LIMIT$1 = 10;
function textIndexRoot(userId, sessionId) {
  return path.join(sessionRoot(userId, sessionId), "indexes", "text");
}
function textIndexPath(userId, sessionId, fileId) {
  return path.join(textIndexRoot(userId, sessionId), `${fileId}.chunks.jsonl`);
}
function resolveSessionPath$1(userId, sessionId, relativePath) {
  return path.join(sessionRoot(userId, sessionId), relativePath);
}
function splitMarkdownBlocks(markdown) {
  return markdown.split(/\n{2,}/).map((block) => normalizeWhitespace(block)).filter(Boolean);
}
function scoreText(text, terms) {
  const lower = text.toLowerCase();
  return terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0);
}
async function recordsFromMarkdownFile(input) {
  const markdown = await fs.readFile(resolveSessionPath$1(input.userId, input.sessionId, input.relativePath), "utf8");
  return splitMarkdownBlocks(markdown).map((text, index) => ({
    chunkId: `${input.chunkPrefix}_${String(index + 1).padStart(4, "0")}`,
    fileId: input.file.file_id,
    originalFilename: input.file.original_filename,
    documentType: input.file.kind,
    locator: { ...input.locator, blockId: `${input.chunkPrefix}_${String(index + 1).padStart(4, "0")}` },
    text,
    searchText: text.toLowerCase(),
    warnings: input.file.warnings
  }));
}
async function recordsFromPdf(input) {
  const documentPath = input.file.derived_paths.document;
  if (typeof documentPath !== "string") return [];
  const document = await readJson(resolveSessionPath$1(input.userId, input.sessionId, documentPath));
  const records = [];
  for (const page of document.pages ?? []) {
    const pageRecords = await recordsFromMarkdownFile({
      userId: input.userId,
      sessionId: input.sessionId,
      file: input.file,
      relativePath: page.markdown,
      locator: { page: page.page_number },
      chunkPrefix: `page_${String(page.page_number).padStart(3, "0")}`
    });
    records.push(...pageRecords);
  }
  return records;
}
async function recordsFromPptx(input) {
  const deckPath = input.file.derived_paths.deck;
  if (typeof deckPath !== "string") return [];
  const deck = await readJson(resolveSessionPath$1(input.userId, input.sessionId, deckPath));
  const records = [];
  for (const slide of deck.slides ?? []) {
    const slideRecords = await recordsFromMarkdownFile({
      userId: input.userId,
      sessionId: input.sessionId,
      file: input.file,
      relativePath: slide.markdown,
      locator: { slide: slide.slide_number },
      chunkPrefix: `slide_${String(slide.slide_number).padStart(3, "0")}`
    });
    records.push(...slideRecords);
  }
  return records;
}
async function buildTextIndexForFile(input) {
  if (input.file.kind === "excel" || input.file.kind === "csv" || input.file.kind === "unsupported") {
    return { records: 0, warnings: [] };
  }
  let records = [];
  if (input.file.kind === "pdf") records = await recordsFromPdf(input);
  else if (input.file.kind === "pptx") records = await recordsFromPptx(input);
  else if (typeof input.file.derived_paths.markdown === "string") {
    records = await recordsFromMarkdownFile({
      userId: input.userId,
      sessionId: input.sessionId,
      file: input.file,
      relativePath: input.file.derived_paths.markdown,
      locator: {},
      chunkPrefix: "block"
    });
  }
  if (records.length === 0) return { records: 0, warnings: [`No text chunks were indexed for ${input.file.file_id}.`] };
  const outputPath = textIndexPath(input.userId, input.sessionId, input.file.file_id);
  await ensureDir(path.dirname(outputPath));
  await writeText(outputPath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  return {
    path: path.relative(sessionRoot(input.userId, input.sessionId), outputPath),
    records: records.length,
    warnings: []
  };
}
async function readTextIndex(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return raw.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
}
async function searchTextEvidence(input) {
  const manifest = await loadOrCreateManifest(input.userId, input.sessionId);
  const files = input.fileId ? [getFileOrThrow(manifest, input.fileId)] : manifest.files;
  const terms = input.query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = [];
  for (const file of files) {
    if (file.kind === "unsupported") continue;
    let indexPath = textIndexPath(input.userId, input.sessionId, file.file_id);
    if (!await fileExists(indexPath)) {
      const indexResult = await buildTextIndexForFile({ userId: input.userId, sessionId: input.sessionId, file });
      if (!indexResult.path) continue;
      indexPath = resolveSessionPath$1(input.userId, input.sessionId, indexResult.path);
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
            text: safeSnippet(record.text, 520)
          },
          score,
          warnings: record.warnings
        })
      );
    }
  }
  return matches.sort((left, right) => (right.score ?? 0) - (left.score ?? 0)).slice(0, input.limit ?? DEFAULT_LIMIT$1);
}

async function buildRetrievalIndexesForFile(input) {
  const textIndex = await buildTextIndexForFile(input);
  return {
    derivedPaths: textIndex.path ? { text_index: textIndex.path } : {},
    warnings: textIndex.warnings
  };
}

async function runExtractor(job) {
  if (job.kind === "excel") return extractExcelWorkbook(job.userId, job.sessionId, job.fileId, job.sourcePath);
  if (job.kind === "csv") return extractCsvLikeWorkbook(job.userId, job.sessionId, job.fileId, job.sourcePath);
  if (job.kind === "docx") return extractDocx(job.userId, job.sessionId, job.fileId, job.sourcePath);
  if (job.kind === "pdf") return extractPdf(job.userId, job.sessionId, job.fileId, job.sourcePath);
  return extractPptx(job.userId, job.sessionId, job.fileId, job.sourcePath);
}
async function processExtractDocumentJob(job) {
  await updateFile(job.userId, job.sessionId, job.fileId, { status: "extracting" });
  try {
    const extraction = await runExtractor(job);
    const extractedFile = await updateFile(job.userId, job.sessionId, job.fileId, {
      status: "indexing",
      extracted_at: (/* @__PURE__ */ new Date()).toISOString(),
      derived_paths: extraction.derivedPaths,
      warnings: extraction.warnings,
      error: extraction.error
    });
    const indexResult = await buildRetrievalIndexesForFile({
      userId: job.userId,
      sessionId: job.sessionId,
      file: extractedFile
    });
    return updateFile(job.userId, job.sessionId, job.fileId, {
      status: extraction.status,
      derived_paths: {
        ...extractedFile.derived_paths,
        ...indexResult.derivedPaths
      },
      warnings: [...extraction.warnings, ...indexResult.warnings],
      error: extraction.error
    });
  } catch (error) {
    return updateFile(job.userId, job.sessionId, job.fileId, {
      status: "failed",
      extracted_at: (/* @__PURE__ */ new Date()).toISOString(),
      warnings: [],
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    const manifest = await loadOrCreateManifest(job.userId, job.sessionId);
    getFileOrThrow(manifest, job.fileId);
  }
}

class LocalDocumentJobQueue {
  constructor(concurrency = Number(process.env.DOCUMENT_WORKER_CONCURRENCY ?? 1)) {
    this.concurrency = concurrency;
  }
  concurrency;
  queue = [];
  states = /* @__PURE__ */ new Map();
  activeCount = 0;
  enqueue(job) {
    if (this.states.has(job.jobId)) return job.jobId;
    let resolve;
    let reject;
    const promise = new Promise((promiseResolve, promiseReject) => {
      resolve = promiseResolve;
      reject = promiseReject;
    });
    this.states.set(job.jobId, {
      job,
      status: "queued",
      resolve,
      reject,
      promise
    });
    this.queue.push(job);
    this.drain();
    return job.jobId;
  }
  getStatus(jobId) {
    const state = this.states.get(jobId);
    if (!state) return void 0;
    return {
      jobId,
      status: state.status,
      fileId: state.job.fileId,
      error: state.error?.message
    };
  }
  async wait(jobId) {
    const state = this.states.get(jobId);
    if (!state) throw new Error(`Unknown document job '${jobId}'.`);
    return state.promise;
  }
  drain() {
    while (this.activeCount < Math.max(1, this.concurrency) && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) return;
      const state = this.states.get(job.jobId);
      if (!state) continue;
      state.status = "running";
      this.activeCount += 1;
      processExtractDocumentJob(job).then((result) => {
        state.status = "succeeded";
        state.result = result;
        state.resolve(result);
      }).catch((error) => {
        state.status = "failed";
        state.error = error instanceof Error ? error : new Error(String(error));
        state.reject(state.error);
      }).finally(() => {
        this.activeCount -= 1;
        this.drain();
      });
    }
  }
}
const documentJobQueue = new LocalDocumentJobQueue();

function createExtractDocumentJob(input) {
  return {
    ...input,
    jobId: `extract_${input.fileId}_${Date.now()}`,
    queuedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}

async function initializeUpload(input) {
  const manifest = await loadOrCreateManifest(input.userId, input.sessionId);
  const stat = await fs.stat(input.sourcePath);
  const sha256 = await sha256File(input.sourcePath);
  const fileId = sha256.slice(0, 24);
  const kind = detectKind(input.sourcePath, input.mimeType);
  const extension = extensionOf(input.sourcePath) || ".bin";
  const destination = uploadPath(input.userId, input.sessionId, fileId, extension);
  const existing = manifest.files.find((candidate) => candidate.file_id === fileId);
  if (existing && existing.parser?.version === PARSER_VERSION && (existing.status === "ready" || existing.status === "partial") && await fileExists(existing.upload_path)) {
    return { manifest, file: existing };
  }
  await ensureDir(path.dirname(destination));
  try {
    await fs.copyFile(input.sourcePath, destination, fs.constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const uploadedAt = (/* @__PURE__ */ new Date()).toISOString();
  let file = {
    file_id: fileId,
    original_filename: input.originalFilename ?? path.basename(input.sourcePath),
    mime_type: input.mimeType ?? mimeForKind(kind),
    kind,
    size_bytes: stat.size,
    sha256,
    status: kind === "unsupported" ? "unsupported" : "queued",
    uploaded_at: uploadedAt,
    parser: { name: "document-harness", version: PARSER_VERSION },
    upload_path: destination,
    derived_paths: {},
    warnings: []
  };
  await upsertFile(manifest, file);
  if (kind === "unsupported") {
    file = {
      ...file,
      error: `Unsupported file type '${extension}'.`
    };
    await upsertFile(await loadOrCreateManifest(input.userId, input.sessionId), file);
    return { manifest: await loadOrCreateManifest(input.userId, input.sessionId), file };
  }
  const job = createExtractDocumentJob({
    userId: input.userId,
    sessionId: input.sessionId,
    fileId,
    kind,
    sourcePath: destination
  });
  const jobId = documentJobQueue.enqueue(job);
  return { manifest: await loadOrCreateManifest(input.userId, input.sessionId), file, jobId };
}

function resolveSessionPath(userId, sessionId, relativePath) {
  return path.join(sessionRoot(userId, sessionId), relativePath);
}
async function getManifest(input) {
  return loadOrCreateManifest(input.userId, input.sessionId);
}
async function getDocumentStatus(input) {
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
    error: file.error
  }));
}
async function getMarkdown(input) {
  const manifest = await loadOrCreateManifest(input.userId, input.sessionId);
  const file = getFileOrThrow(manifest, input.fileId);
  const markdownPath = file.derived_paths.markdown;
  if (typeof markdownPath !== "string") throw new Error(`File '${input.fileId}' does not expose a markdown artifact.`);
  return fs.readFile(resolveSessionPath(input.userId, input.sessionId, markdownPath), "utf8");
}
async function searchDocuments(input) {
  return searchTextEvidence(input);
}
async function listPptxSlides(input) {
  const manifest = await loadOrCreateManifest(input.userId, input.sessionId);
  const file = getFileOrThrow(manifest, input.fileId);
  const deckPath = file.derived_paths.deck;
  if (typeof deckPath !== "string") throw new Error(`File '${input.fileId}' does not expose a deck artifact.`);
  const raw = await fs.readFile(resolveSessionPath(input.userId, input.sessionId, deckPath), "utf8");
  return JSON.parse(raw);
}
async function getPptxSlideMarkdown(input) {
  const slideId = `slide_${String(input.slideNumber).padStart(3, "0")}`;
  const filePath = path.join(sessionRoot(input.userId, input.sessionId), "extracted", "pptx", input.fileId, "slides", `${slideId}.md`);
  return fs.readFile(filePath, "utf8");
}
async function getPptxSlideStructure(input) {
  const slideId = `slide_${String(input.slideNumber).padStart(3, "0")}`;
  const filePath = path.join(sessionRoot(input.userId, input.sessionId), "extracted", "pptx", input.fileId, "slides", `${slideId}.structure.json`);
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}
async function getChartData(input) {
  const filePath = path.join(sessionRoot(input.userId, input.sessionId), "extracted", "pptx", input.fileId, "charts", `${input.chartId}.json`);
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

const DEFAULT_LIMIT = 50;
const HARD_CELL_CAP = 5e3;
function excelRoot(userId, sessionId, fileId) {
  return path.join(sessionRoot(userId, sessionId), "extracted", "excel", fileId);
}
function sheetPath(userId, sessionId, fileId, sheetId, suffix) {
  return path.join(excelRoot(userId, sessionId, fileId), "sheets", `${sheetId}.${suffix}`);
}
function compareValues(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)) return leftNumber - rightNumber;
  return String(left ?? "").localeCompare(String(right ?? ""));
}
function matchesFilter(row, filter) {
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
async function readRows(filePath) {
  const rows = [];
  const stream = fs$1.createReadStream(filePath, "utf8");
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim()) rows.push(JSON.parse(line));
  }
  return rows;
}
async function readNumberedRows(filePath) {
  const rows = [];
  const stream = fs$1.createReadStream(filePath, "utf8");
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let rowNumber = 1;
  for await (const line of rl) {
    if (line.trim()) rows.push({ rowNumber, row: JSON.parse(line) });
    rowNumber += 1;
  }
  return rows;
}
async function listDocuments(input) {
  const manifest = await loadOrCreateManifest(input.userId, input.sessionId);
  return manifest.files.map((file) => ({
    fileId: file.file_id,
    originalFilename: file.original_filename,
    kind: file.kind,
    status: file.status,
    warnings: file.warnings,
    error: file.error
  }));
}
async function listSheets(input) {
  const manifest = await loadOrCreateManifest(input.userId, input.sessionId);
  getFileOrThrow(manifest, input.fileId);
  const workbook = await readJson(path.join(excelRoot(input.userId, input.sessionId, input.fileId), "workbook.json"));
  return workbook;
}
async function getSchema(input) {
  return readJson(sheetPath(input.userId, input.sessionId, input.fileId, input.sheetId, "schema.json"));
}
async function previewRows(input) {
  const rows = await readRows(sheetPath(input.userId, input.sessionId, input.fileId, input.sheetId, "rows.jsonl"));
  const offset = input.offset ?? 0;
  const limit = Math.max(0, Math.min(input.limit ?? 20, DEFAULT_LIMIT));
  const selectedRows = rows.slice(offset, offset + limit).map((row) => selectColumns(row, input.columns));
  return { offset, limit, returned: selectedRows.length, rows: selectedRows };
}
function selectColumns(row, columns) {
  if (!columns || columns.length === 0) return row;
  return Object.fromEntries(columns.map((column) => [column, row[column] ?? null]));
}
async function queryRows(input) {
  const manifest = await loadOrCreateManifest(input.userId, input.sessionId);
  const file = getFileOrThrow(manifest, input.fileId);
  const allRows = await readNumberedRows(sheetPath(input.userId, input.sessionId, input.fileId, input.sheetId, "rows.jsonl"));
  const filtered = input.filters?.length ? allRows.filter((item) => input.filters?.every((filter) => matchesFilter(item.row, filter))) : allRows;
  if (input.sort) {
    filtered.sort((left, right) => compareValues(left.row[input.sort.column], right.row[input.sort.column]));
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
    evidence: selected.map(
      (item) => buildEvidencePacket({
        userId: input.userId,
        sessionId: input.sessionId,
        file,
        evidenceId: `${input.fileId}:${input.sheetId}:row_${item.rowNumber}`,
        locator: { sheetId: input.sheetId, rowNumber: item.rowNumber },
        content: { row: selectColumns(item.row, input.select) }
      })
    )
  };
}
async function describe(input) {
  const schema = await getSchema(input);
  const rows = await readRows(sheetPath(input.userId, input.sessionId, input.fileId, input.sheetId, "rows.jsonl"));
  const columns = input.columns?.length ? input.columns : schema.columns.map((column) => column.name);
  const stats = columns.map((column) => {
    const values = rows.map((row) => row[column]).filter((value) => value !== null && value !== void 0 && value !== "");
    const numbers = values.map(Number).filter((value) => !Number.isNaN(value));
    return {
      column,
      count: values.length,
      nullCount: rows.length - values.length,
      uniqueCount: new Set(values.map(String)).size,
      min: numbers.length ? Math.min(...numbers) : void 0,
      max: numbers.length ? Math.max(...numbers) : void 0,
      mean: numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : void 0
    };
  });
  return { rowCount: rows.length, stats };
}

const sessionSchema = {
  userId: z.string().min(1),
  sessionId: z.string().min(1)
};
const documentsInitializeUploadTool = createTool({
  id: "documents.initializeUpload",
  description: "Store an uploaded document, enqueue asynchronous extraction, and return the queued file status.",
  inputSchema: z.object({
    ...sessionSchema,
    sourcePath: z.string().min(1),
    originalFilename: z.string().optional(),
    mimeType: z.string().optional()
  }),
  execute: async (input) => initializeUpload(input)
});
const documentsListTool = createTool({
  id: "documents.list",
  description: "List uploaded files in a user session with readiness status.",
  inputSchema: z.object(sessionSchema),
  execute: async (input) => listDocuments(input)
});
const documentsGetManifestTool = createTool({
  id: "documents.getManifest",
  description: "Return the source-of-truth manifest for a session.",
  inputSchema: z.object(sessionSchema),
  execute: async (input) => getManifest(input)
});
const documentsGetStatusTool = createTool({
  id: "documents.getStatus",
  description: "Return extraction/indexing status for one file or all files in a user session.",
  inputSchema: z.object({ ...sessionSchema, fileId: z.string().optional() }),
  execute: async (input) => getDocumentStatus(input)
});
const documentsGetMarkdownTool = createTool({
  id: "documents.getMarkdown",
  description: "Return bounded markdown for a document that exposes a markdown artifact.",
  inputSchema: z.object({ ...sessionSchema, fileId: z.string().min(1) }),
  execute: async (input) => getMarkdown(input)
});
const documentsSearchTextTool = createTool({
  id: "documents.searchText",
  description: "Search persisted text indexes and return structured evidence packets with citations.",
  inputSchema: z.object({ ...sessionSchema, fileId: z.string().optional(), query: z.string().min(1), limit: z.number().int().positive().optional() }),
  execute: async (input) => searchDocuments(input)
});
const excelListSheetsTool = createTool({
  id: "excel.listSheets",
  description: "List sheets and workbook metadata for an extracted Excel or CSV file.",
  inputSchema: z.object({ ...sessionSchema, fileId: z.string().min(1) }),
  execute: async (input) => listSheets(input)
});
const excelGetSchemaTool = createTool({
  id: "excel.getSchema",
  description: "Return persisted sheet schema including inferred types and null counts.",
  inputSchema: z.object({ ...sessionSchema, fileId: z.string().min(1), sheetId: z.string().min(1) }),
  execute: async (input) => getSchema(input)
});
const excelPreviewRowsTool = createTool({
  id: "excel.previewRows",
  description: "Return a bounded preview from a persisted JSONL row store.",
  inputSchema: z.object({
    ...sessionSchema,
    fileId: z.string().min(1),
    sheetId: z.string().min(1),
    limit: z.number().int().nonnegative().optional(),
    offset: z.number().int().nonnegative().optional(),
    columns: z.array(z.string()).optional()
  }),
  execute: async (input) => previewRows(input)
});
const excelQueryRowsTool = createTool({
  id: "excel.queryRows",
  description: "Perform bounded structured retrieval over persisted sheet rows.",
  inputSchema: z.object({
    ...sessionSchema,
    fileId: z.string().min(1),
    sheetId: z.string().min(1),
    select: z.array(z.string()).optional(),
    filters: z.array(z.object({ column: z.string(), op: z.enum(["=", "!=", "<", "<=", ">", ">=", "contains", "in"]), value: z.any() })).optional(),
    sort: z.object({ column: z.string(), direction: z.enum(["asc", "desc"]).optional() }).optional(),
    limit: z.number().int().positive().optional()
  }),
  execute: async (input) => queryRows(input)
});
const excelDescribeTool = createTool({
  id: "excel.describe",
  description: "Return pandas-style summary stats for selected sheet columns.",
  inputSchema: z.object({ ...sessionSchema, fileId: z.string().min(1), sheetId: z.string().min(1), columns: z.array(z.string()).optional() }),
  execute: async (input) => describe(input)
});
const pptxListSlidesTool = createTool({
  id: "pptx.listSlides",
  description: "List slide metadata, extracted markdown paths, and warnings for a PPTX deck.",
  inputSchema: z.object({ ...sessionSchema, fileId: z.string().min(1) }),
  execute: async (input) => listPptxSlides(input)
});
const pptxGetSlideMarkdownTool = createTool({
  id: "pptx.getSlideMarkdown",
  description: "Return LLM-readable markdown for one slide.",
  inputSchema: z.object({ ...sessionSchema, fileId: z.string().min(1), slideNumber: z.number().int().positive() }),
  execute: async (input) => getPptxSlideMarkdown(input)
});
const pptxGetSlideStructureTool = createTool({
  id: "pptx.getSlideStructure",
  description: "Return structured object metadata for one slide.",
  inputSchema: z.object({ ...sessionSchema, fileId: z.string().min(1), slideNumber: z.number().int().positive() }),
  execute: async (input) => getPptxSlideStructure(input)
});
const pptxGetChartDataTool = createTool({
  id: "pptx.getChartData",
  description: "Return best-effort native PowerPoint chart data extraction.",
  inputSchema: z.object({ ...sessionSchema, fileId: z.string().min(1), chartId: z.string().min(1) }),
  execute: async (input) => getChartData(input)
});
const documentHarnessTools = {
  documentsInitializeUploadTool,
  documentsListTool,
  documentsGetManifestTool,
  documentsGetStatusTool,
  documentsGetMarkdownTool,
  documentsSearchTextTool,
  excelListSheetsTool,
  excelGetSchemaTool,
  excelPreviewRowsTool,
  excelQueryRowsTool,
  excelDescribeTool,
  pptxListSlidesTool,
  pptxGetSlideMarkdownTool,
  pptxGetSlideStructureTool,
  pptxGetChartDataTool
};

export { DATA_DIR as D, documentsGetStatusTool as a, documentsListTool as b, pptxGetSlideStructureTool as c, documentsSearchTextTool as d, pptxGetSlideMarkdownTool as e, pptxListSlidesTool as f, getConfiguredGeminiChatModel as g, excelDescribeTool as h, excelQueryRowsTool as i, excelPreviewRowsTool as j, excelGetSchemaTool as k, excelListSheetsTool as l, documentsGetMarkdownTool as m, documentsGetManifestTool as n, documentHarnessTools as o, pptxGetChartDataTool as p, documentsInitializeUploadTool as q };
