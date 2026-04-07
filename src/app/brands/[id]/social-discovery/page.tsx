import SocialDiscoveryClient from "./social-discovery-client";

export default async function SocialDiscoveryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SocialDiscoveryClient brandId={id} />;
}
