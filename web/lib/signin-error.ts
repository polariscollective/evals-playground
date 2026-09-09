/** The sentence a failed sign-in puts above the button, or null for none.
 *
 * Three cases, because three of them are true. `Configuration` is what
 * Auth.js reports when a variable is missing from the deployment — the same
 * failure `requireUser()` already names rather than letting the platform
 * answer 500. Folding it into `AccessDenied` would tell the whole collective
 * it had been struck off the list on the day someone forgot `AUTH_SECRET`.
 *
 * Auth.js passes the reason as `?error=`, and Next gives a query value as an
 * array when the key appears twice. Normalising here rather than in the page
 * keeps the whole decision on the side a test can reach. */
export function signInMessage(
  error: string | string[] | undefined,
): string | null {
  const reason = Array.isArray(error) ? error[0] : error;
  if (!reason) return null;
  if (reason === "AccessDenied") {
    return "That address does not open the application.";
  }
  if (reason === "Configuration") {
    return "Sign-in is not configured on this deployment.";
  }
  return "Something went wrong signing in. Try again.";
}
