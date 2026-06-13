import { getBrandById } from "@/lib/factory-data";
import { notFound } from "next/navigation";
import SendClient from "./send-client";

export default async function SendPage({
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
  return <SendClient brand={brand} preferredSenderAccountId={String(resolvedSearchParams.sender ?? "").trim()} />;
}
