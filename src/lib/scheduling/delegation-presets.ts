import type { Role } from "@/lib/types";

/** Roles commonly used for SDR → closer delegation presets. */
export const DELEGATION_ROLE_PRESETS: {
  id: Role | "all_sales";
  label: string;
  roles: Role[];
}[] = [
  {
    id: "all_sales",
    label: "All salespeople",
    roles: ["salesperson", "prospecting", "team_lead"],
  },
  { id: "salesperson", label: "Salespeople only", roles: ["salesperson"] },
  { id: "prospecting", label: "Prospecting / lead gen", roles: ["prospecting"] },
  { id: "team_lead", label: "Team leads", roles: ["team_lead"] },
];
