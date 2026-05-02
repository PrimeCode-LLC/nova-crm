import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Building2, Shield, ArrowRight, Wrench } from "lucide-react";
import { MigrateExistingUsersButton } from "./migrate-existing-users";

export default function PlatformOverviewPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Platform admin</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Operate the product as SaaS: customer organizations, plans, tenant settings, and who
          can access this console. Workspace roles (director, manager, etc.) stay inside the CRM;
          this area is for you and trusted operators only.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4" />
              Organizations
            </CardTitle>
            <CardDescription>
              Create and suspend tenants, set plans, billing contact, and internal notes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/platform/organizations"
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
            >
              Manage organizations
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-4 w-4" />
              Super admins
            </CardTitle>
            <CardDescription>
              Grant platform access by email (user must exist in Firebase Auth). Remove access
              when someone leaves.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/platform/admins"
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
            >
              Manage super admins
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </CardContent>
        </Card>

        <Card className="sm:col-span-2 border-dashed">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wrench className="h-4 w-4" />
              One-shot: migrate legacy users
            </CardTitle>
            <CardDescription>
              For users who signed up before multi-tenant landed. Creates a personal workspace
              for each user that has no organization and stamps them as owner. Idempotent.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MigrateExistingUsersButton />
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        Bootstrap: set <code className="rounded bg-muted px-1 py-0.5">PLATFORM_ADMIN_EMAILS</code>{" "}
        in the server environment (comma-separated) so the first operators can sign in before any
        Firestore <code className="rounded bg-muted px-1 py-0.5">platformAdmins</code> documents
        exist.
      </p>
    </div>
  );
}
