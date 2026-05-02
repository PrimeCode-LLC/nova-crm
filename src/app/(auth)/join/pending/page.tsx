import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getVerifiedSession } from "@/lib/auth/server";
import { isAuthDisabled } from "@/lib/auth/flags";
import { findMembershipForUserServer } from "@/lib/platform/members-server";
import { getOrganizationServer } from "@/lib/platform/organizations-server";

export const dynamic = "force-dynamic";

export default async function JoinPendingPage() {
  if (isAuthDisabled()) {
    redirect("/dashboard");
  }
  const session = await getVerifiedSession();
  if (!session) {
    redirect("/login?next=/join/pending");
  }
  let membership;
  try {
    membership = await findMembershipForUserServer(session.uid);
  } catch {
    redirect("/onboarding");
  }
  if (!membership || membership.status !== "pending") {
    redirect("/dashboard");
  }
  const org = await getOrganizationServer(membership.organizationId);
  const name = org?.name ?? "your workspace";

  return (
    <div className="space-y-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
        <Clock className="h-5 w-5" />
      </div>
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Approval pending</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your account is linked to <span className="font-medium text-foreground">{name}</span> but
          an organization admin has not approved access yet. You&apos;ll get full access once
          they approve your request from Team → Pending requests.
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        Signed in as {session.email ?? session.uid}. You can close this tab and return after
        you&apos;re approved — then sign in again if needed.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Link
          href="/login"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "inline-flex text-center")}
        >
          Switch account
        </Link>
        <Link
          href="/"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex text-center")}
        >
          Home
        </Link>
      </div>
    </div>
  );
}
