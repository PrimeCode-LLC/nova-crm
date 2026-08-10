import { NextResponse } from "next/server";
import { guardTenantApi, roleAtLeast } from "@/lib/platform/tenant-api-guard";
import { buildOrgMailboxUtilizationServer } from "@/lib/email/mailbox-utilization-server";
import {
  getCachedMailboxUtilization,
  setCachedMailboxUtilization,
} from "@/lib/email/mailbox-utilization-cache";
import {
  filterMailboxUtilizationForViewer,
  summarizeMailboxUtilization,
  type MailboxUtilizationRow,
} from "@/lib/email/mailbox-utilization";
import { isRedisConfigured } from "@/lib/cache/redis";

/** Process-local fallback when Redis is unset (dev without Compose Redis). */
const UTILIZATION_CACHE_TTL_MS = 60_000;
const utilizationMemoryCache = new Map<
  string,
  {
    expiresAt: number;
    rows: MailboxUtilizationRow[];
    generatedAt: string;
  }
>();

/**
 * Inbox capacity utilization (P0.11: Redis-shared cache when configured).
 * - Managers / admins / owners: org-wide rows
 * - Members (salespeople): only mailboxes they own or are assigned to
 */
export async function GET() {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  try {
    const orgId = g.ctx.session.organizationId;
    const viewerUid = g.ctx.session.uid;
    const canViewOrgWide = roleAtLeast(g.ctx.role, "manager");

    let rows: MailboxUtilizationRow[];
    let generatedAt: string;
    let cached: boolean;
    let cacheSource: "redis" | "memory" | null = null;

    const redisHit = await getCachedMailboxUtilization(orgId);
    if (redisHit?.rows) {
      rows = redisHit.rows;
      generatedAt = redisHit.generatedAt;
      cached = true;
      cacheSource = "redis";
    } else {
      const memHit = utilizationMemoryCache.get(orgId);
      if (memHit && memHit.expiresAt > Date.now()) {
        rows = memHit.rows;
        generatedAt = memHit.generatedAt;
        cached = true;
        cacheSource = "memory";
      } else {
        rows = await buildOrgMailboxUtilizationServer({
          organizationId: orgId,
        });
        const payload = await setCachedMailboxUtilization(orgId, rows);
        utilizationMemoryCache.set(orgId, {
          expiresAt: Date.now() + UTILIZATION_CACHE_TTL_MS,
          rows,
          generatedAt: payload.generatedAt,
        });
        if (utilizationMemoryCache.size > 100) {
          const now = Date.now();
          for (const [k, v] of utilizationMemoryCache) {
            if (v.expiresAt <= now) utilizationMemoryCache.delete(k);
          }
        }
        generatedAt = payload.generatedAt;
        cached = false;
        cacheSource = isRedisConfigured() ? "redis" : "memory";
      }
    }

    const scopedRows = canViewOrgWide
      ? rows
      : filterMailboxUtilizationForViewer(rows, viewerUid);
    const summary = summarizeMailboxUtilization(scopedRows);

    return NextResponse.json({
      ok: true,
      scope: canViewOrgWide ? "org" : "mine",
      rows: scopedRows,
      summary,
      generatedAt,
      cached,
      cacheSource,
    });
  } catch (err) {
    console.error("[mailboxes/utilization]", err);
    return NextResponse.json(
      { ok: false, error: "Could not load mailbox utilization" },
      { status: 500 },
    );
  }
}
