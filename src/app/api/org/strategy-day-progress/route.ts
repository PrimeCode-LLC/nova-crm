import { NextResponse } from "next/server";

import { resolveCrmListNarrowForSession } from "@/lib/db/crm-list-scope";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { loadStrategyDayProgress } from "@/lib/prospecting-strategy/strategy-day-progress-server";

const MAX_SUBJECTS = 200;
const MAX_ASSIGNMENT_IDS = 50;

type Subject = { userId: string; strategyAssignmentIds: string[] };

function parseSubjects(body: unknown): Subject[] | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { subjects?: unknown }).subjects;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_SUBJECTS) return null;
  const subjects: Subject[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const userId = typeof (item as { userId?: unknown }).userId === "string"
      ? (item as { userId: string }).userId.trim()
      : "";
    if (!userId || userId.length > 128) return null;
    const idsRaw = (item as { strategyAssignmentIds?: unknown }).strategyAssignmentIds;
    if (idsRaw !== undefined && !Array.isArray(idsRaw)) return null;
    const strategyAssignmentIds = (Array.isArray(idsRaw) ? idsRaw : [])
      .filter((id): id is string => typeof id === "string")
      .map((id) => id.trim())
      .filter((id) => id.length > 0 && id.length <= 128)
      .slice(0, MAX_ASSIGNMENT_IDS);
    subjects.push({ userId, strategyAssignmentIds });
  }
  return subjects;
}

function parseThreshold(body: unknown): number {
  const raw = (body as { outreachThreshold?: unknown })?.outreachThreshold;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 45;
  return Math.max(0, Math.min(100, raw));
}

/** POST — today's prospect progress for the requested users. Reads only. */
export async function POST(req: Request) {
  const guard = await guardTenantApi();
  if (!guard.ok) return guard.response;
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const subjects = parseSubjects(body);
  if (!subjects) {
    return NextResponse.json({ ok: false, error: "subjects required" }, { status: 400 });
  }

  const narrowToMember = await resolveCrmListNarrowForSession(
    guard.ctx.role,
    null,
    guard.ctx.session.uid,
  );
  try {
    const result = await loadStrategyDayProgress({
      organizationId: guard.ctx.session.organizationId,
      subjects,
      narrowToMember,
      viewerUid: guard.ctx.session.uid,
      outreachThreshold: parseThreshold(body),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[strategy-day-progress] failed", guard.ctx.session.organizationId, err);
    return NextResponse.json(
      { ok: false, error: "Failed to load strategy day progress" },
      { status: 500 },
    );
  }
}
