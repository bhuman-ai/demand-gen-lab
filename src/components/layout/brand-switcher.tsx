"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { trackEvent } from "@/lib/telemetry-client";
import { fetchBrandDirectory, readCachedBrandDirectory } from "@/lib/brand-directory-client";
import { Select } from "@/components/ui/select";

type Brand = {
  id: string;
  name: string;
};

const ACTIVE_BRAND_KEY = "factory.activeBrandId";

export function getActiveBrandIdFromPath(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "brands" && parts[1] && parts[1] !== "new") {
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
  const [brands, setBrands] = useState<Brand[]>(() => readCachedBrandDirectory());
  const [loadingBrands, setLoadingBrands] = useState(() => readCachedBrandDirectory().length === 0);
  const [activeBrandId, setActiveBrandId] = useState(() =>
    pathBrandId || (typeof window !== "undefined" ? localStorage.getItem(ACTIVE_BRAND_KEY) ?? "" : "")
  );

  useEffect(() => {
    if (pathBrandId) {
      localStorage.setItem(ACTIVE_BRAND_KEY, pathBrandId);
      setActiveBrandId(pathBrandId);
    }
  }, [pathBrandId]);

  useEffect(() => {
    let mounted = true;

    const cachedRows = readCachedBrandDirectory();
    if (cachedRows.length) {
      setBrands(cachedRows);
      setLoadingBrands(false);
    } else {
      setLoadingBrands(true);
    }

    const load = async () => {
      try {
        const rows = await fetchBrandDirectory({ force: cachedRows.length === 0 });
        if (!mounted) return;
        setBrands(rows);

        if (!pathBrandId) {
          const storedBrandId =
            typeof window !== "undefined" ? localStorage.getItem(ACTIVE_BRAND_KEY) ?? "" : "";
          const fallbackBrandId = hasBrandId(rows, storedBrandId) ? storedBrandId : rows[0]?.id ?? "";
          if (fallbackBrandId) {
            setActiveBrandId(fallbackBrandId);
            localStorage.setItem(ACTIVE_BRAND_KEY, fallbackBrandId);
          }
        }
      } catch {
        if (mounted) setBrands([]);
      } finally {
        if (mounted) setLoadingBrands(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [pathBrandId]);

  useEffect(() => {
    if (!brands.length) return;

    if (pathBrandId) {
      if (hasBrandId(brands, pathBrandId)) {
        localStorage.setItem(ACTIVE_BRAND_KEY, pathBrandId);
        setActiveBrandId(pathBrandId);
      }
      return;
    }

    const storedBrandId = typeof window !== "undefined" ? localStorage.getItem(ACTIVE_BRAND_KEY) ?? "" : "";
    const fallbackBrandId = hasBrandId(brands, storedBrandId) ? storedBrandId : brands[0]?.id ?? "";
    if (fallbackBrandId) {
      localStorage.setItem(ACTIVE_BRAND_KEY, fallbackBrandId);
      setActiveBrandId(fallbackBrandId);
    }
  }, [brands, pathBrandId]);

  const selectedBrandId = pathBrandId || activeBrandId;

  const activeBrand = useMemo(
    () => brands.find((brand) => brand.id === selectedBrandId) ?? null,
    [brands, selectedBrandId]
  );

  return (
    <div className="grid gap-2">
      <div className="text-[12px] text-[color:var(--muted-foreground)]">Active brand</div>
      <div className="flex w-full items-center gap-2">
        <Select
          className="bg-[color:var(--surface)]"
          value={selectedBrandId}
          onChange={(event) => {
            const brandId = event.target.value;
            if (!brandId || brandId === selectedBrandId) {
              return;
            }
            setActiveBrandId(brandId);
            localStorage.setItem(ACTIVE_BRAND_KEY, brandId);
            trackEvent("brand_switched", { brandId });
            router.push(buildPathWithBrandId(pathname, brandId));
          }}
        >
          {loadingBrands && !brands.length ? <option value="">Loading brands...</option> : null}
          {!loadingBrands && !brands.length ? <option value="">No brands</option> : null}
          {brands.map((brand) => (
            <option key={brand.id} value={brand.id}>
              {brand.name}
            </option>
          ))}
        </Select>
        {!activeBrand ? (
          <button
            type="button"
            className="h-11 shrink-0 rounded-[10px] border border-[color:var(--border)] px-3 text-sm text-[color:var(--muted-foreground)] transition-colors hover:bg-[color:var(--surface)] hover:text-[color:var(--foreground)]"
            onClick={() => router.push("/brands/new")}
          >
            New brand
          </button>
        ) : null}
      </div>
    </div>
  );
}
