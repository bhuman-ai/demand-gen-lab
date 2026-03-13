-- Outreach email enrichment via Apify actor

ALTER TABLE public.outreach_prospects
  ADD COLUMN IF NOT EXISTS email_enrichment_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS email_enrichment_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_email_enriched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_source_provider TEXT,
  ADD COLUMN IF NOT EXISTS email_confidence NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_enrichment_error TEXT,
  ADD COLUMN IF NOT EXISTS email_enrichment_payload JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_outreach_prospects_email_enrichment_status
  ON public.outreach_prospects(email_enrichment_status);
CREATE INDEX IF NOT EXISTS idx_outreach_prospects_last_email_enriched_at
  ON public.outreach_prospects(last_email_enriched_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_prospects_email_enrichment_candidates
  ON public.outreach_prospects(priority_score DESC, created_at ASC)
  WHERE status = 'qualified' AND contact_email IS NULL;
CREATE TABLE IF NOT EXISTS public.outreach_enrichment_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'success',
  daily_limit INTEGER NOT NULL DEFAULT 300,
  candidates_found INTEGER NOT NULL DEFAULT 0,
  attempted INTEGER NOT NULL DEFAULT 0,
  enriched INTEGER NOT NULL DEFAULT 0,
  not_found INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_outreach_enrichment_runs_started_at
  ON public.outreach_enrichment_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_enrichment_runs_status
  ON public.outreach_enrichment_runs(status);
