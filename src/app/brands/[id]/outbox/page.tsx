import { getBrandById } from "@/lib/factory-data";
import { notFound } from "next/navigation";
import OutboxClient from "./outbox-client";

export default async function OutboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ sender?: string }>;
}) {
  const { id } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const brand = await getBrandById(id, { includeEmbedded: true });
  if (!brand) notFound();
  return <OutboxClient brand={brand} preferredSenderAccountId={String(resolvedSearchParams.sender ?? "").trim()} />;
}
