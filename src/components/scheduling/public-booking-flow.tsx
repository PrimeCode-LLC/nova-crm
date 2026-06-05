"use client";

import * as React from "react";
import { format, parseISO } from "date-fns";
import { ArrowLeft, Clock, Globe, Video } from "lucide-react";
import { toast } from "sonner";

import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type PublicLink = {
  slug: string;
  title: string;
  description?: string;
  durationMin: number;
  locationType: string;
  locationDetails?: string;
  hostName?: string;
  color?: string;
};

type PublicOrg = { name: string; slug: string };

type Step = "datetime" | "details" | "confirmed";

const LOCATION_LABEL: Record<string, string> = {
  google_meet: "Google Meet",
  zoom: "Zoom",
  teams: "Microsoft Teams",
  phone: "Phone call",
  in_person: "In person",
  custom: "Custom",
};

export function PublicBookingFlow({
  orgSlug,
  linkSlug,
  organization,
  link,
  scheduleTimezone,
  availableDates,
  initialEmail,
  initialName,
  demoMode,
}: {
  orgSlug: string;
  linkSlug: string;
  organization: PublicOrg;
  link: PublicLink;
  scheduleTimezone: string;
  availableDates: string[];
  initialEmail?: string;
  initialName?: string;
  /** Skip API when previewing demo org without Firestore. */
  demoMode?: boolean;
}) {
  const [step, setStep] = React.useState<Step>("datetime");
  const [selectedDate, setSelectedDate] = React.useState<Date | undefined>();
  const [slots, setSlots] = React.useState<{ startAt: string; endAt: string }[]>([]);
  const [loadingSlots, setLoadingSlots] = React.useState(false);
  const [selectedSlot, setSelectedSlot] = React.useState<{
    startAt: string;
    endAt: string;
  } | null>(null);
  const [name, setName] = React.useState(initialName ?? "");
  const [email, setEmail] = React.useState(initialEmail ?? "");
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [confirmedMeeting, setConfirmedMeeting] = React.useState<{
    startAt: string;
    endAt: string;
  } | null>(null);

  const availableSet = React.useMemo(() => new Set(availableDates), [availableDates]);
  const accent = link.color ?? "#006bff";

  React.useEffect(() => {
    if (!selectedDate) {
      setSlots([]);
      return;
    }
    const ymd = format(selectedDate, "yyyy-MM-dd");
    setLoadingSlots(true);
    setSelectedSlot(null);
    fetch(`/api/scheduling/public/${orgSlug}/${linkSlug}?date=${ymd}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setSlots(j.slots ?? []);
        else setSlots([]);
      })
      .catch(() => setSlots([]))
      .finally(() => setLoadingSlots(false));
  }, [selectedDate, orgSlug, linkSlug]);

  async function handleSchedule() {
    if (!selectedSlot || !name.trim() || !email.trim()) {
      toast.error("Name and email are required");
      return;
    }
    setSubmitting(true);
    try {
      if (demoMode && selectedSlot) {
        setConfirmedMeeting(selectedSlot);
        setStep("confirmed");
        toast.success("You're scheduled! (demo)");
        return;
      }
      const res = await fetch(`/api/scheduling/public/${orgSlug}/${linkSlug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startAt: selectedSlot.startAt,
          endAt: selectedSlot.endAt,
          attendeeName: name.trim(),
          attendeeEmail: email.trim(),
          attendeeNotes: notes.trim() || undefined,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || scheduleTimezone,
        }),
      });
      const j = await res.json();
      if (!j.ok) {
        toast.error(j.error ?? "Could not schedule");
        return;
      }
      setConfirmedMeeting(selectedSlot);
      setStep("confirmed");
      toast.success("You're scheduled!");
    } catch {
      toast.error("Could not schedule");
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "confirmed" && confirmedMeeting) {
    const when = format(parseISO(confirmedMeeting.startAt), "h:mm a – ");
    const whenEnd = format(parseISO(confirmedMeeting.endAt), "h:mm a, EEEE, MMMM d, yyyy");
    return (
      <div className="mx-auto max-w-lg rounded-2xl border bg-white p-10 shadow-sm">
        <div
          className="mb-4 flex h-12 w-12 items-center justify-center rounded-full text-white"
          style={{ backgroundColor: accent }}
        >
          ✓
        </div>
        <h1 className="text-2xl font-semibold">You&apos;re scheduled</h1>
        <p className="mt-2 text-muted-foreground">
          A calendar invitation has been sent to <strong>{email}</strong>.
        </p>
        <p className="mt-6 text-sm">
          <strong>{link.title}</strong>
          <br />
          {when}
          {whenEnd}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col overflow-hidden rounded-2xl border bg-white shadow-sm md:min-h-[520px] md:flex-row">
      <aside className="border-b p-8 md:w-[38%] md:border-b-0 md:border-r">
        {step === "details" && (
          <button
            type="button"
            className="mb-4 flex items-center gap-1 text-sm text-primary"
            onClick={() => setStep("datetime")}
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
        )}
        <p className="text-sm font-medium text-muted-foreground">{organization.name}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{link.title}</h1>
        <ul className="mt-6 space-y-3 text-sm text-muted-foreground">
          <li className="flex items-center gap-2">
            <Clock className="h-4 w-4 shrink-0" style={{ color: accent }} />
            {link.durationMin} min
          </li>
          <li className="flex items-start gap-2">
            <Video className="mt-0.5 h-4 w-4 shrink-0" style={{ color: accent }} />
            {link.locationDetails ||
              `${LOCATION_LABEL[link.locationType] ?? "Meeting"}, details upon confirmation`}
          </li>
          {selectedSlot && step === "details" && (
            <li className="flex items-start gap-2 text-foreground">
              <Globe className="mt-0.5 h-4 w-4 shrink-0" style={{ color: accent }} />
              {format(parseISO(selectedSlot.startAt), "h:mm a – ")}
              {format(parseISO(selectedSlot.endAt), "h:mm a, EEEE, MMMM d, yyyy")}
            </li>
          )}
        </ul>
        {link.description?.trim() && (
          <p className="mt-6 text-sm leading-relaxed text-muted-foreground">{link.description}</p>
        )}
        {link.hostName && (
          <p className="mt-4 text-xs text-muted-foreground">Host: {link.hostName}</p>
        )}
      </aside>

      <main className="flex flex-1 flex-col p-8">
        {step === "datetime" ? (
          <>
            <h2 className="text-xl font-semibold">Select a Date &amp; Time</h2>
            <div className="mt-6 flex flex-1 flex-col gap-6 lg:flex-row">
              <div>
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  disabled={(date) => !availableSet.has(format(date, "yyyy-MM-dd"))}
                  className="rounded-md border-0 p-0"
                />
                <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <Globe className="h-4 w-4" />
                  {scheduleTimezone.replace(/_/g, " ")}
                </div>
              </div>
              <div className="min-w-[140px] flex-1 lg:max-w-[200px]">
                {selectedDate ? (
                  <>
                    <p className="mb-3 text-sm font-medium">
                      {format(selectedDate, "EEEE, MMMM d")}
                    </p>
                    {loadingSlots ? (
                      <p className="text-sm text-muted-foreground">Loading times…</p>
                    ) : slots.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No times available</p>
                    ) : (
                      <div className="flex max-h-[320px] flex-col gap-2 overflow-y-auto pr-1">
                        {slots.map((slot) => {
                          const label = format(parseISO(slot.startAt), "h:mm a");
                          const active = selectedSlot?.startAt === slot.startAt;
                          return (
                            <div key={slot.startAt} className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setSelectedSlot(slot)}
                                className={cn(
                                  "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                                  active
                                    ? "border-transparent text-white"
                                    : "border-primary/30 text-primary hover:bg-primary/5",
                                )}
                                style={active ? { backgroundColor: accent } : undefined}
                              >
                                {label}
                              </button>
                              {active && (
                                <Button
                                  size="sm"
                                  className="shrink-0"
                                  style={{ backgroundColor: accent }}
                                  onClick={() => setStep("details")}
                                >
                                  Next
                                </Button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Select a date to see times</p>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-xl font-semibold">Enter Details</h2>
            <div className="mt-6 max-w-md space-y-4">
              <div>
                <Label htmlFor="name">Name *</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="notes">Please share anything that will help prepare for our meeting.</Label>
                <Textarea
                  id="notes"
                  rows={4}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
              <Button
                className="w-full"
                style={{ backgroundColor: accent }}
                disabled={submitting}
                onClick={() => void handleSchedule()}
              >
                {submitting ? "Scheduling…" : "Schedule Event"}
              </Button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
