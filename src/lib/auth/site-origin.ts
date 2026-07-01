/**
 * NEXT_PUBLIC_SITE_URL should be an origin only (e.g. https://app.example.com).
 * SITE_URL is the same value but server-only (read at runtime on App Hosting).
 * If a path was accidentally included (e.g. .../dashboard), strip to origin so
 * links resolve to the correct host without bogus paths.
 */

/** Hosts that must never be used for OAuth redirects or public links. */
export function isInternalHost(hostWithPort: string): boolean {
  const host = hostWithPort.trim().toLowerCase();
  if (!host) return true;

  let hostname: string;
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    hostname = end > 0 ? host.slice(1, end) : host;
  } else {
    hostname = host.split(":")[0] ?? host;
  }

  return hostname === "0.0.0.0" || hostname === "::" || hostname === "[::]";
}

function parseOrigin(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  try {
    const u = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    if (isInternalHost(u.host)) return undefined;
    return `${u.protocol}//${u.host}`;
  } catch {
    return undefined;
  }
}

export function siteOriginFromEnv(): string | undefined {
  // SITE_URL is runtime-only (Firebase App Hosting); NEXT_PUBLIC_* may be build-inlined.
  return (
    parseOrigin(process.env.SITE_URL) ?? parseOrigin(process.env.NEXT_PUBLIC_SITE_URL)
  );
}

function firstHeaderValue(req: Request, name: string): string | undefined {
  const raw = req.headers.get(name);
  if (!raw) return undefined;
  return raw.split(",")[0]?.trim() || undefined;
}

function originFromHostHeader(host: string, proto: string): string | undefined {
  if (isInternalHost(host)) return undefined;
  const scheme = proto.replace(/:$/, "") || "https";
  return `${scheme}://${host}`;
}

/** Preferred public origin for links and redirects (env → proxy headers → request URL). */
export function publicSiteOriginFromRequest(req: Request): string {
  const envOrigin = siteOriginFromEnv();
  if (envOrigin) return envOrigin;

  const proto =
    (req.headers.get("x-forwarded-proto") ?? "https").split(",")[0]?.trim() || "https";

  for (const header of ["x-forwarded-host", "host"] as const) {
    const host = firstHeaderValue(req, header);
    if (!host) continue;
    const origin = originFromHostHeader(host, proto);
    if (origin) return origin;
  }

  try {
    const fromUrl = new URL(req.url);
    if (!isInternalHost(fromUrl.host)) return fromUrl.origin;
  } catch {
    /* ignore */
  }

  return "http://localhost:3000";
}

export function loginPageContinueUrl(req: Request): string {
  return `${publicSiteOriginFromRequest(req)}/login`;
}

export function resetPasswordPageUrl(req: Request): string {
  return `${publicSiteOriginFromRequest(req)}/reset-password`;
}
