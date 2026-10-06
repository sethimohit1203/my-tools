// CSV parse/serialize, downloads and {{template}} rendering — shared, isomorphic.

export function toCSV(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns || [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [cols.map(esc).join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

export function csvToObjects(text: string): Record<string, string>[] {
  const [head, ...rest] = parseCSV(text);
  if (!head) return [];
  const keys = head.map((h, i) => h.trim() || `col${i + 1}`);
  return rest.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ""])));
}

export function download(content: string | Blob, filename: string, mime = "text/plain") {
  const blob = typeof content === "string" ? new Blob([content], { type: mime }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadCSV(rows: Record<string, unknown>[], filename: string, columns?: string[]) {
  download("﻿" + toCSV(rows, columns), filename, "text/csv;charset=utf-8");
}

/** Resolve a dotted path like "input.name" or "steps.ai.score". */
export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o != null && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

/** Replace {{path}} placeholders. Objects are inserted as JSON. */
export function renderTemplate(tpl: string, ctx: unknown): string {
  return (tpl || "").replace(/\{\{\s*([\w.\- ]+?)\s*\}\}/g, (_, p: string) => {
    const v = getPath(ctx, p.trim());
    if (v == null) return "";
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  });
}

export function slugify(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
