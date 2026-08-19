import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import {
  getOrganizationServer,
  sanitizeOrganizationForApi,
  updateOrganizationServer,
} from "@/lib/platform/organizations-server";
import { recordAudit } from "@/lib/documents/audit";
import { isValidIanaTimezone } from "@/lib/org-timezone";
import {
  DEFAULT_ORG_SEND_POLICY,
  parseOrgSendPolicy,
  resolveOrgSendPolicy,
} from "@/lib/email/org-send-policy";
import { WEEKDAY_KEYS } from "@/lib/scheduling/defaults";

const slotSchema = z.object({
  start: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  end: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
});

const weeklySchema = z.object({
  sunday: z.array(slotSchema),
  monday: z.array(slotSchema),
  tuesday: z.array(slotSchema),
  wednesday: z.array(slotSchema),
  thursday: z.array(slotSchema),
  friday: z.array(slotSchema),
  saturday: z.array(slotSchema),
});

const sendPolicySchema = z.object({
  weekly: weeklySchema,
  weekdayOnly: z.boolean().optional(),
  dailyCeiling: z.number().int().positive().nullable().optional(),
});

const patchSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    settings: z
      .object({
        billingEmail: z
          .union([z.string().email().max(254), z.literal("")])
          .optional(),
        /** IANA timezone, or "" to clear (fall back to browser). */
        timezone: z.string().max(80).optional(),
        sendPolicy: sendPolicySchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const hasName = val.name !== undefined;
    const hasBilling =
      val.settings !== undefined && val.settings.billingEmail !== undefined;
    const hasTimezone =
      val.settings !== undefined && val.settings.timezone !== undefined;
    const hasSendPolicy =
      val.settings !== undefined && val.settings.sendPolicy !== undefined;
    if (!hasName && !hasBilling && !hasTimezone && !hasSendPolicy) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Provide name and/or settings.billingEmail and/or settings.timezone and/or settings.sendPolicy",
        path: [],
      });
    }
    const tz = val.settings?.timezone;
    if (tz !== undefined && tz.trim() !== "" && !isValidIanaTimezone(tz)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid IANA timezone",
        path: ["settings", "timezone"],
      });
    }
    const weekly = val.settings?.sendPolicy?.weekly;
    if (weekly) {
      for (const key of WEEKDAY_KEYS) {
        for (const [i, slot] of weekly[key].entries()) {
          if (slot.end <= slot.start) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Slot end must be after start",
              path: ["settings", "sendPolicy", "weekly", key, i],
            });
          }
        }
      }
    }
  });

export async function GET() {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  const org = await getOrganizationServer(g.ctx.session.organizationId);
  if (!org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }
  const safe = sanitizeOrganizationForApi(org);
  return NextResponse.json({
    ok: true,
    name: safe.name,
    timezone: safe.settings.timezone ?? "",
    sendPolicy: resolveOrgSendPolicy(safe.settings.sendPolicy ?? DEFAULT_ORG_SEND_POLICY),
  });
}

export async function PATCH(req: Request) {
  const g = await guardTenantApi({ minRole: "admin" });
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const orgId = g.ctx.session.organizationId;
  const org = await getOrganizationServer(orgId);
  if (!org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  const body = parsed.data;
  const patch: Parameters<typeof updateOrganizationServer>[1] = {};

  if (body.name !== undefined) {
    patch.name = body.name;
  }

  const settingsPatch: {
    billingEmail?: string;
    timezone?: string;
    sendPolicy?: ReturnType<typeof parseOrgSendPolicy>;
  } = {};
  let touchedSettings = false;

  if (body.settings?.billingEmail !== undefined) {
    settingsPatch.billingEmail =
      body.settings.billingEmail === "" ? "" : body.settings.billingEmail;
    touchedSettings = true;
  }
  if (body.settings?.timezone !== undefined) {
    settingsPatch.timezone = body.settings.timezone.trim();
    touchedSettings = true;
  }
  if (body.settings?.sendPolicy !== undefined) {
    settingsPatch.sendPolicy = resolveOrgSendPolicy(body.settings.sendPolicy);
    touchedSettings = true;
  }

  if (touchedSettings) {
    patch.settings = {
      ...org.settings,
      ...settingsPatch,
    };
  }

  const result = await updateOrganizationServer(orgId, patch);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await recordAudit({
    organizationId: orgId,
    actorUid: g.ctx.session.uid,
    event: "settings.updated",
    meta: {
      fields: [
        ...(body.name !== undefined ? ["name"] : []),
        ...(body.settings?.billingEmail !== undefined ? ["settings.billingEmail"] : []),
        ...(body.settings?.timezone !== undefined ? ["settings.timezone"] : []),
        ...(body.settings?.sendPolicy !== undefined ? ["settings.sendPolicy"] : []),
      ],
    },
  });

  return NextResponse.json({ ok: true });
}
