"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const steps = [
  { id: "build", label: "Build" },
  { id: "run", label: "Run" },
] as const;

function parseCampaignPath(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "brands" || parts[2] !== "campaigns" || !parts[3] || !parts[4]) {
    return null;
  }
  const brandId = parts[1];
  const campaignId = parts[3];
  const step = parts[4] === "build" || parts[4] === "run" ? parts[4] : "";
  if (!steps.some((candidate) => candidate.id === step)) return null;
  return { brandId, campaignId, step };
}

export function CampaignStepper() {
  const pathname = usePathname();
  const parsed = parseCampaignPath(pathname);

  if (!parsed) return null;

  return (
    <nav className="flex flex-wrap items-center gap-2" aria-label="Campaign stepper">
      {steps.map((step, index) => {
        const href = `/brands/${parsed.brandId}/campaigns/${parsed.campaignId}/${step.id}`;
        const active = parsed.step === step.id;
        return (
          <Link
            key={step.id}
            href={href}
            className={cn(
              "rounded-[8px] border px-3 py-1.5 text-xs transition-colors",
              active
                ? "border-[color:var(--border-strong)] bg-[color:var(--surface-muted)] text-[color:var(--foreground)]"
                : "border-[color:var(--border)] text-[color:var(--muted-foreground)] hover:bg-[color:var(--surface-muted)]"
            )}
          >
            {index + 1}. {step.label}
          </Link>
        );
      })}
    </nav>
  );
}
