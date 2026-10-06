// Template resolution for step configs: "{{name}}", "{{steps.audit.score}}".
import { getPath, renderTemplate } from "../../csv";
import type { ConditionOp, Rule } from "../../automation/types";

export type Ctx = { record: Record<string, unknown>; steps: Record<string, unknown>; vars: Record<string, unknown>; run: { id: string; is_test: boolean }; now: string; today: string };

export function scope(ctx: Ctx) {
  return { ...ctx.record, record: ctx.record, input: ctx.record, steps: ctx.steps, vars: ctx.vars, run: ctx.run, now: ctx.now, today: ctx.today };
}

/** Render to string. */
export function t(v: unknown, ctx: Ctx): string {
  if (v == null) return "";
  return renderTemplate(String(v), scope(ctx));
}

/** Render keeping the raw type when the whole value is a single placeholder. */
export function val(v: unknown, ctx: Ctx): unknown {
  if (typeof v !== "string") return v;
  const m = v.match(/^\s*\{\{\s*([\w.\- ]+?)\s*\}\}\s*$/);
  if (m) return getPath(scope(ctx), m[1].trim());
  return t(v, ctx);
}

/** Render a JSON template (string or object) into a value. */
export function jsonVal(v: unknown, ctx: Ctx): unknown {
  if (v == null || v === "") return undefined;
  if (typeof v === "object") return deepRender(v, ctx);
  const s = String(v);
  const rendered = s.replace(/\{\{\s*([\w.\- ]+?)\s*\}\}/g, (_, p: string) => {
    const x = getPath(scope(ctx), p.trim());
    if (x != null && typeof x === "object") return JSON.stringify(x);
    return JSON.stringify(x == null ? "" : String(x)).slice(1, -1);
  });
  try { return JSON.parse(rendered); } catch { return rendered; }
}

function deepRender(o: unknown, ctx: Ctx): unknown {
  if (Array.isArray(o)) return o.map((x) => deepRender(x, ctx));
  if (o && typeof o === "object") return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, deepRender(x, ctx)]));
  return val(o, ctx);
}

/** "fields" configs are stored as [{key, value}] or {key: value}. */
export function fieldMap(v: unknown, ctx: Ctx): Record<string, unknown> {
  const pairs: [string, unknown][] = Array.isArray(v) ? (v as { key: string; value: unknown }[]).filter((x) => x?.key).map((x) => [x.key, x.value]) : Object.entries((v as Record<string, unknown>) || {});
  return Object.fromEntries(pairs.map(([k, x]) => [k, val(x, ctx)]));
}

function cmp(left: unknown, op: ConditionOp, right: string): boolean {
  const l = left == null ? "" : typeof left === "object" ? JSON.stringify(left) : String(left);
  const num = (x: string) => Number(String(x).replace(/[^\d.-]/g, ""));
  switch (op) {
    case "equals": return l.trim().toLowerCase() === right.trim().toLowerCase();
    case "not_equals": return l.trim().toLowerCase() !== right.trim().toLowerCase();
    case "contains": return l.toLowerCase().includes(right.toLowerCase());
    case "not_contains": return !l.toLowerCase().includes(right.toLowerCase());
    case "gt": return l !== "" && num(l) > num(right);
    case "lt": return l !== "" && num(l) < num(right);
    case "gte": return l !== "" && num(l) >= num(right);
    case "lte": return l !== "" && num(l) <= num(right);
    case "exists": return l.trim() !== "" && l !== "[]" && l !== "{}";
    case "empty": return l.trim() === "" || l === "[]" || l === "{}";
    default: return false;
  }
}

export function evalRules(rules: Rule[] | undefined, combinator: string | undefined, ctx: Ctx): { pass: boolean; details: { left: unknown; op: string; right: string; pass: boolean }[] } {
  const list = (rules || []).filter((r) => r && r.left);
  if (!list.length) return { pass: true, details: [] };
  const details = list.map((r) => {
    const left = val(r.left.includes("{{") ? r.left : `{{${r.left}}}`, ctx);
    const right = t(r.right ?? "", ctx);
    return { left, op: r.op, right, pass: cmp(left, r.op, right) };
  });
  const pass = combinator === "or" ? details.some((d) => d.pass) : details.every((d) => d.pass);
  return { pass, details };
}
