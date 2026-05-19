import { Mastra } from "@mastra/core/mastra";
import type { ObservabilityExporter } from "@mastra/core/observability";
import { MastraCompositeStore } from "@mastra/core/storage";
import { DuckDBStore } from "@mastra/duckdb";
import { LibSQLStore } from "@mastra/libsql";
import { MastraPlatformExporter, MastraStorageExporter, Observability } from "@mastra/observability";
import path from "node:path";
import { coordinatorAgent } from "../agents/coordinator.js";
import { documentAnalystAgent } from "../agents/documentAnalystAgent.js";
import { researchAgent } from "../agents/researchAgent.js";
import { DATA_DIR } from "../config.js";
import { mastraDbUrl } from "./memory.js";
import { documentVectorStore } from "./vectorStore.js";
import { citationCoverageScorer } from "./evals/citationCoverage.js";
import { groundednessScorer } from "./evals/groundedness.js";
import { answerQuestionWorkflow } from "./workflows/answerQuestion.js";
import { ingestDocumentWorkflow } from "./workflows/ingestDocument.js";

export const agentKeys = [
  "coordinatorAgent",
  "documentAnalystAgent",
  "researchAgent",
] as const;

const primaryStore = new LibSQLStore({
  id: "mastra-storage",
  url: mastraDbUrl,
});

const observabilityStore = new DuckDBStore({
  id: "mastra-observability-storage",
  path: path.join(DATA_DIR, "mastra-observability.duckdb"),
});

const observabilityExporters: ObservabilityExporter[] = [new MastraStorageExporter()];

if (process.env.MASTRA_PLATFORM_ACCESS_TOKEN && process.env.MASTRA_PROJECT_ID) {
  observabilityExporters.push(new MastraPlatformExporter());
}

export const mastra = new Mastra({
  storage: new MastraCompositeStore({
    id: "mastra-composite-storage",
    default: primaryStore,
    domains: {
      observability: observabilityStore.observability,
    },
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: "mastra-multi-agent-rag",
        exporters: observabilityExporters,
        logging: {
          enabled: true,
          level: "info",
        },
      },
    },
  }),
  vectors: {
    documentVectorStore,
  },
  workflows: {
    ingestDocumentWorkflow,
    answerQuestionWorkflow,
  },
  scorers: {
    citationCoverageScorer,
    groundednessScorer,
  },
  agents: {
    coordinatorAgent,
    documentAnalystAgent,
    researchAgent,
  },
});
