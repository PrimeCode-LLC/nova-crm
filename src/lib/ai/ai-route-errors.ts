import { NextResponse } from "next/server";
import { AiForbiddenError, AiNotConfiguredError } from "@/lib/ai/run-feature";
import { parseAiProviderError } from "@/lib/ai/parse-provider-error";

export function aiErrorResponse(e: unknown): NextResponse {
  if (e instanceof AiForbiddenError) {
    return NextResponse.json({ error: e.message, code: "forbidden" }, { status: 403 });
  }
  if (e instanceof AiNotConfiguredError) {
    return NextResponse.json({ error: e.message, code: "not_configured" }, { status: 503 });
  }
  if (e instanceof Error && e.message.includes("API key")) {
    return NextResponse.json({ error: e.message, code: "not_configured" }, { status: 503 });
  }

  const provider = parseAiProviderError(e);
  if (provider) {
    if (provider.code !== "provider_rate_limit") {
      console.error("[ai]", provider.code, e);
    }
    return NextResponse.json(
      { error: provider.message, code: provider.code },
      { status: provider.httpStatus },
    );
  }

  console.error("[ai]", e);
  return NextResponse.json({ error: "AI request failed", code: "unknown" }, { status: 500 });
}
