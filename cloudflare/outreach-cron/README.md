# Cloudflare Outreach Cron Worker

This worker replaces Vercel Cron and calls the app's combined operator tick:

- `POST /api/internal/outreach/tick`

It runs every 5 minutes (`*/5 * * * *`) and supports a protected manual trigger endpoint. The app tick handles outreach dispatch, inbox sync, sendable prep, sender warmup/launch, deliverability supervision, and AI mission learning refreshes.

## Files

- `wrangler.toml`
- `src/index.ts`

## Setup

1. Set app env var on Vercel:
   - `OUTREACH_CRON_TOKEN` (required)
2. Update `OUTREACH_TICK_URL` in `wrangler.toml` to your app domain.
3. Deploy worker:

```bash
cd /Users/don/lastb2b/cloudflare/outreach-cron
wrangler login
wrangler secret put OUTREACH_CRON_TOKEN
wrangler secret put MANUAL_TRIGGER_TOKEN
wrangler deploy
```

## Endpoints

- `GET /health` (public health check)
- `POST /run` (manual trigger, requires `Authorization: Bearer <MANUAL_TRIGGER_TOKEN>`)

Example manual run:

```bash
curl -X POST "https://<your-worker>.workers.dev/run" \
  -H "Authorization: Bearer <MANUAL_TRIGGER_TOKEN>"
```
