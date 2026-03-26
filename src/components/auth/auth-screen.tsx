"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle2, Inbox, Orbit, ShieldCheck, Workflow } from "lucide-react";
import BrandWordmark from "@/components/layout/brand-wordmark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AUTHENTICATED_HOME, normalizeNextPath } from "@/lib/auth-paths";

type AuthMode = "login" | "signup";

const SCREEN_COPY: Record<
  AuthMode,
  {
    eyebrow: string;
    title: string;
    description: string;
    submit: string;
    alternateLabel: string;
    alternateHref: string;
  }
> = {
  login: {
    eyebrow: "Operator access",
    title: "Sign in to the outbound desk.",
    description: "Open brands, launch tests, inspect runs, and work the reply queue from one surface.",
    submit: "Sign in",
    alternateLabel: "Need an account?",
    alternateHref: "/signup",
  },
  signup: {
    eyebrow: "Create access",
    title: "Create a workspace login.",
    description: "Set up your operator identity once, then move between brands, senders, experiments, and inboxes without a shared browser tab.",
    submit: "Create account",
    alternateLabel: "Already have an account?",
    alternateHref: "/login",
  },
};

function buildAlternateHref(baseHref: string, nextPath: string) {
  if (!nextPath || nextPath === AUTHENTICATED_HOME) {
    return baseHref;
  }
  return `${baseHref}?next=${encodeURIComponent(nextPath)}`;
}

export default function AuthScreen({ mode }: { mode: AuthMode }) {
  const copy = SCREEN_COPY[mode];
  const searchParams = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const nextPath = useMemo(() => {
    return normalizeNextPath(searchParams.get("next"));
  }, [searchParams]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    const requestTimeoutMs = mode === "signup" ? 45_000 : 15_000;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({
          name,
          email,
          password,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error || "Unable to continue.");
        return;
      }

      window.location.assign(nextPath);
    } catch (submitError) {
      if (submitError instanceof DOMException && submitError.name === "AbortError") {
        setError(
          mode === "signup"
            ? "Signup took too long. If this was your first attempt, try signing in now."
            : "Sign in took too long. Try again."
        );
      } else {
        setError(submitError instanceof Error ? submitError.message : "Unable to continue.");
      }
    } finally {
      window.clearTimeout(timeout);
      setSubmitting(false);
    }
  }

  const alternateHref = buildAlternateHref(copy.alternateHref, nextPath);

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
              <Link href="/">Home</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={alternateHref}>{mode === "login" ? "Create account" : "Sign in"}</Link>
            </Button>
          </div>
        </header>

        <div className="grid flex-1 gap-10 py-10 lg:grid-cols-[minmax(0,1.1fr)_28rem] lg:items-center">
          <section className="motion-enter min-w-0" style={{ ["--motion-order" as string]: 0 }}>
            <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
              <Orbit className="h-3.5 w-3.5" />
              {copy.eyebrow}
            </div>
            <h1 className="mt-6 max-w-[14ch] text-[clamp(3.25rem,8vw,6.2rem)] font-semibold leading-[0.92] tracking-[-0.08em] text-[color:var(--foreground)]">
              {copy.title}
            </h1>
            <p className="mt-5 max-w-[42rem] text-[1.02rem] leading-7 text-[color:var(--muted-foreground)]">
              {copy.description}
            </p>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <div className="rounded-[22px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                <div className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">Brands</div>
                <div className="mt-3 text-lg font-semibold tracking-[-0.05em]">Keep every offer desk in one account.</div>
              </div>
              <div className="rounded-[22px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                <div className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">Sending</div>
                <div className="mt-3 text-lg font-semibold tracking-[-0.05em]">Review sender state before anything launches.</div>
              </div>
              <div className="rounded-[22px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                <div className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">Replies</div>
                <div className="mt-3 text-lg font-semibold tracking-[-0.05em]">Handle the queue without bouncing between tools.</div>
              </div>
            </div>

            <div className="mt-8 grid gap-3 text-sm text-[color:var(--muted-foreground)]">
              <div className="flex items-center gap-3">
                <ShieldCheck className="h-4 w-4 text-[color:var(--foreground)]" />
                App access is separated from sender and webhook secrets.
              </div>
              <div className="flex items-center gap-3">
                <Workflow className="h-4 w-4 text-[color:var(--foreground)]" />
                Experiments, campaigns, and inbox work stay in the same authenticated surface.
              </div>
              <div className="flex items-center gap-3">
                <Inbox className="h-4 w-4 text-[color:var(--foreground)]" />
                Public visitors see the product story. Operators see the desk.
              </div>
            </div>
          </section>

          <section
            className="motion-enter rounded-[28px] border border-[color:var(--border)] bg-[color:var(--surface)] p-6 shadow-[0_18px_60px_color-mix(in_oklab,var(--shadow)_14%,transparent)] lg:p-7"
            style={{ ["--motion-order" as string]: 1 }}
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                  {copy.eyebrow}
                </div>
                <div className="mt-2 text-[1.75rem] font-semibold tracking-[-0.06em] text-[color:var(--foreground)]">
                  {copy.submit}
                </div>
              </div>
              <CheckCircle2 className="h-6 w-6 text-[color:var(--muted-foreground)]" />
            </div>

            <form className="mt-6 grid gap-4" onSubmit={handleSubmit}>
              {mode === "signup" ? (
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-[color:var(--foreground)]">Full name</span>
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Alicia from ops"
                    autoComplete="name"
                    required
                  />
                </label>
              ) : null}

              <label className="grid gap-2 text-sm">
                <span className="font-medium text-[color:var(--foreground)]">Email</span>
                <Input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="team@yourbrand.com"
                  autoComplete="email"
                  type="email"
                  required
                />
              </label>

              <label className="grid gap-2 text-sm">
                <span className="font-medium text-[color:var(--foreground)]">Password</span>
                <Input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={mode === "signup" ? "At least 10 characters" : "Password"}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  type="password"
                  required
                />
              </label>

              {error ? (
                <div className="rounded-[16px] border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-4 py-3 text-sm text-[color:var(--danger)]">
                  {error}
                </div>
              ) : null}

              <Button type="submit" size="lg" className="mt-2 w-full justify-center" disabled={submitting}>
                {submitting ? (mode === "signup" ? "Creating account..." : "Signing in...") : copy.submit}
                <ArrowRight className="h-4 w-4" />
              </Button>

              {submitting && mode === "signup" ? (
                <div className="text-center text-xs text-[color:var(--muted-foreground)]">
                  First-time account creation can take around 20 seconds.
                </div>
              ) : null}
            </form>

            <div className="mt-5 text-sm text-[color:var(--muted-foreground)]">
              {copy.alternateLabel}{" "}
              <Link href={alternateHref} className="font-medium text-[color:var(--foreground)] underline decoration-[color:var(--border-strong)] underline-offset-4">
                {mode === "login" ? "Create one" : "Use your existing login"}
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
