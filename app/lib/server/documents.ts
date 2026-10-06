// Simple PDF documents (certificates, question papers) + Supabase Storage.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const latin = (s: string) => s.replace(/₹/g, "Rs.").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "");

export async function makeDocumentPdf(title: string, body: string, layout: "document" | "certificate") {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold), serif = await pdf.embedFont(StandardFonts.TimesRomanBold);
  if (layout === "certificate") {
    const page = pdf.addPage([842, 595]);
    page.drawRectangle({ x: 24, y: 24, width: 794, height: 547, borderColor: rgb(0.31, 0.27, 0.9), borderWidth: 4 });
    page.drawRectangle({ x: 36, y: 36, width: 770, height: 523, borderColor: rgb(0.85, 0.65, 0.13), borderWidth: 1.5 });
    const t = latin(title);
    page.drawText(t, { x: (842 - serif.widthOfTextAtSize(t, 34)) / 2, y: 440, size: 34, font: serif, color: rgb(0.2, 0.2, 0.35) });
    let y = 360;
    for (const line of latin(body).split("\n")) {
      const size = y === 360 ? 18 : 14;
      page.drawText(line, { x: (842 - font.widthOfTextAtSize(line, size)) / 2, y, size, font, color: rgb(0.15, 0.15, 0.15) });
      y -= size + 14;
    }
    return Buffer.from(await pdf.save());
  }
  let page = pdf.addPage([595, 842]);
  let y = 790;
  page.drawText(latin(title).slice(0, 80), { x: 50, y, size: 18, font: bold, color: rgb(0.31, 0.27, 0.9) });
  y -= 30;
  for (const para of latin(body).split("\n")) {
    let cur = "";
    const flush = () => { if (y < 50) { page = pdf.addPage([595, 842]); y = 790; } page.drawText(cur, { x: 50, y, size: 11, font }); y -= 15; cur = ""; };
    for (const w of para.split(" ")) { const tt = cur ? `${cur} ${w}` : w; if (font.widthOfTextAtSize(tt, 11) > 495 && cur) { flush(); cur = w; } else cur = tt; }
    flush();
  }
  return Buffer.from(await pdf.save());
}

export async function storeDocument(ws: string, name: string, pdf: Buffer): Promise<{ stored: boolean; path?: string; url?: string; note?: string }> {
  const base = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, ""), key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return { stored: false, note: "Supabase Storage not configured (SUPABASE_SERVICE_ROLE_KEY) — PDF was generated but not stored" };
  const path = `${ws}/documents/${name}`;
  const up = await fetch(`${base}/storage/v1/object/reports/${path}`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/pdf", "x-upsert": "true" }, body: new Uint8Array(pdf) });
  if (!up.ok) throw new Error(`Storage upload failed (${up.status})`);
  const s = await fetch(`${base}/storage/v1/object/sign/reports/${path}`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 7 * 86400 }) });
  const d = s.ok ? ((await s.json()) as { signedURL?: string; signedUrl?: string }) : {};
  return { stored: true, path, url: d.signedURL || d.signedUrl ? `${base}/storage/v1${d.signedURL || d.signedUrl}` : undefined };
}
