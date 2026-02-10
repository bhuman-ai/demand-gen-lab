import Link from "next/link";
import { readBrands } from "@/lib/brand-storage";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brands = await readBrands();
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
        <h1 className="text-xl font-semibold text-[color:var(--foreground)]">{brand.brandName} — Hypotheses</h1>
        <Link className="text-xs text-[color:var(--accent)]" href={`/brands/${brand.id}`}>
          Back to Brand
        </Link>
      </div>
      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <div className="text-xs text-[color:var(--muted)]">Approved hypotheses</div>
        <div className="mt-3 grid gap-2">
          {(brand.ideas || []).slice(0, 12).map((idea: any) => (
            <div key={idea.title} className="rounded-md border border-[color:var(--border)] px-3 py-2">
              <div className="text-xs text-[color:var(--muted)]">{idea.channel}</div>
              <div className="text-sm text-[color:var(--foreground)]">{idea.title}</div>
              <div className="mt-1 text-[11px] text-[color:var(--muted)]">{idea.rationale}</div>
            </div>
          ))}
          {!(brand.ideas || []).length ? (
            <div className="text-xs text-[color:var(--muted)]">No hypotheses yet.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
