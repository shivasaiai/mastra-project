import { DEFAULT_SESSION_ID, DEFAULT_USER_ID } from "../config.js";
import { searchMarkdown } from "../services/documentTools.js";
import { listDocuments, listSheets } from "../services/excelTools.js";
import { ignoreBrokenPipe } from "../utils/stdio.js";

ignoreBrokenPipe();

async function main() {
  const userId = DEFAULT_USER_ID;
  const sessionId = DEFAULT_SESSION_ID;
  const questions = [
    "What are the main project risks mentioned in the uploaded documents?",
    "Which sample records need follow-up?",
    "Summarize the quarterly update with citations.",
  ];

  const files = await listDocuments({ userId, sessionId });
  console.log(`# Sample Question Evidence Plan\n`);
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
