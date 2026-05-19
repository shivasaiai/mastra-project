import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { getConfiguredGeminiChatModel } from "../config.js";

function injectDummyThoughtSignatures(bodyText: string): string {
  const dummy = "skip_thought_signature_validator";
  try {
    const parsed = JSON.parse(bodyText) as any;
    const contents = parsed?.contents;
    if (!Array.isArray(contents)) return bodyText;

    for (const content of contents) {
      const parts = content?.parts;
      if (!Array.isArray(parts)) continue;
      for (const part of parts) {
        const fc = part?.functionCall;
        if (fc && typeof fc === "object") {
          // Gemini 3 tool calling requires a thought signature to be present in history.
          // When the upstream SDK doesn't preserve it, we can add a documented dummy signature.
          if (part.thought_signature == null && part.thoughtSignature == null) {
            part.thought_signature = dummy;
            part.thoughtSignature = dummy;
          }
        }
      }
    }

    return JSON.stringify(parsed);
  } catch {
    return bodyText;
  }
}

export function getDefaultModel() {
  if (process.env.GEMINI_API_KEY) {
    const google = createGoogleGenerativeAI({
      apiKey: process.env.GEMINI_API_KEY,
      fetch: async (url, init) => {
        if (init?.body && typeof init.body === "string") {
          const patched = injectDummyThoughtSignatures(init.body);
          return fetch(url, { ...init, body: patched });
        }
        return fetch(url, init);
      },
    });
    return google(getConfiguredGeminiChatModel());
  }

  return openai(process.env.OPENAI_MODEL ?? "gpt-4o-mini");
}

export function hasEmbeddingProvider(): boolean {
  return Boolean(process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY);
}

export function getEmbeddingDimension(): number {
  if (process.env.GEMINI_API_KEY) {
    const model = process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-004";
    if (model.includes("text-embedding-004")) return 768;
    return 3072;
  }
  return 1536;
}

export function getDefaultEmbeddingModel() {
  if (process.env.GEMINI_API_KEY) {
    const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
    return google.textEmbeddingModel(process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-004");
  }

  return openai.embedding(process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small");
}
