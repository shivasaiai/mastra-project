import { loadOrCreateManifest } from "../document-store/manifest.js";
import { routeIntent } from "./coordinator.js";

type RouteDecision = ReturnType<typeof routeIntent>;

function countReadyFiles(files: { status: string }[]): number {
  return files.filter((file) => file.status === "ready" || file.status === "partial").length;
}

function messageMentionsSpecificFile(message: string, filenames: string[]): boolean {
  const lower = message.toLowerCase();
  return filenames.some((name) => {
    const base = name.toLowerCase();
    if (!base || base.length < 4) return false;
    return lower.includes(base) || lower.includes(base.replace(/\.[a-z0-9]+$/i, ""));
  });
}

export async function routeIntentEvidenceAware(input: {
  userId: string;
  sessionId: string;
  message: string;
}): Promise<RouteDecision> {
  const base = routeIntent(input.message);

  // Pure research can bypass document state checks.
  if (base.route === "research") return base;

  // If the user is talking about "this" and we have multiple files, force a clarification.
  if (base.route === "clarify") {
    const manifest = await loadOrCreateManifest(input.userId, input.sessionId);
    if (manifest.files.length === 0) {
      return { route: "intake", rationale: "No uploaded files exist in the session yet." };
    }
    if (manifest.files.length === 1) {
      return { route: "document_search", rationale: "Only one file exists; proceed with document evidence search." };
    }
    if (messageMentionsSpecificFile(input.message, manifest.files.map((file) => file.original_filename))) {
      return { route: "document_search", rationale: "A specific filename is mentioned; proceed with document evidence search." };
    }
    return {
      route: "clarify",
      rationale: "Multiple uploaded files exist, but the request does not specify which one to use.",
    };
  }

  // For any document-facing route, incorporate session readiness.
  if (base.route === "document_search" || base.route === "excel" || base.route === "pptx" || base.route === "hybrid" || base.route === "manifest" || base.route === "intake") {
    const manifest = await loadOrCreateManifest(input.userId, input.sessionId);
    const totalFiles = manifest.files.length;
    const readyFiles = countReadyFiles(manifest.files);

    if (totalFiles === 0) {
      return {
        route: "intake",
        rationale: "The request appears to require uploaded documents, but none exist in this session.",
      };
    }

    if (readyFiles === 0 && base.route !== "intake") {
      return {
        route: "manifest",
        rationale: "Files exist but none are ready yet; show status so the user can wait or retry extraction.",
      };
    }
  }

  return base;
}

