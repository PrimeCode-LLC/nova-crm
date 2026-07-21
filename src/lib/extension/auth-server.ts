import "server-only";

import crypto from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { resolveLiveTenantForSession } from "@/lib/auth/resolve-live-tenant";
import type { OrgMemberRole } from "@/lib/types";
import {
  extensionSessionExpiresAt,
  isFreshInteractiveLogin,
  pkceChallengeForVerifier,
} from "@/lib/extension/auth-policy";

const AUTH_CODE_MAX_AGE_MS = 5 * 60 * 1000;
const ACCESS_LEASE_MS = 2 * 60 * 1000;

type ExtensionPrincipal = {
  uid: string;
  email?: string;
  name?: string;
  organizationId: string;
  orgRole: OrgMemberRole;
  sessionId: string;
  expiresAt: string;
};

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function randomSecret(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

function configuredExtensionIds(): Set<string> {
  return new Set(
    [process.env.NOVA_EXTENSION_IDS, process.env.NOVA_EXTENSION_DEV_IDS]
      .filter(Boolean)
      .join(",")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => /^[a-p]{32}$/.test(id)),
  );
}

function isAllowedExtensionId(id: string): boolean {
  return (
    configuredExtensionIds().has(id) ||
    (process.env.NODE_ENV !== "production" && /^[a-p]{32}$/.test(id))
  );
}

export function extensionIdFromOrigin(origin: string | null): string | null {
  if (!origin) return null;
  const match = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin);
  if (!match) return null;
  return isAllowedExtensionId(match[1]!) ? match[1]! : null;
}

export function extensionIdFromRedirectUri(redirectUri: string): string | null {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !url.hostname.endsWith(".chromiumapp.org")) return null;
  const id = url.hostname.slice(0, -".chromiumapp.org".length);
  return isAllowedExtensionId(id) ? id : null;
}

export function extensionCorsHeaders(origin: string | null): HeadersInit {
  const id = extensionIdFromOrigin(origin);
  if (!id) return {};
  return {
    "Access-Control-Allow-Origin": `chrome-extension://${id}`,
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, If-None-Match, X-Nova-Extension-Id",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export function extensionOptionsResponse(req: Request): Response {
  const origin = req.headers.get("origin");
  if (!extensionIdFromOrigin(origin)) {
    return Response.json({ error: "Extension origin is not allowed." }, { status: 403 });
  }
  return new Response(null, { status: 204, headers: extensionCorsHeaders(origin) });
}

export async function enforceExtensionAuthRateLimit(key: string): Promise<boolean> {
  const db = getAdminDb();
  if (!db) return false;
  const windowMs = 15 * 60 * 1000;
  const limit = 12;
  const now = Date.now();
  const ref = db.collection(COLLECTIONS.extensionAuthRateLimits).doc(sha256(key));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    const windowStartedAt =
      data?.windowStartedAt instanceof Timestamp ? data.windowStartedAt.toMillis() : 0;
    const currentCount = typeof data?.count === "number" ? data.count : 0;
    if (!windowStartedAt || now - windowStartedAt >= windowMs) {
      tx.set(ref, {
        count: 1,
        windowStartedAt: Timestamp.fromMillis(now),
        expiresAt: Timestamp.fromMillis(now + windowMs * 2),
      });
      return true;
    }
    if (currentCount >= limit) return false;
    tx.update(ref, { count: FieldValue.increment(1) });
    return true;
  });
}

export async function createExtensionAuthorizationCode(input: {
  idToken: string;
  redirectUri: string;
  codeChallenge: string;
}): Promise<
  | { ok: true; code: string; expiresAt: string }
  | { ok: false; status: number; error: string; code?: string }
