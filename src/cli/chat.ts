import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { DEFAULT_SESSION_ID, DEFAULT_USER_ID } from "../config.js";
import { routeIntent } from "../agents/coordinator.js";
import { listDocuments, listSheets } from "../services/excelTools.js";
import { searchMarkdown } from "../services/documentTools.js";
import { ignoreBrokenPipe } from "../utils/stdio.js";

ignoreBrokenPipe();

function getArg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

async function handleLocalQuestion(userId: string, sessionId: string, question: string) {
  const route = routeIntent(question);
  if (route.route === "manifest") {
    return JSON.stringify(await listDocuments({ userId, sessionId }), null, 2);
  }
  if (route.route === "excel") {
    const files = await listDocuments({ userId, sessionId });
    const firstExcel = files.find((file) => file.kind === "excel" || file.kind === "csv");
    if (!firstExcel) return "No extracted Excel/CSV files are ready in this session.";
    const workbook = await listSheets({ userId, sessionId, fileId: firstExcel.fileId });
    return JSON.stringify({ route, file: firstExcel, workbook }, null, 2);
  }
  const results = await searchMarkdown({ userId, sessionId, query: question, limit: 8 });
  return JSON.stringify({ route, results }, null, 2);
}

async function main() {
  const userId = getArg("user", DEFAULT_USER_ID);
  const sessionId = getArg("session", DEFAULT_SESSION_ID);
  const rl = readline.createInterface({ input, output });
  console.log(`Local document chat for ${userId}/${sessionId}. Type 'exit' to quit.`);
  for (;;) {
    const question = await rl.question("> ").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ERR_USE_AFTER_CLOSE") return "exit";
      throw error;
    });
    if (question.trim().toLowerCase() === "exit") break;
    console.log(await handleLocalQuestion(userId, sessionId, question));
  }
  try {
    rl.close();
  } catch {
    // The input stream may already be closed when chat is driven through a pipe.
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
