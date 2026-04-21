import SocialDiscoveryClient from "./social-discovery-client";
import { getBrandById } from "@/lib/factory-data";

export default async function SocialDiscoveryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brand = await getBrandById(id);
  return <SocialDiscoveryClient brandId={id} initialBrandName={brand?.name ?? ""} />;
}
