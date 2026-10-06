"use client";
// Run an AI instruction over many rows, a batch per call, filling new columns.
import { aiJSON } from "./settings";

export type Row = Record<string, string>;

export async function processRows(rows: Row[], instruction: string, outputs: string[], opts: { batch?: number; onProgress?: (done: number, total: number) => void; shouldStop?: () => boolean; onBatch?: (rows: Row[]) => void } = {}): Promise<Row[]> {
  const size = opts.batch || 10;
  const out = rows.map((r) => ({ ...r }));
  for (let i = 0; i < rows.length; i += size) {
    if (opts.shouldStop?.()) break;
    opts.onProgress?.(i, rows.length);
    const batch = rows.slice(i, i + size).map((r, j) => ({ _i: i + j, ...r }));
    let attempt = 0;
    for (;;) {
      try {
        const res = await aiJSON<{ rows: Record<string, unknown>[] }>(`${instruction}

For EACH input row produce the output fields: ${outputs.map((o) => `"${o}"`).join(", ")}.
Return JSON {"rows":[{"_i": <same _i as input>, ${outputs.map((o) => `"${o}": "..."`).join(", ")}}]} — one object per input row, same order. Keep values short (they go into spreadsheet cells).

Input rows:
${JSON.stringify(batch)}`, { maxTokens: 6000 });
        for (const r of res.rows || []) {
          const idx = Number(r._i);
          if (!(idx >= 0 && idx < out.length)) continue;
          for (const o of outputs) out[idx][o] = r[o] == null ? "" : typeof r[o] === "object" ? JSON.stringify(r[o]) : String(r[o]);
        }
        break;
      } catch (e) {
        if (++attempt >= 3) { for (const b of batch) out[b._i]["_error"] = (e as Error).message; break; }
        await new Promise((r) => setTimeout(r, 2000 * attempt)); // rate limits on free tiers
      }
    }
    opts.onBatch?.(out);
  }
  opts.onProgress?.(rows.length, rows.length);
  return out;
}

export const PRESETS: { name: string; instruction: string; outputs: string }[] = [
  { name: "Lead scoring (Designoia)", instruction: "You are a sales analyst for Designoia, an Indian web/SEO/social media agency. Judge each business from its data (website present?, rating, reviews, category).", outputs: "Category, Lead Score (0-100), Temperature (HOT/WARM/COLD), Recommended Service, Est. Budget INR, Opening Line" },
  { name: "Clean & categorise businesses", instruction: "Normalise each business: fix capitalisation of the name, guess the business category and city from the data.", outputs: "Clean Name, Category, City" },
  { name: "COL student results remarks", instruction: "You are a teacher at Circle of Learning. Using the marks in each row, write an encouraging, specific remark and a grade.", outputs: "Grade, Strength, Improve, Remark" },
  { name: "ClikiXpress product listings", instruction: "Write e-commerce listing content for each product for an Indian marketplace.", outputs: "SEO Title, Short Description, Bullet Points, Category, Search Keywords" },
  { name: "Personalised outreach messages", instruction: "Write a short, friendly, personalised first-contact WhatsApp message (max 3 lines) from Designoia for each business, mentioning one specific improvement for their online presence.", outputs: "Message" },
  { name: "Sentiment of reviews/feedback", instruction: "Analyse the feedback text in each row.", outputs: "Sentiment (Positive/Neutral/Negative), Theme, Suggested Reply" },
];
