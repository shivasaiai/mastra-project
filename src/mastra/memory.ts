import path from "node:path";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { DATA_DIR } from "../config.js";

const databasePath = path.join(DATA_DIR, "mastra.db");
export const mastraDbUrl = `file:${databasePath}`;

export const defaultMemory = new Memory({
  storage: new LibSQLStore({ id: "memory-storage", url: mastraDbUrl }),
  options: {
    lastMessages: 20,
  },
});
