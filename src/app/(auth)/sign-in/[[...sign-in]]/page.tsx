import { SignIn } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { isClerkAuthV1Enabled } from "@/lib/auth/clerk-flags";
import { ClerkInviteStash } from "@/components/providers/clerk-invite-stash";

function firstString(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

export default async function ClerkSignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isClerkAuthV1Enabled()) {
    redirect("/login");
  }

  const q = await searchParams;
  const invite = firstString(q.invite);
  const join = firstString(q.join);
  const next = firstString(q.next);
  const after = next && next.startsWith("/") && !next.startsWith("//")
    ? next
    : "/dashboard";

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <ClerkInviteStash invite={invite} join={join} />
      <SignIn
        routing="path"
        path="/sign-in"
        signUpUrl={
          invite
            ? `/sign-up?invite=${encodeURIComponent(invite)}`
            : join
              ? `/sign-up?join=${encodeURIComponent(join)}`
              : "/sign-up"
        }
        forceRedirectUrl={after}
        fallbackRedirectUrl={after}
      />
    </div>
  );
}
