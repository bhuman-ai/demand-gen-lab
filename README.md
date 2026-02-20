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
- `CRON_SECRET` (optional, Vercel-native cron auth token; also accepted by tick endpoint)
- `CUSTOMER_IO_WEBHOOK_SECRET` (optional)
- `APIFY_WEBHOOK_SECRET` (optional)

## API endpoints

- `GET /api/brands` — list brands
- `POST /api/brands` — create brand
- `GET /api/brands/:brandId` — read brand
- `PATCH /api/brands/:brandId` — update brand modules
- `DELETE /api/brands/:brandId` — delete brand
- `GET /api/brands/:brandId/campaigns` — list campaigns for brand
- `POST /api/brands/:brandId/campaigns` — create campaign
- `GET /api/brands/:brandId/campaigns/:campaignId` — read campaign
- `PATCH /api/brands/:brandId/campaigns/:campaignId` — update campaign step data
- `DELETE /api/brands/:brandId/campaigns/:campaignId` — delete campaign
- `GET/PATCH /api/brands/:brandId/campaigns/:campaignId/build` — Build facade (objective + angles + variants)
- `POST /api/brands/:brandId/campaigns/:campaignId/build/suggest` — AI build bundle suggestions
- `GET /api/brands/:brandId/campaigns/:campaignId/run` — Run facade (runs + leads + inbox + insights)
- `POST /api/brands/:brandId/campaigns/:campaignId/hypotheses/generate` — generate hypothesis suggestions
- `POST /api/brands/:brandId/campaigns/:campaignId/experiments/generate` — generate experiment variants
- `POST /api/telemetry` — event intake
- `GET/POST /api/outreach/accounts` — outreach account pool
- `PATCH/DELETE /api/outreach/accounts/:accountId` — account management
- `POST /api/outreach/accounts/:accountId/test` — account connectivity test
- `GET/PUT /api/brands/:brandId/outreach-account` — brand-to-account assignment
- `GET /api/brands/:brandId/campaigns/:campaignId/runs` — run + anomaly list
- `POST /api/brands/:brandId/campaigns/:campaignId/experiments/:experimentId/runs` — launch experiment run
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
- `/brands/:brandId/campaigns` — campaign list
- `/brands/:brandId/campaigns/:campaignId/build` — Build workspace
- `/brands/:brandId/campaigns/:campaignId/run/overview` — Run overview
- `/brands/:brandId/campaigns/:campaignId/run/variants` — Run variants
- `/brands/:brandId/campaigns/:campaignId/run/leads` — Run leads
- `/brands/:brandId/campaigns/:campaignId/run/inbox` — Run inbox
- `/brands/:brandId/campaigns/:campaignId/run/insights` — Run insights
- `/brands/:brandId/network`, `/brands/:brandId/leads`, `/brands/:brandId/inbox`
- `/logic`, `/doctor`
- `/settings/outreach`

## E2E tests (Playwright)

```bash
npm run test:e2e:install
npm run test:e2e
```
