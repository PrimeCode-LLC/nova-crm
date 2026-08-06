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
      <div className="absolute -top-40 left-1/2 h-[620px] w-[1100px] -translate-x-1/2 rounded-full bg-primary/12 blur-[140px] dark:bg-primary/10" />
      <div className="absolute top-[38vh] -right-40 h-[480px] w-[680px] rounded-full bg-cyan-500/[0.08] blur-[120px]" />
      <div className="absolute bottom-0 left-0 h-[380px] w-[480px] rounded-full bg-sky-500/[0.05] blur-[120px]" />
    </div>
  );
}
