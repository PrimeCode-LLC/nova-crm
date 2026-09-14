"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type ParentConfig = {
  id: string;
  label: string;
  systemPrompt: string;
  userPromptTemplate: string;
  provider?: string;
  model?: string;
};

export function CreateVariantDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parent: ParentConfig | null;
  onCreated: (id: string) => void;
}) {
  const { open, onOpenChange, parent, onCreated } = props;
  const [label, setLabel] = React.useState("");
  const [systemPrompt, setSystemPrompt] = React.useState("");
  const [userPromptTemplate, setUserPromptTemplate] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!parent || !open) return;
    setLabel(`${parent.label} · variant`);
    setSystemPrompt(parent.systemPrompt);
    setUserPromptTemplate(parent.userPromptTemplate);
    setNotes("");
  }, [parent, open]);

  async function submit() {
    if (!parent) return;
    if (!label.trim() || !systemPrompt.trim() || !userPromptTemplate.trim()) {
      toast.error("Label and both prompts are required");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/ai/outreach-configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          featureKey: "followup_suggest",
          label: label.trim(),
          systemPrompt,
          userPromptTemplate,
          parentConfigId: parent.id,
          notes: notes.trim() || undefined,
          provider: parent.provider,
          model: parent.model,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : "Create failed");
        return;
      }
      toast.success("Variant created");
      onOpenChange(false);
      onCreated(String(data.id));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create variant</DialogTitle>
          <DialogDescription>
            Forks an immutable config from {parent?.label ?? "parent"}. Edit prompts here —
            Admin → AI prompts stay separate until you promote a zone pointer.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="variant-label">Label</Label>
            <Input
              id="variant-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="variant-system">System prompt</Label>
            <Textarea
              id="variant-system"
              className="min-h-32 font-mono text-xs"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="variant-user">User prompt template</Label>
            <Textarea
              id="variant-user"
              className="min-h-32 font-mono text-xs"
              value={userPromptTemplate}
              onChange={(e) => setUserPromptTemplate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="variant-notes">Notes (optional)</Label>
            <Input
              id="variant-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Hypothesis for this variant"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !parent}>
            {busy ? "Creating…" : "Create variant"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
