/** The collective's star, from the header of polariscollective.org.
 *
 * One `d` for the two places that draw it — the navigation bar and the
 * sign-in page. `app/icon.svg` holds a third copy and cannot share this one:
 * it is served straight off disk and never passes through the bundler, which
 * is exactly what its own comment warns about.
 *
 * `currentColor` rather than a fill of its own: every caller already sets a
 * text colour, and the star is meant to follow it. */
export function PolarisStar({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d="M7 0.5 L7.6 6.4 L13.5 7 L7.6 7.6 L7 13.5 L6.4 7.6 L0.5 7 L6.4 6.4 Z"
        fill="currentColor"
      />
    </svg>
  );
}
