import path from "node:path";
import * as mammoth from "mammoth";
import { extractedRoot, relativeToSession } from "../document-store/paths.js";
import { writeJson, writeText } from "../utils/fs.js";
import { ExtractionResult } from "./types.js";

export async function extractDocx(
  userId: string,
  sessionId: string,
  fileId: string,
  sourcePath: string,
): Promise<ExtractionResult> {
  const root = extractedRoot(userId, sessionId, "docx", fileId);
  const result = await (mammoth as typeof mammoth & {
    convertToMarkdown: (input: { path: string }) => Promise<{ value: string; messages: { message: string }[] }>;
  }).convertToMarkdown({ path: sourcePath });
  const markdownPath = path.join(root, "document.md");
  const structurePath = path.join(root, "structure.json");
  const chunksPath = path.join(root, "chunks.jsonl");

  const lines = result.value.split(/\n{2,}/).map((block: string) => block.trim()).filter(Boolean);
  const chunks = lines.map((text: string, index: number) => ({ chunk_id: `docx_${String(index + 1).padStart(4, "0")}`, text }));

  await writeText(markdownPath, result.value.trim() + "\n");
  await writeJson(structurePath, {
    file_id: fileId,
    block_count: chunks.length,
    warnings: result.messages.map((message: { message: string }) => message.message),
  });
  await writeText(chunksPath, chunks.map((chunk: { chunk_id: string; text: string }) => JSON.stringify(chunk)).join("\n") + "\n");

  const warnings = result.messages.map((message: { message: string }) => message.message);
  return {
    status: warnings.length > 0 ? "partial" : "ready",
    derivedPaths: {
      markdown: relativeToSession(userId, sessionId, markdownPath),
      structure: relativeToSession(userId, sessionId, structurePath),
      chunks: relativeToSession(userId, sessionId, chunksPath),
    },
    warnings,
  };
}
