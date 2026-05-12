import fs from "node:fs/promises";
import { getConfiguredGeminiVisionModel } from "../config.js";

export type GeminiMarkdownResult = {
  markdown: string;
  model: string;
  attempts: number;
};

type GeminiResponse = {
  candidates?: {
    content?: {
      parts?: {
        text?: string;
      }[];
    };
  }[];
  error?: {
    message?: string;
  };
};

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export async function convertPageImageToMarkdown(input: {
  imagePath: string;
  pageNumber: number;
  model?: string;
  timeoutMs?: number;
  retries?: number;
}): Promise<GeminiMarkdownResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

  const model = input.model ?? getConfiguredGeminiVisionModel();
  const image = await fs.readFile(input.imagePath);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const prompt = [
    `Convert PDF page ${input.pageNumber} into faithful Markdown.`,
    "Preserve headings, bullets, tables, field labels, dates, IDs, and footnotes.",
    "Do not summarize. Do not invent missing text. If a region is unreadable, write [unreadable].",
    "Return only Markdown.",
  ].join(" ");

  const retries = input.retries ?? 2;
  const timeoutMs = input.timeoutMs ?? 60_000;
  let lastError: Error | null = null;

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
                    data: image.toString("base64"),
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
          },
        }),
      });

      const payload = (await response.json()) as GeminiResponse;
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
