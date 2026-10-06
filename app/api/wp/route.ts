// WordPress REST proxy — avoids browser CORS blocks on client sites.
import { NextRequest, NextResponse } from "next/server";
import { wpRequest, wpUploadData, wpUploadFromUrl } from "@/app/lib/server/channels";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  try {
    if (b.action === "uploadData") return NextResponse.json({ data: await wpUploadData(b, b.dataUrl, b.filename, b.alt, b.title) });
    if (b.action === "upload") return NextResponse.json({ data: await wpUploadFromUrl(b, b.imageUrl, b.filename, b.alt) });
    return NextResponse.json({ data: await wpRequest(b, b.method || "GET", b.endpoint, b.query, b.payload) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
