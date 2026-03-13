"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Rocket, Target } from "lucide-react";
import BrandWordmark from "@/components/layout/brand-wordmark";
import { Button } from "@/components/ui/button";
import { fetchBrands, fetchExperiments, fetchScaleCampaigns } from "@/lib/client-api";
import type { BrandRecord } from "@/lib/factory-types";

function formatCount(value: number) {
  return value.toString().padStart(2, "0");
}

export default function HomePage() {
  const [brands, setBrands] = useState<BrandRecord[]>([]);
  const [experimentCount, setExperimentCount] = useState(0);
  const [campaignCount, setCampaignCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const brandRows = await fetchBrands();
        if (!mounted) return;
        setBrands(brandRows);

        const [experimentCounts, campaignCounts] = await Promise.all([
          Promise.all(brandRows.map((row) => fetchExperiments(row.id))),
          Promise.all(brandRows.map((row) => fetchScaleCampaigns(row.id))),
        ]);
        if (!mounted) return;
        setExperimentCount(experimentCounts.reduce((sum, rows) => sum + rows.length, 0));
        setCampaignCount(campaignCounts.reduce((sum, rows) => sum + rows.length, 0));
      } catch {
        if (mounted) {
          setBrands([]);
          setExperimentCount(0);
          setCampaignCount(0);
        }
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const scorecard = [
    {
      label: "Brands in motion",
      value: formatCount(brands.length),
      detail: brands.length ? `${brands[0].name}${brands.length > 1 ? ` +${brands.length - 1} more` : ""}` : "Start with one brand",
    },
    {
      label: "Experiments under test",
      value: formatCount(experimentCount),
      detail: experimentCount ? "Promote only the messages that prove themselves." : "No test has shipped yet",
    },
    {
      label: "Campaigns in market",
      value: formatCount(campaignCount),
      detail: campaignCount ? "Scaled sequences stay connected to the proof that earned them." : "Nothing scaled yet",
    },
    {
      label: "Next move",
      value: brands.length ? "Open" : "Start",
      detail: brands.length ? "Continue the active brand and push one winner forward." : "Create a brand and set the first test in motion.",
    },
  ];

  const operatingSequence = [
    {
      title: "Find signal",
      detail: "Capture accounts, leads, and sender infrastructure without jumping between tools.",
      note: "Lead source, channel, and sender state stay attached to the same record.",
    },
    {
      title: "Run the test",
      detail: "Draft experiments first, launch lean, and let actual replies decide what deserves another week.",
      note: "Sequences start small enough to learn, not large enough to hide mistakes.",
    },
    {
      title: "Scale the winner",
      detail: "Promote the proven version into campaign mode with the evidence still visible beside it.",
      note: "The jump from test to scale is deliberate, traceable, and reversible.",
    },
  ];

  const principles = [
    "No stitched-together outbound stack.",
    "No guessing which message earned the reply.",
    "No separating the sender from the experiment that used it.",
    "No buying another platform to cover the gaps.",
  ];

  return (
    <div className="space-y-10">
      <section className="grid gap-10 xl:grid-cols-[minmax(0,1.4fr)_22rem] xl:gap-12">
        <div className="space-y-8">
          <div className="max-w-4xl">
            <div className="motion-enter" style={{ ["--motion-order" as string]: 0 }}>
              <BrandWordmark
                animated
                lastClassName="text-[clamp(4.4rem,12vw,8.6rem)]"
                b2bClassName="mb-[0.95em] text-[clamp(0.74rem,1vw,0.96rem)] tracking-[0.16em]"
              />
            </div>
            <p
              className="motion-enter mt-5 max-w-[18rem] border-t border-[color:var(--border)] pt-4 text-sm leading-6 text-[color:var(--muted-foreground)]"
              style={{ ["--motion-order" as string]: 1 }}
            >
              Outbound, reduced to one operating desk.
            </p>
            <h1
              className="motion-enter mt-6 font-[family:var(--font-brand)] text-[clamp(2.8rem,6.8vw,5.6rem)] leading-[0.92] tracking-[-0.08em] text-[color:var(--foreground)]"
              style={{ ["--motion-order" as string]: 2 }}
            >
              Keep the lead list, sender, experiment, campaign, and inbox on one desk.
            </h1>
            <p
              className="motion-enter mt-5 max-w-[44rem] text-[clamp(1.02rem,1.65vw,1.16rem)] leading-8 text-[color:var(--muted-foreground)]"
              style={{ ["--motion-order" as string]: 3 }}
            >
              last b2b is built for operators who want the proof beside the action: test the message, launch from the
              same brand context, promote the winner without losing the sender trail, and keep replies attached to the
              decision that earned them.
            </p>
          </div>

          <div className="motion-enter flex flex-wrap gap-3" style={{ ["--motion-order" as string]: 4 }}>
            <Button asChild size="lg">
              <Link href="/brands/new">
                <Rocket className="h-4 w-4" />
                Create brand
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/brands">
                <Target className="h-4 w-4" />
                Open brand directory
              </Link>
            </Button>
          </div>
        </div>

        <div
          className="motion-enter rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface)]"
          style={{ ["--motion-order" as string]: 3 }}
        >
          <div className="border-b border-[color:var(--border)] px-5 py-4 text-[12px] text-[color:var(--muted-foreground)]">
            Current desk
          </div>
          <div>
            {scorecard.map((row, index) => (
              <div
                key={row.label}
                className={`grid gap-2 px-5 py-4 ${index < scorecard.length - 1 ? "border-b border-[color:var(--border)]" : ""}`}
              >
                <div className="flex items-end justify-between gap-4">
                  <div className="text-sm text-[color:var(--muted-foreground)]">{row.label}</div>
                  <div className="font-[family:var(--font-brand)] text-[2rem] leading-none tracking-[-0.07em] text-[color:var(--foreground)]">
                    {row.value}
                  </div>
                </div>
                <div className="text-sm leading-6 text-[color:var(--foreground)]">{row.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-8 lg:grid-cols-[minmax(0,1.18fr)_minmax(18rem,0.82fr)]">
        <div className="rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface)]">
          {operatingSequence.map((step, index) => (
            <div
              key={step.title}
              className={`grid gap-4 px-5 py-5 md:grid-cols-[3.2rem_minmax(0,1fr)_16rem] ${index < operatingSequence.length - 1 ? "border-b border-[color:var(--border)]" : ""}`}
            >
              <div className="font-[family:var(--font-brand)] text-[2.25rem] leading-none tracking-[-0.08em] text-[color:var(--accent)]">
                0{index + 1}
              </div>
              <div>
                <div className="text-lg font-semibold tracking-[-0.04em] text-[color:var(--foreground)]">{step.title}</div>
                <p className="mt-2 text-sm leading-7 text-[color:var(--muted-foreground)]">{step.detail}</p>
              </div>
              <div className="text-sm leading-6 text-[color:var(--foreground)]">{step.note}</div>
            </div>
          ))}
        </div>

        <div className="grid gap-5">
          <div className="rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface)]">
            {principles.map((principle, index) => (
              <div
                key={principle}
                className={`px-5 py-4 text-sm leading-6 text-[color:var(--foreground)] ${index < principles.length - 1 ? "border-b border-[color:var(--border)]" : ""}`}
              >
                {principle}
              </div>
            ))}
          </div>

          <div className="rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface)] px-5 py-5">
            <BrandWordmark
              lastClassName="text-[1.6rem]"
              b2bClassName="mb-[0.22em] text-[0.68rem] tracking-[0.12em]"
            />
            <div className="mt-4 text-sm leading-7 text-[color:var(--muted-foreground)]">
              Built for operators who want each reply, sender, and sequence decision preserved in the same place.
            </div>
            <div className="mt-5 flex items-center gap-2 text-sm text-[color:var(--foreground)]">
              <span>Start with a brand</span>
              <ArrowRight className="h-3.5 w-3.5 text-[color:var(--muted-foreground)]" />
              <span>run the test</span>
              <ArrowRight className="h-3.5 w-3.5 text-[color:var(--muted-foreground)]" />
              <span>scale the proof</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
