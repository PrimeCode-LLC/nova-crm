import { AdminRouteFeatureGate } from "@/components/admin/admin-feature-gate";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminRouteFeatureGate>{children}</AdminRouteFeatureGate>;
}
