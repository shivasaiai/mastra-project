import path from "node:path";
import fs from "node:fs/promises";
import { extractText, getDocumentProxy } from "unpdf";
import { extractedRoot, relativeToSession } from "../document-store/paths.js";
import { ensureDir, writeJson, writeText } from "../utils/fs.js";
import { normalizeWhitespace } from "../utils/text.js";
import { mapWithConcurrency } from "../utils/async.js";
import { getPdfExtractionConfig } from "./pdfConfig.js";
import { convertPageImageToMarkdown, isGeminiConfigured } from "./geminiVision.js";
import { renderPdfPageToPng } from "./pdfRenderer.js";
import { ExtractionResult } from "./types.js";

type PdfPageResult = {
  page_number: number;
  markdown: string;
  markdownPath: string;
  structurePath: string;
  imagePath: string | null;
  markdownSource: "gemini_vision" | "unpdf_text" | "empty";
  rendered: boolean;
  geminiSucceeded: boolean;
  warnings: string[];
};

export async function extractPdf(
  userId: string,
  sessionId: string,
  fileId: string,
  sourcePath: string,
): Promise<ExtractionResult> {
  const root = extractedRoot(userId, sessionId, "pdf", fileId);
  const pagesRoot = path.join(root, "pages");
  await ensureDir(pagesRoot);
  const config = getPdfExtractionConfig();

  const pdf = await getDocumentProxy(new Uint8Array(await fs.readFile(sourcePath)));
  const extracted = await extractText(pdf, { mergePages: false });

  const pagesToProcess = Array.from(
    { length: Math.min(extracted.totalPages, config.maxPages) },
    (_, index) => index + 1,
  );

  async function processPage(pageNumber: number): Promise<PdfPageResult> {
    const pageId = `page_${String(pageNumber).padStart(3, "0")}`;
    const markdownPath = path.join(pagesRoot, `${pageId}.md`);
    const structurePath = path.join(pagesRoot, `${pageId}.structure.json`);
    const imagePath = path.join(pagesRoot, `${pageId}.png`);
    const text = normalizeWhitespace(extracted.text[pageNumber - 1] ?? "");
    const pageWarnings: string[] = [];
    let markdownSource: PdfPageResult["markdownSource"] = text ? "unpdf_text" : "empty";
    let markdown = [`# Page ${pageNumber}`, "", text || "_No extractable text found on this page._", ""].join("\n");
    let render: { byteLength: number } | null = null;
    let geminiModel: string | null = null;
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
          retries: config.geminiRetries,
        });
        markdown = gemini.markdown.endsWith("\n") ? gemini.markdown : `${gemini.markdown}\n`;
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
      warnings: pageWarnings,
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
      warnings: pageWarnings,
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
    markdown_source: page.markdownSource,
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
      gemini_retries: config.geminiRetries,
    },
    pages,
    warnings,
  });

  const status = warnings.length === 0 ? "ready" : "partial";

  return {
    status,
    derivedPaths: {
      markdown: relativeToSession(userId, sessionId, documentPath),
      document: relativeToSession(userId, sessionId, documentJsonPath),
      pages_dir: relativeToSession(userId, sessionId, pagesRoot),
    },
    warnings,
  };
}
