# The Factory

Autonomous genetic outreach engine. Customer.io-first with conversion-aware optimization.

## Getting started

```bash
npm install
npm run dev
```

## Environment

Copy `.env.example` to `.env.local` and fill values:

- `OPENAI_API_KEY`
- `OPENAI_MODEL_MISSION_OPERATOR` (recommended: `gpt-5.5`)
- `OPENAI_MISSION_REASONING_EFFORT` (recommended: `high`)
- `SUPABASE_URL` (optional)
- `SUPABASE_SERVICE_ROLE_KEY` (optional)
- `OUTREACH_ENCRYPTION_KEY` (required for secure account secret storage)
- `OUTREACH_CRON_TOKEN` (optional, protects cron tick endpoint)
- `CRON_SECRET` (optional legacy alias for tick auth token)
- `CUSTOMER_IO_WEBHOOK_SECRET` (optional)
- `NAMECHEAP_RELAY_URL` (optional, routes Namecheap API calls through a fixed-IP relay)
- `NAMECHEAP_RELAY_TOKEN` (optional bearer token for that relay)
- `FORWARD_EMAIL_API_TOKEN` (optional, enables fresh Forward Email control probe aliases)
- `FORWARD_EMAIL_PROBE_DOMAIN` (optional, domain already configured in Forward Email for probe aliases)
- `FORWARD_EMAIL_PROBE_MODE` (optional: `only`, `prefer`, or `off`; defaults to `only` when Forward Email is configured)
- `FORWARD_EMAIL_PROBE_TARGETS_PER_RUN` (optional, default `1`, max `10`)
- `FORWARD_EMAIL_PROBE_RECIPIENTS` (optional, comma/space-separated email or webhook recipients; IMAP storage is always enabled for probes)
- `GMAIL_DELIVERABILITY_MONITOR_EMAILS` (optional, comma/space-separated allowlist of Gmail-backed monitor inboxes approved for post-Forward Email placement confirmation)
- `GMAIL_DELIVERABILITY_PROBE_TARGETS_PER_RUN` (optional, default `1`, max `5`; existing Gmail monitor mailboxes to use only after a Forward Email probe inboxes)
- `DELIVERABILITY_PROBE_REPEAT_HOURS` (optional, default `24`; controls automatic recurring inbox placement probes)
- `DELIVERABILITY_PRE_SEND_GATE` (optional, default `true`; when enabled, dispatch waits for a fresh passing probe for the sender/message content)

## Scheduler (Cloudflare Worker)

Vercel cron is intentionally disabled in this repo, so Hobby deploys are not blocked.

Use Cloudflare Worker cron instead:

```bash
cd /Users/don/lastb2b/cloudflare/outreach-cron
wrangler login
wrangler secret put OUTREACH_CRON_TOKEN
wrangler secret put MANUAL_TRIGGER_TOKEN
wrangler deploy
```

The worker calls the combined outreach operator tick every 5 minutes. That tick covers outreach dispatch, inbox sync, sendable prep, sender launch, deliverability supervision, and AI mission learning refreshes.

The worker schedule is configured in:

- `/Users/don/lastb2b/cloudflare/outreach-cron/wrangler.toml`

## Forward Email probe aliases

Forward Email is used as the cheap control-probe receiver layer. When `FORWARD_EMAIL_API_TOKEN` and `FORWARD_EMAIL_PROBE_DOMAIN` are set, deliverability probes can create a fresh alias, send the probe from the real sender to that alias, poll the alias over IMAP, and delete the alias after the probe completes. If that Forward Email probe inboxes, the runtime can then queue an optional Gmail confirmation probe using an already-connected Gmail monitor mailbox that has not been used for that sender domain. When `GMAIL_DELIVERABILITY_MONITOR_EMAILS` is set, only those approved Gmail-backed monitors can be selected. Gmail is never used before the cheap Forward Email gate passes. Matched Gmail seed messages found in Inbox are archived after placement is recorded so approved seed inboxes stay clean.

The outreach runtime queues probes automatically when scheduled message content changes, repeats probes daily by default, and gates dispatch until the active sender/message has a fresh passing pre-send probe. The mission deliverability operator can also request a probe as an explicit AI tool when a run exists and delivery confidence is uncertain.

Smoke test the API setup with:

```bash
npm run forward-email:probe-smoke
```

## Namecheap Relay (Fixed IP)

Namecheap API access is tied to an allowlisted IPv4. If this app runs on Vercel without Static IPs, Namecheap calls can fail because the outbound IP is not fixed.

This repo includes a small relay you can run on a VPS or VM with a stable public IPv4:

```bash
NAMECHEAP_RELAY_TOKEN=replace-me \
PORT=8788 \
npm run namecheap:relay
```

Put it behind HTTPS or a private network before exposing it outside your host.

Recommended setup:

1. Run the relay on a small server with a fixed public IPv4.
2. Add that server IPv4 to Namecheap's API allowlist.
3. Set these app env vars in `lastb2b`:

```bash
NAMECHEAP_RELAY_URL=https://YOUR_RELAY_HOST/namecheap
NAMECHEAP_RELAY_TOKEN=replace-me
```

