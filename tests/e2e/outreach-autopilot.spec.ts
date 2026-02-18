import { expect, test } from "@playwright/test";
import { promises as fs } from "fs";
import path from "path";

const brandsFile = path.join(process.cwd(), "data", "brands.v2.json");
const campaignsFile = path.join(process.cwd(), "data", "campaigns.v2.json");
const outreachFile = path.join(process.cwd(), "data", "outreach.v1.json");

async function resetDataFiles() {
  await fs.rm(brandsFile, { force: true });
  await fs.rm(campaignsFile, { force: true });
  await fs.rm(outreachFile, { force: true });
}

type SetupContext = {
  brandId: string;
  campaignId: string;
  runId: string;
};

async function setupAutopilotContext(request: import("@playwright/test").APIRequestContext): Promise<SetupContext> {
  const brandRes = await request.post("/api/brands", {
    data: {
      name: "Autopilot Brand",
      website: "https://autopilot.example.com",
      tone: "direct",
      notes: "autopilot test",
    },
  });
  expect(brandRes.ok()).toBeTruthy();
  const brandJson = await brandRes.json();
  const brandId = String(brandJson.brand?.id ?? "");
  expect(brandId).toBeTruthy();

  const campaignRes = await request.post(`/api/brands/${brandId}/campaigns`, {
    data: { name: "Autopilot Campaign" },
  });
  expect(campaignRes.ok()).toBeTruthy();
  const campaignJson = await campaignRes.json();
  const campaignId = String(campaignJson.campaign?.id ?? "");
  expect(campaignId).toBeTruthy();

  const accountRes = await request.post("/api/outreach/accounts", {
    data: {
      name: "Primary Stack",
      config: {
        customerIo: {
          siteId: "site_123",
          workspaceId: "ws_123",
          fromEmail: "sender@example.com",
        },
        apify: {
          defaultActorId: "apify/mock-actor",
        },
        mailbox: {
          provider: "gmail",
          email: "ops@example.com",
          status: "connected",
          host: "imap.gmail.com",
          port: 993,
          secure: true,
        },
      },
      credentials: {
        customerIoTrackApiKey: "track_key",
        customerIoAppApiKey: "app_key",
        apifyToken: "apify_token",
        mailboxAccessToken: "mailbox_token",
      },
    },
  });
  expect(accountRes.ok()).toBeTruthy();
  const accountJson = await accountRes.json();
  const accountId = String(accountJson.account?.id ?? "");
  expect(accountId).toBeTruthy();

  const assignRes = await request.put(`/api/brands/${brandId}/outreach-account`, {
    data: { accountId },
  });
  expect(assignRes.ok()).toBeTruthy();

  const patchRes = await request.patch(`/api/brands/${brandId}/campaigns/${campaignId}`, {
    data: {
      hypotheses: [
        {
          id: "hyp_test_1",
          title: "Run founder wedge",
          channel: "Email",
          rationale: "Founder context increases response quality",
          actorQuery: "founder prospects",
          sourceConfig: {
            actorId: "apify/mock-actor",
            actorInput: { query: "SaaS founder" },
            maxLeads: 10,
          },
          seedInputs: ["founder"],
          status: "approved",
        },
      ],
    },
  });
  expect(patchRes.ok()).toBeTruthy();

  const runsRes = await request.get(`/api/brands/${brandId}/campaigns/${campaignId}/runs`);
  expect(runsRes.ok()).toBeTruthy();
  const runsJson = await runsRes.json();
  const runId = String(runsJson.runs?.[0]?.id ?? "");
  expect(runId).toBeTruthy();

  return { brandId, campaignId, runId };
}

test.beforeEach(async ({ context, page }) => {
  await resetDataFiles();
  await context.clearCookies();
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
});

test("approved hypothesis auto-queues and progresses run on worker tick", async ({ request }) => {
  const { brandId, campaignId, runId } = await setupAutopilotContext(request);

  const tick1 = await request.post("/api/internal/outreach/tick");
  expect(tick1.ok()).toBeTruthy();

  const tick2 = await request.post("/api/internal/outreach/tick");
  expect(tick2.ok()).toBeTruthy();

  const runsRes = await request.get(`/api/brands/${brandId}/campaigns/${campaignId}/runs`);
  expect(runsRes.ok()).toBeTruthy();
  const runsJson = await runsRes.json();
  const run = (runsJson.runs ?? []).find((item: { id: string }) => item.id === runId);
  expect(run).toBeTruthy();
  expect(run.status).not.toBe("preflight_failed");
  expect(Number(run.metrics?.sourcedLeads ?? 0)).toBeGreaterThan(0);
  expect(Number(run.metrics?.scheduledMessages ?? 0)).toBeGreaterThan(0);
});

test("inbound reply creates draft and human send endpoint marks draft sent", async ({ request }) => {
  const { brandId, campaignId, runId } = await setupAutopilotContext(request);

  const apifyWebhook = await request.post("/api/webhooks/apify/run-complete", {
    data: {
      runId,
      leads: [
        {
          email: "reply-target@example.com",
          name: "Reply Target",
          company: "Example Co",
          title: "Founder",
          domain: "example.com",
          sourceUrl: "https://example.com/profile/reply-target",
        },
      ],
    },
  });
  expect(apifyWebhook.ok()).toBeTruthy();

  const tick1 = await request.post("/api/internal/outreach/tick");
  expect(tick1.ok()).toBeTruthy();

  const tick2 = await request.post("/api/internal/outreach/tick");
  expect(tick2.ok()).toBeTruthy();

  const replyWebhook = await request.post("/api/webhooks/customerio/events", {
    data: {
      eventType: "reply",
      runId,
      brandId,
      campaignId,
      from: "reply-target@example.com",
      to: "ops@example.com",
      subject: "Re: Run founder wedge",
      body: "Interested. Can you send more details?",
      messageId: `msg_${Date.now().toString(36)}`,
    },
  });
  expect(replyWebhook.ok()).toBeTruthy();

  const inboxRes = await request.get(`/api/brands/${brandId}/inbox/threads`);
  expect(inboxRes.ok()).toBeTruthy();
  const inboxJson = await inboxRes.json();
  expect(Array.isArray(inboxJson.threads)).toBeTruthy();
  expect((inboxJson.threads ?? []).length).toBeGreaterThan(0);
  expect(Array.isArray(inboxJson.drafts)).toBeTruthy();
  expect((inboxJson.drafts ?? []).length).toBeGreaterThan(0);

  const draftId = String(inboxJson.drafts?.[0]?.id ?? "");
  expect(draftId).toBeTruthy();

  const sendRes = await request.post(`/api/brands/${brandId}/inbox/drafts/${draftId}/send`);
  expect(sendRes.ok()).toBeTruthy();

  const inboxAfter = await request.get(`/api/brands/${brandId}/inbox/threads`);
  expect(inboxAfter.ok()).toBeTruthy();
  const inboxAfterJson = await inboxAfter.json();
  const sentDraft = (inboxAfterJson.drafts ?? []).find((draft: { id: string }) => draft.id === draftId);
  expect(sentDraft?.status).toBe("sent");
});
