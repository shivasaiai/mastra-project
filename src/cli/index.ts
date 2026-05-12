import path from "node:path";
import { DATASET_ROOT, DEFAULT_SESSION_ID, DEFAULT_USER_ID } from "../config.js";
import { initializeUploadAndWait } from "../document-store/intake.js";
import { listFilesRecursive } from "../utils/fs.js";
import { ignoreBrokenPipe } from "../utils/stdio.js";

ignoreBrokenPipe();

const supported = new Set([".xlsx", ".xlsm", ".xls", ".csv", ".docx", ".pdf", ".pptx"]);

function getArg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

async function main() {
  const userId = getArg("user", DEFAULT_USER_ID);
  const sessionId = getArg("session", DEFAULT_SESSION_ID);
  const source = path.resolve(getArg("source", DATASET_ROOT));
  const files = (await listFilesRecursive(source)).filter((file) => supported.has(path.extname(file).toLowerCase()));

  console.log(`Ingesting ${files.length} supported files into ${userId}/${sessionId}`);
  for (const filePath of files) {
    const result = await initializeUploadAndWait({ userId, sessionId, sourcePath: filePath });
    console.log(`${result.file.status.padEnd(8)} ${result.file.kind.padEnd(5)} ${result.file.file_id} ${path.relative(source, filePath)}`);
    if (result.file.error) console.log(`  error: ${result.file.error}`);
    for (const warning of result.file.warnings) console.log(`  warning: ${warning}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
