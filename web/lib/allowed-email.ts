// Who is allowed in. The same definition serves the Google front door and any
// route that wants to check again: two definitions would end up
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
