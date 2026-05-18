import { normalizeWhitespace } from "../utils/text.js";

export type Chunk = {
  text: string;
  warnings: string[];
  meta?: {
    heading?: string;
  };
};

function isHeading(line: string): boolean {
  return /^#{1,6}\s+\S+/.test(line.trim());
}

function headingText(line: string): string {
  return line.trim().replace(/^#{1,6}\s+/, "").trim();
}

function splitIntoBlocks(markdown: string): string[] {
  return markdown
    .split(/\n{2,}/)
    .map((block) => normalizeWhitespace(block))
    .filter(Boolean);
}

function approxTokenCount(text: string): number {
  // Rough heuristic; stable and fast.
  return Math.ceil(text.length / 4);
}

export function chunkMarkdownByHeadings(markdown: string, opts?: { maxTokens?: number; minTokens?: number }): Chunk[] {
  const maxTokens = opts?.maxTokens ?? 420;
  const minTokens = opts?.minTokens ?? 120;
  const blocks = splitIntoBlocks(markdown);
  const chunks: Chunk[] = [];

  let currentHeading: string | undefined;
  let buffer: string[] = [];

  function flush(force = false) {
    const text = buffer.join("\n\n").trim();
    if (!text) return;
    const tokens = approxTokenCount(text);
    if (!force && tokens < minTokens && chunks.length > 0) return;
    chunks.push({ text, warnings: [], meta: currentHeading ? { heading: currentHeading } : undefined });
    buffer = [];
  }

  for (const block of blocks) {
    // Start a new chunk on a heading boundary.
    const firstLine = block.split("\n", 1)[0] ?? "";
    if (isHeading(firstLine)) {
      flush(true);
      currentHeading = headingText(firstLine);
    }

    buffer.push(block);
    const tokens = approxTokenCount(buffer.join("\n\n"));
    if (tokens >= maxTokens) flush(true);
  }

  flush(true);
  return chunks.filter((chunk) => chunk.text.trim().length > 0);
}

