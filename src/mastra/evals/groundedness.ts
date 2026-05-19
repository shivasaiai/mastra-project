import { createScorer } from "@mastra/core/evals";
import { z } from "zod";
import { getDefaultModel } from "../model.js";
import { clampScore, evidenceToJudgeContext, extractEvidenceScorerTarget } from "./shared.js";

export const groundednessScorer = createScorer({
  id: "groundedness",
  name: "Groundedness",
  description: "Scores whether the answer stays within the facts present in retrieved evidence.",
  judge: {
    model: getDefaultModel(),
    instructions:
      "You are a careful groundedness judge. Penalize unsupported facts, invented details, and conclusions that do not follow from the evidence.",
  },
})
  .preprocess(({ run }) => extractEvidenceScorerTarget(run.output))
  .analyze({
    description: "Identify unsupported answer statements relative to the evidence packets.",
    outputSchema: z.object({
      totalStatements: z.number().int().nonnegative(),
      unsupportedStatements: z.array(z.string()),
      groundedSummary: z.string(),
    }),
    createPrompt: ({ results }) => {
      const target = results.preprocessStepResult;
      return [
        "Evaluate whether this answer is grounded in the evidence.",
        "List any answer statements that introduce facts not present in the evidence. Ignore harmless wording differences.",
        "Return JSON with totalStatements, unsupportedStatements, and groundedSummary.",
        "",
        "Answer:",
        target.answer,
        "",
        "Evidence packets:",
        evidenceToJudgeContext(target.evidence),
      ].join("\n");
    },
  })
  .generateScore(({ results }) => {
    const analysis = results.analyzeStepResult as {
      totalStatements: number;
      unsupportedStatements: string[];
    };
    if (analysis.totalStatements === 0) return 1;
    return clampScore((analysis.totalStatements - analysis.unsupportedStatements.length) / analysis.totalStatements);
  })
  .generateReason(({ results, score }) => {
    const analysis = results.analyzeStepResult as {
      unsupportedStatements: string[];
      groundedSummary: string;
    };
    return [
      `Groundedness score ${score.toFixed(2)}.`,
      analysis.groundedSummary,
      analysis.unsupportedStatements.length ? `Unsupported statements: ${analysis.unsupportedStatements.join("; ")}` : "No unsupported statements were identified.",
    ].join(" ");
  });
