import { NextResponse } from "next/server";
import { z } from "zod";
import { guardPlatformApi } from "@/lib/platform/platform-api-guard";
import {
  createOrganizationServer,
  listOrganizationsServer,
} from "@/lib/platform/organizations-server";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(80).optional(),
  status: z.enum(["trial", "active", "suspended"]).optional(),
  planId: z.enum(["free", "pro", "enterprise"]).optional(),
  maxUsers: z.number().int().positive().max(100_000).optional(),
  settings: z
    .object({
      billingEmail: z.string().email().optional().or(z.literal("")),
      operatorNotes: z.string().max(5000).optional(),
    })
    .optional(),
});

export async function GET() {
  const g = await guardPlatformApi();
  if (!g.ok) return g.response;
  const items = await listOrganizationsServer();
  return NextResponse.json({ organizations: items });
}

export async function POST(req: Request) {
  const g = await guardPlatformApi();
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { settings: s, ...rest } = parsed.data;
  const settings =
    s === undefined
      ? undefined
      : {
          billingEmail: s.billingEmail || undefined,
          operatorNotes: s.operatorNotes,
        };

  const result = await createOrganizationServer({ ...rest, settings });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ id: result.id }, { status: 201 });
}
