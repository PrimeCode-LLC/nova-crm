import { APICallError } from "ai";

export type AiProviderErrorCode =
  | "provider_quota"
  | "provider_rate_limit"
  | "provider_auth"
  | "provider_unavailable"
  | "unknown";

export type ParsedAiProviderError = {
  message: string;
  httpStatus: number;
  code: AiProviderErrorCode;
};

function openAiErrorCode(responseBody?: string): string | undefined {
  if (!responseBody) return undefined;
  try {
    const parsed = JSON.parse(responseBody) as {
      error?: { code?: string; type?: string };
    };
    return parsed.error?.code ?? parsed.error?.type;
  } catch {
    return undefined;
  }
}

/** Map AI SDK / provider failures to user-facing messages and HTTP status codes. */
export function parseAiProviderError(e: unknown): ParsedAiProviderError | null {
  const err = APICallError.isInstance(e)
    ? e
    : e instanceof Error && APICallError.isInstance(e.cause)
      ? e.cause
      : null;

  if (!err) return null;

  const providerCode = openAiErrorCode(err.responseBody);
  const msg = err.message.toLowerCase();

  if (
    providerCode === "insufficient_quota" ||
    msg.includes("exceeded your current quota") ||
    msg.includes("insufficient_quota")
  ) {
    return {
      code: "provider_quota",
      httpStatus: 402,
      message:
        "Your AI provider quota is exhausted (billing/credits). Add funds in your OpenAI (or other provider) account, or configure a different provider under Admin → AI & knowledge.",
    };
  }

  if (err.statusCode === 429) {
    return {
      code: "provider_rate_limit",
      httpStatus: 429,
      message:
        "The AI provider rate-limited this request. Wait a minute and try again, or use a different model/provider in Admin → AI & knowledge.",
    };
  }

  if (providerCode === "invalid_json_schema" || msg.includes("invalid schema")) {
    return {
      code: "unknown",
      httpStatus: 500,
      message:
        "AI response schema mismatch. Try again; if it persists, contact support (this is usually fixed by an app update).",
    };
  }

  if (err.statusCode === 401 || err.statusCode === 403) {
    return {
      code: "provider_auth",
      httpStatus: 503,
      message:
        "The AI provider rejected the API key. Verify the key in Admin → AI & knowledge.",
    };
  }

  if (err.statusCode != null && err.statusCode >= 500) {
    return {
      code: "provider_unavailable",
      httpStatus: 503,
      message: "The AI provider is temporarily unavailable. Try again in a few minutes.",
    };
  }

  return {
    code: "unknown",
    httpStatus: 502,
    message: err.message || "The AI provider returned an error.",
  };
}
