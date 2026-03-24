import { NextResponse } from "next/server";
import { maybeAutoLaunchPreparedExperiment } from "@/lib/experiment-auto-launch";
import { getExperimentRecordById } from "@/lib/experiment-data";
import { prepareExperimentSendableContacts } from "@/lib/experiment-sendable-prep";

export async function POST(
  request: Request,
  context: { params: Promise<{ brandId: string; experimentId: string }> }
) {
  const { brandId, experimentId } = await context.params;

  try {
    const result = await prepareExperimentSendableContacts({
      brandId,
      experimentId,
      requestOrigin: new URL(request.url).origin,
    });

    let autoLaunchAttempted = false;
    let autoLaunchTriggered = false;
    let autoLaunchBlocked = false;
    let autoLaunchRunId = "";
    let autoLaunchReason = "";

    if (result.ready) {
      const experiment = await getExperimentRecordById(brandId, experimentId);
      if (experiment && experiment.messageFlow.publishedRevision > 0) {
        autoLaunchAttempted = true;
        const autoLaunch = await maybeAutoLaunchPreparedExperiment(experiment);
        autoLaunchTriggered = autoLaunch.launched;
        autoLaunchBlocked = autoLaunch.blocked;
        autoLaunchRunId = autoLaunch.runId ?? "";
        autoLaunchReason = autoLaunch.reason ?? "";
      }
    }

    return NextResponse.json({
      ...result,
      autoLaunchAttempted,
      autoLaunchTriggered,
      autoLaunchBlocked,
      autoLaunchRunId,
      autoLaunchReason,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to resolve approved prospects.";

    if (message === "experiment not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    if (message === "experiment runtime is not configured") {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json(
      {
        error: "Failed to resolve approved prospects.",
        hint: message,
      },
      { status: 500 }
    );
  }
}
