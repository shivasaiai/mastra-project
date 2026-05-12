import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

function isTopic(topic) {
  return "Text" in topic;
}
const researchSearchWebTool = createTool({
  id: "research.searchWeb",
  description: "Look up current or general research information on the web and return compact cited snippets.",
  inputSchema: z.object({
    query: z.string().min(1),
    limit: z.number().int().positive().max(10).optional()
  }),
  execute: async (input) => {
    const url = new URL("https://api.duckduckgo.com/");
    url.searchParams.set("q", input.query);
    url.searchParams.set("format", "json");
    url.searchParams.set("no_html", "1");
    url.searchParams.set("skip_disambig", "1");
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Research lookup failed with HTTP ${response.status}.`);
    const payload = await response.json();
    const results = [];
    if (payload.AbstractText) {
      results.push({
        title: payload.Heading || input.query,
        url: payload.AbstractURL,
        snippet: payload.AbstractText
      });
    }
    for (const topic of payload.RelatedTopics ?? []) {
      if ("Topics" in topic) {
        for (const nested of topic.Topics ?? []) {
          if (nested.Text) results.push({ title: nested.Text.split(" - ")[0], url: nested.FirstURL, snippet: nested.Text });
        }
      } else if (isTopic(topic) && topic.Text) {
        results.push({ title: topic.Text.split(" - ")[0], url: topic.FirstURL, snippet: topic.Text });
      }
    }
    return {
      query: input.query,
      results: results.slice(0, input.limit ?? 5)
    };
  }
});

export { researchSearchWebTool };
