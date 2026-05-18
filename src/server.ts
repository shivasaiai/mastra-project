import http from "node:http";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { DEFAULT_SESSION_ID, DEFAULT_USER_ID } from "./config.js";
import { routeIntent } from "./agents/coordinator.js";
import { routeIntentEvidenceAware } from "./agents/router.js";
import { initializeUpload } from "./document-store/intake.js";
import { agentKeys, mastra } from "./mastra/index.js";
import { listDocuments, listSheets } from "./services/excelTools.js";
import { getDocumentStatus, searchMarkdown } from "./services/documentTools.js";

type ChatRequest = {
  message: string;
  userId?: string;
  sessionId?: string;
};

type UploadRequest = {
  sourcePath: string;
  userId?: string;
  sessionId?: string;
  originalFilename?: string;
  mimeType?: string;
};

function json(response: http.ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body, null, 2));
}

function html(response: http.ServerResponse, status: number, body: string) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
}

let cachedUiHtml: Promise<string> | undefined;
async function loadUiHtml(): Promise<string> {
  if (!cachedUiHtml) {
    cachedUiHtml = readFile(new URL("./ui/index.html", import.meta.url), "utf8");
  }
  return cachedUiHtml;
}

async function readJson<T>(request: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function selectedAgentForRoute(route: ReturnType<typeof routeIntent>["route"]) {
  switch (route) {
    case "research":
      return "researchAgent";
    case "hybrid":
    case "clarify":
      return "coordinatorAgent";
    default:
      return "documentAnalystAgent";
  }
}

function hasLlmProvider(): boolean {
  return Boolean(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY);
}

async function deterministicFallback(userId: string, sessionId: string, message: string) {
  const route = await routeIntentEvidenceAware({ userId, sessionId, message });
  if (route.route === "manifest" || route.route === "intake" || route.route === "clarify") {
    return { route, output: await listDocuments({ userId, sessionId }) };
  }

  if (route.route === "excel") {
    const documents = await listDocuments({ userId, sessionId });
    const spreadsheets = documents.filter((document) => document.kind === "excel" || document.kind === "csv");
    const workbooks = [];
    for (const document of spreadsheets) {
      workbooks.push({
        fileId: document.fileId,
        originalFilename: document.originalFilename,
        workbook: await listSheets({ userId, sessionId, fileId: document.fileId }),
      });
    }
    return { route, output: workbooks };
  }

  return {
    route,
    output: await searchMarkdown({ userId, sessionId, query: message, limit: 8 }),
  };
}

async function handleChat(body: ChatRequest) {
  const userId = body.userId ?? DEFAULT_USER_ID;
  const sessionId = body.sessionId ?? DEFAULT_SESSION_ID;
  const route = await routeIntentEvidenceAware({ userId, sessionId, message: body.message });
  const selectedAgent = selectedAgentForRoute(route.route);

  if (!hasLlmProvider()) {
    return {
      mode: "deterministic-fallback",
      selectedAgent,
      ...(await deterministicFallback(userId, sessionId, body.message)),
    };
  }

  const agent = mastra.getAgent(selectedAgent as (typeof agentKeys)[number]);
  const prompt = [
    `Session context: userId=${userId}, sessionId=${sessionId}.`,
    `Coordinator route: ${route.route}. Rationale: ${route.rationale}.`,
    "Use tools with this session context when document evidence is needed.",
    body.message,
  ].join("\n\n");
  const result = await agent.generate(
    [{ role: "user", content: prompt }],
    {
      memory: {
        resource: userId,
        thread: sessionId,
      },
    },
  );

  return {
    mode: "mastra-agent",
    selectedAgent,
    route,
    text: result.text,
  };
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "GET" && (requestUrl.pathname === "/" || requestUrl.pathname === "/ui")) {
      html(response, 200, await loadUiHtml());
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/health") {
      json(response, 200, {
        ok: true,
        agents: agentKeys,
        llmConfigured: hasLlmProvider(),
      });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/documents") {
      const userId = requestUrl.searchParams.get("userId") ?? DEFAULT_USER_ID;
      const sessionId = requestUrl.searchParams.get("sessionId") ?? DEFAULT_SESSION_ID;
      json(response, 200, await listDocuments({ userId, sessionId }));
      return;
    }

    const statusMatch = requestUrl.pathname.match(/^\/documents\/([^/]+)\/status$/);
    if (request.method === "GET" && statusMatch) {
      const userId = requestUrl.searchParams.get("userId") ?? DEFAULT_USER_ID;
      const sessionId = requestUrl.searchParams.get("sessionId") ?? DEFAULT_SESSION_ID;
      json(response, 200, await getDocumentStatus({ userId, sessionId, fileId: decodeURIComponent(statusMatch[1]) }));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/upload") {
      const body = await readJson<UploadRequest>(request);
      const userId = body.userId ?? DEFAULT_USER_ID;
      const sessionId = body.sessionId ?? DEFAULT_SESSION_ID;
      const result = await initializeUpload({ ...body, userId, sessionId });
      json(response, result.file.status === "queued" ? 202 : 200, result);
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/chat") {
      const body = await readJson<ChatRequest>(request);
      json(response, 200, await handleChat(body));
      return;
    }

    json(response, 404, { error: "Not found" });
  } catch (error) {
    json(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

const port = Number(process.env.PORT ?? 4111);
server.on("error", (error) => {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: unknown }).code);
    if (code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use. Stop the existing process or choose another PORT.`);
      process.exitCode = 1;
      return;
    }
    if (code === "EPERM") {
      console.error(
        `Permission denied while binding to http://localhost:${port}. Try PORT=4111, or stop the existing server on 4111 and restart.`
      );
      process.exitCode = 1;
      return;
    }
  }
  console.error("Server error:", error);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => {
  console.log(`Mastra multi-agent chatbot API listening on http://localhost:${port}`);
});
