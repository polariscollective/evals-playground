import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import {
  ConfigFileError,
  readConfigFile,
  writeConfigFile,
} from "@/lib/config-file";
import type { EvalRunConfig } from "@/lib/types";

/** Reads a run described in a JSON or YAML file, and returns it ready to fill
 * in the form.
 *
 * On the server side for two reasons: the YAML parser stays out of the bundle
 * sent to the browser, and the validation that applies here is exactly the
 * launch's — a file accepted here cannot be refused at launch time. */
export async function POST(request: Request) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const body = (await request.json().catch(() => null)) as {
    text?: string;
  } | null;

  if (typeof body?.text !== "string" || body.text.trim() === "") {
    return NextResponse.json({ error: "The file is empty." }, { status: 422 });
  }

  try {
    return NextResponse.json(readConfigFile(body.text));
  } catch (error) {
    if (error instanceof ConfigFileError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}

/** The reverse path: the form's configuration, written in YAML.
 *
 * Here rather than in the page for two reasons: the YAML writer stays out of the
 * browser bundle, and the two directions of the same conversion live side by
 * side — which is what makes it visible that they must stay in agreement. */
export async function PUT(request: Request) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const body = (await request.json().catch(() => null)) as {
    config?: EvalRunConfig;
  } | null;

  if (!body?.config) {
    return NextResponse.json({ error: "config is missing." }, { status: 422 });
  }

  return NextResponse.json({ text: writeConfigFile(body.config) });
}
