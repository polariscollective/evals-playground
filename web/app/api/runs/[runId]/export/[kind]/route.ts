import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { NotFound, loadRun } from "@/lib/runs";
import { detailsCsv, matrixCsv, runMarkdown } from "@/lib/exports";
import { zip } from "@/lib/zip";
import { csvResponse } from "@/lib/csv-response";
import { isPlainView, viewFromQuery } from "@/lib/view";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string; kind: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId, kind } = await params;
  if (kind !== "matrix" && kind !== "details") {
    return NextResponse.json({ error: `Unknown export: ${kind}` }, { status: 404 });
  }

  try {
      // The details copy the transcripts; the matrix does not use them, but a
      // single read avoids two paths to keep aligned. `withJudges`, combined with
      // `withTranscripts`, brings back EVERY living judge's verdict
      // (`attachJudges`, `lib/runs.ts`, `fullScores`) — without it, `exports.ts`
      // would have only the cells, no grade living on `EvalSample` any more since
      // the multiple judges.
    const { run, samples, judges } = await loadRun(runId, {
      withTranscripts: true,
      withJudges: true,
    });
      // The view comes from the request: the server does not see the screen, and a
      // CSV that said something other than the displayed matrix would be worse
      // than useless. The details, for their part, carry the judge's raw grades
      // and have nothing to do with it.
    const view = viewFromQuery(new URL(request.url).searchParams);

    if (kind === "details") {
      // Two files, because they do not mix: one row per cell on one side, what
      // holds for the whole run on the other. The notes and the tool
      // descriptions copied onto every row of a CSV were read by nobody.
      const name = `run-${runId}`;
      const archive = zip([
        { name: `${name}/results.csv`, content: detailsCsv(run, samples, judges ?? []) },
        { name: `${name}/run.md`, content: runMarkdown(run, samples, judges ?? []) },
      ]);
      return new Response(new Uint8Array(archive), {
        headers: {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="${name}.zip"`,
          "cache-control": "no-store",
        },
      });
    }

    const body = matrixCsv(run, samples, judges ?? [], view);
      // The file's name carries the view: two exports of the same run, read
      // differently, must not overwrite each other in the downloads folder. The
      // scale's remapping figures there too, without which a mean on a folded
      // scale would bear the same name as a plain mean.
    const suffix =
      kind === "matrix" && !isPlainView(view)
        ? `-${view.aggregate}${Object.keys(view.remap).length > 0 ? "-remapped" : ""}`
        : "";
    return csvResponse(body, `${kind}${suffix}-${runId}.csv`);
  } catch (error) {
    if (error instanceof NotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
