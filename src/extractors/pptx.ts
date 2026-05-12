import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { extractedRoot, relativeToSession } from "../document-store/paths.js";
import { ensureDir, writeJson, writeText } from "../utils/fs.js";
import { normalizeWhitespace } from "../utils/text.js";
import { ExtractionResult } from "./types.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "text",
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function collectText(node: unknown): string[] {
  if (!node || typeof node !== "object") return [];
  const record = node as Record<string, unknown>;
  const ownText = typeof record.text === "string" ? [record.text] : [];
  return Object.values(record).reduce<string[]>((acc, value) => {
    if (typeof value === "object") acc.push(...collectText(value));
    return acc;
  }, ownText);
}

async function readXml(zip: JSZip, filePath: string): Promise<Record<string, unknown> | null> {
  const file = zip.file(filePath);
  if (!file) return null;
  return parser.parse(await file.async("text")) as Record<string, unknown>;
}

function extractSlideNumber(fileName: string): number {
  const match = fileName.match(/slide(\d+)\.xml$/);
  return match ? Number(match[1]) : 0;
}

async function extractChart(zip: JSZip, chartPath: string, chartId: string, chartsRoot: string) {
  const chartXml = await readXml(zip, chartPath);
  const text = normalizeWhitespace(collectText(chartXml).join(" "));
  const chart = {
    chart_id: chartId,
    source_part: chartPath,
    data_status: text ? "partial_xml_text" : "unavailable",
    extracted_text: text,
    warning: "Native chart XML was parsed best-effort; embedded workbook extraction is not implemented in V1.",
  };
  const output = path.join(chartsRoot, `${chartId}.json`);
  await writeJson(output, chart);
  return output;
}

export async function extractPptx(
  userId: string,
  sessionId: string,
  fileId: string,
  sourcePath: string,
): Promise<ExtractionResult> {
  const root = extractedRoot(userId, sessionId, "pptx", fileId);
  const slidesRoot = path.join(root, "slides");
  const mediaRoot = path.join(root, "media");
  const chartsRoot = path.join(root, "charts");
  await ensureDir(slidesRoot);
  await ensureDir(mediaRoot);
  await ensureDir(chartsRoot);

  const zip = await JSZip.loadAsync(await fs.readFile(sourcePath));
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((left, right) => extractSlideNumber(left) - extractSlideNumber(right));

  const mediaFiles = Object.keys(zip.files).filter((name) => /^ppt\/media\//.test(name));
  const extractedMedia = [];
  for (const mediaFile of mediaFiles) {
    const file = zip.file(mediaFile);
    if (!file) continue;
    const outputPath = path.join(mediaRoot, path.basename(mediaFile));
    await fs.writeFile(outputPath, await file.async("nodebuffer"));
    extractedMedia.push(relativeToSession(userId, sessionId, outputPath));
  }

  const chartFiles = Object.keys(zip.files).filter((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name));
  const charts = [];
  for (const [index, chartFile] of chartFiles.entries()) {
    const chartId = `chart_${String(index + 1).padStart(3, "0")}`;
    const output = await extractChart(zip, chartFile, chartId, chartsRoot);
    charts.push({ chart_id: chartId, path: relativeToSession(userId, sessionId, output), source_part: chartFile });
  }

  const slides = [];
  for (const [index, slideFile] of slideFiles.entries()) {
    const slideNumber = index + 1;
    const slideId = `slide_${String(slideNumber).padStart(3, "0")}`;
    const slideXml = await readXml(zip, slideFile);
    const texts = collectText(slideXml).map(normalizeWhitespace).filter(Boolean);
    const title = texts[0] ?? `Slide ${slideNumber}`;
    const markdownPath = path.join(slidesRoot, `${slideId}.md`);
    const structurePath = path.join(slidesRoot, `${slideId}.structure.json`);
    const markdown = [
      `# Slide ${slideNumber}: ${title}`,
      "",
      "## Text",
      ...(texts.length ? texts.map((text) => `- ${text}`) : ["_No extractable text found._"]),
      "",
      "## Images",
      extractedMedia.length ? "_Images are extracted at deck level; relationship-level slide mapping is best-effort in V1._" : "_No embedded images extracted._",
      "",
      "## Charts",
      charts.length ? charts.map((chart) => `- ${chart.path}: ${chart.source_part}`).join("\n") : "_No native chart XML detected._",
      "",
      "## Warnings",
      "- Slide rendering is not enabled in this local runtime.",
      "",
    ].join("\n");

    await writeText(markdownPath, markdown);
    await writeJson(structurePath, {
      slide_number: slideNumber,
      source_part: slideFile,
      title_candidate: title,
      render_path: null,
      object_count: texts.length,
      objects: texts.map((text, objectIndex) => ({
        object_id: `text_${String(objectIndex + 1).padStart(3, "0")}`,
        type: "text",
        text,
      })),
      warnings: ["Slide rendering and precise relationship-level object geometry are not implemented in V1."],
    });

    slides.push({
      slide_number: slideNumber,
      title,
      markdown: relativeToSession(userId, sessionId, markdownPath),
      structure: relativeToSession(userId, sessionId, structurePath),
    });
  }

  const deckPath = path.join(root, "deck.json");
  const warnings = ["PPTX extraction is XML-based; slide PNG rendering and precise geometry are optional future stages."];
  await writeJson(deckPath, {
    file_id: fileId,
    slide_count: slideFiles.length,
    media_count: extractedMedia.length,
    chart_count: charts.length,
    slides,
    media: extractedMedia,
    charts,
    warnings,
  });

  return {
    status: "partial",
    derivedPaths: {
      deck: relativeToSession(userId, sessionId, deckPath),
      slides_dir: relativeToSession(userId, sessionId, slidesRoot),
      media_dir: relativeToSession(userId, sessionId, mediaRoot),
      charts_dir: relativeToSession(userId, sessionId, chartsRoot),
    },
    warnings,
  };
}

