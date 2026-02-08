import { readFile } from "fs/promises";
import Link from "next/link";

async function loadBrands() {
  try {
    const raw = await readFile(`${process.cwd()}/data/brands.json`, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    try {
      const legacyRaw = await readFile(`${process.cwd()}/data/projects.json`, "utf-8");
      const legacyData = JSON.parse(legacyRaw);
      return Array.isArray(legacyData) ? legacyData : [];
    } catch {
      return [];
    }
  }
}

export default async function Page() {
  const brands = await loadBrands();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-[color:var(--foreground)]">Network Hub</h1>
      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <p className="text-sm text-[color:var(--muted)]">Domains, reputation health, and burn/replace controls.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {brands.map((brand: any) => (
            <Link
              key={brand.id}
              href={`/brands/${brand.id}/network`}
              className="rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/40 px-4 py-3 text-xs text-[color:var(--foreground)]"
            >
              {brand.brandName}
            </Link>
          ))}
          {!brands.length ? (
            <div className="rounded-md border border-dashed border-[color:var(--border)] px-4 py-3 text-xs text-[color:var(--muted)]">
              No brands yet.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
