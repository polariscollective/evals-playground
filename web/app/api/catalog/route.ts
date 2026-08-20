import { NextResponse } from "next/server";
import { catalog } from "@/lib/catalog";

export async function GET() {
  return NextResponse.json(catalog());
}
