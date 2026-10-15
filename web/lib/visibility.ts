// A run's visibility, and who may see what.
//
// private:    members only, in the application; the shared address answers
//             "not found".
// restricted: also readable at the shared address by the people listed as
//             restricted, signed in; by link only, nothing lists them.
// public:     anyone at the shared address, no sign-in.
//
// Members are ALLOWED_EMAILS / ALLOWED_DOMAINS; restricted readers are
// ALLOWED_RESTRICTED_EMAILS / ALLOWED_RESTRICTED_DOMAINS. Both may sign in;
// only a member may use the application, the API or an agent. Pure, for
// `node --test`: the environment is passed in.

export const VISIBILITIES = ["private", "restricted", "public"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export function isVisibility(value: unknown): value is Visibility {
  return typeof value === "string" && (VISIBILITIES as readonly string[]).includes(value);
}

export type Access = "member" | "restricted";

type ListEnv = Record<string, string | undefined>;

function parseList(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function listed(email: string, emails: string | undefined, domains: string | undefined): boolean {
  if (parseList(emails).includes(email)) return true;
  const domain = email.split("@")[1];
  return Boolean(domain && parseList(domains).includes(domain));
}

/** What `email` may do once signed in, or `null` when it may not sign in. A
 *  member listed as restricted too is a member. */
export function accessOf(
  email: string | null | undefined,
  env: ListEnv = process.env,
): Access | null {
  const normalized = (email || "").trim().toLowerCase();
  if (!normalized) return null;
  if (listed(normalized, env.ALLOWED_EMAILS, env.ALLOWED_DOMAINS)) return "member";
  if (listed(normalized, env.ALLOWED_RESTRICTED_EMAILS, env.ALLOWED_RESTRICTED_DOMAINS)) {
    return "restricted";
  }
  return null;
}

/** What a visitor gets at a run's shared address: the run, a page saying it
 *  is restricted (sign in, or ask for access), or "not found". */
export function sharedView(
  visibility: Visibility,
  access: Access | null,
): "show" | "restricted" | "not_found" {
  if (visibility === "public") return "show";
  if (visibility === "restricted") return access ? "show" : "restricted";
  return "not_found";
}

/** A run's visibility, read from `visibility`, or from `is_public` on a row
 *  read before that column existed. */
export function visibilityOf(run: {
  visibility?: string | null;
  is_public?: boolean | null;
}): Visibility {
  if (isVisibility(run.visibility)) return run.visibility;
  return run.is_public ? "public" : "private";
}

/** The request header the proxy writes on every page it lets through: the
 *  path asked for. Absent on the paths the proxy never sees (`/shared`,
 *  `/signin`, `/inspect-view`, ...), which are the ones a restricted reader
 *  may open. A client cannot forge it on the others: the proxy overwrites it. */
export const PATH_HEADER = "x-playground-path";

/** The paths a restricted reader may open: a run's shared page, its Inspect
 *  log, and the sign-in screen. Everything else in the application is for
 *  members. */
const READER_PREFIXES = ["/shared", "/inspect-view", "/signin"];

/** Whether the application's page at `path` is shown to this visitor. Only a
 *  restricted reader is ever turned away here: a stranger is sent to sign in
 *  by the proxy, and a member sees everything. */
export function pageAllowed(access: Access | null, path: string | null): boolean {
  if (access !== "restricted" || path === null) return true;
  return READER_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
