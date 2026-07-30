import {
  ERROR_LOG_FUNCTION_MAX,
  ERROR_LOG_LOCATION_MAX,
  ERROR_LOG_MESSAGE_MAX,
  ERROR_LOG_STACK_MAX,
  ERROR_LOG_URL_MAX,
} from "@/lib/error-logging/types";

const SECRET_KEY =
  /^(authorization|cookie|password|token|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token)$/i;

export function truncate(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  const s = String(value);
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

export function sanitizeMessage(message: string | null | undefined): string {
  return truncate(message?.trim() || "Unknown error", ERROR_LOG_MESSAGE_MAX) ?? "Unknown error";
}

export function sanitizeStack(stack: string | null | undefined): string | null {
  return truncate(stack, ERROR_LOG_STACK_MAX);
}

export function sanitizeLocation(location: string | null | undefined): string {
  return truncate(location?.trim() || "unknown", ERROR_LOG_LOCATION_MAX) ?? "unknown";
}

export function sanitizeFunctionName(name: string | null | undefined): string {
  return truncate(name?.trim() || "unknown", ERROR_LOG_FUNCTION_MAX) ?? "unknown";
}

export function sanitizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, "http://local");
    // Drop sensitive query params
    for (const key of [...u.searchParams.keys()]) {
      if (SECRET_KEY.test(key) || /token|secret|password|key/i.test(key)) {
        u.searchParams.set(key, "[redacted]");
      }
    }
    const out = u.origin === "http://local" ? `${u.pathname}${u.search}${u.hash}` : u.toString();
    return truncate(out, ERROR_LOG_URL_MAX);
  } catch {
    return truncate(url, ERROR_LOG_URL_MAX);
  }
}

/** Shallow-sanitize meta objects so secrets never land in logs. */
export function sanitizeMeta(
  meta: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!meta) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (SECRET_KEY.test(key)) {
      out[key] = "[redacted]";
      continue;
    }
    if (typeof value === "string") {
      out[key] = truncate(value, 500);
    } else if (
      value === null ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      out[key] = value;
    } else {
      out[key] = "[omitted]";
    }
  }
  return out;
}
