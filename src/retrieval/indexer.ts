import { UploadedDocument } from "../types.js";
import { buildTextIndexForFile } from "./textIndex.js";

export async function buildRetrievalIndexesForFile(input: {
  userId: string;
  sessionId: string;
  file: UploadedDocument;
}): Promise<{ derivedPaths: Record<string, string>; warnings: string[] }> {
  const textIndex = await buildTextIndexForFile(input);
  return {
    derivedPaths: textIndex.path ? { text_index: textIndex.path } : {},
    warnings: textIndex.warnings,
  };
}
