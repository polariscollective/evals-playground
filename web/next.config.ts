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
};

export default nextConfig;
