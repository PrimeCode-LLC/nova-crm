import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { DocumentSnapshot } from "firebase-admin/firestore";
import type {
  Account,
  Campaign,
  Contact,
  CrmLabel,
  Deal,
  Followup,
  Lead,
  LeadTask,
  Note,
  Profile,
  ScriptLibraryItem,
  TimelineEvent,
  Touchpoint,
} from "@/lib/types";
import type {
  BuyerPersona,
  ProspectingStrategy,
  StrategyAssignment,
} from "@/lib/prospecting-strategy/types";
import {
  buildLeadAiEmailThreadsFromMail,
  type LeadAiEmailThread,
} from "@/lib/ai/lead-ai-email-threads";
import { listLeadMailMessagesServer } from "@/lib/email/lead-mail-store-server";
import { LEAD_MAIL_LIST_LIMIT } from "@/lib/email/lead-mail-types";

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
  emailThreads?: LeadAiEmailThread[];
  campaign?: Campaign;
  profile?: Profile;
  strategy?: ProspectingStrategy;
  persona?: BuyerPersona;
  strategyAssignment?: StrategyAssignment;
  caseStudy?: ScriptLibraryItem;
  labels?: CrmLabel[];
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
    campaign?: Record<string, unknown>;
    profile?: Record<string, unknown>;
    strategy?: Record<string, unknown>;
    persona?: Record<string, unknown>;
    strategyAssignment?: Record<string, unknown>;
    caseStudy?: Record<string, unknown>;
    labels?: Record<string, unknown>[];
  };
  emailThreads?: LeadAiContextInput["emailThreads"];
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
      emailThreads: input.emailThreads ?? d.emailThreads,
      campaign: d.campaign as unknown as Campaign | undefined,
      profile: d.profile as unknown as Profile | undefined,
      strategy: d.strategy as unknown as ProspectingStrategy | undefined,
      persona: d.persona as unknown as BuyerPersona | undefined,
      strategyAssignment: d.strategyAssignment as unknown as StrategyAssignment | undefined,
      caseStudy: d.caseStudy as unknown as ScriptLibraryItem | undefined,
      labels: (d.labels ?? []) as unknown as CrmLabel[],
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

  const [
    accountSnap,
    contactSnap,
    notesSnap,
    timelineSnap,
    touchSnap,
    followSnap,
    tasksSnap,
    campaignSnap,
    profileSnap,
    strategySnap,
    personaSnap,
    assignmentSnap,
    caseStudySnap,
  ] =
    await Promise.all([
      db.collection(COLLECTIONS.accounts).doc(lead.accountId).get(),
      db.collection(COLLECTIONS.contacts).doc(lead.contactId).get(),
      db
        .collection(COLLECTIONS.notes)
        .where("leadId", "==", lead.id)
        .orderBy("createdAt", "desc")
        .limit(30)
        .get(),
      db
        .collection(COLLECTIONS.timelineEvents)
        .where("leadId", "==", lead.id)
        .orderBy("createdAt", "desc")
        .limit(40)
        .get(),
      db
        .collection(COLLECTIONS.touchpoints)
        .where("leadId", "==", lead.id)
        .orderBy("occurredAt", "desc")
        .limit(30)
        .get(),
      db
        .collection(COLLECTIONS.followups)
        .where("leadId", "==", lead.id)
        .orderBy("dueAt", "desc")
        .limit(30)
        .get(),
      db
        .collection(COLLECTIONS.leadTasks)
        .where("leadId", "==", lead.id)
        .orderBy("createdAt", "desc")
        .limit(30)
        .get(),
      lead.campaignId
        ? db.collection(COLLECTIONS.campaigns).doc(lead.campaignId).get()
        : Promise.resolve(undefined),
      lead.profileId
        ? db.collection(COLLECTIONS.profiles).doc(lead.profileId).get()
        : Promise.resolve(undefined),
      lead.strategyId
        ? db.collection(COLLECTIONS.prospectingStrategies).doc(lead.strategyId).get()
        : Promise.resolve(undefined),
      lead.personaId
        ? db.collection(COLLECTIONS.buyerPersonas).doc(lead.personaId).get()
        : Promise.resolve(undefined),
      lead.strategyAssignmentId
        ? db.collection(COLLECTIONS.strategyAssignments).doc(lead.strategyAssignmentId).get()
        : Promise.resolve(undefined),
      lead.caseStudyId
        ? db.collection(COLLECTIONS.scriptLibrary).doc(lead.caseStudyId).get()
        : Promise.resolve(undefined),
    ]);

  let deal: Deal | undefined;
  const dealsSnap = await db
    .collection(COLLECTIONS.deals)
    .where("leadId", "==", lead.id)
    .limit(1)
    .get();
  if (
    !dealsSnap.empty &&
    dealsSnap.docs[0].data().organizationId === input.organizationId
  ) {
    deal = { ...dealsSnap.docs[0].data(), id: dealsSnap.docs[0].id } as Deal;
  }

  const labelSnaps = lead.labelIds?.length
    ? await Promise.all(
        lead.labelIds.map((id) => db.collection(COLLECTIONS.labels).doc(id).get()),
      )
    : [];
  const belongsToOrganization = (snap: DocumentSnapshot | undefined) =>
    Boolean(snap?.exists && snap.data()?.organizationId === input.organizationId);

  // Prefer durable lead-mail (sent + replies). Fall back to client threads when store is empty.
  const storedMail = await listLeadMailMessagesServer({
    organizationId: input.organizationId,
    leadId: lead.id,
    limit: LEAD_MAIL_LIST_LIMIT,
  });
  const emailThreads =
    storedMail.length > 0
      ? buildLeadAiEmailThreadsFromMail(storedMail)
      : (input.emailThreads ?? []);

  return {
    lead,
    account: belongsToOrganization(accountSnap)
      ? ({ ...accountSnap.data(), id: accountSnap.id } as Account)
      : undefined,
    contact: belongsToOrganization(contactSnap)
      ? ({ ...contactSnap.data(), id: contactSnap.id } as Contact)
      : undefined,
    deal,
    notes: notesSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as Note),
    timeline: timelineSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as TimelineEvent),
    touchpoints: touchSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as Touchpoint),
    followups: followSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as Followup),
    tasks: tasksSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as LeadTask),
    emailThreads,
    campaign: belongsToOrganization(campaignSnap)
      ? ({ ...campaignSnap!.data(), id: campaignSnap!.id } as Campaign)
      : undefined,
    profile: belongsToOrganization(profileSnap)
      ? ({ ...profileSnap!.data(), id: profileSnap!.id } as Profile)
      : undefined,
    strategy: belongsToOrganization(strategySnap)
      ? ({ ...strategySnap!.data(), id: strategySnap!.id } as ProspectingStrategy)
      : undefined,
    persona: belongsToOrganization(personaSnap)
      ? ({ ...personaSnap!.data(), id: personaSnap!.id } as BuyerPersona)
      : undefined,
    strategyAssignment: belongsToOrganization(assignmentSnap)
      ? ({ ...assignmentSnap!.data(), id: assignmentSnap!.id } as StrategyAssignment)
      : undefined,
    caseStudy: belongsToOrganization(caseStudySnap)
      ? ({ ...caseStudySnap!.data(), id: caseStudySnap!.id } as ScriptLibraryItem)
      : undefined,
    labels: labelSnaps
      .filter((snap) => belongsToOrganization(snap))
      .map((snap) => ({ ...snap.data(), id: snap.id }) as CrmLabel),
  };
}
