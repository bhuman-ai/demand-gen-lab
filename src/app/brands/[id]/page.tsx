import BrandHomeClient from "./brand-home-client";

export default async function BrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BrandHomeClient brandId={id} />;
}
