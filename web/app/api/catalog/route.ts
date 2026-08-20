import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { catalog } from "@/lib/catalog";

export async function GET() {
  const user = await requireUser();
  if ("response" in user) return user.response;

  return NextResponse.json(catalog());
}
