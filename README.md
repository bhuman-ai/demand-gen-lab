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
- `SUPABASE_URL` (optional)
- `SUPABASE_SERVICE_ROLE_KEY` (optional)
- `OUTREACH_ENCRYPTION_KEY` (required for secure account secret storage)
- `OUTREACH_CRON_TOKEN` (optional, protects cron tick endpoint)
- `CRON_SECRET` (optional legacy alias for tick auth token)
- `CUSTOMER_IO_WEBHOOK_SECRET` (optional)
- `APIFY_WEBHOOK_SECRET` (optional)

## Scheduler (Cloudflare Worker)

Vercel cron is intentionally disabled in this repo (`/Users/don/factory-platform/vercel.json`) so Hobby deploys are not blocked.

Use Cloudflare Worker cron instead:

```bash
cd /Users/don/factory-platform/cloudflare/outreach-cron
wrangler login
wrangler secret put OUTREACH_CRON_TOKEN
wrangler secret put MANUAL_TRIGGER_TOKEN
wrangler deploy
```

The worker schedule is configured in:

- `/Users/don/factory-platform/cloudflare/outreach-cron/wrangler.toml`

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
- `POST /api/webhooks/apify/run-complete` — lead sourcing webhook intake
- `POST /api/internal/outreach/tick` — cron worker tick
  - `GET` is also supported so Vercel Cron can call it directly.

## UI routes

- `/` — launcher dashboard
- `/brands` — brand directory
- `/brands/new` — brand onboarding
- `/brands/:brandId` — brand home
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
