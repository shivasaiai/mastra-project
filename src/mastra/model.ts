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
          if (fc.thought_signature == null && fc.thoughtSignature == null) {
            fc.thought_signature = dummy;
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
