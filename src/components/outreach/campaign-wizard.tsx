"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";

type StepDraft = {
  delay: number;
  subject: string;
  body: string;
};

type AccountOption = { email: string };

const DEFAULT_STEP: StepDraft = { delay: 3, subject: "", body: "" };

export function CampaignWizard({
  open,
  onOpenChange,
  connected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connected: boolean;
}) {
  const router = useRouter();
  const { addCampaign, isDemo } = useWorkspace();
  const [step, setStep] = React.useState(0);
  const [submitting, setSubmitting] = React.useState(false);
  const [name, setName] = React.useState("");
  const [timezone, setTimezone] = React.useState("America/New_York");
  const [scheduleFrom, setScheduleFrom] = React.useState("09:00");
  const [scheduleTo, setScheduleTo] = React.useState("17:00");
  const [steps, setSteps] = React.useState<StepDraft[]>([{ ...DEFAULT_STEP }]);
  const [accounts, setAccounts] = React.useState<AccountOption[]>([]);
  const [selectedAccounts, setSelectedAccounts] = React.useState<string[]>([]);
  const [activateOnCreate, setActivateOnCreate] = React.useState(false);

  React.useEffect(() => {
    if (!open || !connected || isDemo) return;
    void (async () => {
      try {
        const res = await fetch("/api/integrations/instantly/accounts");
        if (!res.ok) return;
        const data = (await res.json()) as { accounts?: { email: string }[] };
        setAccounts((data.accounts ?? []).map((a) => ({ email: a.email })));
      } catch {
        /* ignore */
      }
    })();
  }, [open, connected, isDemo]);

  function reset() {
    setStep(0);
    setName("");
    setSteps([{ ...DEFAULT_STEP }]);
    setSelectedAccounts([]);
    setActivateOnCreate(false);
  }

  function updateStep(i: number, patch: Partial<StepDraft>) {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Enter a campaign name");
      return;
    }
    for (const s of steps) {
      if (!s.subject.trim() || !s.body.trim()) {
        toast.error("Each email step needs a subject and body");
        return;
      }
    }

    setSubmitting(true);
    try {
      if (isDemo || !connected) {
        const id = `c-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
        addCampaign({
          id,
          name: trimmed,
          channel: "cold_email",
          status: "draft",
          externalRef: `instantly:demo-${id.slice(2, 10)}`,
          instantlyId: `demo-${id.slice(2, 10)}`,
          startedAt: new Date().toISOString(),
          sequenceSummary: { steps: steps.length },
          stats: { sent: 0, replied: 0, meetings: 0, closed: 0 },
        });
        toast.success("Campaign created (demo)");
        onOpenChange(false);
        reset();
        router.push(`/outreach/${id}`);
        return;
      }

      const res = await fetch("/api/integrations/instantly/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          timezone,
          scheduleFrom,
          scheduleTo,
          steps: steps.map((s) => ({
            type: "email" as const,
            delay: s.delay,
            variants: [{ subject: s.subject.trim(), body: s.body.trim() }],
          })),
          email_list: selectedAccounts.length ? selectedAccounts : undefined,
          activate: activateOnCreate,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : "Could not create campaign");
        return;
      }
      const campaign = data.campaign as { id: string };
      toast.success("Campaign created in Instantly");
      onOpenChange(false);
      reset();
      router.push(`/outreach/${campaign.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" showCloseButton>
        <DialogHeader>
          <DialogTitle>New outreach campaign</DialogTitle>
          <DialogDescription>
            {step === 0 && "Name and sending schedule"}
            {step === 1 && "Email sequence (first touch + follow-ups)"}
            {step === 2 && "Sending accounts"}
          </DialogDescription>
        </DialogHeader>

        {step === 0 && (
          <div className="grid gap-3 py-1">
            <div className="grid gap-2">
              <Label htmlFor="cw-name">Campaign name</Label>
              <Input id="cw-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cw-tz">Timezone</Label>
              <Input id="cw-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-2">
                <Label htmlFor="cw-from">Send from</Label>
                <Input id="cw-from" value={scheduleFrom} onChange={(e) => setScheduleFrom(e.target.value)} placeholder="09:00" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="cw-to">Send until</Label>
                <Input id="cw-to" value={scheduleTo} onChange={(e) => setScheduleTo(e.target.value)} placeholder="17:00" />
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4 py-1">
            {steps.map((s, i) => (
              <div key={i} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    Step {i + 1}
                    {i > 0 ? ` · wait ${s.delay} days` : ""}
                  </span>
                  {steps.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setSteps((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                {i > 0 && (
                  <div className="grid gap-1">
                    <Label className="text-xs">Delay (days)</Label>
                    <Input
                      type="number"
                      min={1}
                      value={s.delay}
                      onChange={(e) => updateStep(i, { delay: Number(e.target.value) || 1 })}
                      className="h-8"
                    />
                  </div>
                )}
                <div className="grid gap-1">
                  <Label className="text-xs">Subject</Label>
                  <Input value={s.subject} onChange={(e) => updateStep(i, { subject: e.target.value })} className="h-8" />
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs">Body</Label>
                  <Textarea
                    value={s.body}
                    onChange={(e) => updateStep(i, { body: e.target.value })}
                    className="min-h-[72px] text-sm"
                    placeholder="Hi {{first_name}}, …"
                  />
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSteps((prev) => [...prev, { ...DEFAULT_STEP }])}
            >
              <Plus className="h-3.5 w-3.5" /> Add follow-up
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3 py-1">
            {!connected || isDemo ? (
              <p className="text-xs text-muted-foreground">
                Connect Instantly to assign sending accounts. Demo campaigns skip this step.
              </p>
            ) : accounts.length === 0 ? (
              <p className="text-xs text-muted-foreground">No sending accounts found in Instantly.</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {accounts.map((a) => (
                  <label key={a.email} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={selectedAccounts.includes(a.email)}
                      onCheckedChange={(checked) => {
                        setSelectedAccounts((prev) =>
                          checked ? [...prev, a.email] : prev.filter((e) => e !== a.email),
                        );
                      }}
                    />
                    <span className="font-mono text-xs">{a.email}</span>
                  </label>
                ))}
              </div>
            )}
            {connected && !isDemo && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={activateOnCreate} onCheckedChange={(c) => setActivateOnCreate(Boolean(c))} />
                Activate campaign after creation
              </label>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {step > 0 ? (
            <Button type="button" variant="outline" onClick={() => setStep((s) => s - 1)}>
              Back
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          )}
          {step < 2 ? (
            <Button
              type="button"
              onClick={() => {
                if (step === 0 && !name.trim()) {
                  toast.error("Enter a campaign name");
                  return;
                }
                setStep((s) => s + 1);
              }}
            >
              Next
            </Button>
          ) : (
            <Button type="button" disabled={submitting} onClick={() => void submit()}>
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Create campaign
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
