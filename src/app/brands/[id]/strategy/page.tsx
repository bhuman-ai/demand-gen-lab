import Link from "next/link";
import { readBrands } from "@/lib/brand-storage";
import StrategyEditor from "./strategy-editor";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brands = await readBrands();
  const brand = brands.find((item: any) => item.id === id) as
    | {
        id?: string;
        brandName?: string;
        website?: string;
        tone?: string;
        modules?: {
          strategy?: {
            status?: "draft" | "active" | "paused";
            goal?: string;
            constraints?: string;
            scoring?: { replyWeight?: number; conversionWeight?: number; qualityWeight?: number };
          };
          sequences?: { status?: "idle" | "testing" | "scaling"; activeCount?: number };
          leads?: { total?: number; qualified?: number };
        };
        ideas?: { title?: string; channel?: string; rationale?: string }[];
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
        <h1 className="text-xl font-semibold text-[color:var(--foreground)]">{brand.brandName} — Objectives</h1>
        <Link className="text-xs text-[color:var(--accent)]" href={`/brands/${brand.id}`}>
          Back to Brand
        </Link>
      </div>
      {brand.id ? (
        <StrategyEditor
          brand={{
            id: brand.id,
            brandName: brand.brandName ?? "",
            website: brand.website ?? "",
            tone: brand.tone ?? "",
            modules: {
              strategy: {
                status: brand.modules?.strategy?.status ?? "draft",
                goal: brand.modules?.strategy?.goal ?? "",
                constraints: brand.modules?.strategy?.constraints ?? "",
                scoring: {
                  replyWeight: brand.modules?.strategy?.scoring?.replyWeight ?? 0.3,
                  conversionWeight: brand.modules?.strategy?.scoring?.conversionWeight ?? 0.6,
                  qualityWeight: brand.modules?.strategy?.scoring?.qualityWeight ?? 0.1,
                },
              },
              sequences: {
                status: brand.modules?.sequences?.status ?? "idle",
                activeCount: brand.modules?.sequences?.activeCount ?? 0,
              },
              leads: {
                total: brand.modules?.leads?.total ?? 0,
                qualified: brand.modules?.leads?.qualified ?? 0,
              },
            },
            ideas: (brand.ideas || []).map((idea) => ({
              title: idea.title ?? "",
              channel: idea.channel ?? "",
              rationale: idea.rationale ?? "",
            })),
          }}
        />
      ) : null}
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
