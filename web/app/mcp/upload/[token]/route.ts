import { getPublicOrigin } from "mcp-handler";
import { DraftNotFound, loadDraft } from "@/lib/drafts";
import { importDraft } from "@/lib/import-draft";
import { openUploadLink, uploadedText } from "@/lib/import-upload-link";

/** Receives a filled import document as a file, at a link `get_import_upload_link`
 *  handed out, and imports it exactly as `import_draft_results` would.
 *
 * Open without a session (it sits under `mcp/`, see `lib/public-paths.ts`): the
 * agent uploading has none. The link itself is the credential: it names the
 * draft and the caller, sealed with the app's secret, and stops working once
 * the draft has been imported or after its lifetime. Answers in plain text, the
 * same sentence the tool would have returned, so the agent reads one or the
 * other the same way. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const say = (status: number, text: string) =>
    new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

  const secret = process.env.AUTH_SECRET;
  if (!secret) return say(503, "Upload links are not available on this deployment.");

  const { token } = await params;
  const link = openUploadLink(token, secret, Date.now());
  if (link === "invalid") return say(404, "This upload link is not valid.");
  if (link === "expired") {
    return say(410, "This upload link has expired. Ask get_import_upload_link for a new one.");
  }

  let draft;
  try {
    draft = await loadDraft(link.draftId);
  } catch (error) {
    if (error instanceof DraftNotFound) return say(404, error.message);
    throw error;
  }
  // An import moves `launched_at`: a link made before it has already served.
  if (draft.launched_at !== link.launchedAt) {
    return say(
      410,
      `This upload link has already served: draft ${draft.id} was imported since it was made. ` +
        "Ask get_import_upload_link for a new one if you mean to import again.",
    );
  }

  const text = uploadedText(new Uint8Array(await request.arrayBuffer()));
  if (text === null) {
    return say(400, "The file starts like a gzip archive but does not decompress. Nothing was written.");
  }
  if (text.trim() === "") {
    return say(400, "The request carried no file. Send the filled document as the request body.");
  }

  const outcome = await importDraft(draft, text, link.caller, getPublicOrigin(request));
  return say(outcome.ok ? 200 : 422, outcome.text);
}
