import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore } from "@mastra/libsql";
import { coordinatorAgent } from "../agents/coordinator.js";
import { documentAnalystAgent } from "../agents/documentAnalystAgent.js";
import { researchAgent } from "../agents/researchAgent.js";
import { mastraDbUrl } from "./memory.js";

export const agentKeys = [
  "coordinatorAgent",
  "documentAnalystAgent",
  "researchAgent",
] as const;

export const mastra = new Mastra({
  storage: new LibSQLStore({
    id: "mastra-storage",
    url: mastraDbUrl,
  }),
  agents: {
    coordinatorAgent,
    documentAnalystAgent,
    researchAgent,
  },
});
