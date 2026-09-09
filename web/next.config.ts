import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // The root goes up one notch so that `shared/` resolves: Turbopack resolves
    // nothing outside the project root, and the prices as well as the judge
    // prompt's templates live at the repository root, shared with the job's
    // Python. Copying them here would be exactly what one is trying to avoid —
    // two copies that end up drifting apart.
    root: path.join(__dirname, ".."),
  },

  // The advice pages were called `/scenarios` back when there was one document
  // and it was about scenarios. There are four now — writing a scenario,
  // putting a batch together, reading the results, writing a judge — and the
  // old name described a quarter of what lives there.
  //
  // Permanent, and the old addresses keep working, because `/shared/scenarios`
  // is a PUBLIC link: it is printed in `docs/evals-methodology.md`, which is
  // the document this project hands to people asking for feedback, and it has
  // been sent to readers who have no reason to know anything moved. A rename
  // that breaks a link somebody else holds is a rename that was not worth it.
  //
  // `?topic=` rides along on its own: Next carries the query string through a
  // redirect unless told otherwise.
  async redirects() {
    return [
      { source: "/scenarios", destination: "/advice", permanent: true },
      // `/scenario-advice` and `/prompt` served those documents as plain text to
      // an agent that could fetch a URL but not hold the connector. Both routes
      // are gone — two ways in, not three — so there is nothing left to send
      // those addresses to. The advice is still readable without an account at
      // `/shared/advice`, which is where a person who has no session goes.
      { source: "/scenario-advice", destination: "/shared/advice", permanent: true },
      {
        source: "/shared/scenarios",
        destination: "/shared/advice",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
