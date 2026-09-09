// The computation behind an MCP token: nothing that touches the database,
// everything that can be tested. Separated from `mcp-auth.ts`, which is
// `server-only` and which a direct import would make invisible to
// `node --test`.
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

/** An opaque secret — authorisation code or token — ready to travel in a URL
 *  or a header: 32 bytes, base64url, no padding. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** L'empreinte d'un secret, pour ne jamais le garder en clair en base. */
export function hashOf(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Le challenge PKCE S256 attendu d'un `code_verifier` — RFC 7636 §4.2. */
export function challengeOf(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Constant-time comparison: a secret is compared as a secret, not as an
 *  ordinary string — otherwise the comparison's duration leaks how many
 *  characters are already right. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Does a `code_verifier` reproduce the `code_challenge` set at authorisation? */
export function pkceMatches(verifier: string, challenge: string): boolean {
  return safeEqual(challengeOf(verifier), challenge);
}
