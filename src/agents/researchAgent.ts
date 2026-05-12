import { Agent } from "@mastra/core/agent";
import { researchSearchWebTool } from "../mastra/tools/researchTools.js";
import { getDefaultModel } from "../mastra/model.js";
import { defaultMemory } from "../mastra/memory.js";

export const researchAgent = new Agent({
  id: "researchAgent",
  name: "ResearchAgent",
  instructions: `
You answer research questions using lookup tools.
Search first, compare sources, include source URLs, and separate verified facts from uncertainty.
If lookup is unavailable or evidence is thin, say that directly.
`.trim(),
  model: getDefaultModel(),
  memory: defaultMemory,
  tools: {
    researchSearchWebTool,
  },
});
