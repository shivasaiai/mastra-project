export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function safeSnippet(text: string, maxLen = 240): string {
  const t = normalizeWhitespace(text);
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

export function slugify(input: string, fallback = "sheet"): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || fallback;
}

export function toMarkdownTable(rows: Record<string, unknown>[], columns: string[], limit = 20): string {
  const visibleRows = rows.slice(0, limit);
  if (columns.length === 0) return "_No columns detected._\n";
  const clean = (value: unknown) =>
    String(value ?? "")
      .replace(/\r?\n/g, " ")
      .replace(/\|/g, "\\|");
  const header = `| ${columns.map(clean).join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = visibleRows.map((row) => `| ${columns.map((column) => clean(row[column])).join(" | ")} |`);
  return [header, divider, ...body].join("\n") + "\n";
}
