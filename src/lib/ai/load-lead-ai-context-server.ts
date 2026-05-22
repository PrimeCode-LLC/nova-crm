import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type {
  Account,
  Contact,
  Deal,
  Followup,
  Lead,
  LeadTask,
  Note,
  TimelineEvent,
  Touchpoint,
} from "@/lib/types";

export type LeadAiContextInput = {
  lead: Lead;
  account?: Account;
  contact?: Contact;
  deal?: Deal;
  notes: Note[];
  timeline: TimelineEvent[];
  touchpoints: Touchpoint[];
  followups: Followup[];
  tasks: LeadTask[];
  emailThreads?: { subject: string; messages: { from: string; date: string; snippet: string }[] }[];
};

const demoContextSchema = {
  lead: (v: Record<string, unknown>) => v as unknown as Lead,
};

export async function loadLeadAiContextServer(input: {
  organizationId: string;
  leadId: string;
  demoContext?: {
    lead: Record<string, unknown>;
    account?: Record<string, unknown>;
    contact?: Record<string, unknown>;
    deal?: Record<string, unknown>;
    notes?: Record<string, unknown>[];
    timeline?: Record<string, unknown>[];
    touchpoints?: Record<string, unknown>[];
    followups?: Record<string, unknown>[];
    tasks?: Record<string, unknown>[];
    emailThreads?: LeadAiContextInput["emailThreads"];
  };
}): Promise<LeadAiContextInput | { error: string; status: number }> {
  if (input.demoContext) {
    const d = input.demoContext;
    return {
      lead: demoContextSchema.lead(d.lead),
      account: d.account as unknown as Account | undefined,
      contact: d.contact as unknown as Contact | undefined,
      deal: d.deal as unknown as Deal | undefined,
      notes: (d.notes ?? []) as unknown as Note[],
      timeline: (d.timeline ?? []) as unknown as TimelineEvent[],
      touchpoints: (d.touchpoints ?? []) as unknown as Touchpoint[],
      followups: (d.followups ?? []) as unknown as Followup[],
      tasks: (d.tasks ?? []) as unknown as LeadTask[],
      emailThreads: d.emailThreads,
    };
  }

  const db = getAdminDb();
  if (!db) return { error: "Database not configured", status: 503 };

  const leadSnap = await db.collection(COLLECTIONS.leads).doc(input.leadId).get();
  if (!leadSnap.exists) return { error: "Lead not found", status: 404 };

  const rawLead = leadSnap.data() as Record<string, unknown>;
  if (rawLead.organizationId !== input.organizationId) {
    return { error: "Forbidden", status: 403 };
  }
  const lead = { ...rawLead, id: leadSnap.id } as Lead;

  const [accountSnap, contactSnap, notesSnap, timelineSnap, touchSnap, followSnap, tasksSnap] =
    await Promise.all([
      db.collection(COLLECTIONS.accounts).doc(lead.accountId).get(),
      db.collection(COLLECTIONS.contacts).doc(lead.contactId).get(),
      db.collection(COLLECTIONS.notes).where("leadId", "==", lead.id).limit(30).get(),
      db.collection(COLLECTIONS.timelineEvents).where("leadId", "==", lead.id).limit(40).get(),
      db.collection(COLLECTIONS.touchpoints).where("leadId", "==", lead.id).limit(30).get(),
      db.collection(COLLECTIONS.followups).where("leadId", "==", lead.id).limit(20).get(),
      db.collection(COLLECTIONS.leadTasks).where("leadId", "==", lead.id).limit(20).get(),
    ]);

  let deal: Deal | undefined;
  const dealsSnap = await db
    .collection(COLLECTIONS.deals)
    .where("leadId", "==", lead.id)
    .limit(1)
    .get();
  if (!dealsSnap.empty) {
    deal = { ...dealsSnap.docs[0].data(), id: dealsSnap.docs[0].id } as Deal;
  }

  return {
    lead,
    account: accountSnap.exists
      ? ({ ...accountSnap.data(), id: accountSnap.id } as Account)
      : undefined,
    contact: contactSnap.exists
      ? ({ ...contactSnap.data(), id: contactSnap.id } as Contact)
      : undefined,
    deal,
    notes: notesSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as Note),
    timeline: timelineSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as TimelineEvent),
    touchpoints: touchSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as Touchpoint),
    followups: followSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as Followup),
    tasks: tasksSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as LeadTask),
    emailThreads: [],
  };
}
