import path from "node:path";
import { DATA_DIR } from "../config.js";

export function sessionRoot(userId: string, sessionId: string): string {
  return path.join(DATA_DIR, "users", userId, "sessions", sessionId);
}

export function manifestPath(userId: string, sessionId: string): string {
  return path.join(sessionRoot(userId, sessionId), "manifest.json");
}

export function uploadDir(userId: string, sessionId: string, fileId: string): string {
  return path.join(sessionRoot(userId, sessionId), "uploads", fileId);
}

export function uploadPath(userId: string, sessionId: string, fileId: string, extension: string): string {
  return path.join(uploadDir(userId, sessionId, fileId), `original${extension}`);
}

export function extractedRoot(userId: string, sessionId: string, kind: string, fileId: string): string {
  return path.join(sessionRoot(userId, sessionId), "extracted", kind, fileId);
}

export function workspaceRoot(userId: string, sessionId: string): string {
  return path.join(sessionRoot(userId, sessionId), "workspace");
}

export function relativeToSession(userId: string, sessionId: string, filePath: string): string {
  return path.relative(sessionRoot(userId, sessionId), filePath);
}

