import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { getConfiguredGeminiChatModel } from "../config.js";

export function getDefaultModel() {
  if (process.env.GEMINI_API_KEY) {
    const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
    return google(getConfiguredGeminiChatModel());
  }

  return openai(process.env.OPENAI_MODEL ?? "gpt-4o-mini");
}
