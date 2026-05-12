import path from "node:path";

export const PROJECT_ROOT = path.resolve(process.cwd());
export const DATASET_ROOT = path.resolve(PROJECT_ROOT, "bpss_agentic_dataset");
export const DATA_DIR = path.resolve(PROJECT_ROOT, "data");
export const CACHE_DIR = path.resolve(PROJECT_ROOT, ".cache");

export const DEFAULT_USER_ID = "local-user";
export const DEFAULT_SESSION_ID = "bpss-demo";

export const PARSER_VERSION = "2026-05-11";
export const DEFAULT_GEMINI_CHAT_MODEL = "gemini-3-flash-preview";
export const DEFAULT_GEMINI_VISION_MODEL = "gemini-3.1-pro-preview";

const GEMINI_MODEL_ALIASES = new Map<string, string>([
  ["gemini-3-flash", "gemini-3-flash-preview"],
  ["gemini-pro", DEFAULT_GEMINI_CHAT_MODEL],
]);

function normalizeGeminiModel(configured: string | undefined, fallback: string): string {
  if (!configured?.trim()) return fallback;
  const model = configured.replace(/^models\//, "");
  return GEMINI_MODEL_ALIASES.get(model) ?? model;
}

export function getConfiguredGeminiChatModel(): string {
  return normalizeGeminiModel(process.env.GEMINI_MODEL, DEFAULT_GEMINI_CHAT_MODEL);
}

export function getConfiguredGeminiVisionModel(): string {
  return normalizeGeminiModel(process.env.GEMINI_VISION_MODEL ?? process.env.GEMINI_MODEL, DEFAULT_GEMINI_VISION_MODEL);
}
