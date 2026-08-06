import { WaitlistForm } from "./waitlist-form";

export function CtaBand() {
  return (
    <section className="relative py-20 sm:py-28">
      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-card/60 px-8 py-14 text-center backdrop-blur-xl sm:px-16 sm:py-16">
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,oklch(0.7_0.17_265/.16),transparent_70%)]"
          />
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-primary/90">
            Nova
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            You do not manage the prospect journey.
            <br />
            Nova does.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Join the waitlist for early access. Tell us about your outbound motion
            and we&apos;ll reach out from sales@stellixsoft.com.
          </p>
          <div className="mx-auto mt-8 max-w-lg">
            <WaitlistForm showCompany />
          </div>
        </div>
      </div>
    </section>
  );
}