4. Keep the saved Namecheap `clientIp` setting equal to that same server IPv4.
5. Check the relay with `curl https://YOUR_RELAY_HOST/healthz`.

The relay only accepts authenticated `POST /namecheap` requests and only forwards to Namecheap's production or sandbox API host.

## API endpoints

- `GET /api/brands` — list brands
- `POST /api/brands` — create brand
- `GET /api/brands/:brandId` — read brand
- `PATCH /api/brands/:brandId` — update brand modules
- `DELETE /api/brands/:brandId` — delete brand
- `GET /api/brands/:brandId/experiments` — list experiments
- `POST /api/brands/:brandId/experiments` — create experiment
- `GET/PATCH/DELETE /api/brands/:brandId/experiments/:experimentId` — experiment CRUD
- `POST /api/brands/:brandId/experiments/:experimentId/launch` — launch experiment test
- `POST /api/brands/:brandId/experiments/:experimentId/promote` — promote experiment to scale campaign
- `GET /api/brands/:brandId/missions` — list AI campaign missions
- `POST /api/brands/:brandId/missions` — analyze site + target customers and generate an editable mission plan
- `GET/PATCH /api/brands/:brandId/missions/:missionId` — mission detail and plan edits
- `POST /api/brands/:brandId/missions/:missionId/start` — approve the plan and let the operator start only when deliverability is ready
- `GET /api/brands/:brandId/experiments/:experimentId/runs` — experiment run visibility
- `PATCH /api/brands/:brandId/experiments/:experimentId/runs/:runId` — pause/resume/cancel experiment run
- `GET /api/brands/:brandId/campaigns` — list promoted scale campaigns
- `POST /api/brands/:brandId/campaigns` — create campaign by promoting `sourceExperimentId`
- `GET/PATCH/DELETE /api/brands/:brandId/campaigns/:campaignId` — scale campaign detail and scale-policy updates
- `POST /api/brands/:brandId/campaigns/:campaignId/launch` — launch scale campaign
- `POST /api/telemetry` — event intake
- `GET/POST /api/outreach/accounts` — outreach account pool
- `PATCH/DELETE /api/outreach/accounts/:accountId` — account management
- `POST /api/outreach/accounts/:accountId/test` — account connectivity test
- `GET/PUT /api/brands/:brandId/outreach-account` — brand-to-account assignment
- `GET /api/brands/:brandId/campaigns/:campaignId/runs` — run + anomaly list
- `PATCH /api/brands/:brandId/campaigns/:campaignId/runs/:runId` — pause/resume/cancel
- `GET /api/brands/:brandId/inbox/threads` — reply threads + draft queue
- `POST /api/brands/:brandId/inbox/drafts/:draftId/send` — human-approved draft send
- `POST /api/webhooks/customerio/events` — delivery/reply webhook intake
- `POST /api/internal/outreach/tick` — cron worker tick
  - `GET` is also supported so Vercel Cron can call it directly.
- `GET/POST /api/internal/missions/tick` — mission-only operator refresh, useful for manual checks

## UI routes

- `/` — launcher dashboard
- `/brands` — brand directory
- `/brands/new` — brand onboarding
- `/brands/:brandId` — brand home
- `/brands/:brandId/missions` — AI mission setup
- `/brands/:brandId/missions/:missionId` — AI mission control room
- `/brands/:brandId/experiments` — experiment list
- `/brands/:brandId/experiments/:experimentId` — experiment workspace
- `/brands/:brandId/experiments/:experimentId/flow` — conversation flow editor
- `/brands/:brandId/campaigns` — promoted scale campaign list
- `/brands/:brandId/campaigns/:campaignId` — scale campaign workspace
- `/brands/:brandId/network`, `/brands/:brandId/leads`, `/brands/:brandId/inbox`
- `/logic`, `/doctor`
- `/settings/outreach`

Legacy campaign step routes (`/build`, `/run/*`, `/objective`, `/hypotheses`, `/experiments`, `/evolution`) now render explicit route-replaced UX with links to Experiments/Campaigns.

## E2E tests (Playwright)

```bash
npm run test:e2e:install
npm run test:e2e
```

## Product plan pipeline (ICP -> UX -> Critic -> optional UI review)

Generate a build-ready `plan.md` from one idea:

```bash
npm run plan:generate -- --idea "AI platform that converts podcasts into viral short clips"
```

Generate from a brief file:

```bash
npm run plan:generate -- --brief /Users/don/factory-platform/FACTORY_PROJECT_BRIEF.md
```

Run with UI review using current app routes (captures desktop + mobile screenshots first):

```bash
npm run plan:generate -- \
  --idea "Factory onboarding and campaign setup UX" \
  --base-url http://localhost:3000 \
  --routes "/,/brands,/brands/new,/logic"
```

Outputs:

- `/Users/don/factory-platform/output/plan.md` (final plan)
- `/Users/don/factory-platform/output/plan.icp.md` (ICP draft)
- `/Users/don/factory-platform/output/plan.ux.md` (UX draft)
- `/Users/don/factory-platform/output/ui-review.md` (only when screenshots are provided)
