import Link from "next/link";
import { readBrands } from "@/lib/brand-storage";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brands = await readBrands();
  const brand = brands.find((item: any) => item.id === id) as
    | {
        id?: string;
        brandName?: string;
        modules?: { strategy?: { goal?: string } };
        ideas?: any[];
      }
    | undefined;

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
        <h1 className="text-xl font-semibold text-[color:var(--foreground)]">{brand.brandName} — Strategy</h1>
        <Link className="text-xs text-[color:var(--accent)]" href={`/brands/${brand.id}`}>
          Back to Brand
        </Link>
      </div>
      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <div className="text-xs text-[color:var(--muted)]">Goal</div>
        <div className="mt-2 text-sm text-[color:var(--foreground)]">{brand.modules?.strategy?.goal || "—"}</div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link
            href={`/brands/${brand.id}?tab=strategy`}
            className="rounded-md border border-[color:var(--border)] px-3 py-2 text-xs text-[color:var(--foreground)]"
          >
            {brand.modules?.strategy?.goal ? "Edit Strategy" : "Define Strategy"}
          </Link>
          <span className="text-[11px] text-[color:var(--muted)]">Strategy details live in the brand context.</span>
        </div>
      </div>
      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <div className="text-xs text-[color:var(--muted)]">Ideas</div>
        <div className="mt-3 grid gap-2">
          {(brand.ideas || []).slice(0, 10).map((idea: any) => (
            <div key={idea.title} className="rounded-md border border-[color:var(--border)] px-3 py-2">
              <div className="text-xs text-[color:var(--muted)]">{idea.channel}</div>
              <div className="text-sm text-[color:var(--foreground)]">{idea.title}</div>
            </div>
          ))}
          {!(brand.ideas || []).length ? (
            <div className="text-xs text-[color:var(--muted)]">No ideas yet.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
