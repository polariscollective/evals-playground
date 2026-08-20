import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // La racine remonte d'un cran pour que `shared/` soit résoluble : Turbopack
    // ne résout rien hors de la racine du projet, et les tarifs comme les
    // gabarits du prompt du juge vivent à la racine du dépôt, partagés avec le
    // Python du job. Les recopier ici serait exactement ce qu'on cherche à
    // éviter — deux copies qui finissent par diverger.
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;
