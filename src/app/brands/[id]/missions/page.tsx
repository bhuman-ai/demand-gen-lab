import MissionsClient from "./missions-client";

export default async function BrandMissionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MissionsClient brandId={id} />;
}
