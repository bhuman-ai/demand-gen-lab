import ExperimentsClient from "./experiments-client";

export default async function ExperimentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ExperimentsClient brandId={id} />;
}
