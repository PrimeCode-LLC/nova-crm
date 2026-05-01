"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { CHANNELS, PIPELINE_STAGES, PRIORITY_TONE, TEMPERATURE_TONE, COMPANY_SIZES, REVENUE_RANGES, CHANNEL_LIST } from "@/lib/constants";
import { mockUsers, mockAccounts, mockLeads } from "@/lib/mock-data";
import { UserRound, Building2, Contact, CheckSquare } from "lucide-react";

type Pill = "lead" | "contact" | "account" | "task";

const PILLS: { key: Pill; label: string; icon: React.ElementType }[] = [
  { key: "lead", label: "Lead", icon: UserRound },
  { key: "contact", label: "Contact", icon: Contact },
  { key: "account", label: "Account", icon: Building2 },
  { key: "task", label: "Task", icon: CheckSquare },
];

// ── Lead schema ──
const leadSchema = z.object({
  contactName: z.string().min(1, "Name required"),
  company: z.string().min(1, "Company required"),
  channel: z.string().min(1, "Channel required"),
  email: z.string().email("Invalid email").or(z.literal("")),
  stage: z.string().min(1, "Stage required"),
  ownerId: z.string().min(1, "Owner required"),
  estimatedValue: z.string().optional(),
  priority: z.string().min(1, "Priority required"),
  temperature: z.string().min(1, "Temperature required"),
});
type LeadForm = z.infer<typeof leadSchema>;

// ── Contact schema ──
const contactSchema = z.object({
  firstName: z.string().min(1, "First name required"),
  lastName: z.string().min(1, "Last name required"),
  accountId: z.string().min(1, "Account required"),
  email: z.string().email("Invalid email").or(z.literal("")),
  phone: z.string().optional(),
  title: z.string().optional(),
});
type ContactForm = z.infer<typeof contactSchema>;

// ── Account schema ──
const accountSchema = z.object({
  name: z.string().min(1, "Name required"),
  domain: z.string().optional(),
  industry: z.string().optional(),
  size: z.string().optional(),
  revenueRange: z.string().optional(),
});
type AccountForm = z.infer<typeof accountSchema>;

// ── Task schema ──
const taskSchema = z.object({
  title: z.string().min(1, "Title required"),
  leadId: z.string().optional(),
  dueDate: z.string().min(1, "Due date required"),
  priority: z.string().min(1, "Priority required"),
});
type TaskForm = z.infer<typeof taskSchema>;

