import { notFound } from "next/navigation";
import { getBrandById } from "@/lib/factory-data";
import InboxEvalLabClient from "./evals-client";

export default async function InboxEvalLabPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const brand = await getBrandById(id);
  if (!brand) notFound();
  return <InboxEvalLabClient brand={brand} />;
}
