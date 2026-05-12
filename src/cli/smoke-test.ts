import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DATASET_ROOT } from "../config.js";
import { initializeUploadAndWait } from "../document-store/intake.js";
import { loadOrCreateManifest } from "../document-store/manifest.js";
import { sessionRoot } from "../document-store/paths.js";
import { getSchema, listDocuments, listSheets, previewRows, queryRows } from "../services/excelTools.js";
import { searchMarkdown } from "../services/documentTools.js";
import { fileExists } from "../utils/fs.js";
import { ignoreBrokenPipe } from "../utils/stdio.js";

ignoreBrokenPipe();

type TestCase = {
  name: string;
  run: () => Promise<void>;
};

const userId = "test-user";
const sessionId = `smoke-${Date.now()}`;

function logPass(name: string) {
  console.log(`PASS ${name}`);
}

async function assertExists(filePath: string) {
  assert.equal(await fileExists(filePath), true, `Expected file to exist: ${filePath}`);
}

const tests: TestCase[] = [
  {
    name: "Excel upload creates manifest and all sheet artifacts",
    run: async () => {
      const sourcePath = path.join(DATASET_ROOT, "structured", "BPSS_case_tracker.xlsx");
      const result = await initializeUploadAndWait({ userId, sessionId, sourcePath });
      assert.equal(result.file.status, "ready");
      assert.equal(result.file.kind, "excel");
      assert.equal(result.file.original_filename, "BPSS_case_tracker.xlsx");
      await assertExists(result.file.upload_path);

      const workbook = await listSheets({ userId, sessionId, fileId: result.file.file_id });
      const sheets = workbook.sheets as { sheet_id: string; sheet_name: string }[];
      assert.equal(sheets.length, 4);

      for (const sheet of sheets) {
        const base = path.join(sessionRoot(userId, sessionId), "extracted", "excel", result.file.file_id, "sheets");
        await assertExists(path.join(base, `${sheet.sheet_id}.schema.json`));
        await assertExists(path.join(base, `${sheet.sheet_id}.preview.md`));
        await assertExists(path.join(base, `${sheet.sheet_id}.rows.jsonl`));
      }
    },
  },
  {
    name: "Excel tools return bounded schema, preview, and query results",
    run: async () => {
      const documents = await listDocuments({ userId, sessionId });
      const excel = documents.find((document) => document.originalFilename === "BPSS_case_tracker.xlsx");
      assert.ok(excel);

      const schema = await getSchema({ userId, sessionId, fileId: excel.fileId, sheetId: "tracker" });
      assert.equal(schema.sheet_id, "tracker");
      assert.ok(Array.isArray(schema.columns));

      const preview = await previewRows({ userId, sessionId, fileId: excel.fileId, sheetId: "tracker", limit: 2 });
      assert.equal(preview.rows.length, 2);

      const query = await queryRows({
        userId,
        sessionId,
        fileId: excel.fileId,
        sheetId: "tracker",
        filters: [{ column: "candidate_id", op: "contains", value: "CAND" }],
        limit: 50,
      });
      assert.equal(query.returned, 6);
      assert.equal(query.truncated, false);
    },
  },
  {
    name: "DOCX upload exposes searchable markdown evidence",
    run: async () => {
      const sourcePath = path.join(DATASET_ROOT, "candidate_pack", "CAND-102_candidate_pack.docx");
      const result = await initializeUploadAndWait({ userId, sessionId, sourcePath });
      assert.equal(result.file.status, "ready");
      assert.equal(typeof result.file.derived_paths.markdown, "string");

      const matches = await searchMarkdown({ userId, sessionId, fileId: result.file.file_id, query: "Do not close BPSS yet", limit: 5 });
      assert.ok(matches.length >= 1);
      assert.equal(matches[0].fileId, result.file.file_id);
    },
  },
  {
    name: "PDF upload renders page images and records Gemini fallback state",
    run: async () => {
      const sourcePath = path.join(DATASET_ROOT, "policies", "BPSS_Screening_Policy_v3.pdf");
      const result = await initializeUploadAndWait({ userId, sessionId, sourcePath });
      assert.ok(result.file.status === "ready" || result.file.status === "partial");
      assert.equal(result.file.kind, "pdf");
      await assertExists(result.file.upload_path);
      const markdownPath = path.join(sessionRoot(userId, sessionId), String(result.file.derived_paths.markdown));
      const documentPath = path.join(sessionRoot(userId, sessionId), String(result.file.derived_paths.document));
      await assertExists(markdownPath);
      await assertExists(documentPath);

      const document = JSON.parse(await fs.readFile(documentPath, "utf8")) as {
        processed_pages: number;
        rendered_pages: number;
        gemini_markdown_pages: number;
        config: { page_concurrency: number; gemini_retries: number };
        pages: { image: string | null; markdown_source: string }[];
      };
      assert.ok(document.processed_pages >= 1);
      assert.ok(document.rendered_pages >= 1);
      assert.ok(document.config.page_concurrency >= 1);
      assert.ok(document.config.gemini_retries >= 0);
      assert.ok(document.pages.some((page) => page.image));
      if (!process.env.GEMINI_API_KEY) {
        assert.equal(document.gemini_markdown_pages, 0);
        assert.ok(result.file.warnings.some((warning) => warning.includes("GEMINI_API_KEY")));
      }
    },
  },
  {
    name: "Unsupported file stores original and marks manifest unsupported",
    run: async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "doc-harness-"));
      const sourcePath = path.join(tmpDir, "unsupported.txt");
      await fs.writeFile(sourcePath, "not a supported upload", "utf8");

      const result = await initializeUploadAndWait({ userId, sessionId, sourcePath });
      assert.equal(result.file.status, "unsupported");
      assert.equal(result.file.kind, "unsupported");
      assert.match(result.file.error ?? "", /Unsupported file type/);
      await assertExists(result.file.upload_path);
    },
  },
  {
    name: "Session manifest is source of truth",
    run: async () => {
      const manifest = await loadOrCreateManifest(userId, sessionId);
      assert.equal(manifest.user_id, userId);
      assert.equal(manifest.session_id, sessionId);
      assert.ok(manifest.files.length >= 4);
      assert.ok(manifest.files.some((file) => file.status === "unsupported"));
      assert.ok(manifest.files.some((file) => file.status === "partial"));
      await assertExists(path.join(sessionRoot(userId, sessionId), "manifest.json"));
    },
  },
];

async function main() {
  console.log(`Smoke test session: ${userId}/${sessionId}`);
  for (const test of tests) {
    await test.run();
    logPass(test.name);
  }
  console.log(`Completed ${tests.length} smoke tests.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
