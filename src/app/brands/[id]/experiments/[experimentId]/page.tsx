import ExperimentClient from "./experiment-client";

export default async function ExperimentPage({
  params,
}: {
  params: Promise<{ id: string; experimentId: string }>;
}) {
  const { id, experimentId } = await params;
  return <ExperimentClient brandId={id} experimentId={experimentId} />;
}
