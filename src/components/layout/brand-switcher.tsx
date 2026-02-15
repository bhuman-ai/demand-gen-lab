"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { trackEvent } from "@/lib/telemetry-client";
import { Select } from "@/components/ui/select";

type Brand = {
  id: string;
  name: string;
};

const ACTIVE_BRAND_KEY = "factory.activeBrandId";

export function getActiveBrandIdFromPath(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "brands" && parts[1]) {
    return parts[1];
  }
  return "";
}

function hasBrandId(rows: Brand[], brandId: string) {
  return rows.some((brand) => brand.id === brandId);
}

function buildPathWithBrandId(pathname: string, brandId: string) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "brands") return `/brands/${brandId}`;
  const next = [...parts];
  next[1] = brandId;
  return `/${next.join("/")}`;
}

export default function BrandSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const pathBrandId = getActiveBrandIdFromPath(pathname);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [activeBrandId, setActiveBrandId] = useState(() =>
    pathBrandId || (typeof window !== "undefined" ? localStorage.getItem(ACTIVE_BRAND_KEY) ?? "" : "")
  );

  useEffect(() => {
    if (pathBrandId) {
      localStorage.setItem(ACTIVE_BRAND_KEY, pathBrandId);
    }
  }, [pathBrandId]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const response = await fetch("/api/brands", { cache: "no-store" });
        const data = await response.json();
        if (!mounted) return;
        const rows = Array.isArray(data?.brands) ? (data.brands as Brand[]) : [];
        setBrands(rows);
        if (!activeBrandId && !pathBrandId && rows[0]?.id) {
          setActiveBrandId(rows[0].id);
          localStorage.setItem(ACTIVE_BRAND_KEY, rows[0].id);
        }
      } catch {
        if (mounted) setBrands([]);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [activeBrandId, pathBrandId]);

  useEffect(() => {
    if (!brands.length) return;

    const storedBrandId = typeof window !== "undefined" ? localStorage.getItem(ACTIVE_BRAND_KEY) ?? "" : "";
    const validStoredBrandId = hasBrandId(brands, storedBrandId) ? storedBrandId : "";
    const fallbackBrandId = validStoredBrandId || brands[0]?.id || "";

    if (pathBrandId && !hasBrandId(brands, pathBrandId) && fallbackBrandId) {
      localStorage.setItem(ACTIVE_BRAND_KEY, fallbackBrandId);
      router.replace(buildPathWithBrandId(pathname, fallbackBrandId));
      return;
    }

    if (!pathBrandId) {
      if (fallbackBrandId) {
        localStorage.setItem(ACTIVE_BRAND_KEY, fallbackBrandId);
      }
    }
  }, [brands, pathBrandId, activeBrandId, pathname, router]);

  const selectedBrandId = pathBrandId || activeBrandId;

  const activeBrand = useMemo(
    () => brands.find((brand) => brand.id === selectedBrandId) ?? null,
    [brands, selectedBrandId]
  );

  return (
    <div className="flex min-w-[260px] items-center gap-2">
      <Select
        value={selectedBrandId}
        onChange={(event) => {
          const brandId = event.target.value;
          setActiveBrandId(brandId);
          localStorage.setItem(ACTIVE_BRAND_KEY, brandId);
          trackEvent("brand_switched", { brandId });
          router.push(`/brands/${brandId}`);
        }}
      >
        {!brands.length ? <option value="">No brands</option> : null}
        {brands.map((brand) => (
          <option key={brand.id} value={brand.id}>
            {brand.name}
          </option>
        ))}
      </Select>
      {!activeBrand ? (
        <button
          type="button"
          className="rounded-xl border border-[color:var(--border)] px-3 py-2 text-xs text-[color:var(--muted-foreground)]"
          onClick={() => router.push("/brands/new")}
        >
          New Brand
        </button>
      ) : null}
    </div>
  );
}