> {
  const extensionId = extensionIdFromRedirectUri(input.redirectUri);
  if (!extensionId) {
    return { ok: false, status: 400, error: "Extension redirect URI is not allowed." };
  }
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(input.codeChallenge)) {
    return { ok: false, status: 400, error: "Invalid PKCE code challenge." };
  }

  const auth = getAdminAuth();
  const db = getAdminDb();
  if (!auth || !db) {
    return { ok: false, status: 503, error: "Nova authentication is unavailable." };
  }

  let decoded;
  try {
    decoded = await auth.verifyIdToken(input.idToken, true);
  } catch {
    return { ok: false, status: 401, error: "Invalid or revoked login." };
  }

  const authTime = typeof decoded.auth_time === "number" ? decoded.auth_time * 1000 : 0;
  if (!isFreshInteractiveLogin(authTime)) {
    return {
      ok: false,
      status: 401,
      error: "A fresh interactive Nova login is required.",
      code: "fresh_login_required",
    };
  }
  if (!(await enforceExtensionAuthRateLimit(`authorize:${decoded.uid}`))) {
    return { ok: false, status: 429, error: "Too many extension login attempts." };
  }

  const tenant = await resolveLiveTenantForSession({
    uid: decoded.uid,
    organizationId:
      typeof decoded.organizationId === "string" ? decoded.organizationId : undefined,
    orgRole: decoded.orgRole as OrgMemberRole | undefined,
  });
  if (
    tenant.accessDeniedReason ||
    tenant.membershipPending ||
    !tenant.organizationId ||
    !tenant.orgRole
  ) {
    return {
      ok: false,
      status: 403,
      error: "Your Nova user or organization membership is not active.",
      code: tenant.accessDeniedReason ?? "membership_pending",
    };
  }

  const code = randomSecret();
  const expiresAtMs = Date.now() + AUTH_CODE_MAX_AGE_MS;
  await db.collection(COLLECTIONS.extensionAuthCodes).doc(sha256(code)).set({
    uid: decoded.uid,
    email: decoded.email ?? null,
    name: decoded.name ?? null,
    organizationId: tenant.organizationId,
    orgRole: tenant.orgRole,
    extensionId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    authTime: Timestamp.fromMillis(authTime),
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(expiresAtMs),
    consumedAt: null,
  });
  return { ok: true, code, expiresAt: new Date(expiresAtMs).toISOString() };
}

export async function exchangeExtensionAuthorizationCode(input: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  origin: string | null;
  extensionIdHeader?: string | null;
}): Promise<
  | { ok: true; token: string; expiresAt: string; principal: Omit<ExtensionPrincipal, "sessionId"> }
  | { ok: false; status: number; error: string }
> {
  const extensionId =
    extensionIdFromOrigin(input.origin) ??
    (input.extensionIdHeader && isAllowedExtensionId(input.extensionIdHeader)
      ? input.extensionIdHeader
      : null);
  if (!extensionId || extensionIdFromRedirectUri(input.redirectUri) !== extensionId) {
    return { ok: false, status: 403, error: "Extension origin is not allowed." };
  }
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(input.codeVerifier)) {
    return { ok: false, status: 400, error: "Invalid PKCE verifier." };
  }
  if (!(await enforceExtensionAuthRateLimit(`exchange:${extensionId}`))) {
    return { ok: false, status: 429, error: "Too many extension login attempts." };
  }

  const db = getAdminDb();
  if (!db) return { ok: false, status: 503, error: "Nova authentication is unavailable." };
  const codeRef = db.collection(COLLECTIONS.extensionAuthCodes).doc(sha256(input.code));
  const token = randomSecret();
  const sessionId = sha256(token);
  const sessionRef = db.collection(COLLECTIONS.extensionSessions).doc(sessionId);
  const now = Date.now();

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(codeRef);
    const data = snap.data();
    const expiresAt =
      data?.expiresAt instanceof Timestamp ? data.expiresAt.toMillis() : 0;
    if (
      !snap.exists ||
      data?.consumedAt ||
      expiresAt <= now ||
      data?.extensionId !== extensionId ||
      data?.redirectUri !== input.redirectUri ||
      data?.codeChallenge !== pkceChallengeForVerifier(input.codeVerifier)
    ) {
      return null;
    }
    const authTime =
      data.authTime instanceof Timestamp ? data.authTime.toMillis() : 0;
    const sessionExpiresAt = extensionSessionExpiresAt(authTime, now);
    if (sessionExpiresAt <= now) return null;
    tx.update(codeRef, { consumedAt: FieldValue.serverTimestamp() });
    tx.set(sessionRef, {
      uid: data.uid,
      email: data.email ?? null,
      name: data.name ?? null,
      organizationId: data.organizationId,
      orgRole: data.orgRole,
      extensionId,
      authTime: data.authTime,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(sessionExpiresAt),
      revokedAt: null,
      lastSeenAt: FieldValue.serverTimestamp(),
    });
    return {
      uid: String(data.uid),
      email: typeof data.email === "string" ? data.email : undefined,
      name: typeof data.name === "string" ? data.name : undefined,
      organizationId: String(data.organizationId),
      orgRole: data.orgRole as OrgMemberRole,
      expiresAt: new Date(sessionExpiresAt).toISOString(),
    };
  });

  if (!result) {
    return { ok: false, status: 401, error: "Authorization code is invalid or expired." };
  }
  return { ok: true, token, expiresAt: result.expiresAt, principal: result };
}

