import path from "node:path";
import { DEFAULT_SESSION_ID, DEFAULT_USER_ID, SAMPLE_DATA_DIR } from "../config.js";
import { initializeUploadAndWait } from "../document-store/intake.js";
import { listFilesRecursive } from "../utils/fs.js";
import { ignoreBrokenPipe } from "../utils/stdio.js";

ignoreBrokenPipe();

const supportedExtensions = new Set([".csv", ".docx", ".pdf", ".pptx"]);

function getArg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

async function main() {
  const userId = getArg("user", DEFAULT_USER_ID);
  const sessionId = getArg("session", DEFAULT_SESSION_ID);
  const sampleDir = path.resolve(getArg("source", SAMPLE_DATA_DIR));
  const files = (await listFilesRecursive(sampleDir))
    .filter((filePath) => supportedExtensions.has(path.extname(filePath).toLowerCase()))
    .sort();

  if (files.length === 0) {
    throw new Error(`No sample files found in ${sampleDir}.`);
  }

  console.log(`Seeding ${files.length} sample files into ${userId}/${sessionId}`);
  for (const sourcePath of files) {
    const result = await initializeUploadAndWait({
      userId,
      sessionId,
      sourcePath,
      originalFilename: path.basename(sourcePath),
    });
    console.log(`${result.file.status.padEnd(8)} ${result.file.kind.padEnd(5)} ${result.file.file_id} ${path.basename(sourcePath)}`);
    if (result.file.error) console.log(`  error: ${result.file.error}`);
    for (const warning of result.file.warnings) console.log(`  warning: ${warning}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
