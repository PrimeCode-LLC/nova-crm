"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, ArrowLeft } from "lucide-react";
import { signOut } from "firebase/auth";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { isFirebaseWebConfigured } from "@/lib/firebase/config";
import { isAuthDisabled } from "@/lib/auth/flags";

const schema = z
  .object({
    newPassword: z.string().min(8, "At least 8 characters"),
    confirmPassword: z.string().min(8, "At least 8 characters"),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type FormValues = z.infer<typeof schema>;

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const oobCode = searchParams.get("oobCode")?.trim() ?? "";
  const [submitting, setSubmitting] = React.useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  async function onSubmit(values: FormValues) {
    if (isAuthDisabled()) {
      toast.info("Auth is disabled in this environment.");
      return;
    }
    if (!isFirebaseWebConfigured()) {
      toast.error("Firebase is not configured.");
      return;
    }
    if (!oobCode) {
      toast.error("Missing reset code. Use the link from your email.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/password-reset/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          oobCode,
          newPassword: values.newPassword,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        redirect?: string;
      };
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? "Could not reset password.");
        return;
      }

      try {
        await signOut(getFirebaseAuth());
      } catch {
        /* ignore */
      }

      void fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(
        () => {},
      );

      window.location.assign(data.redirect ?? "/login?reset=complete");
    } catch {
      toast.error("Request failed.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!oobCode) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-muted-foreground">
          Invalid or expired reset link. Request a new password reset from the sign-in page.
        </p>
        <Link href="/login">
          <Button variant="outline" className="w-full">
            <ArrowLeft className="h-4 w-4" /> Back to sign in
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Choose a new password</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Your previous sessions are ended. Sign in again with your new password on the next screen.
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="newPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">New password</FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    className="h-9"
                    {...field}
                  />
                </FormControl>
                <FormMessage className="text-xs" />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Confirm password</FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    className="h-9"
                    {...field}
                  />
                </FormControl>
                <FormMessage className="text-xs" />
              </FormItem>
            )}
          />
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? "Updating…" : "Update password"}
          </Button>
        </form>
      </Form>

      <p className="text-center text-xs text-muted-foreground">
        <Link href="/login" className="text-primary hover:underline inline-flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" /> Back to sign in
        </Link>
      </p>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
