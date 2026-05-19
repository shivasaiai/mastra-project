import { UploadedDocument } from "../types.js";
import { buildTextIndexForFile } from "./textIndex.js";
import { buildVectorIndexForFile } from "./vectorIndex.js";

export async function buildRetrievalIndexesForFile(input: {
  userId: string;
  sessionId: string;
  file: UploadedDocument;
}): Promise<{ derivedPaths: Record<string, string>; warnings: string[] }> {
  const textIndex = await buildTextIndexForFile(input);
  const vectorIndex = await buildVectorIndexForFile(input);
  return {
    derivedPaths: {
      ...(textIndex.path ? { text_index: textIndex.path } : {}),
      ...(vectorIndex.path ? { vector_index: vectorIndex.path } : {}),
    },
    warnings: [...textIndex.warnings, ...vectorIndex.warnings],
  };
}
