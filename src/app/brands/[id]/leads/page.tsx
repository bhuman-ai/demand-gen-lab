import LeadsClient from "./leads-client";
import { getBrandById } from "@/lib/factory-data";
import { notFound } from "next/navigation";

export default async function LeadsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brand = await getBrandById(id);
  if (!brand) notFound();
  return <LeadsClient brand={brand} />;
}
