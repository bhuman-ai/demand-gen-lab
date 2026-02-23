import {
  listReplyMessagesByRun,
  listReplyThreadsByBrand,
  listRunAnomalies,
  listRunEvents,
  listRunJobs,
  listRunLeads,
  listRunMessages,
} from "@/lib/outreach-data";
import type {
  OutreachMessage,
  OutreachRun,
  OutreachRunEvent,
  OutreachRunJob,
  OutreachRunLead,
  ReplyDraft,
  ReplyMessage,
  ReplyThread,
  RunAnomaly,
} from "@/lib/factory-types";

export type RunVisibilityBundle = {
  runs: OutreachRun[];
  leads: OutreachRunLead[];
  messages: OutreachMessage[];
  threads: ReplyThread[];
  replyMessages: ReplyMessage[];
  drafts: ReplyDraft[];
  anomalies: RunAnomaly[];
  eventsByRun: Record<string, OutreachRunEvent[]>;
  jobsByRun: Record<string, OutreachRunJob[]>;
};

export async function buildRunVisibilityBundle(input: {
  brandId: string;
  runs: OutreachRun[];
  campaignIdFilter?: string;
}): Promise<RunVisibilityBundle> {
  const runs = [...input.runs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const [
    anomaliesByRun,
    eventsByRunEntries,
    jobsByRunEntries,
    leadsByRunEntries,
    messagesByRunEntries,
    replies,
    replyMessagesByRunEntries,
  ] = await Promise.all([
    Promise.all(runs.map((run) => listRunAnomalies(run.id))),
    Promise.all(runs.map(async (run) => [run.id, await listRunEvents(run.id)] as const)),
    Promise.all(runs.map(async (run) => [run.id, await listRunJobs(run.id, 25)] as const)),
    Promise.all(runs.map(async (run) => [run.id, await listRunLeads(run.id)] as const)),
    Promise.all(runs.map(async (run) => [run.id, await listRunMessages(run.id)] as const)),
    listReplyThreadsByBrand(input.brandId),
    Promise.all(runs.map(async (run) => [run.id, await listReplyMessagesByRun(run.id)] as const)),
  ]);

  const runIds = new Set(runs.map((run) => run.id));

  const leads = leadsByRunEntries
    .flatMap(([, rows]) => rows)
    .filter((lead) => (input.campaignIdFilter ? lead.campaignId === input.campaignIdFilter : true))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const messages = messagesByRunEntries
    .flatMap(([, rows]) => rows)
    .filter((message) => (input.campaignIdFilter ? message.campaignId === input.campaignIdFilter : true))
    .sort((a, b) => {
      const aTime = a.sentAt || a.scheduledAt || a.createdAt;
      const bTime = b.sentAt || b.scheduledAt || b.createdAt;
      return aTime < bTime ? 1 : -1;
    });

  const threads = replies.threads
    .filter(
      (thread) =>
        runIds.has(thread.runId) &&
        (input.campaignIdFilter ? thread.campaignId === input.campaignIdFilter : true)
    )
    .sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1));

  const drafts = replies.drafts
    .filter((draft) => runIds.has(draft.runId))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const anomalies = anomaliesByRun.flat();
  const replyMessages = replyMessagesByRunEntries
    .flatMap(([, rows]) => rows)
    .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));

  return {
    runs,
    leads,
    messages,
    threads,
    replyMessages,
    drafts,
    anomalies,
    eventsByRun: Object.fromEntries(eventsByRunEntries),
    jobsByRun: Object.fromEntries(jobsByRunEntries),
  };
}
