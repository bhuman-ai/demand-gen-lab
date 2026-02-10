"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Step = {
  id: string;
  label: string;
  href: string;
};

type ProgressRailProps = {
  brandId: string;
};

export default function ProgressRail({ brandId }: ProgressRailProps) {
  const pathname = usePathname();
  const steps: Step[] = [
    { id: "objectives", label: "Objectives", href: `/brands/${brandId}/strategy` },
    { id: "hypotheses", label: "Hypotheses", href: `/brands/${brandId}/hypotheses` },
    { id: "experiments", label: "Experiments", href: `/brands/${brandId}?tab=experiments` },
    { id: "evolution", label: "Evolution", href: `/brands/${brandId}/evolution` },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--muted)]">
      {steps.map((step) => {
        const active = pathname === step.href;
        return (
          <Link
            key={step.id}
            href={step.href}
            className={`rounded-md border px-3 py-1 ${
              active
                ? "border-[color:var(--accent)] text-[color:var(--foreground)]"
                : "border-[color:var(--border)] text-[color:var(--muted)]"
            }`}
          >
            {step.label}
          </Link>
        );
      })}
    </div>
  );
}
