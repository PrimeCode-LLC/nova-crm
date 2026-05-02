"use client";

import * as React from "react";
import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";

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
import { isFirebaseWebConfigured } from "@/lib/firebase/config";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { exchangeIdTokenForSession } from "@/lib/auth/client-session";
import { isAuthDisabled } from "@/lib/auth/flags";

type InvitePreview = {
  organizationName: string;
  email: string;
  role: string;
};

const formSchema = z.object({
  fullName: z.string().min(2, "Enter your full name"),
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  company: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const inviteToken = params.get("invite") ?? undefined;
  const joinToken = params.get("join") ?? undefined;
  const [loading, setLoading] = React.useState(false);
  const [invitePreview, setInvitePreview] =
    React.useState<InvitePreview | null>(null);
  const [inviteError, setInviteError] = React.useState<string | null>(null);
  const [joinPreview, setJoinPreview] = React.useState<{ organizationName: string } | null>(
    null,
  );
  const [joinError, setJoinError] = React.useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { fullName: "", company: "", email: "", password: "" },
  });

  React.useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/auth/invite/preview?token=${encodeURIComponent(inviteToken)}`,
          { cache: "no-store" },
        );
        const data = (await res.json()) as
          | { organizationName: string; email: string; role: string }
          | { error: string };
        if (cancelled) return;
        if ("error" in data) {
          setInviteError(data.error);
        } else {
          setInvitePreview(data);
          form.setValue("email", data.email);
        }
      } catch {
        if (!cancelled) setInviteError("Could not verify invite.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteToken, form]);

  React.useEffect(() => {
    if (!joinToken || inviteToken) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/auth/join/preview?token=${encodeURIComponent(joinToken)}`,
          { cache: "no-store" },
        );
        const data = (await res.json()) as
          | { organizationName: string }
          | { error: string };
        if (cancelled) return;
        if ("error" in data) {
          setJoinError(data.error);
        } else {
          setJoinPreview(data);
        }
      } catch {
        if (!cancelled) setJoinError("Could not verify join link.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [joinToken, inviteToken]);

  async function onSubmit(values: FormValues) {
    if (!inviteToken && !joinToken && !values.company?.trim()) {
      form.setError("company", { message: "Company name is required" });
      return;
    }
    if (isAuthDisabled()) {
      router.replace("/dashboard");
      return;
    }
    if (!isFirebaseWebConfigured()) {
      toast.error("Firebase is not configured.");
      return;
    }

    setLoading(true);
    try {
      const auth = getFirebaseAuth();
      const cred = await createUserWithEmailAndPassword(
        auth,
        values.email,
        values.password,
      );
      await updateProfile(cred.user, { displayName: values.fullName });
      const idToken = await cred.user.getIdToken();
      const exchanged = await exchangeIdTokenForSession(idToken, {
        company: inviteToken || joinToken ? undefined : values.company,
        inviteToken,
        openJoinToken: joinToken,
      });
      if (exchanged.membershipPending) {
        router.replace("/join/pending");
        toast.message("Request submitted", {
          description: "An admin will approve your access shortly.",
        });
        return;
      }
      router.replace("/dashboard");
      toast.success(
        inviteToken
          ? "Welcome! You've joined the team."
          : "Workspace created. Welcome aboard!",
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Sign-up failed";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  if (joinError && !inviteToken) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Join link issue</h2>
          <p className="mt-1 text-sm text-destructive">{joinError}</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Ask an admin for a new organization link, or{" "}
          <Link href="/signup" className="text-primary hover:underline">
            create your own workspace
          </Link>
          .
        </p>
      </div>
    );
  }

  if (inviteError) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Invite issue</h2>
          <p className="mt-1 text-sm text-destructive">{inviteError}</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Ask the person who invited you to send a new link, or{" "}
          <Link href="/signup" className="text-primary hover:underline">
            create your own workspace
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          {invitePreview
            ? `Join ${invitePreview.organizationName}`
            : joinPreview
              ? `Request access to ${joinPreview.organizationName}`
              : "Create account"}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {invitePreview
            ? `You've been invited as ${invitePreview.role}.`
            : joinPreview
              ? "After you sign up, an admin approves your account before you can use the workspace."
              : "Get your team set up in under 2 minutes."}
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem className="col-span-2 sm:col-span-1">
                  <FormLabel className="text-xs">Full name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Jordan Harper"
                      className="h-9"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="text-xs" />
                </FormItem>
              )}
            />
            {!invitePreview && !joinPreview && (
              <FormField
                control={form.control}
                name="company"
                render={({ field }) => (
                  <FormItem className="col-span-2 sm:col-span-1">
                    <FormLabel className="text-xs">Company</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Nova Inc."
                        className="h-9"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />
            )}
          </div>
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Work email</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    placeholder="you@company.com"
                    autoComplete="email"
                    className="h-9"
                    disabled={Boolean(invitePreview)}
                    {...field}
                  />
                </FormControl>
                <FormMessage className="text-xs" />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Password</FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    placeholder="8+ characters"
                    autoComplete="new-password"
                    className="h-9"
                    {...field}
                  />
                </FormControl>
                <FormMessage className="text-xs" />
              </FormItem>
            )}
          />
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading
              ? "Creating account…"
              : invitePreview
                ? "Join workspace"
                : joinPreview
                  ? "Submit request"
                  : "Create account"}
          </Button>
        </form>
      </Form>

      <p className="text-center text-xs text-muted-foreground">
        Already have an account?{" "}
        <Link
          href={
            joinToken && !inviteToken
              ? `/login?join=${encodeURIComponent(joinToken)}`
              : "/login"
          }
          className="text-primary hover:underline font-medium"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4 animate-pulse">
          <div className="h-6 w-32 rounded bg-muted" />
          <div className="h-9 w-full rounded bg-muted" />
          <div className="h-9 w-full rounded bg-muted" />
          <div className="h-9 w-full rounded bg-muted" />
        </div>
      }
    >
      <SignupForm />
    </Suspense>
  );
}
