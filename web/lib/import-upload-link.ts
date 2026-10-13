// The link an agent sends a filled import document to, as a file rather than as
// tool-call text: a large run's results are megabytes the agent would otherwise
// have to write out token by token, and often cannot.
//
// The link is its own credential. Whoever uploads to it carries no session and
// no MCP token, so it says by itself which draft it fills and on whose behalf.
// It is encrypted rather than only signed: the caller's address must not be
// readable from a URL that ends up in logs.
//
// Nothing here touches the database, so that `node --test` can reach it.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { gunzipSync } from "node:zlib";

/** Long enough to play a large run's last cells after asking for it, short
 *  enough that a link left in a transcript is soon worthless. */
export const UPLOAD_LINK_TTL_MS = 30 * 60 * 1000;

export interface UploadLink {
  draftId: string;
  /** The MCP caller who asked for the link: the import is theirs. */
  caller: string;
  /** The draft's `launched_at` when the link was made. An import changes it, so
   *  a link no longer matching the draft has already served. */
  launchedAt: string | null;
}

/** Derived from the app's secret, never the secret itself: this key does one
 *  thing only. */
function keyOf(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "", "evals-playground import upload link", 32));
}

export function sealUploadLink(link: UploadLink, secret: string, now: number): string {
  const payload = JSON.stringify({
    d: link.draftId,
    u: link.caller,
    l: link.launchedAt,
    e: now + UPLOAD_LINK_TTL_MS,
  });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyOf(secret), iv);
  const body = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** What the link carries, or why it does not open. Never throws: a token is
 *  whatever a stranger typed into a URL. */
export function openUploadLink(
  token: string,
  secret: string,
  now: number,
): (UploadLink & { expiresAt: number }) | "invalid" | "expired" {
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 12 + 16 + 1) return "invalid";
    const decipher = createDecipheriv("aes-256-gcm", keyOf(secret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const payload = JSON.parse(
      Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8"),
    ) as { d: string; u: string; l: string | null; e: number };
    if (now > payload.e) return "expired";
    return { draftId: payload.d, caller: payload.u, launchedAt: payload.l, expiresAt: payload.e };
  } catch {
    return "invalid";
  }
}

/** The uploaded document as text, gunzipped first when it arrives compressed
 *  (recognised by gzip's two magic bytes, whatever the headers claim). `null`
 *  for a compressed file that does not decompress. */
export function uploadedText(bytes: Uint8Array): string | null {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      return gunzipSync(bytes).toString("utf8");
    } catch {
      return null;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}
