import { readFile } from "fs/promises";
import Link from "next/link";
import InboxClient from "./inbox-client";

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

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brands = await loadBrands();
  const brand = brands.find((item: any) => item.id === id);

  if (!brand) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-[color:var(--foreground)]">Brand Not Found</h1>
        <Link className="text-xs text-[color:var(--accent)]" href="/brands">
          Back to Brands
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[color:var(--foreground)]">{brand.brandName} — Inbox</h1>
        <Link className="text-xs text-[color:var(--accent)]" href={`/brands/${brand.id}`}>
          Back to Brand
        </Link>
      </div>
      <InboxClient brand={brand} />
    </div>
  );
}
