"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

type BrandInput = {
  id?: string;
  website?: string;
  brandName?: string;
  tone?: string;
  proof?: string;
};

type BrandDetailProps = {
  brand: BrandInput;
  brands: BrandInput[];
};

export default function BrandDetail({ brand, brands }: BrandDetailProps) {
  const router = useRouter();
  const brandId = brand.id ?? "";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-[color:var(--foreground)]">
            {brand.brandName}
          </h1>
          <select
            value={brandId}
            onChange={(event) => router.push(`/brands/${event.target.value}`)}
            className="h-8 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
          >
            {brands.map((item) => (
              <option key={item.id} value={item.id}>
                {item.brandName}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <Link className="text-xs text-[color:var(--accent)]" href="/brands">
            Back to Brands
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
          <div className="text-xs text-[color:var(--muted)]">Website</div>
          <div className="mt-2 text-sm text-[color:var(--foreground)]">{brand.website || "—"}</div>
        </div>
        <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
          <div className="text-xs text-[color:var(--muted)]">Tone</div>
          <div className="mt-2 text-sm text-[color:var(--foreground)]">{brand.tone || "—"}</div>
        </div>
      </div>

      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <div className="text-xs text-[color:var(--muted)]">Proof</div>
        <div className="mt-2 text-sm text-[color:var(--foreground)]">{brand.proof || "—"}</div>
      </div>

      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <div className="text-xs text-[color:var(--muted)]">Primary flow</div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {[
            { label: "Objectives", href: `/brands/${brandId}/strategy` },
            { label: "Hypotheses", href: `/brands/${brandId}/hypotheses` },
            { label: "Experiments", href: `/brands/${brandId}/evolution` },
            { label: "Evolution", href: `/brands/${brandId}/evolution` },
          ].map((module) => (
            <Link
              key={module.label}
              href={module.href}
              className="rounded-lg border border-[color:var(--border)] bg-[color:var(--background)]/40 px-3 py-2 text-xs text-[color:var(--foreground)]"
            >
              {module.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <div className="text-xs text-[color:var(--muted)]">Operations</div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {[
            { label: "Network", href: `/brands/${brandId}/network` },
            { label: "Leads", href: `/brands/${brandId}/leads` },
            { label: "Inbox", href: `/brands/${brandId}/inbox` },
          ].map((module) => (
            <Link
              key={module.label}
              href={module.href}
              className="rounded-lg border border-[color:var(--border)] bg-[color:var(--background)]/40 px-3 py-2 text-xs text-[color:var(--foreground)]"
            >
              {module.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
