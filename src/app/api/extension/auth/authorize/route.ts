import { z } from "zod";
import { createExtensionAuthorizationCode } from "@/lib/extension/auth-server";

const bodySchema = z.object({
  idToken: z.string().min(100),
  redirectUri: z.string().url().max(500),
  codeChallenge: z.string().min(43).max(128),
  state: z.string().min(16).max(256),
});

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await createExtensionAuthorizationCode(parsed.data);
  if (!result.ok) {
    console.warn(
      JSON.stringify({
        event: "extension.auth.denied",
        code: result.code ?? "authorization_denied",
        status: result.status,
      }),
    );
    return Response.json(
      { error: result.error, code: result.code },
      { status: result.status },
    );
  }

  const redirect = new URL(parsed.data.redirectUri);
  redirect.searchParams.set("code", result.code);
  redirect.searchParams.set("state", parsed.data.state);
  return Response.json({
    redirectUrl: redirect.toString(),
    expiresAt: result.expiresAt,
  });
}
