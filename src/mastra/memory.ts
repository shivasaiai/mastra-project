import path from "node:path";
import { Memory } from "@mastra/memory";
import { DATA_DIR } from "../config.js";

const databasePath = path.join(DATA_DIR, "mastra.db");

export const defaultMemory = new Memory({
  options: {
    lastMessages: 20,
    observationalMemory: true,
  },
});

export const mastraDbUrl = `file:${databasePath}`;

