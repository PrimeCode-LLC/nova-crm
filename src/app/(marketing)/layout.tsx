import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      <BackgroundGradient />
      <SiteHeader />
      <main className="relative flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}

function BackgroundGradient() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div className="absolute -top-40 left-1/2 h-[600px] w-[1100px] -translate-x-1/2 rounded-full bg-primary/15 blur-[140px] dark:bg-primary/10" />
      <div className="absolute top-[40vh] -right-40 h-[500px] w-[700px] rounded-full bg-indigo-500/10 blur-[120px]" />
      <div className="absolute bottom-0 left-0 h-[400px] w-[500px] rounded-full bg-fuchsia-500/[0.06] blur-[120px]" />
    </div>
  );
}
