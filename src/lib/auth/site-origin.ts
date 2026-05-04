/**
 * NEXT_PUBLIC_SITE_URL should be an origin only (e.g. https://app.example.com).
 * If a path was accidentally included (e.g. .../dashboard), strip to origin so
 * links resolve to the correct host without bogus paths.
 */
export function siteOriginFromEnv(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return undefined;
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return `${u.protocol}//${u.host}`;
  } catch {
    return undefined;
  }
}

/** Preferred public origin for links and redirects (env → Host header → request URL). */
export function publicSiteOriginFromRequest(req: Request): string {
  const envOrigin = siteOriginFromEnv();
  if (envOrigin) return envOrigin;

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = (req.headers.get("x-forwarded-proto") ?? "http").split(",")[0]?.trim() || "http";
  if (host) return `${proto}://${host}`;

  try {
    return new URL(req.url).origin;
  } catch {
    return "http://localhost:3000";
  }
}

export function loginPageContinueUrl(req: Request): string {
  return `${publicSiteOriginFromRequest(req)}/login`;
}

export function resetPasswordPageUrl(req: Request): string {
  return `${publicSiteOriginFromRequest(req)}/reset-password`;
}
