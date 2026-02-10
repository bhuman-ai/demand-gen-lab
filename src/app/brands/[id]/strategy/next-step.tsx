"use client";

import Link from "next/link";

type NextStepProps = {
  brandId: string;
};

export default function NextStep({ brandId }: NextStepProps) {
  return (
    <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-4">
      <div className="text-xs text-[color:var(--muted)]">Next step</div>
      <div className="mt-2 text-sm text-[color:var(--foreground)]">Generate hypotheses from this objective.</div>
      <div className="mt-3">
        <Link
          href={`/brands/${brandId}/hypotheses`}
          className="rounded-md border border-[color:var(--border)] px-3 py-2 text-xs text-[color:var(--foreground)]"
        >
          Go to Hypotheses
        </Link>
      </div>
    </div>
  );
}
