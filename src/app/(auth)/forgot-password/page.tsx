"use client";

import * as React from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, ArrowLeft } from "lucide-react";
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
import { isAuthDisabled } from "@/lib/auth/flags";

const schema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
});

type FormValues = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [loading, setLoading] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: FormValues) {
    if (isAuthDisabled()) {
      setSent(true);
      toast.success("Reset link sent. Check your inbox (auth disabled mode)");
      return;
    }
    if (!isFirebaseWebConfigured()) {
      toast.error("Firebase is not configured.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/password-reset-mail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: values.email.trim().toLowerCase() }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };
      if (!res.ok || data.ok === false) {
        toast.error(data.error ?? "Request failed");
        return;
      }
      setSent(true);
      toast.success(data.message ?? "Reset link sent. Check your inbox");
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-5 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
          <span className="text-2xl">✉️</span>
        </div>
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Check your email</h2>
          <p className="text-sm text-muted-foreground mt-1">
            We&apos;ve sent a password reset link. It may take a minute.
          </p>
        </div>
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
        <h2 className="text-lg font-semibold tracking-tight">Reset password</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Enter your email and we&apos;ll send a reset link.
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
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      </Form>

      <p className="text-center text-xs text-muted-foreground">
        <Link
          href="/login"
          className="text-primary hover:underline inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-3 w-3" /> Back to sign in
        </Link>
      </p>
    </div>
  );
}
