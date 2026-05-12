import fs from "node:fs/promises";
import path from "node:path";
import { DATASET_ROOT, DEFAULT_SESSION_ID, DEFAULT_USER_ID } from "../config.js";
import { searchMarkdown } from "../services/documentTools.js";
import { listDocuments, listSheets } from "../services/excelTools.js";
import { ignoreBrokenPipe } from "../utils/stdio.js";

ignoreBrokenPipe();

async function main() {
  const userId = DEFAULT_USER_ID;
  const sessionId = DEFAULT_SESSION_ID;
  const sampleQuestions = await fs.readFile(path.join(DATASET_ROOT, "candidate_pack", "sample_questions.md"), "utf8");
  const questions = sampleQuestions
    .split("\n")
    .map((line) => line.match(/^\d+\.\s+(.*)$/)?.[1])
    .filter((question): question is string => Boolean(question));

  const files = await listDocuments({ userId, sessionId });
  console.log(`# BPSS Sample Question Evidence Plan\n`);
  console.log(`Session: ${userId}/${sessionId}`);
  console.log(`Files: ${files.length}\n`);

  for (const question of questions) {
    console.log(`## ${question}\n`);
    const searchResults = await searchMarkdown({ userId, sessionId, query: question, limit: 5 });
    console.log(`Text evidence candidates:`);
    for (const result of searchResults) {
      console.log(`- ${result.originalFilename} (${result.fileId}, block ${result.block}): ${result.excerpt}`);
    }
    const excelFiles = files.filter((file) => file.kind === "excel" || file.kind === "csv");
    if (excelFiles.length) {
      console.log(`Spreadsheet artifacts:`);
      for (const file of excelFiles) {
        const workbook = await listSheets({ userId, sessionId, fileId: file.fileId });
        console.log(`- ${file.originalFilename} (${file.fileId}): ${JSON.stringify(workbook)}`);
      }
    }
    console.log("");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
