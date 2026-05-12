import fs from "node:fs/promises";
import path from "node:path";
import { PARSER_VERSION } from "../config.js";
import { InitializeUploadResult, UploadedDocument } from "../types.js";
import { ensureDir, fileExists, sha256File } from "../utils/fs.js";
import { detectKind, extensionOf, mimeForKind } from "./detect.js";
import { loadOrCreateManifest, upsertFile } from "./manifest.js";
import { uploadPath } from "./paths.js";
import { documentJobQueue } from "../ingestion/jobQueue.js";
import { createExtractDocumentJob } from "../ingestion/jobs.js";

export type InitializeUploadInput = {
  userId: string;
  sessionId: string;
  sourcePath: string;
  originalFilename?: string;
  mimeType?: string;
};

export async function initializeUpload(input: InitializeUploadInput): Promise<InitializeUploadResult> {
  const manifest = await loadOrCreateManifest(input.userId, input.sessionId);
  const stat = await fs.stat(input.sourcePath);
  const sha256 = await sha256File(input.sourcePath);
  const fileId = sha256.slice(0, 24);
  const kind = detectKind(input.sourcePath, input.mimeType);
  const extension = extensionOf(input.sourcePath) || ".bin";
  const destination = uploadPath(input.userId, input.sessionId, fileId, extension);
  const existing = manifest.files.find((candidate) => candidate.file_id === fileId);

  if (
    existing &&
    existing.parser?.version === PARSER_VERSION &&
    (existing.status === "ready" || existing.status === "partial") &&
    (await fileExists(existing.upload_path))
  ) {
    return { manifest, file: existing };
  }

  await ensureDir(path.dirname(destination));
  try {
    await fs.copyFile(input.sourcePath, destination, fs.constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }

  const uploadedAt = new Date().toISOString();
  let file: UploadedDocument = {
    file_id: fileId,
    original_filename: input.originalFilename ?? path.basename(input.sourcePath),
    mime_type: input.mimeType ?? mimeForKind(kind),
    kind,
    size_bytes: stat.size,
    sha256,
    status: kind === "unsupported" ? "unsupported" : "queued",
    uploaded_at: uploadedAt,
    parser: { name: "document-harness", version: PARSER_VERSION },
    upload_path: destination,
    derived_paths: {},
    warnings: [],
  };

  await upsertFile(manifest, file);

  if (kind === "unsupported") {
    file = {
      ...file,
      error: `Unsupported file type '${extension}'.`,
    };
    await upsertFile(await loadOrCreateManifest(input.userId, input.sessionId), file);
    return { manifest: await loadOrCreateManifest(input.userId, input.sessionId), file };
  }

  const job = createExtractDocumentJob({
    userId: input.userId,
    sessionId: input.sessionId,
    fileId,
    kind,
    sourcePath: destination,
  });
  const jobId = documentJobQueue.enqueue(job);

  return { manifest: await loadOrCreateManifest(input.userId, input.sessionId), file, jobId };
}

export async function initializeUploadAndWait(input: InitializeUploadInput): Promise<InitializeUploadResult> {
  const initialized = await initializeUpload(input);
  if (!initialized.jobId) return initialized;
  const file = await documentJobQueue.wait(initialized.jobId);
  return {
    manifest: await loadOrCreateManifest(input.userId, input.sessionId),
    file,
    jobId: initialized.jobId,
  };
}
