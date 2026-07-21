"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import { Loader2, Radar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { isFirebaseWebConfigured } from "@/lib/firebase/config";
import { formatFirebaseAuthError } from "@/lib/firebase/auth-errors";

type LoginError = { error?: string };
type ExternalChromeRuntime = {
  runtime?: {
    lastError?: { message?: string };
    sendMessage(
      extensionId: string,
      message: unknown,
      callback: (response?: { ok?: boolean; error?: string }) => void,
    ): void;
  };
};

function ExtensionLoginAfterMount() {
  const mounted = React.useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  if (!mounted) {
    return <div className="h-72 animate-pulse rounded-lg bg-muted/30" />;
  }
  return <ExtensionLoginForm />;
}

function ExtensionLoginForm() {
  const params = useSearchParams();
  const redirectUri = params.get("redirect_uri") ?? "";
  const state = params.get("state") ?? "";
  const codeChallenge = params.get("code_challenge") ?? "";
  const extensionId = params.get("extension_id") ?? "";
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState<"email" | "google" | null>(null);
  const [error, setError] = React.useState("");
  const [complete, setComplete] = React.useState(false);

  const validRequest =
    redirectUri.startsWith("https://") &&
    state.length >= 16 &&
    codeChallenge.length >= 43;

  async function finish(idToken: string) {
    const response = await fetch("/api/extension/auth/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, redirectUri, state, codeChallenge }),
    });
    const body = (await response.json()) as LoginError & { redirectUrl?: string };
    if (!response.ok || !body.redirectUrl) {
      throw new Error(body.error ?? "Nova could not authorize the extension.");
    }
    if (/^[a-p]{32}$/.test(extensionId)) {
      const callbackUrl = new URL(body.redirectUrl);
      const code = callbackUrl.searchParams.get("code");
      const callbackState = callbackUrl.searchParams.get("state");
      const runtime = (window.chrome as ExternalChromeRuntime | undefined)?.runtime;
      if (!runtime || !code || !callbackState) {
        throw new Error("The Nova extension could not receive the login result.");
      }
      await new Promise<void>((resolve, reject) => {
        runtime.sendMessage(
          extensionId,
          { type: "nova-auth-code", code, state: callbackState },
          (result) => {
            const runtimeError = runtime.lastError?.message;
            if (runtimeError || !result?.ok) {
              reject(new Error(runtimeError ?? result?.error ?? "Extension login failed."));
              return;
            }
            resolve();
          },
        );
      });
      setComplete(true);
      return;
    }
    window.location.assign(body.redirectUrl);
  }

  async function emailLogin(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading("email");
    try {
      if (!isFirebaseWebConfigured()) throw new Error("Firebase is not configured.");
      const credential = await signInWithEmailAndPassword(
        getFirebaseAuth(),
        email,
        password,
      );
      await finish(await credential.user.getIdToken(true));
    } catch (caught) {
      setError(
        caught instanceof Error && !("code" in caught)
          ? caught.message
          : formatFirebaseAuthError(caught),
      );
      setLoading(null);
    }
  }

  async function googleLogin() {
    setError("");
    setLoading("google");
    try {
      if (!isFirebaseWebConfigured()) throw new Error("Firebase is not configured.");
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const credential = await signInWithPopup(getFirebaseAuth(), provider);
      await finish(await credential.user.getIdToken(true));
    } catch (caught) {
      setError(
        caught instanceof Error && !("code" in caught)
          ? caught.message
          : formatFirebaseAuthError(caught),
      );
      setLoading(null);
    }
  }

  if (!validRequest) {
    return (
      <div className="space-y-3 text-center">
        <Radar className="mx-auto h-8 w-8 text-destructive" />
        <h2 className="font-semibold">Invalid extension request</h2>
        <p className="text-sm text-muted-foreground">
          Open Intent Radar from its Chrome or Edge toolbar button and try again.
        </p>
      </div>
    );
  }

  if (complete) {
    return (
      <div className="space-y-3 text-center">
        <Radar className="mx-auto h-8 w-8 text-primary" />
        <h2 className="font-semibold">Intent Radar unlocked</h2>
        <p className="text-sm text-muted-foreground">
          You can close this tab and continue in the Nova side panel.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex items-center gap-2">
          <Radar className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Unlock Intent Radar</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Sign in again with your Nova account. Extension access expires after 24 hours.
        </p>
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={loading !== null}
        onClick={googleLogin}
      >
        {loading === "google" ? <Loader2 className="animate-spin" /> : null}
        Continue with Google
      </Button>

      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">or email and password</span>
        <Separator className="flex-1" />
      </div>

      <form className="space-y-4" onSubmit={emailLogin}>
        <div className="space-y-1.5">
          <Label htmlFor="extension-email">Email</Label>
          <Input
            id="extension-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="extension-password">Password</Label>
          <Input
            id="extension-password"
            type="password"
            autoComplete="current-password"
            minLength={6}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button className="w-full" disabled={loading !== null} type="submit">
          {loading === "email" ? <Loader2 className="animate-spin" /> : null}
          Sign in and unlock
        </Button>
      </form>
    </div>
  );
}

export default function ExtensionLoginPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <ExtensionLoginAfterMount />
    </Suspense>
  );
}
