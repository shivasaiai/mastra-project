import { Agent } from "@mastra/core/agent";
import { researchSearchWebTool } from "../mastra/tools/researchTools.js";
import { getDefaultModel } from "../mastra/model.js";
import { defaultMemory } from "../mastra/memory.js";

export const researchAgent = new Agent({
  id: "researchAgent",
  name: "ResearchAgent",
  description:
    "Searches the web for current information, facts, and external sources. Returns answers with source URLs.",
  instructions: `
You answer research questions using lookup tools.
Search first, compare sources, include source URLs, and separate verified facts from uncertainty.
If lookup is unavailable or evidence is thin, say that directly.

Tool policy:
- Tools return { ok: true, result: ... } or { ok: false, what_failed, what_it_tried, next_best_tool, error }.
`.trim(),
  model: getDefaultModel(),
  memory: defaultMemory,
  tools: {
    researchSearchWebTool,
  },
});
