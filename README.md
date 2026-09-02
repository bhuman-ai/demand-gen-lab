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
- `OPENROUTER_API_KEY` (optional fallback for JSON LLM calls when OpenAI is unavailable)
- `LLM_JSON_PROVIDER` (optional, `openai` or `openrouter`; blank tries OpenAI first then OpenRouter)
- `OPENROUTER_MODEL_ROUTINE` (recommended: `google/gemini-3.5-flash`; used for routine copy, lead planning, and quality-policy calls)
- `OPENROUTER_MODEL_DEFAULT` (recommended: `google/gemini-3.5-flash`; do not point this at GPT-5.5 unless routine automation spend is intentional)
- `OPENROUTER_MODEL_MISSION_OPERATOR` (recommended: `openai/gpt-5.5`; reserved for strategic mission/operator decisions)
- `OPENROUTER_MODEL_TASK_OPERATOR_CHAT` (recommended: `openai/gpt-5.5`; used for interactive Brand GPT chat)
- `OPENAI_MODEL_MISSION_OPERATOR` (recommended: `gpt-5.5`)
- `OPENAI_MISSION_REASONING_EFFORT` (recommended: `high`)
- `BRAND_ACTIVATION_AUTOPILOT_ENABLED` (optional, lets GPT activate brands, missions, and sender remediation from the ops tick)
- `BRAND_ACTIVATION_AUTOPILOT_ACTIONS_PER_TICK` (optional, default `1`; cap on autonomous writes per tick)
- `BRAND_ACTIVATION_AUTOPILOT_PLAN_COOLDOWN_MINUTES` (optional, default `60`; prevents the strategic GPT operator from re-planning the same brand every cron tick)
- `BRAND_ACTIVATION_AUTOPILOT_PROVISION_FAILURE_COOLDOWN_MINUTES` (optional, default `60`; prevents repeated domain-buy retries after provider failures)
- `BRAND_ACTIVATION_AUTOPILOT_ALLOW_DOMAIN_REGISTRATION` (optional, set `true` only when sender domain purchase is allowed)
- `BRAND_ACTIVATION_AUTOPILOT_ALLOW_GROWTH_TOOLS` (optional, default `true`; lets GPT call the generic growth tool registry)
- `BRAND_ACTIVATION_AUTOPILOT_ALLOW_GUARDED_GROWTH_TOOLS`, `BRAND_ACTIVATION_AUTOPILOT_ALLOW_SPEND_GROWTH_TOOLS`, and `BRAND_ACTIVATION_AUTOPILOT_ALLOW_REPUTATION_GROWTH_TOOLS` (optional; guarded/reputation actions default to enabled when brand activation autopilot is enabled, while spend-risk actions still require explicit enablement)
- `BRAND_ACTIVATION_AUTOPILOT_REGISTRANT_*` (required for autonomous domain registration)
- `BRAND_GPT_MISSION_RUNNER_ENABLED` (optional; defaults to enabled when `BRAND_ACTIVATION_AUTOPILOT_ENABLED=true`; lets Brand GPT keep active missions moving from scheduled ticks)
- `OUTREACH_DOMAIN_REGISTRAR` (optional, `mailpool`, `vercel`, or `auto`; `auto` falls back to Vercel when Mailpool registration fails)
- `OUTREACH_VERCEL_API_TOKEN` (optional, enables guarded Vercel sender-domain registration)
- `OUTREACH_VERCEL_TEAM_ID` (optional, scopes Vercel registrar requests to a team)
- `OUTREACH_VERCEL_MAX_DOMAIN_PRICE_USD` (optional, default `20`; hard price guard before buying)
- `OUTREACH_VERCEL_DOMAIN_AUTO_RENEW` (optional, default `false`)
- `SUPABASE_URL` (optional)
- `SUPABASE_SERVICE_ROLE_KEY` (optional)
- `OUTREACH_ENCRYPTION_KEY` (required for secure account secret storage)
- `OUTREACH_COMBINED_TICK_ENABLED` (optional, default `false`; leave off when Vercel split crons are active so the legacy Cloudflare combined tick cannot duplicate ops work)
- `OUTREACH_CRON_TOKEN` (optional, protects cron tick endpoint)
- `CRON_SECRET` (optional legacy alias for tick auth token)
- `CUSTOMER_IO_WEBHOOK_SECRET` (optional)
- `AIRSCALE_API_KEY` (optional, enables Airscale as the external email waterfall provider)
- `EMAIL_FINDER_EXTERNAL_WATERFALL_ENABLED` (optional, set `true` to let the email finder use external paid fallback)
- `NAMECHEAP_RELAY_URL` (optional, routes Namecheap API calls through a fixed-IP relay)
- `NAMECHEAP_RELAY_TOKEN` (optional bearer token for that relay)
- `LIFTLINE_AUTOPILOT_WEBHOOK_SECRET` (authenticates TapIn frontend calls to the protected backend routes)
- `CLUSTERSEO_API_URL=https://www.clusterseo.com`
- `CLUSTERSEO_TAPIN_SHARED_SECRET` (same high-entropy HMAC secret in ClusterSEO and TapInSocial)
- `CLUSTERSEO_WELCOME_GIFT_AUTOMATION_ENABLED` (optional, default `false`; enables automatic delivery only for allowlisted, self-owned ClusterSEO YouTube welcome gifts)
- `CLUSTERSEO_WELCOME_GIFT_AUTOMATION_DRY_RUN` (optional, default `true`; set `false` only after validating the production allowlists)
- `CLUSTERSEO_WELCOME_GIFT_AUTOMATION_USER_IDS` (comma-separated TapIn user UUID allowlist)
- `CLUSTERSEO_WELCOME_GIFT_AUTOMATION_TARGET_DOMAINS` (comma-separated target-domain allowlist, for example `bhuman.ai`)
- `CLUSTERSEO_WELCOME_GIFT_AUTOMATION_PER_RUN_CAP` (optional, default `1`, hard maximum `3`)

Apply Supabase migration `20260814123000_tapinsocial_clusterseo_deliveries.sql` before enabling ClusterSEO comment delivery. Its service-role-only ledger makes YouTube posting idempotent: a retry settles the existing verified comment instead of posting it again.

The five-minute TapIn dispatch worker can also fulfill an allowlisted ClusterSEO welcome gift without a member approval click. It accepts only `YOUTUBE` `COMMENT` opportunities whose source ends in `:welcome_youtube_gift`, whose target belongs to the connected ClusterSEO user, and whose normalized domain is explicitly allowlisted. It uses the existing ClusterSEO draft, signed grant, YouTube verification, idempotent delivery ledger, and settlement path. Ordinary TapIn campaigns remain unchanged and manual.

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

The worker calls the combined outreach operator tick every 5 minutes. That tick now covers outreach dispatch, inbox sync, sendable prep, sender warmup/launch, deliverability supervision, AI mission learning refreshes, and optional GPT-driven brand activation.

The worker schedule is configured in:

- `/Users/don/lastb2b/cloudflare/outreach-cron/wrangler.toml`

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
