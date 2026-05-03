"use client";

import * as React from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ContactForm() {
  const [submitting, setSubmitting] = React.useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const form = e.currentTarget;
      const fd = new FormData(form);
      const entry = {
        at: new Date().toISOString(),
        name: String(fd.get("name") ?? "").trim(),
        email: String(fd.get("email") ?? "").trim(),
        company: String(fd.get("company") ?? "").trim(),
        size: String(fd.get("size") ?? "").trim(),
        message: String(fd.get("message") ?? "").trim(),
      };
      if (!entry.name || !entry.email || !entry.message) {
        toast.error("Please fill in name, email, and your message.");
        return;
      }
      const key = "nova-marketing-contact-intake";
      const raw = typeof window !== "undefined" ? localStorage.getItem(key) : null;
      const prev = (raw ? (JSON.parse(raw) as unknown[]) : []) as typeof entry[];
      if (typeof window !== "undefined") {
        localStorage.setItem(key, JSON.stringify([...prev, entry]));
      }
      toast.success("Got it. We'll be in touch within 24 hours.");
      form.reset();
    } catch {
      toast.error("Could not save your message in this browser.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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
        placeholder="e.g. 8 sales, 2 scrapers"
      />

      <div className="space-y-1.5">
        <Label htmlFor="message">What's on your mind?</Label>
        <Textarea
          id="message"
          name="message"
          required
          rows={5}
          placeholder="Tell us about your channels, what's broken in Sheets, or the integrations you need."
        />
      </div>

      <Button type="submit" size="lg" disabled={submitting} className="w-full">
        <Send />
        {submitting ? "Sending..." : "Send message"}
      </Button>

      <p className="text-center text-[11px] text-muted-foreground">
        By submitting you agree to our{" "}
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