export async function guardExtensionApi(req: Request): Promise<
  | { ok: true; principal: ExtensionPrincipal; headers: HeadersInit; leaseExpiresAt: string }
  | { ok: false; response: Response }
> {
  const origin = req.headers.get("origin");
  const headers = extensionCorsHeaders(origin);
  const headerExtensionId = req.headers.get("x-nova-extension-id");
  const extensionId =
    extensionIdFromOrigin(origin) ??
    (headerExtensionId && isAllowedExtensionId(headerExtensionId)
      ? headerExtensionId
      : null);
  if (!extensionId) {
    console.warn(
      JSON.stringify({
        event: "extension.access.denied",
        code: "origin_denied",
        origin: origin ?? null,
        hasExtensionIdHeader: Boolean(headerExtensionId),
      }),
    );
    return {
      ok: false,
      response: Response.json(
        { error: "Extension origin is not allowed.", code: "origin_denied" },
        { status: 403 },
      ),
    };
  }
  const bearer = req.headers.get("authorization");
  const token = bearer?.startsWith("Bearer ") ? bearer.slice(7).trim() : "";
  if (!token) {
    return {
      ok: false,
      response: Response.json(
        { error: "Extension login required.", code: "login_required" },
        { status: 401, headers },
      ),
    };
  }

  const db = getAdminDb();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return {
      ok: false,
      response: Response.json({ error: "Nova authentication is unavailable." }, { status: 503, headers }),
    };
  }
  const sessionId = sha256(token);
  const ref = db.collection(COLLECTIONS.extensionSessions).doc(sessionId);
  const snap = await ref.get();
  const data = snap.data();
  const expiresAt =
    data?.expiresAt instanceof Timestamp ? data.expiresAt.toMillis() : 0;
  if (!snap.exists || data?.revokedAt || expiresAt <= Date.now() || data?.extensionId !== extensionId) {
    return {
      ok: false,
      response: Response.json(
        { error: "Extension session expired. Sign in again.", code: "session_expired" },
        { status: 401, headers },
      ),
    };
  }

  try {
    const user = await auth.getUser(String(data.uid));
    if (user.disabled) throw new Error("disabled");
  } catch {
    await ref.set({ revokedAt: FieldValue.serverTimestamp() }, { merge: true });
    return {
      ok: false,
      response: Response.json(
        { error: "Your Nova user is inactive.", code: "inactive_user" },
        { status: 403, headers },
      ),
    };
  }

  const tenant = await resolveLiveTenantForSession({
    uid: String(data.uid),
    organizationId: String(data.organizationId),
    orgRole: data.orgRole as OrgMemberRole,
  });
  if (
    tenant.accessDeniedReason ||
    tenant.membershipPending ||
    !tenant.organizationId ||
    !tenant.orgRole ||
    tenant.organizationId !== data.organizationId
  ) {
    await ref.set({ revokedAt: FieldValue.serverTimestamp() }, { merge: true });
    return {
      ok: false,
      response: Response.json(
        {
          error: "Your Nova user or organization membership is not active.",
          code: tenant.accessDeniedReason ?? "membership_inactive",
        },
        { status: 403, headers },
      ),
    };
  }

  void ref.set({ lastSeenAt: FieldValue.serverTimestamp() }, { merge: true });
  return {
    ok: true,
    headers,
    leaseExpiresAt: new Date(Date.now() + ACCESS_LEASE_MS).toISOString(),
    principal: {
      uid: String(data.uid),
      email: typeof data.email === "string" ? data.email : undefined,
      name: typeof data.name === "string" ? data.name : undefined,
      organizationId: tenant.organizationId,
      orgRole: tenant.orgRole,
      sessionId,
      expiresAt: new Date(expiresAt).toISOString(),
    },
  };
}

export async function revokeExtensionSession(sessionId: string): Promise<void> {
  const db = getAdminDb();
  if (!db) return;
  await db
    .collection(COLLECTIONS.extensionSessions)
    .doc(sessionId)
    .set({ revokedAt: FieldValue.serverTimestamp() }, { merge: true });
}
