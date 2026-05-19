import { createScorer } from "@mastra/core/evals";
import { z } from "zod";
import { getDefaultModel } from "../model.js";
import { clampScore, evidenceToJudgeContext, extractEvidenceScorerTarget } from "./shared.js";

export const citationCoverageScorer = createScorer({
  id: "citationCoverage",
  name: "Citation Coverage",
  description: "Scores what fraction of material answer claims are backed by retrieved evidence packets.",
  judge: {
    model: getDefaultModel(),
    instructions:
      "You are an exacting RAG evaluator. Judge whether answer claims are supported by the supplied evidence packets and citation locators.",
  },
})
  .preprocess(({ run }) => extractEvidenceScorerTarget(run.output))
  .analyze({
    description: "Estimate claim-level citation coverage from answer text and evidence packets.",
    outputSchema: z.object({
      totalClaims: z.number().int().nonnegative(),
      supportedClaims: z.number().int().nonnegative(),
      unsupportedClaims: z.array(z.string()),
    }),
    createPrompt: ({ results }) => {
      const target = results.preprocessStepResult;
      return [
        "Evaluate citation coverage for this answer.",
        "Count only material factual claims. A claim is supported when it is directly backed by at least one evidence packet.",
        "Return JSON with totalClaims, supportedClaims, and unsupportedClaims.",
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
      totalClaims: number;
      supportedClaims: number;
    };
    if (analysis.totalClaims === 0) return 1;
    return clampScore(analysis.supportedClaims / analysis.totalClaims);
  })
  .generateReason(({ results, score }) => {
    const analysis = results.analyzeStepResult as {
      totalClaims: number;
      supportedClaims: number;
      unsupportedClaims: string[];
    };
    return [
      `Citation coverage score ${score.toFixed(2)}: ${analysis.supportedClaims}/${analysis.totalClaims} material claims were supported.`,
      analysis.unsupportedClaims.length ? `Unsupported claims: ${analysis.unsupportedClaims.join("; ")}` : "No unsupported claims were identified.",
    ].join(" ");
  });
