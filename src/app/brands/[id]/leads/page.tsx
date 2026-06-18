import LeadsClient from "./leads-client";
import { getBrandById } from "@/lib/factory-data";
import { buildBrandAudienceSnapshot } from "@/lib/audience-data";
import { notFound } from "next/navigation";

export default async function LeadsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brand = await getBrandById(id, { includeEmbedded: true });
  if (!brand) notFound();
  const audience = await buildBrandAudienceSnapshot(brand);
  return <LeadsClient brand={brand} outreachContacts={audience.contacts} generatedAt={audience.generatedAt} />;
}
