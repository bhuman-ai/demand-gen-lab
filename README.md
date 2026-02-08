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
- `APIFY_TOKEN`

## API endpoints

- `POST /api/strategy/ideas` — generate hypothesis ideas
- `POST /api/strategy/build` — build sequence drafts from ideas
- `GET /api/apify/actors?search=...` — search Apify Store
- `POST /api/apify/run` — run an actor with budget caps
- `GET /api/apify/run/[runId]` — poll run status

## UI routes

- `/projects`, `/projects/new`, `/strategy`, `/hypotheses`, `/evolution`, `/network`, `/leads`, `/inbox`, `/logic`, `/doctor`

