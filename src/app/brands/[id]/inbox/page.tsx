import InboxClient from "./inbox-client";
import { getBrandById } from "@/lib/factory-data";
import { notFound } from "next/navigation";

export default async function InboxPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brand = await getBrandById(id);
  if (!brand) notFound();
  return <InboxClient brand={brand} />;
}
