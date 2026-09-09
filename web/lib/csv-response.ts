/** A CSV the browser saves instead of displaying.
 *
 * The UTF-8 BOM is there for Excel, which without it reads accents as latin-1
 * and shows "Accès données" as mojibake. */
export function csvResponse(body: string, filename: string): Response {
  return new Response(`﻿${body}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
