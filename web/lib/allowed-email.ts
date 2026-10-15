// Who is a member. The same definition serves the Google front door, every
// route that checks again, and the restricted readers' rule beside it (see
// `accessOf`, lib/visibility.ts): two definitions would end up diverging, and
// it is the more permissive one that would win.
import { accessOf } from "./visibility.ts";

export function isAllowedEmail(email: string | null | undefined): boolean {
  return accessOf(email) === "member";
}
