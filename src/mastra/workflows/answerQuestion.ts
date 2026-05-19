import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { routeIntent } from "../../agents/coordinator.js";
import { documentAnalystAgent } from "../../agents/documentAnalystAgent.js";
import { DEFAULT_SESSION_ID, DEFAULT_USER_ID } from "../../config.js";
import { searchTextEvidence } from "../../retrieval/textIndex.js";
import { searchVectorEvidence } from "../../retrieval/vectorIndex.js";
import type { EvidencePacket } from "../../types.js";
import { citationCoverageScorer } from "../evals/citationCoverage.js";
import { groundednessScorer } from "../evals/groundedness.js";
import { hasEmbeddingProvider } from "../model.js";

const answerInputSchema = z.object({
  userId: z.string().optional(),
  sessionId: z.string().optional(),
  question: z.string().min(1),
  fileId: z.string().optional(),
  limit: z.number().int().positive().optional(),
});

const normalizedQuestionSchema = z.object({
  userId: z.string(),
  sessionId: z.string(),
  question: z.string(),
  fileId: z.string().optional(),
  limit: z.number().int().positive(),
});

const classifiedQuestionSchema = normalizedQuestionSchema.extend({
  intent: z.string(),
  rationale: z.string(),
});

const evidencePacketSchema = z.custom<EvidencePacket>();
const retrievedEvidenceSchema = classifiedQuestionSchema.extend({
  retrievalMode: z.enum(["vector", "lexical", "none"]),
  evidence: z.array(evidencePacketSchema),
  lowEvidence: z.boolean(),
});

const answerOutputSchema = retrievedEvidenceSchema.extend({
  answer: z.string(),
  citationCount: z.number(),
});

function hasLlmProvider(): boolean {
  return Boolean(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY);
}

function citationFor(packet: EvidencePacket): string {
  const locator = Object.entries(packet.locator)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  return `[${packet.source.originalFilename} | ${locator || packet.evidenceId}]`;
}

function deterministicAnswer(question: string, evidence: EvidencePacket[]): string {
  if (evidence.length === 0) {
    return `I could not find enough uploaded-document evidence to answer "${question}" reliably.`;
  }
  return evidence
    .slice(0, 4)
    .map((packet) => {
      const text = packet.content.text ?? packet.content.summary ?? JSON.stringify(packet.content.row ?? packet.content.table ?? {});
      return `${text} ${citationFor(packet)}`;
    })
    .join("\n\n");
}

const classifyIntentStep = createStep({
  id: "classify-intent",
  description: "Normalize session context and classify the question route.",
  inputSchema: answerInputSchema,
  outputSchema: classifiedQuestionSchema,
  execute: async ({ inputData }) => {
    const decision = routeIntent(inputData.question);
    return {
      userId: inputData.userId ?? DEFAULT_USER_ID,
      sessionId: inputData.sessionId ?? DEFAULT_SESSION_ID,
      question: inputData.question,
      fileId: inputData.fileId,
      limit: inputData.limit ?? 5,
      intent: decision.route,
      rationale: decision.rationale,
    };
  },
});

const retrieveEvidenceStep = createStep({
  id: "retrieve-evidence",
  description: "Retrieve narrative document evidence using vector search with lexical fallback.",
  inputSchema: classifiedQuestionSchema,
  outputSchema: retrievedEvidenceSchema,
  execute: async ({ inputData }) => {
    let evidence: EvidencePacket[] = [];
    let retrievalMode: "vector" | "lexical" | "none" = "none";

    if (inputData.intent !== "research") {
      const retrievalInput = {
        userId: inputData.userId,
        sessionId: inputData.sessionId,
        fileId: inputData.fileId,
        query: inputData.question,
        limit: inputData.limit,
      };

      if (hasEmbeddingProvider()) {
        evidence = await searchVectorEvidence(retrievalInput);
        if (evidence.length > 0) retrievalMode = "vector";
      }

      if (evidence.length === 0) {
        evidence = await searchTextEvidence(retrievalInput);
        retrievalMode = evidence.length > 0 ? "lexical" : "none";
      }
    }

    return {
      ...inputData,
      retrievalMode,
      evidence,
      lowEvidence: evidence.length < 2,
    };
  },
});

const generateAnswerStep = createStep({
  id: "generate-answer",
  description: "Generate a concise answer grounded in retrieved evidence and score the result.",
  inputSchema: retrievedEvidenceSchema,
  outputSchema: answerOutputSchema,
  scorers: {
    citationCoverage: { scorer: citationCoverageScorer, sampling: { type: "ratio", rate: 1 } },
    groundedness: { scorer: groundednessScorer, sampling: { type: "ratio", rate: 1 } },
  },
  execute: async ({ inputData }) => {
    if (!hasLlmProvider()) {
      return {
        ...inputData,
        answer: deterministicAnswer(inputData.question, inputData.evidence),
        citationCount: inputData.evidence.length,
      };
    }

    const evidenceContext = inputData.evidence
      .map((packet, index) => {
        const text = packet.content.text ?? packet.content.summary ?? JSON.stringify(packet.content.row ?? packet.content.table ?? {});
        return `Evidence ${index + 1}: ${text}\nCitation: ${citationFor(packet)}`;
      })
      .join("\n\n");
    const prompt = [
      `Session context: userId=${inputData.userId}, sessionId=${inputData.sessionId}.`,
      `Question: ${inputData.question}`,
      `Intent: ${inputData.intent}. Retrieval mode: ${inputData.retrievalMode}.`,
      "Answer only from the evidence below. Cite every material claim using the supplied citation labels.",
      inputData.lowEvidence ? "Evidence is thin; state uncertainty explicitly." : "",
      "",
      evidenceContext || "No evidence packets were retrieved.",
    ].join("\n");

    const result = await documentAnalystAgent.generateLegacy(
      [{ role: "user", content: prompt }],
      { memory: { resource: inputData.userId, thread: inputData.sessionId } },
    );

    return {
      ...inputData,
      answer: result.text,
      citationCount: inputData.evidence.length,
    };
  },
});

export const answerQuestionWorkflow = createWorkflow({
  id: "answerQuestion",
  description: "Classify a question, retrieve evidence, generate a cited answer, and run answer-quality scorers.",
  inputSchema: answerInputSchema,
  outputSchema: answerOutputSchema,
})
  .then(classifyIntentStep)
  .then(retrieveEvidenceStep)
  .then(generateAnswerStep)
  .commit();
