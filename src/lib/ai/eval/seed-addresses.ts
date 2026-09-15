/**
 * Inject seedAddresses into bulk schedule batches for inbox-placement monitoring.
 */

export type SeedProspectStub = {
  key: string;
  to: string;
  isSeed: true;
};

export function normalizeSeedEmails(
  settings: { seedAddresses?: string[] } | null | undefined,
): string[] {
  return (settings?.seedAddresses ?? [])
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
}

/** Build synthetic prospect keys for seed addresses (caller schedules a single probe email). */
export function buildSeedProspectStubs(
  settings: { seedAddresses?: string[] } | null | undefined,
): SeedProspectStub[] {
  return normalizeSeedEmails(settings).map((to) => ({
    key: `seed:${to}`,
    to,
    isSeed: true as const,
  }));
}

export function isSeedRecipient(
  settings: { seedAddresses?: string[] } | null | undefined,
  to: string | null | undefined,
): boolean {
  const email = (to ?? "").trim().toLowerCase();
  if (!email.includes("@")) return false;
  return normalizeSeedEmails(settings).includes(email);
}

export function seedMetaForRecipient(to: string): {
  seedAddress: true;
  seedTo: string;
  /** Filled by a future inbox monitor; unknown until placement is observed. */
  seedPlacement: "unknown";
} {
  return {
    seedAddress: true,
    seedTo: to.trim().toLowerCase(),
    seedPlacement: "unknown",
  };
}

/** Short deliverability probe used when injecting seeds into a bulk batch. */
export function seedProbeCopy(orgName?: string): { subject: string; text: string } {
  const who = orgName?.trim() || "Nova CRM";
  return {
    subject: `${who} deliverability probe`,
    text: `This is an automated deliverability seed message from ${who}. No action needed.`,
  };
}
