export type ParsedStackFrame = {
  functionName: string | null;
  location: string | null;
};

/**
 * Best-effort extract of file path + function from an Error stack.
 * Prefers the first frame that looks like app source (`src/` or webpack path).
 */
export function parseErrorStack(stack: string | null | undefined): ParsedStackFrame {
  if (!stack || typeof stack !== "string") {
    return { functionName: null, location: null };
  }

  const lines = stack.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (/^error:/i.test(line)) continue;

    const chrome = line.match(
      /at\s+(?:(.+?)\s+\()?((?:https?:\/\/|file:\/\/|webpack-internal:\/\/\/|\.?\.?\/)?[^\s)]+):(\d+):(\d+)\)?/,
    );
    if (chrome) {
      const fn = chrome[1]?.trim() || null;
      const location = normalizeLocation(chrome[2] ?? null);
      if (location || fn) {
        if (location && !isAppFrame(location) && lines.length > 1) {
          // keep scanning for a better app frame
        } else {
          return { functionName: cleanFunctionName(fn), location };
        }
      }
      continue;
    }

    const firefox = line.match(
      /(?:(.+?)@)?((?:https?:\/\/|file:\/\/|\.?\.?\/)[^\s:]+):(\d+):(\d+)/,
    );
    if (firefox) {
      const fn = firefox[1]?.trim() || null;
      const location = normalizeLocation(firefox[2] ?? null);
      if (location && isAppFrame(location)) {
        return { functionName: cleanFunctionName(fn), location };
      }
      if (location || fn) {
        return { functionName: cleanFunctionName(fn), location };
      }
    }
  }

  // Second pass: accept first chrome frame even if not app-looking
  for (const line of lines) {
    if (/^error:/i.test(line)) continue;
    const chrome = line.match(
      /at\s+(?:(.+?)\s+\()?((?:https?:\/\/|file:\/\/|webpack-internal:\/\/\/|\.?\.?\/)?[^\s)]+):(\d+):(\d+)\)?/,
    );
    if (chrome) {
      return {
        functionName: cleanFunctionName(chrome[1]?.trim() || null),
        location: normalizeLocation(chrome[2] ?? null),
      };
    }
  }

  return { functionName: null, location: null };
}

function isAppFrame(location: string): boolean {
  return (
    location.includes("src/") ||
    location.includes("/app/") ||
    location.includes("components/") ||
    location.includes("lib/")
  );
}

function cleanFunctionName(fn: string | null): string | null {
  if (!fn) return null;
  const cleaned = fn
    .replace(/^Object\./, "")
    .replace(/^async\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned === "Object.<anonymous>" || cleaned === "<anonymous>") {
    return null;
  }
  return cleaned;
}

/**
 * Normalize stack path to a repo-relative `src/...` path when possible.
 */
export function normalizeLocation(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let path = raw.trim();

  // Strip query/hash from URLs
  try {
    if (/^https?:\/\//i.test(path) || path.startsWith("file://")) {
      const u = new URL(path);
      path = u.pathname;
    }
  } catch {
    /* keep path */
  }

  path = path.replace(/^webpack-internal:\/\/\//, "");
  path = path.replace(/^\/_next\/static\/[^/]+\//, "");
  path = decodeURIComponent(path);

  const srcIdx = path.indexOf("src/");
  if (srcIdx >= 0) {
    return path.slice(srcIdx);
  }

  // Next.js app dir without src/
  const appIdx = path.indexOf("/app/");
  if (appIdx >= 0) {
    return `src${path.slice(appIdx)}`;
  }

  // Drop leading noise
  path = path.replace(/^\.\//, "");
  if (path.startsWith("node_modules/")) return null;
  return path || null;
}

export function stackFromUnknown(error: unknown): string | null {
  if (error instanceof Error && error.stack) return error.stack;
  return null;
}

export function messageFromUnknown(error: unknown, fallback = "Unknown error"): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object" && "message" in error) {
    const m = (error as { message: unknown }).message;
    if (typeof m === "string" && m.trim()) return m.trim();
  }
  return fallback;
}
