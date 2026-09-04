// Le calcul derrière un jeton MCP : rien qui touche la base, tout ce qui se
// teste. Séparé de `mcp-auth.ts`, qui est `server-only` et qu'un import
// direct rendrait invisible à `node --test`.
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

/** Un secret opaque — code d'autorisation ou jeton — prêt à circuler dans une
 *  URL ou un en-tête : 32 octets, en base64url, sans remplissage. */
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

/** Comparaison à temps constant : un secret se compare comme un secret, pas
 *  comme une chaîne ordinaire — sinon la durée de la comparaison fuit le
 *  nombre de caractères déjà corrects. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Un `code_verifier` reproduit-il le `code_challenge` posé à l'autorisation ? */
export function pkceMatches(verifier: string, challenge: string): boolean {
  return safeEqual(challengeOf(verifier), challenge);
}
