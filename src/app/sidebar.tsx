"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Brand = {
  id: string;
  brandName: string;
};

const ACTIVE_BRAND_KEY = "factory.activeBrandId";

const globalItems = [
  { href: "/logic", label: "Logic" },
  { href: "/doctor", label: "Doctor" },
];

export default function Sidebar() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [activeBrandId, setActiveBrandId] = useState<string>("");

  useEffect(() => {
    const savedBrandId = typeof window !== "undefined" ? localStorage.getItem(ACTIVE_BRAND_KEY) : "";
    if (savedBrandId) {
      setActiveBrandId(savedBrandId);
    }
    const loadBrands = async () => {
      try {
        const response = await fetch("/api/brands");
        const data = await response.json();
        const list = Array.isArray(data?.brands) ? (data.brands as Brand[]) : [];
        setBrands(list);
      } catch {
        setBrands([]);
      }
    };
    loadBrands();
  }, []);

  const activeBrand = useMemo(
    () => brands.find((brand) => brand.id === activeBrandId),
    [brands, activeBrandId]
  );

  const brandItems = activeBrandId
    ? [
        { href: `/brands/${activeBrandId}/campaigns`, label: "Campaigns" },
        { href: `/brands/${activeBrandId}/network`, label: "Network" },
        { href: `/brands/${activeBrandId}/leads`, label: "Leads" },
        { href: `/brands/${activeBrandId}/inbox`, label: "Inbox" },
      ]
    : [];

  return (
    <aside className="w-60 border-r border-[color:var(--border)] bg-[color:var(--glass)]/80 px-4 py-6">
      <div className="text-xs uppercase tracking-[0.2em] text-[color:var(--muted)]">Protocol Genesis</div>
      <div className="mt-2 text-lg font-semibold text-[color:var(--foreground)]">The Factory</div>

      {activeBrand ? (
        <div className="mt-6 rounded-lg border border-[color:var(--border)] bg-[color:var(--background-elevated)]/60 px-3 py-2 text-xs text-[color:var(--foreground)]">
          <div className="text-[11px] uppercase tracking-[0.2em] text-[color:var(--muted)]">Active Brand</div>
          <Link
            href={`/brands/${activeBrand.id}`}
            className="mt-2 block text-sm text-[color:var(--foreground)]"
          >
            {activeBrand.brandName}
          </Link>
        </div>
      ) : (
        <div className="mt-6 text-xs text-[color:var(--muted)]">Select a brand to continue.</div>
      )}

      <nav className="mt-6 space-y-2 text-sm">
        {!activeBrandId ? (
          <Link
            href="/brands"
            className="block rounded-md border border-transparent px-3 py-2 text-[color:var(--muted)] hover:border-[color:var(--border)] hover:bg-[color:var(--background-elevated)] hover:text-[color:var(--foreground)]"
          >
            Brands
          </Link>
        ) : null}
        {brandItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="block rounded-md border border-transparent px-3 py-2 text-[color:var(--muted)] hover:border-[color:var(--border)] hover:bg-[color:var(--background-elevated)] hover:text-[color:var(--foreground)]"
          >
            {item.label}
          </Link>
        ))}
        {globalItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="block rounded-md border border-transparent px-3 py-2 text-[color:var(--muted)] hover:border-[color:var(--border)] hover:bg-[color:var(--background-elevated)] hover:text-[color:var(--foreground)]"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
