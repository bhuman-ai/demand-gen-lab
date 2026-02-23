import { NextResponse } from "next/server";
import { getCampaignById } from "@/lib/factory-data";
import {
  listCampaignRuns,
  listReplyMessagesByRun,
  listReplyThreadsByBrand,
  listRunMessages,
  listRunAnomalies,
  listRunEvents,
  listRunJobs,
  listRunLeads,
} from "@/lib/outreach-data";

export async function GET(
  _request: Request,
  context: { params: Promise<{ brandId: string; campaignId: string }> }
) {
  const { brandId, campaignId } = await context.params;
  const campaign = await getCampaignById(brandId, campaignId);
  if (!campaign) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  const runs = await listCampaignRuns(brandId, campaignId);
  const [anomaliesByRun, eventsByRunEntries, jobsByRunEntries, leadsByRunEntries, messagesByRunEntries, replies, replyMessagesByRunEntries] = await Promise.all([
    Promise.all(runs.map((run) => listRunAnomalies(run.id))),
    Promise.all(runs.map(async (run) => [run.id, await listRunEvents(run.id)] as const)),
    Promise.all(runs.map(async (run) => [run.id, await listRunJobs(run.id, 25)] as const)),
    Promise.all(runs.map(async (run) => [run.id, await listRunLeads(run.id)] as const)),
    Promise.all(runs.map(async (run) => [run.id, await listRunMessages(run.id)] as const)),
    listReplyThreadsByBrand(brandId),
    Promise.all(runs.map(async (run) => [run.id, await listReplyMessagesByRun(run.id)] as const)),
  ]);

  const anomalies = anomaliesByRun.flat();
  const eventsByRun = Object.fromEntries(eventsByRunEntries);
  const jobsByRun = Object.fromEntries(jobsByRunEntries);
  const leads = leadsByRunEntries
    .flatMap(([, rows]) => rows)
    .filter((lead) => lead.campaignId === campaignId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const messages = messagesByRunEntries
    .flatMap(([, rows]) => rows)
    .filter((message) => message.campaignId === campaignId)
    .sort((a, b) => {
      const aTime = a.sentAt || a.scheduledAt || a.createdAt;
      const bTime = b.sentAt || b.scheduledAt || b.createdAt;
      return aTime < bTime ? 1 : -1;
    });

  const runIds = new Set(runs.map((run) => run.id));
  const threads = replies.threads
    .filter((thread) => thread.campaignId === campaignId || runIds.has(thread.runId))
    .sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1));
  const replyMessages = replyMessagesByRunEntries
    .flatMap(([, rows]) => rows)
    .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
  const drafts = replies.drafts
    .filter((draft) => runIds.has(draft.runId))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return NextResponse.json({
    run: {
      runs,
      leads,
      messages,
      threads,
      replyMessages,
      drafts,
      insights: campaign.evolution,
      anomalies,
      eventsByRun,
      jobsByRun,
    },
  });
}
