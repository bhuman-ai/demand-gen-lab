"use client";

import { Check, ChevronDown, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { trackEvent } from "@/lib/telemetry-client";
import { fetchBrandDirectory, readCachedBrandDirectory } from "@/lib/brand-directory-client";
import { cn } from "@/lib/utils";

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pathBrandId = getActiveBrandIdFromPath(pathname);
  const [brands, setBrands] = useState<Brand[]>(() => readCachedBrandDirectory());
  const [loadingBrands, setLoadingBrands] = useState(() => readCachedBrandDirectory().length === 0);
  const [activeBrandId, setActiveBrandId] = useState(() =>
    pathBrandId || (typeof window !== "undefined" ? localStorage.getItem(ACTIVE_BRAND_KEY) ?? "" : "")
  );
  const [menuOpen, setMenuOpen] = useState(false);

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

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const selectedBrandId = pathBrandId || activeBrandId;

  const activeBrand = useMemo(
    () => brands.find((brand) => brand.id === selectedBrandId) ?? null,
    [brands, selectedBrandId]
  );

  const triggerLabel = loadingBrands && !brands.length
    ? "Loading brands..."
    : activeBrand?.name || (brands.length ? "Choose a brand" : "No brands yet");

  const triggerHint = activeBrand
    ? "Switch active brand"
    : brands.length
      ? "Pick the brand you want to work on"
      : "Create your first brand";

  function handleBrandSwitch(brandId: string) {
    const nextPath = buildPathWithBrandId(pathname, brandId);
    const sameBrand = brandId === selectedBrandId;
    if (sameBrand && nextPath === pathname) {
      setMenuOpen(false);
      return;
    }
    setActiveBrandId(brandId);
    localStorage.setItem(ACTIVE_BRAND_KEY, brandId);
    setMenuOpen(false);
    trackEvent("brand_switched", { brandId });
    router.push(nextPath);
  }

  function handleCreateBrand() {
    setMenuOpen(false);
    router.push("/brands/new");
  }

  return (
    <div className="grid gap-2">
      <div className="text-[12px] text-[color:var(--muted-foreground)]">Active brand</div>
      <div ref={containerRef} className="relative">
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((prev) => !prev)}
          className={cn(
            "flex w-full items-center justify-between gap-3 rounded-[14px] border px-3.5 py-3 text-left transition-all duration-150",
            "border-[color:var(--border)] bg-[color:var(--surface)] shadow-[0_1px_0_rgba(15,23,42,0.02)]",
            "hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-hover)]",
            menuOpen ? "border-[color:var(--border-strong)] bg-[color:var(--surface-hover)]" : ""
          )}
        >
          <div className="min-w-0">
            <div className="truncate text-[15px] font-medium text-[color:var(--foreground)]">{triggerLabel}</div>
            <div className="mt-0.5 text-[11px] text-[color:var(--muted-foreground)]">{triggerHint}</div>
          </div>
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[color:var(--border)] bg-[color:var(--background)] text-[color:var(--muted-foreground)] transition-transform duration-150",
              menuOpen ? "rotate-180" : ""
            )}
          >
            <ChevronDown className="h-4 w-4" />
          </div>
        </button>

        {menuOpen ? (
          <div className="absolute left-0 right-0 top-[calc(100%+10px)] z-30 overflow-hidden rounded-[16px] border border-[color:var(--border-strong)] bg-[color:var(--surface)] p-1.5 shadow-[0_16px_40px_rgba(15,23,42,0.14)]">
            <div role="listbox" aria-label="Brands" className="grid gap-1">
              {loadingBrands && !brands.length ? (
                <div className="rounded-[12px] px-3 py-3 text-sm text-[color:var(--muted-foreground)]">
                  Loading brands...
                </div>
              ) : null}

              {!loadingBrands && !brands.length ? (
                <div className="rounded-[12px] px-3 py-3 text-sm text-[color:var(--muted-foreground)]">
                  No brands yet.
                </div>
              ) : null}

              {brands.map((brand) => {
                const active = brand.id === selectedBrandId;
                return (
                  <button
                    key={brand.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => handleBrandSwitch(brand.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-[12px] px-3 py-3 text-left transition-colors duration-150",
                      active
                        ? "bg-[color:var(--surface-muted)] text-[color:var(--foreground)]"
                        : "text-[color:var(--foreground)] hover:bg-[color:var(--surface-muted)]"
                    )}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{brand.name}</div>
                      <div className="mt-0.5 text-[11px] text-[color:var(--muted-foreground)]">
                        {active ? "Current brand" : "Open this brand"}
                      </div>
                    </div>
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center">
                      {active ? <Check className="h-4 w-4 text-[color:var(--foreground)]" /> : null}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-1 border-t border-[color:var(--border)] pt-1.5">
              <button
                type="button"
                onClick={handleCreateBrand}
                className="flex w-full items-center gap-3 rounded-[12px] px-3 py-3 text-left text-[color:var(--foreground)] transition-colors duration-150 hover:bg-[color:var(--surface-muted)]"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[color:var(--border)] bg-[color:var(--background)] text-[color:var(--muted-foreground)]">
                  <Plus className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-medium">+ New Brand</div>
                  <div className="mt-0.5 text-[11px] text-[color:var(--muted-foreground)]">
                    Create another brand workspace
                  </div>
                </div>
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
