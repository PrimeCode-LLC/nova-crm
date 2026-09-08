"use client";

import * as React from "react";
import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Globe, Eye, EyeOff } from "lucide-react";
import {
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";

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
import { Separator } from "@/components/ui/separator";
import { isFirebaseWebConfigured } from "@/lib/firebase/config";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { exchangeIdTokenForSession } from "@/lib/auth/client-session";
import { isAuthDisabled } from "@/lib/auth/flags";
import { formatFirebaseAuthError } from "@/lib/firebase/auth-errors";

const schema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type FormValues = z.infer<typeof schema>;

/** Full navigation so the next document request includes the freshly Set-Cookie session (App Router client transitions can race). */
function goAfterSessionCookie(nextPath: string) {
  window.location.assign(nextPath);
}

function LoginFormSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-6 w-32 rounded bg-muted" />
      <div className="h-9 w-full rounded bg-muted" />
      <div className="h-9 w-full rounded bg-muted" />
      <div className="h-9 w-full rounded bg-muted" />
    </div>
  );
}

/** Renders the form only after mount so password-manager extensions cannot break SSR hydration. */
function LoginFormAfterMount() {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) return <LoginFormSkeleton />;
  return <LoginForm />;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const joinToken = searchParams.get("join") ?? undefined;
  const inviteToken = searchParams.get("invite") ?? undefined;
  const [loading, setLoading] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const resetBannerShown = React.useRef(false);

  React.useEffect(() => {
    if (searchParams.get("reset") !== "complete" || resetBannerShown.current) return;
    resetBannerShown.current = true;
    toast.message("Password updated", {
      description: "Sign in with your new password.",
    });
  }, [searchParams]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: FormValues) {
    if (isAuthDisabled()) {
      setLoading(true);
      router.replace(searchParams.get("next") ?? "/dashboard");
      return;
    }
    if (!isFirebaseWebConfigured()) {
      toast.error("Firebase is not configured. Check NEXT_PUBLIC_FIREBASE_* in .env.local.");
      return;
    }

    setLoading(true);
    try {
      const auth = getFirebaseAuth();
      const cred = await signInWithEmailAndPassword(
        auth,
        values.email,
        values.password,
      );
      const idToken = await cred.user.getIdToken();
      const exchanged = await exchangeIdTokenForSession(idToken, {
        openJoinToken: joinToken,
        inviteToken,
      });
      if (exchanged.membershipPending) {
        goAfterSessionCookie("/join/pending");
        toast.message("Access pending approval", {
          description: "An admin still needs to approve your workspace request.",
        });
        return;
      }
      const next = searchParams.get("next") ?? "/dashboard";
      toast.success("Signed in");
      goAfterSessionCookie(next);
    } catch (e: unknown) {
      toast.error(formatFirebaseAuthError(e));
    } finally {
      setLoading(false);
    }
  }

  async function signInWithGoogle() {
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
      const cred = await signInWithPopup(auth, new GoogleAuthProvider());
      const idToken = await cred.user.getIdToken();
      const exchanged = await exchangeIdTokenForSession(idToken, {
        openJoinToken: joinToken,
        inviteToken,
      });
      if (exchanged.membershipPending) {
        goAfterSessionCookie("/join/pending");
        toast.message("Access pending approval", {
          description: "An admin still needs to approve your workspace request.",
        });
        return;
      }
      toast.success("Signed in with Google");
      goAfterSessionCookie(searchParams.get("next") ?? "/dashboard");
    } catch (e: unknown) {
      toast.error(formatFirebaseAuthError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Sign in</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Welcome back. Let&apos;s get to work.
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Email</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    placeholder="you@company.com"
                    autoComplete="email"
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
            name="password"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between">
                  <FormLabel className="text-xs">Password</FormLabel>
                  <Link
                    href="/forgot-password"
                    className="text-xs text-primary hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <FormControl>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      className="h-9 pr-10"
                      {...field}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="absolute right-0.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </FormControl>
                <FormMessage className="text-xs" />
              </FormItem>
            )}
          />
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Form>

      <div className="relative">
        <Separator />
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-[10px] text-muted-foreground">
          OR
        </span>
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={loading}
        onClick={() => void signInWithGoogle()}
      >
        <Globe className="h-4 w-4" />
        Sign in with Google
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        No account yet?{" "}
        <Link
          href={
            inviteToken
              ? `/signup?invite=${encodeURIComponent(inviteToken)}`
              : joinToken
                ? `/signup?join=${encodeURIComponent(joinToken)}`
                : "/signup"
          }
          className="text-primary hover:underline font-medium"
        >
          Create one
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFormSkeleton />}>
      <LoginFormAfterMount />
    </Suspense>
  );
}
