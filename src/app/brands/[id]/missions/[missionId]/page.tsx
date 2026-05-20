import MissionDetailClient from "./mission-detail-client";

export default async function MissionPage({
  params,
}: {
  params: Promise<{ id: string; missionId: string }>;
}) {
  const { id, missionId } = await params;
  return <MissionDetailClient brandId={id} missionId={missionId} />;
}
