/** Un CSV que le navigateur enregistre au lieu de l'afficher.
 *
 * Le BOM UTF-8 est là pour Excel, qui sans lui lit les accents en latin-1 et
 * affiche « Accès données » en mojibake. */
export function csvResponse(body: string, filename: string): Response {
  return new Response(`﻿${body}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
