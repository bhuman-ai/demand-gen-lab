"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type BrandRedirectProps = {
  target: "strategy" | "hypotheses" | "evolution";
  title: string;
  description: string;
};

const ACTIVE_BRAND_KEY = "factory.activeBrandId";

export default function BrandRedirect({ target, title, description }: BrandRedirectProps) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [activeBrandId, setActiveBrandId] = useState("");

  useEffect(() => {
    const savedBrandId = typeof window !== "undefined" ? localStorage.getItem(ACTIVE_BRAND_KEY) : "";
    if (savedBrandId) {
      router.replace(`/brands/${savedBrandId}/${target}`);
      return;
    }
    setActiveBrandId("");
    setReady(true);
  }, [router, target]);

  if (!ready) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-[color:var(--foreground)]">{title}</h1>
      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <p className="text-sm text-[color:var(--muted)]">{description}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link
            href="/brands"
            className="rounded-md border border-[color:var(--border)] px-3 py-2 text-xs text-[color:var(--foreground)]"
          >
            Select a Brand
          </Link>
          {activeBrandId ? (
            <Link
              href={`/brands/${activeBrandId}/${target}`}
              className="text-xs text-[color:var(--accent)]"
            >
              Open last active brand
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