// ── Sub-form components ──
function LeadFormBody({ onClose }: { onClose: () => void }) {
  const form = useForm<LeadForm>({
    resolver: zodResolver(leadSchema),
    defaultValues: { contactName: "", company: "", channel: "", email: "", stage: "new", ownerId: "", estimatedValue: "", priority: "medium", temperature: "cold" },
  });

  async function onSubmit(_v: LeadForm) {
    await new Promise((r) => setTimeout(r, 800));
    toast.success("Lead created");
    onClose();
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <FormField control={form.control} name="contactName" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Contact name</FormLabel>
              <FormControl><Input className="h-9" placeholder="Jordan Harper" {...field} /></FormControl>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
          <FormField control={form.control} name="company" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Company</FormLabel>
              <FormControl><Input className="h-9" placeholder="Acme Inc." {...field} /></FormControl>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField control={form.control} name="channel" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Channel</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl><SelectTrigger className="h-9"><SelectValue placeholder="Channel" /></SelectTrigger></FormControl>
                <SelectContent>{CHANNEL_LIST.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
          <FormField control={form.control} name="email" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Email</FormLabel>
              <FormControl><Input type="email" className="h-9" placeholder="contact@co.com" {...field} /></FormControl>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <FormField control={form.control} name="stage" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Stage</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl><SelectTrigger className="h-9"><SelectValue /></SelectTrigger></FormControl>
                <SelectContent>{PIPELINE_STAGES.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
          <FormField control={form.control} name="priority" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Priority</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl><SelectTrigger className="h-9"><SelectValue /></SelectTrigger></FormControl>
                <SelectContent>{Object.entries(PRIORITY_TONE).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
              </Select>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
          <FormField control={form.control} name="temperature" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Temperature</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl><SelectTrigger className="h-9"><SelectValue /></SelectTrigger></FormControl>
                <SelectContent>{Object.entries(TEMPERATURE_TONE).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
              </Select>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField control={form.control} name="ownerId" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Owner</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl><SelectTrigger className="h-9"><SelectValue placeholder="Assign to" /></SelectTrigger></FormControl>
                <SelectContent>{mockUsers.map((u) => <SelectItem key={u.id} value={u.id}>{u.displayName}</SelectItem>)}</SelectContent>
              </Select>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
          <FormField control={form.control} name="estimatedValue" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Est. value (USD)</FormLabel>
              <FormControl><Input type="number" className="h-9 tabular-nums" placeholder="0" {...field} /></FormControl>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Creating…" : "Create lead"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function ContactFormBody({ onClose }: { onClose: () => void }) {
  const form = useForm<ContactForm>({
    resolver: zodResolver(contactSchema),
    defaultValues: { firstName: "", lastName: "", accountId: "", email: "", phone: "", title: "" },
  });

  async function onSubmit(_v: ContactForm) {
    await new Promise((r) => setTimeout(r, 800));
    toast.success("Contact created");
    onClose();
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <FormField control={form.control} name="firstName" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">First name</FormLabel>
              <FormControl><Input className="h-9" placeholder="Jordan" {...field} /></FormControl>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
          <FormField control={form.control} name="lastName" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Last name</FormLabel>
              <FormControl><Input className="h-9" placeholder="Harper" {...field} /></FormControl>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
        </div>
        <FormField control={form.control} name="accountId" render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">Account</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl><SelectTrigger className="h-9"><SelectValue placeholder="Select account" /></SelectTrigger></FormControl>
              <SelectContent>{mockAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
            </Select>
            <FormMessage className="text-xs" />
          </FormItem>
        )} />
        <div className="grid grid-cols-2 gap-3">
          <FormField control={form.control} name="email" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Email</FormLabel>
              <FormControl><Input type="email" className="h-9" placeholder="jordan@co.com" {...field} /></FormControl>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
          <FormField control={form.control} name="phone" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Phone</FormLabel>
              <FormControl><Input className="h-9" placeholder="+1 555-0100" {...field} /></FormControl>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
        </div>
        <FormField control={form.control} name="title" render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">Title</FormLabel>
            <FormControl><Input className="h-9" placeholder="CEO" {...field} /></FormControl>
            <FormMessage className="text-xs" />
          </FormItem>
        )} />
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Creating…" : "Create contact"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function AccountFormBody({ onClose }: { onClose: () => void }) {
  const form = useForm<AccountForm>({
    resolver: zodResolver(accountSchema),
    defaultValues: { name: "", domain: "", industry: "", size: "", revenueRange: "" },
  });

  async function onSubmit(_v: AccountForm) {
    await new Promise((r) => setTimeout(r, 800));
    toast.success("Account created");
    onClose();
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <FormField control={form.control} name="name" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Company name</FormLabel>
              <FormControl><Input className="h-9" placeholder="Acme Inc." {...field} /></FormControl>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
          <FormField control={form.control} name="domain" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Domain</FormLabel>
              <FormControl><Input className="h-9" placeholder="acme.com" {...field} /></FormControl>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
        </div>
        <FormField control={form.control} name="industry" render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">Industry</FormLabel>
            <FormControl><Input className="h-9" placeholder="SaaS, Fintech, Healthcare…" {...field} /></FormControl>
            <FormMessage className="text-xs" />
          </FormItem>
        )} />
        <div className="grid grid-cols-2 gap-3">
          <FormField control={form.control} name="size" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Company size</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl><SelectTrigger className="h-9"><SelectValue placeholder="Size" /></SelectTrigger></FormControl>
                <SelectContent>{COMPANY_SIZES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
          <FormField control={form.control} name="revenueRange" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Revenue range</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl><SelectTrigger className="h-9"><SelectValue placeholder="Revenue" /></SelectTrigger></FormControl>
                <SelectContent>{Object.entries(REVENUE_RANGES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Creating…" : "Create account"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function TaskFormBody({ onClose }: { onClose: () => void }) {
  const form = useForm<TaskForm>({
    resolver: zodResolver(taskSchema),
    defaultValues: { title: "", leadId: "", dueDate: new Date().toISOString().slice(0, 10), priority: "medium" },
  });

  async function onSubmit(_v: TaskForm) {
    await new Promise((r) => setTimeout(r, 800));
    toast.success("Task created");
    onClose();
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <FormField control={form.control} name="title" render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">Task title</FormLabel>
            <FormControl><Input className="h-9" placeholder="Send proposal to…" {...field} /></FormControl>
            <FormMessage className="text-xs" />
          </FormItem>
        )} />
        <FormField control={form.control} name="leadId" render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">Related lead (optional)</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl><SelectTrigger className="h-9"><SelectValue placeholder="No lead" /></SelectTrigger></FormControl>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
                {mockLeads.slice(0, 15).map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.contactName} · {l.companyName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage className="text-xs" />
          </FormItem>
        )} />
        <div className="grid grid-cols-2 gap-3">
          <FormField control={form.control} name="dueDate" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Due date</FormLabel>
              <FormControl><Input type="date" className="h-9" {...field} /></FormControl>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
          <FormField control={form.control} name="priority" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Priority</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl><SelectTrigger className="h-9"><SelectValue /></SelectTrigger></FormControl>
                <SelectContent>{Object.entries(PRIORITY_TONE).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
              </Select>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Creating…" : "Create task"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

// ── Main dialog ──
export function QuickAddDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [pill, setPill] = React.useState<Pill>("lead");

  function handleClose() {
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Quick add</DialogTitle>
        </DialogHeader>
        <div className="flex gap-1.5 p-1 bg-muted/40 rounded-lg">
          {PILLS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setPill(key)}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                pill === key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
        <div className="mt-1">
          {pill === "lead" && <LeadFormBody onClose={handleClose} />}
          {pill === "contact" && <ContactFormBody onClose={handleClose} />}
          {pill === "account" && <AccountFormBody onClose={handleClose} />}
          {pill === "task" && <TaskFormBody onClose={handleClose} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
