import Link from "next/link";
import { readBrands } from "@/lib/brand-storage";
import CampaignsClient from "./campaigns-client";

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

  return <CampaignsClient brand={brand} />;
}
