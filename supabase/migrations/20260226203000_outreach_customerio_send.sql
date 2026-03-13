-- Outreach send pipeline state + run logging (Customer.io trigger based)

ALTER TABLE public.outreach_prospects
  ADD COLUMN IF NOT EXISTS outreach_send_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS outreach_send_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_outreach_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS outreach_provider TEXT,
  ADD COLUMN IF NOT EXISTS outreach_external_id TEXT,
  ADD COLUMN IF NOT EXISTS outreach_error TEXT,
  ADD COLUMN IF NOT EXISTS outreach_payload JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_outreach_prospects_send_status
  ON public.outreach_prospects(outreach_send_status);
CREATE INDEX IF NOT EXISTS idx_outreach_prospects_last_outreach_sent_at
  ON public.outreach_prospects(last_outreach_sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_prospects_qualified_email
  ON public.outreach_prospects(priority_score DESC, created_at ASC)
  WHERE status = 'qualified' AND contact_email IS NOT NULL;
CREATE TABLE IF NOT EXISTS public.outreach_send_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'success',
  daily_limit INTEGER NOT NULL DEFAULT 100,
  candidates_found INTEGER NOT NULL DEFAULT 0,
  attempted INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_outreach_send_runs_started_at
  ON public.outreach_send_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_send_runs_status
  ON public.outreach_send_runs(status);
