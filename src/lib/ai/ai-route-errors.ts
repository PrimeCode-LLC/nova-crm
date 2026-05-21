import { NextResponse } from "next/server";
import { AiForbiddenError, AiNotConfiguredError } from "@/lib/ai/run-feature";

export function aiErrorResponse(e: unknown): NextResponse {
  if (e instanceof AiForbiddenError) {
    return NextResponse.json({ error: e.message }, { status: 403 });
  }
  if (e instanceof AiNotConfiguredError) {
    return NextResponse.json({ error: e.message }, { status: 503 });
  }
  if (e instanceof Error && e.message.includes("API key")) {
    return NextResponse.json({ error: e.message }, { status: 503 });
  }
  console.error("[ai]", e);
  return NextResponse.json({ error: "AI request failed" }, { status: 500 });
}
