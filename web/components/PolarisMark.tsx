/** The broken orbit: the collective's mark, and the only one.
 *
 * The framework fixes the drawing on a 48 unit grid, and this is that drawing
 * exactly. A star of four unequal straight rays — north 19, south 9, east and
 * west 6.5, meeting at a waist of radius 3.6, which is what makes the junctions
 * concave and the points sharp — set at (22.5, 26.5), up and to the left of the
 * ring's centre at (24, 26). The framework fixes every one of those numbers but
 * the waist: 3.6 is what it takes for the star to still read as a star at
 * twenty-two pixels, where a narrower one is swallowed by the ring. The ring is an arc of 300 degrees, radius 16,
 * stroke 2.5, its gap of 60 degrees centred on the top. The north ray leaves
 * through that gap and stops at y = 7.5, outside the ring, touching nothing.
 *
 * Never close the ring, never equalise the rays, never add one, never redraw it
 * as a sparkle. The open arc, the off-centre star and the escaping ray are the
 * identity; what is left without them is a generic star.
 *
 * `currentColor` for both fill and stroke: the caller sets a text colour and the
 * mark follows it. Olive-deep on paper surfaces, gold on olive-deep ones.
 *
 * `app/icon.svg` holds a second copy of the geometry and cannot share this one:
 * it is served straight off disk and never passes through the bundler. The two
 * are kept in step by hand, and by nothing else. */
/** The collective's site, which is where the mark leads from anywhere it is
 *  drawn. It opens in a tab of its own: this application holds editors with
 *  unsaved work, and a click on a signature should never be able to lose it. */
export const POLARIS_SITE = "https://polariscollective.org";

export function PolarisMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d="M 16 12.144 A 16 16 0 1 0 32 12.144"
        stroke="currentColor"
        strokeWidth="2.5"
        fill="none"
      />
      <path
        d="M 22.500 7.500 L 25.046 23.954 L 29 26.500 L 25.046 29.046 L 22.500 35.500 L 19.954 29.046 L 16 26.500 L 19.954 23.954 Z"
        fill="currentColor"
      />
    </svg>
  );
}
