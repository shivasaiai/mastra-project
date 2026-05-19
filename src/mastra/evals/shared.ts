import type { EvidencePacket } from "../../types.js";

export type EvidenceScorerTarget = {
  answer: string;
  evidence: EvidencePacket[];
};

function isEvidencePacket(value: unknown): value is EvidencePacket {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<EvidencePacket>;
  return Boolean(candidate.evidenceId && candidate.source && candidate.locator && candidate.content);
}

function collectEvidence(value: unknown): EvidencePacket[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(isEvidencePacket);
  if (typeof value !== "object") return [];

  const record = value as Record<string, unknown>;
  const direct = record.evidence ?? record.packets;
  if (Array.isArray(direct)) return direct.filter(isEvidencePacket);
  return [];
}

export function extractEvidenceScorerTarget(output: unknown): EvidenceScorerTarget {
  if (typeof output === "string") return { answer: output, evidence: [] };
  if (!output || typeof output !== "object") return { answer: "", evidence: [] };

  const record = output as Record<string, unknown>;
  const answer = typeof record.answer === "string"
    ? record.answer
    : typeof record.text === "string"
      ? record.text
      : "";

  return {
    answer,
    evidence: collectEvidence(record.evidence ?? record.packets ?? record),
  };
}

export function evidenceToJudgeContext(evidence: EvidencePacket[]): string {
  if (evidence.length === 0) return "No evidence packets were provided.";
  return evidence
    .slice(0, 12)
    .map((packet, index) => {
      const locator = Object.entries(packet.locator)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => `${key}=${value}`)
        .join(", ");
      const content = packet.content.text ?? packet.content.summary ?? JSON.stringify(packet.content.row ?? packet.content.table ?? {});
      return [
        `Evidence ${index + 1}:`,
        `- id: ${packet.evidenceId}`,
        `- file: ${packet.source.originalFilename}`,
        `- locator: ${locator || "none"}`,
        `- content: ${content}`,
      ].join("\n");
    })
    .join("\n\n");
}

export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(1, score));
}
