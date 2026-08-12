import { SignUp } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { isClerkAuthV1Enabled } from "@/lib/auth/clerk-flags";
import { ClerkInviteStash } from "@/components/providers/clerk-invite-stash";

function firstString(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

export default async function ClerkSignUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isClerkAuthV1Enabled()) {
    redirect("/signup");
  }

  const q = await searchParams;
  const invite = firstString(q.invite);
  const join = firstString(q.join);
  const after =
    invite || join
      ? "/dashboard"
      : "/onboarding";

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <ClerkInviteStash invite={invite} join={join} />
      <SignUp
        routing="path"
        path="/sign-up"
        signInUrl={
          invite
            ? `/sign-in?invite=${encodeURIComponent(invite)}`
            : join
              ? `/sign-in?join=${encodeURIComponent(join)}`
              : "/sign-in"
        }
        forceRedirectUrl={after}
        fallbackRedirectUrl={after}
      />
    </div>
  );
}
