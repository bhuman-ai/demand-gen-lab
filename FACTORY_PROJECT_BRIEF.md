# THE FACTORY — Protocol Genesis
Status: Ready for Development

## Executive Summary
The Factory is an autonomous genetic outreach engine. It generates many outreach sequence hypotheses, tests them in parallel micro-batches, kills losers, and scales winners. v1 is **Customer.io-first** (email sending) with device farm controls deferred to later phases.

Aesthetic: **Glass & Graphite** — dark mode only, high density, monospace, data-first, no marketing fluff.

## Architecture & Stack
Backend Core
- Language: Python (FastAPI) preferred or Node.js (TypeScript)
- Database: PostgreSQL (Supabase)
- Queue: Redis

Integrations
- Intelligence: OpenAI (gpt-5.2) — ideas, hypotheses, sentiment, copy
- Scouting: Apify — lead scraping and data acquisition
- Sending: Customer.io — transactional messages
- Inbox Layer: Gmail API / Outlook Graph API / IMAP — reply ingestion + sentiment
- Domains/DNS: Namecheap + Cloudflare APIs (high complexity)

Frontend
- React (Next.js)
- Tailwind CSS
- Shadcn/UI (customized)
- TanStack Query

## Core Data Model
- Projects -> Campaigns -> Sequences -> Experiments -> Leads
- Sequences are either human-built or AI-generated.
- Optimize for global win (conversion), with reply sentiment as fallback.

## Genetic Engine
1. Seed: user defines goal, constraints, and brand context.
2. Hypothesis Queue: AI generates 50–200 ideas; user approves/denies.
3. Sequences Created: generate multiple sequences from approved ideas.
4. Execution: run sequences with small batches, capture replies and conversions.
5. Cull/Scale: losers paused, winners scaled.

Note: We store sequence variants internally and pass content as variables to a single Customer.io template/event. We do **not** create 100 templates in Customer.io.

## Apify Strategy
- Apify actor discovery is LLM-driven but validated.
- Actors must have a README and must be pay-per-event or pay-per-dataset-item.
- Inputs are built from the actor schema + README examples.
- Runs are capped by item count and cost; auto-abort when limit exceeded.

## Phases & Screens (v1 focus)
Phase I — Foundation
- Airlock Login (no signup)
- Factory Init (admin keys)
- System Integrity (API latency, error rates)
- Projects Hub
- Project Creation (site scrape + LLM prefill)

Phase II — Assets & CRM
- Network Hub (domains + reputation)
- Master Lead Grid
- CSV Import Refinery
- Suppression Vault

Phase III — Strategy
- Strategy Input
- Hypothesis Queue
- Evolution Grid (core)
- Winner’s Circle

Phase IV — Operations (later)
- Universal Inbox
- Campaign Doctor
- Live Logic Studio

Phase V — Device/Infra (later)
- Device Fleet
- System Terminal
- Remote Control

## Key Decisions
- Customer.io is the sender for v1.
- Device farm is deferred to a later phase.
- Reply ingestion requires inbox APIs (IMAP/Gmail/Outlook).
- Conversion rate is the primary objective metric.

