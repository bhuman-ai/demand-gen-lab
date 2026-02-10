import Link from "next/link";
import { redirect } from "next/navigation";
import { readBrands } from "@/lib/brand-storage";
import ObjectiveDetail from "./objective-detail";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string; objectiveId: string }>;
}) {
  const { id, objectiveId } = await params;
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

  const objectives = Array.isArray((brand as any).objectives) ? (brand as any).objectives : [];
  const objective = objectives.find((item: any) => item.id === objectiveId);

  if (!objective) {
    redirect(`/brands/${id}/campaigns`);
  }

  return (
    <ObjectiveDetail
      brandId={brand.id ?? id}
      brandName={brand.brandName ?? "Untitled brand"}
      website={brand.website ?? ""}
      tone={brand.tone ?? ""}
      objectives={objectives}
      initialObjective={objective}
    />
  );
}
