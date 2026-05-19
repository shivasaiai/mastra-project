# Document Ingestion Pipeline — Design Spec

> **Project:** Multi-Agent RAG Chatbot (Mastra / TypeScript)  
> **Goal:** Convert uploaded documents into structured retrieval nodes for RAG.

---

## Shared Architecture

Every pipeline follows the same shape:

```
File → Parse → Build Node Tree → Attach Metadata → Output JSON / Markdown
```

### Common Output Node

```ts
interface RetrievalNode {
  id: string;                // unique node id
  type: NodeType;            // see per-pipeline types
  content: string;           // markdown content of this node
  metadata: {
    source_file: string;
    document_id: string;
    parent: string | null;   // parent node id
    children: string[];      // child node ids
    token_count: number;
    [key: string]: any;      // pipeline-specific fields below
  };
}
```

All pipelines produce `RetrievalNode[]`.

---

## 1. PDF Pipeline

**Input:** `.pdf`

**Approach:** Vision-based. Render each page as a high-res PNG → send to Gemini Flash → get back Markdown.

**Processing:**
1. Render page to PNG (`unpdf` / `pdfjs`)
2. Send image to Gemini Flash with the vision prompt (already built in `vision.ts`)
3. Receive Markdown per page
4. Parse headings from Markdown to build hierarchy
5. Attach page-level metadata

**Node Types:** `page`, `heading`, `paragraph`, `table`, `figure`, `equation`

**Metadata (per page node):**
```ts
{ document_id, page_number, source_file, parent, children, token_count }
```

**Chunking:** One node per page. Headings within a page become child nodes if needed for finer retrieval.

---

## 2. DOCX Pipeline

**Input:** `.doc`, `.docx`

**Approach:** Structural extraction using `mammoth` (DOCX → HTML → Markdown) or `docx` library for direct XML access.

**Processing:**
1. Parse DOCX with `mammoth` → get HTML
2. Walk HTML to extract: headings, paragraphs, tables, lists, images, equations
3. Build a heading-based tree (H1 → H2 → H3 → content under each)
4. Embedded images → extract as buffers → send to Gemini Flash for a one-line summary
5. Tables → convert to Markdown table syntax
6. Equations (if OMML present) → best-effort convert to LaTeX, otherwise describe

**Node Types:** `heading`, `paragraph`, `table`, `list`, `image_summary`, `equation`

**Metadata:**
```ts
{ document_id, section: string, heading: string, depth: number, parent, children, token_count, source_file }
```

**Chunking:** One node per heading section. Large sections (>1000 tokens) split into paragraph-level children.

---

## 3. CSV Pipeline

**Input:** `.csv`

**Approach:** Read with a streaming CSV parser (e.g., `papaparse`). Detect schema, chunk rows.

**Processing:**
1. Read CSV, detect headers
2. Infer column types: numeric vs categorical (simple heuristic — try `parseFloat`, check unique ratio)
3. Generate a `schema` node describing columns and types
4. Generate a `statistics` node with basic stats (min/max/mean for numeric, top-N values for categorical)
5. If rows ≤ 1000: one `table` node with full Markdown table
6. If rows > 1000: split into row-groups of ~100 rows each → each becomes a `row_group` child node, parent is a `table` summary node
7. Preserve header row in every chunk

**Node Types:** `schema`, `table`, `row_group`, `statistics`

**Metadata:**
```ts
{ source_file, document_id, table_id: string, columns: string[], row_range: [number, number], data_types: Record<string, string>, token_count }
```

---

## 4. Excel Pipeline

**Input:** `.xlsx`, `.xls`

**Approach:** Use `exceljs` or `xlsx` (SheetJS) to read workbook structure.

**Processing:**
1. Read workbook → iterate sheets (including hidden ones, flag them)
2. Per sheet:
   - Extract tables, merged cells, formulas, comments
   - Convert cell data to Markdown table
   - Generate sheet summary (row/col count, named ranges, formula count)
   - If chart metadata exists, extract chart type + data range as a text description
