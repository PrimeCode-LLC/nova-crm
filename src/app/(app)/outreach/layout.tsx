import { AdminFeatureGate } from "@/components/admin/admin-feature-gate";

export default function OutreachLayout({ children }: { children: React.ReactNode }) {
  return <AdminFeatureGate feature="email_outreach">{children}</AdminFeatureGate>;
}
