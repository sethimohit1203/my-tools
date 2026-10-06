// Secret handling: AES-256-GCM for stored credentials, HMAC helpers, tokens.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { HttpError } from "./db";

function key(): Buffer {
  const k = process.env.ENCRYPTION_KEY;
  if (!k) throw new HttpError(503, "ENCRYPTION_KEY is not set (32+ random characters).", "not_configured");
  return createHash("sha256").update(k).digest();
}

export function encrypt(value: unknown): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

export function decrypt<T = Record<string, string>>(blob: string | null | undefined): T | null {
  if (!blob) return null;
  const [v, iv, tag, data] = blob.split(".");
  if (v !== "v1") throw new Error("Unknown secret format");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8")) as T;
}

export const randomToken = (bytes = 24) => randomBytes(bytes).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const hmacHex = (secret: string, body: string | Buffer) => createHmac("sha256", secret).update(body).digest("hex");

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Short signed token (for unsubscribe links etc.). */
export function signToken(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", key()).update(body).digest("base64url").slice(0, 32);
  return `${body}.${sig}`;
}
export function verifyToken<T = Record<string, unknown>>(token: string): T | null {
  const [body, sig] = (token || "").split(".");
  if (!body || !sig) return null;
  const expect = createHmac("sha256", key()).update(body).digest("base64url").slice(0, 32);
  if (!safeEqual(sig, expect)) return null;
  try { return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T; } catch { return null; }
}
