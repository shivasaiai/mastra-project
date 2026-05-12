import { SessionManifest, UploadedDocument } from "../types.js";
import { ensureDir, fileExists, readJson, writeJson } from "../utils/fs.js";
import { manifestPath, sessionRoot, workspaceRoot } from "./paths.js";

function nowIso(): string {
  return new Date().toISOString();
}

export async function loadOrCreateManifest(userId: string, sessionId: string): Promise<SessionManifest> {
  const filePath = manifestPath(userId, sessionId);
  if (await fileExists(filePath)) {
    return readJson<SessionManifest>(filePath);
  }

  const manifest: SessionManifest = {
    user_id: userId,
    session_id: sessionId,
    created_at: nowIso(),
    updated_at: nowIso(),
    files: [],
  };

  await ensureDir(sessionRoot(userId, sessionId));
  await ensureDir(workspaceRoot(userId, sessionId));
  await saveManifest(manifest);
  return manifest;
}

export async function saveManifest(manifest: SessionManifest): Promise<void> {
  manifest.updated_at = nowIso();
  await writeJson(manifestPath(manifest.user_id, manifest.session_id), manifest);
}

export async function upsertFile(manifest: SessionManifest, file: UploadedDocument): Promise<SessionManifest> {
  const index = manifest.files.findIndex((candidate) => candidate.file_id === file.file_id);
  if (index >= 0) manifest.files[index] = file;
  else manifest.files.push(file);
  await saveManifest(manifest);
  return manifest;
}

export function getFileOrThrow(manifest: SessionManifest, fileId: string): UploadedDocument {
  const file = manifest.files.find((candidate) => candidate.file_id === fileId);
  if (!file) throw new Error(`No file '${fileId}' found in session '${manifest.session_id}'.`);
  return file;
}

export async function updateFile(
  userId: string,
  sessionId: string,
  fileId: string,
  patch: Partial<UploadedDocument>,
): Promise<UploadedDocument> {
  const manifest = await loadOrCreateManifest(userId, sessionId);
  const existing = getFileOrThrow(manifest, fileId);
  const updated = { ...existing, ...patch };
  await upsertFile(manifest, updated);
  return updated;
}

