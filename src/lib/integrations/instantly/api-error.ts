import { NextResponse } from "next/server";
import { InstantlyApiError } from "./client";

export function instantlyErrorResponse(err: unknown): NextResponse {
  if (err instanceof InstantlyApiError) {
    return NextResponse.json({ error: err.message }, { status: err.status >= 400 ? err.status : 502 });
  }
  if (err instanceof Error) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
  return NextResponse.json({ error: "Unknown error" }, { status: 500 });
}