3. Large sheets (>1000 rows): split into row-group segments (~100 rows), same as CSV
4. Build hierarchy: `workbook` → `sheet` → `table` / `formula` / `chart_summary`

**Node Types:** `workbook`, `sheet`, `table`, `row_group`, `formula`, `chart_summary`, `statistics`

**Metadata:**
```ts
{ source_file, document_id, workbook: string, sheet: string, range: string, parent, children, node_type: string, token_count, is_hidden: boolean }
```

---

## 5. Markdown Pipeline

**Input:** `.md`

**Approach:** Already Markdown — just parse structure.

**Processing:**
1. Parse Markdown AST (e.g., `remark` / `unified`)
2. Walk AST to find headings → build heading tree
3. Each heading section becomes a node with its content
4. Top-level content (before first heading) → a root `paragraph` node

**Node Types:** `heading`, `paragraph`, `code_block`, `table`, `list`

**Metadata:**
```ts
{ source_file, document_id, heading: string, depth: number, parent, children, token_count }
```

**Chunking:** One node per heading section. No further splitting unless a section exceeds ~1500 tokens.

---

## 6. PPT / PPTX Pipeline

**Input:** `.ppt`, `.pptx`

**Approach:** Hybrid — structural extraction + vision. Extract what we can structurally, then render each slide as an image and send to Gemini Flash for layout/diagram/chart understanding.

**Processing:**
1. Parse PPTX with `pptxgenjs` or `officegen` (read mode) — or use `python-pptx` via a thin CLI wrapper if TS libs are insufficient
2. Per slide, extract: title, text boxes, tables, speaker notes
3. Render each slide as an image (use LibreOffice headless or a canvas-based renderer)
4. Send slide image to Gemini Flash with prompt: *"Analyze this slide. Preserve layout, diagrams, charts, image meaning, table content. Output Markdown."*
5. Merge structural text + vision Markdown (vision is primary, structural fills gaps like speaker notes)
6. Large presentations (>30 slides): group into slide-group summaries (e.g., slides 1-10 summary)

**Node Types:** `presentation`, `slide`, `slide_group_summary`

**Metadata:**
```ts
{ source_file, document_id, slide_number: number, title: string, presentation: string, has_notes: boolean, token_count }
```

---

## Pipeline Router

A single entry point that routes by file extension:

```ts
async function ingest(file: Buffer, filename: string): Promise<RetrievalNode[]> {
  const ext = path.extname(filename).toLowerCase();

  switch (ext) {
    case ".pdf":        return pdfPipeline(file, filename);
    case ".doc":
    case ".docx":       return docxPipeline(file, filename);
    case ".csv":        return csvPipeline(file, filename);
    case ".xlsx":
    case ".xls":        return excelPipeline(file, filename);
    case ".md":         return markdownPipeline(file, filename);
    case ".ppt":
    case ".pptx":       return pptxPipeline(file, filename);
    default:            throw new Error(`Unsupported file type: ${ext}`);
  }
}
```

---

## Key Libraries (TypeScript)

| Pipeline | Primary Library | Fallback / Notes |
|----------|----------------|------------------|
| PDF | `unpdf` + Gemini Flash | Already built (`vision.ts`) |
| DOCX | `mammoth` | `docx` for lower-level access |
| CSV | `papaparse` | Built-in streaming support |
| Excel | `exceljs` | `xlsx` (SheetJS) as alternative |
| Markdown | `remark` / `unified` | Direct AST parsing |
| PPTX | LibreOffice headless + Gemini Flash | Structural extraction as supplement |

---

## What This Does NOT Cover

- Embedding / vector store logic (downstream of this spec)
- Agent orchestration (handled by Mastra agents layer)
- File upload API (separate concern)
- Auth / multi-tenancy
