import BrandList from "./brand-list";
import { readBrands } from "@/lib/brand-storage";

export default async function Page() {
  const brands = await readBrands();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-[color:var(--foreground)]">Brands Hub</h1>
      <BrandList brands={brands} />
    </div>
  );
}
