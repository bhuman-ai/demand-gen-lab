import { NextResponse } from "next/server";
import { getExperimentRecordById } from "@/lib/experiment-data";
import {
  getOutreachRun,
  listExperimentRuns,
  listOwnerRuns,
  listRunEvents,
  listRunJobs,
  listSourcingChainDecisions,
  listSourcingProbeResults,
} from "@/lib/outreach-data";

function safeTime(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(
  _: Request,
  context: { params: Promise<{ brandId: string; experimentId: string }> }
) {
  const { brandId, experimentId } = await context.params;
  const experiment = await getExperimentRecordById(brandId, experimentId);
  if (!experiment) {
    return NextResponse.json({ error: "experiment not found" }, { status: 404 });
  }

  let runs = await listOwnerRuns(brandId, "experiment", experiment.id);
  if (!runs.length && experiment.runtime.campaignId && experiment.runtime.experimentId) {
    runs = await listExperimentRuns(brandId, experiment.runtime.campaignId, experiment.runtime.experimentId);
  }
  const latestRun = [...runs].sort((a, b) => safeTime(b.createdAt) - safeTime(a.createdAt))[0] ?? null;

  const decisions = await listSourcingChainDecisions({
    brandId,
    experimentOwnerId: experiment.id,
    limit: 10,
  });
  const latestDecision =
    (latestRun
      ? decisions.find((decision) => decision.runId === latestRun.id) ?? null
      : null) ?? decisions[0] ?? null;
  const probeResults = latestDecision ? await listSourcingProbeResults(latestDecision.id) : [];

  const run = latestRun ? await getOutreachRun(latestRun.id) : null;
  const runEvents = latestRun ? await listRunEvents(latestRun.id) : [];
  const runJobs = latestRun ? await listRunJobs(latestRun.id, 40) : [];

  return NextResponse.json({
    trace: {
      experimentId: experiment.id,
      runtimeRef: experiment.runtime,
      latestRun: run,
      latestDecision,
      probeResults,
      runEvents,
      runJobs,
      decisions,
    },
  });
}
