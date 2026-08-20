// Qui a le droit d'entrer. La même définition sert à la porte d'entrée Google
// et à toute route qui voudrait revérifier : deux définitions finiraient par
// diverger, et c'est la plus permissive qui l'emporterait.
function parseList(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedEmail(email: string | null | undefined): boolean {
  const normalized = (email || "").trim().toLowerCase();
  if (!normalized) return false;
  if (parseList(process.env.ALLOWED_EMAILS).includes(normalized)) return true;
  const domain = normalized.split("@")[1];
  return Boolean(domain && parseList(process.env.ALLOWED_DOMAINS).includes(domain));
}
