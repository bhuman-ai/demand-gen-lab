import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Inbox,
  Layers3,
  Mail,
  Network,
  Sparkles,
  TestTubeDiagonal,
} from "lucide-react";
import BrandWordmark from "@/components/layout/brand-wordmark";
import { Button } from "@/components/ui/button";
import { AUTHENTICATED_HOME } from "@/lib/auth-paths";
import { getRequestAuthSession } from "@/lib/auth-server";

const OPERATING_SURFACES = [
  {
    title: "Brands stay grounded",
    detail: "Each workspace carries its website, positioning, sender setup, experiments, and inbox context together.",
    icon: Layers3,
  },
  {
    title: "Tests move into sending",
    detail: "Draft angles, publish the flow, confirm the approved table, and watch runs move from waiting to sending.",
    icon: TestTubeDiagonal,
  },
  {
    title: "Reply work is visible",
    detail: "Open inbox state, send drafts, and follow thread context without hopping between provider tabs.",
    icon: Inbox,
  },
];

const SIGNALS = [
  "EnrichAnything-backed prospect tables",
  "Sender health and mailbox wiring in one desk",
  "Experiment, campaign, and inbox state on the same surface",
];

export default async function MarketingHomePage() {
  const session = await getRequestAuthSession();
  const primaryHref = session ? AUTHENTICATED_HOME : "/signup";
  const secondaryHref = session ? "/brands" : "/login";
  const primaryLabel = session ? "Open workspace" : "Create account";
  const secondaryLabel = session ? "Open brands" : "Sign in";

  return (
    <div className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1280px] flex-col px-5 py-6 md:px-8 lg:px-10">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="group inline-flex">
            <BrandWordmark
              animated
              lastClassName="text-[2rem]"
              b2bClassName="mb-[0.26em] text-[0.72rem] tracking-[0.1em] transition-colors group-hover:text-[color:var(--foreground)]"
            />
          </Link>

          <div className="flex items-center gap-2">
            <Button asChild variant="ghost">
              <Link href={secondaryHref}>{secondaryLabel}</Link>
            </Button>
            <Button asChild>
              <Link href={primaryHref}>
                {primaryLabel}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </header>

        <main className="flex-1 py-10 lg:py-14">
          <section className="grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_31rem] lg:items-start">
            <div className="motion-enter min-w-0" style={{ ["--motion-order" as string]: 0 }}>
              <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                <Sparkles className="h-3.5 w-3.5" />
                Signed-out homepage
              </div>
              <h1 className="mt-6 max-w-[11ch] text-[clamp(3.5rem,9vw,7rem)] font-semibold leading-[0.9] tracking-[-0.09em] text-[color:var(--foreground)]">
                Outbound operations in one desk.
              </h1>
              <p className="mt-6 max-w-[46rem] text-[1.05rem] leading-8 text-[color:var(--muted-foreground)]">
                last b2b is the operating surface behind the experiments, senders, approved prospect tables, and
                reply work. Signed-out visitors see the product story first. Signed-in operators go straight to the desk.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <Link href={primaryHref}>
                    {primaryLabel}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href={secondaryHref}>{secondaryLabel}</Link>
                </Button>
              </div>

              <div className="mt-10 grid gap-3 text-sm text-[color:var(--muted-foreground)]">
                {SIGNALS.map((signal) => (
                  <div key={signal} className="flex items-center gap-3">
                    <CheckCircle2 className="h-4 w-4 text-[color:var(--foreground)]" />
                    {signal}
                  </div>
                ))}
              </div>
            </div>

            <div
              className="motion-enter rounded-[30px] border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-[0_22px_70px_rgba(15,23,42,0.08)] lg:p-6"
              style={{ ["--motion-order" as string]: 1 }}
            >
              <div className="rounded-[24px] border border-[color:var(--border)] bg-[color:var(--background)] p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                      Operator view
                    </div>
                    <div className="mt-2 text-[1.85rem] font-semibold tracking-[-0.06em]">What opens after login</div>
                  </div>
                  <Mail className="mt-1 h-5 w-5 text-[color:var(--muted-foreground)]" />
                </div>

                <div className="mt-6 grid gap-3">
                  <div className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium">Brand switcher</div>
                      <div className="text-xs text-[color:var(--muted-foreground)]">Pinned to the active desk</div>
                    </div>
                    <div className="mt-3 text-sm text-[color:var(--muted-foreground)]">
                      Move between brands without losing experiment, campaign, or inbox context.
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                      <TestTubeDiagonal className="h-4 w-4 text-[color:var(--foreground)]" />
                      <div className="mt-3 text-sm font-medium">Experiments</div>
                      <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">Draft, waiting, sending, blocked.</div>
                    </div>
                    <div className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                      <Network className="h-4 w-4 text-[color:var(--foreground)]" />
                      <div className="mt-3 text-sm font-medium">Senders</div>
                      <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">Mailbox readiness before launch.</div>
                    </div>
                    <div className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                      <Inbox className="h-4 w-4 text-[color:var(--foreground)]" />
                      <div className="mt-3 text-sm font-medium">Reply queue</div>
                      <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">Open threads and next actions.</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="mt-16 grid gap-5 lg:grid-cols-3">
            {OPERATING_SURFACES.map((surface, index) => {
              const Icon = surface.icon;
              return (
                <div
                  key={surface.title}
                  className="motion-enter rounded-[26px] border border-[color:var(--border)] bg-[color:var(--surface)] p-6"
                  style={{ ["--motion-order" as string]: index + 2 }}
                >
                  <Icon className="h-5 w-5 text-[color:var(--foreground)]" />
                  <h2 className="mt-5 text-[1.4rem] font-semibold tracking-[-0.05em]">{surface.title}</h2>
                  <p className="mt-3 text-sm leading-7 text-[color:var(--muted-foreground)]">{surface.detail}</p>
                </div>
              );
            })}
          </section>

          <section className="mt-16 rounded-[32px] border border-[color:var(--border)] bg-[color:var(--surface)] px-6 py-8 lg:px-8">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                  Access boundary
                </div>
                <h2 className="mt-3 text-[2rem] font-semibold tracking-[-0.06em]">
                  Public story outside. Operator desk inside.
                </h2>
                <p className="mt-3 max-w-[46rem] text-sm leading-7 text-[color:var(--muted-foreground)]">
                  This split matters. last b2b can now present a real homepage to visitors while keeping the actual
                  brand, sender, experiment, and inbox operations behind login.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <Link href={primaryHref}>
                    {primaryLabel}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                {!session ? (
                  <Button asChild size="lg" variant="outline">
                    <Link href="/login">Sign in</Link>
                  </Button>
                ) : null}
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
