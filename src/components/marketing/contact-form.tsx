"use client";

import * as React from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ContactForm() {
  const [submitting, setSubmitting] = React.useState(false);
  const [website, setWebsite] = React.useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const name = String(fd.get("name") ?? "").trim();
    const email = String(fd.get("email") ?? "").trim();
    const company = String(fd.get("company") ?? "").trim();
    const teamSize = String(fd.get("size") ?? "").trim();
    const message = String(fd.get("message") ?? "").trim();

    if (!name || !email || !message) {
      toast.error("Please fill in name, email, and your message.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/marketing/interest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "contact",
          name,
          email,
          company: company || undefined,
          teamSize: teamSize || undefined,
          message,
          website,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error || "Could not send your message.");
        return;
      }
      toast.success("Got it. We'll be in touch soon.");
      form.reset();
      setWebsite("");
    } catch {
      toast.error("Network error. Email sales@stellixsoft.com directly.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <input
        type="text"
        name="website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        className="pointer-events-none absolute h-0 w-0 opacity-0"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="name" label="Your name" placeholder="Jane Cooper" required />
        <Field
          id="email"
          label="Work email"
          type="email"
          placeholder="jane@acme.co"
          required
        />
      </div>
      <Field id="company" label="Company" placeholder="Acme Inc." />
      <Field
        id="size"
        label="Team size"
        placeholder="e.g. 8 AEs, 2 SDRs"
      />

      <div className="space-y-1.5">
        <Label htmlFor="message">What should we know?</Label>
        <Textarea
          id="message"
          name="message"
          required
          rows={5}
          placeholder="Tell us about your outbound motion, reply volume, and what you want Nova to handle."
        />
      </div>

      <Button type="submit" size="lg" disabled={submitting} className="w-full">
        {submitting ? (
          <>
            <Loader2 className="animate-spin" />
            Sending…
          </>
        ) : (
          <>
            <Send />
            Send message
          </>
        )}
      </Button>

      <p className="text-center text-[11px] text-muted-foreground">
        Messages go to sales@stellixsoft.com. By submitting you agree to our{" "}
        <a className="underline underline-offset-2" href="/legal/privacy">
          privacy policy
        </a>
        .
      </p>
    </form>
  );
}

function Field({
  id,
  label,
  type = "text",
  placeholder,
  required,
}: {
  id: string;
  label: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        type={type}
        placeholder={placeholder}
        required={required}
      />
    </div>
  );
}
