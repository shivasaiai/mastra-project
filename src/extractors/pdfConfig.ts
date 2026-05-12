import { getConfiguredGeminiVisionModel } from "../config.js";

export type PdfExtractionConfig = {
  renderScale: number;
  maxPages: number;
  pageConcurrency: number;
  geminiModel: string;
  geminiTimeoutMs: number;
  geminiRetries: number;
  minTextCharsForTextFallback: number;
};

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function envFloat(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseFloat(raw) : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function getPdfExtractionConfig(): PdfExtractionConfig {
  return {
    renderScale: envFloat("PDF_RENDER_SCALE", 2, 0.5, 4),
    maxPages: envInt("PDF_MAX_PAGES", 250, 1, 5000),
    pageConcurrency: envInt("PDF_PAGE_CONCURRENCY", 2, 1, 8),
    geminiModel: getConfiguredGeminiVisionModel(),
    geminiTimeoutMs: envInt("GEMINI_TIMEOUT_MS", 60_000, 1_000, 300_000),
    geminiRetries: envInt("GEMINI_RETRIES", 2, 0, 5),
    minTextCharsForTextFallback: envInt("PDF_MIN_TEXT_CHARS", 40, 0, 500),
  };
}
