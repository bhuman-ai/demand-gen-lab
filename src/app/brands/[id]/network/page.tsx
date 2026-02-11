import NetworkClient from "./network-client";
import { getBrandById } from "@/lib/factory-data";
import { notFound } from "next/navigation";

export default async function NetworkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brand = await getBrandById(id);
  if (!brand) notFound();
  return <NetworkClient brand={brand} />;
}
