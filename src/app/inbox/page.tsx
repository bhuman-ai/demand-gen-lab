import Link from "next/link";
import { readBrands } from "@/lib/brand-storage";

export default async function Page() {
  const brands = await readBrands();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-[color:var(--foreground)]">Universal Inbox</h1>
      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <p className="text-sm text-[color:var(--muted)]">Replies, sentiment, and battlecards.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {brands.map((brand: any) => (
            <Link
              key={brand.id}
              href={`/brands/${brand.id}/inbox`}
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
