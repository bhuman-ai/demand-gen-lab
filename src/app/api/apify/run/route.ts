import { NextResponse } from "next/server";

const APIFY_ACTOR_BASE = "https://api.apify.com/v2/acts";
const APIFY_RUN_BASE = "https://api.apify.com/v2/actor-runs";
const BUDGET_LIMIT_USD = 0.1;
const MAX_ITEMS = 5;

function applyRunLimits(input: Record<string, unknown>) {
  const limited = { ...input };
  const limitKeys = [
    "limit",
    "maxResults",
    "maxItems",
    "maxItemsPerQuery",
    "resultsLimit",
    "maxPosts",
    "maxReviews",
    "maxProfiles",
    "maxVideos",
    "maxComments",
  ];
  for (const key of limitKeys) {
    if (key in limited && typeof limited[key] === "number") {
      limited[key] = Math.min(limited[key] as number, MAX_ITEMS);
    }
  }
  return limited;
}

export async function POST(request: Request) {
  const body = await request.json();
  const actorId = String(body?.actorId ?? "").trim();
  const input = body?.input && typeof body.input === "object" ? body.input : {};
  const token = process.env.APIFY_TOKEN;

  if (!actorId) {
    return NextResponse.json({ error: "actorId is required" }, { status: 400 });
  }
  if (!token) {
    return NextResponse.json({ error: "APIFY_TOKEN is missing" }, { status: 500 });
  }

  const limitedInput = applyRunLimits(input as Record<string, unknown>);
  const runResponse = await fetch(`${APIFY_ACTOR_BASE}/${encodeURIComponent(actorId)}/runs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(limitedInput),
  });

  if (!runResponse.ok) {
    const errorText = await runResponse.text();
    return NextResponse.json({ error: "Run failed", details: errorText }, { status: 500 });
  }

  const runData = await runResponse.json();
  const run = runData?.data;
  if (!run?.id) {
    return NextResponse.json({ error: "Run response missing id" }, { status: 500 });
  }

  let status = run.status as string;
  let latest = run;
  const startedAt = Date.now();
  while (!"SUCCEEDED FAILED ABORTED TIMED-OUT".includes(status)) {
    if (Date.now() - startedAt > 60000) break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const poll = await fetch(`${APIFY_RUN_BASE}/${encodeURIComponent(run.id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!poll.ok) break;
    const pollData = await poll.json();
    latest = pollData?.data ?? latest;
    status = latest?.status ?? status;

    const totalCostUsd =
      latest?.usage?.totalCostUsd ??
      latest?.usage?.totalCost ??
      latest?.costUsd ??
      latest?.cost ??
      null;

    if (typeof totalCostUsd === "number" && totalCostUsd > BUDGET_LIMIT_USD) {
      await fetch(`${APIFY_RUN_BASE}/${encodeURIComponent(run.id)}/abort`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      status = "ABORTED";
      break;
    }

    if (latest?.defaultDatasetId) {
      const datasetResponse = await fetch(
        `https://api.apify.com/v2/datasets/${encodeURIComponent(latest.defaultDatasetId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (datasetResponse.ok) {
        const dataset = await datasetResponse.json();
        const itemCount = dataset?.data?.itemCount ?? null;
        if (typeof itemCount === "number" && itemCount > MAX_ITEMS) {
          await fetch(`${APIFY_RUN_BASE}/${encodeURIComponent(run.id)}/abort`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          });
          status = "ABORTED";
          break;
        }
      }
    }
  }

  return NextResponse.json({
    runId: run.id,
    status,
    input: limitedInput,
  });
}
