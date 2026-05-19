import { z } from "zod";

export const sessionSchema = {
  userId: z.string().min(1),
  sessionId: z.string().min(1),
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function safeExecute<T>(
  toolId: string,
  fn: () => Promise<T>,
  nextBestTool = "documents.getStatus",
) {
  return (async () => {
    try {
      return { ok: true as const, result: await fn() };
    } catch (error) {
      return {
        ok: false as const,
        what_failed: toolId,
        what_it_tried: `Call ${toolId} with the provided inputs.`,
        next_best_tool: nextBestTool,
        error: { message: errorMessage(error) },
      };
    }
  })();
}
