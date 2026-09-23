/** Count the signed-in researcher's non-rejected prospects at one company. */
export async function fetchCompanyProspectCountForMe(input: {
  companyDomain?: string;
  companyName?: string;
}): Promise<number> {
  const params = new URLSearchParams({
    countOnly: "1",
    prospectActorSelf: "1",
    intakeKind: "prospect",
  });
  const domain = input.companyDomain?.trim();
  const name = input.companyName?.trim();
  if (domain) params.set("companyDomain", domain);
  else if (name) params.set("companyNameExact", name);
  else return 0;

  const res = await fetch(`/api/org/leads?${params.toString()}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  const json = (await res.json()) as { ok?: boolean; totalCount?: number; error?: string };
  if (!res.ok || json.ok === false || typeof json.totalCount !== "number") {
    throw new Error(json.error || "company prospect count failed");
  }
  return json.totalCount;
}
