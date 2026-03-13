-- DataForSEO outreach discovery foundation

CREATE TABLE IF NOT EXISTS public.outreach_prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  company_name TEXT NOT NULL,
  domain TEXT NOT NULL,
  contact_email TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  priority_score NUMERIC NOT NULL DEFAULT 0,
  video_gap_score NUMERIC NOT NULL DEFAULT 0,
  revenue_signal_score NUMERIC NOT NULL DEFAULT 0,
  conversion_friction_score NUMERIC NOT NULL DEFAULT 0,
  source_provider TEXT NOT NULL DEFAULT 'dataforseo',
  source_type TEXT NOT NULL DEFAULT 'organic',
  serp_rank INTEGER,
  serp_query TEXT,
  serp_location TEXT,
  discovery_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.outreach_prospects
  ADD COLUMN IF NOT EXISTS source_provider TEXT NOT NULL DEFAULT 'dataforseo',
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'organic',
  ADD COLUMN IF NOT EXISTS serp_rank INTEGER,
  ADD COLUMN IF NOT EXISTS serp_query TEXT,
  ADD COLUMN IF NOT EXISTS serp_location TEXT,
  ADD COLUMN IF NOT EXISTS discovery_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT,
  ADD COLUMN IF NOT EXISTS priority_score NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS video_gap_score NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revenue_signal_score NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conversion_friction_score NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE public.outreach_prospects
SET dedupe_key = lower(regexp_replace(coalesce(domain, ''), '[^a-z0-9]+', ' ', 'g')) || '::' || lower(regexp_replace(coalesce(company_name, ''), '[^a-z0-9]+', ' ', 'g'))
WHERE (dedupe_key IS NULL OR dedupe_key = '')
  AND domain IS NOT NULL
  AND company_name IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_prospects_dedupe ON public.outreach_prospects(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_outreach_prospects_status ON public.outreach_prospects(status);
CREATE INDEX IF NOT EXISTS idx_outreach_prospects_priority ON public.outreach_prospects(priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_prospects_domain ON public.outreach_prospects(domain);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'update_updated_at_column'
      AND pg_function_is_visible(oid)
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgname = 'update_outreach_prospects_updated_at'
    ) THEN
      CREATE TRIGGER update_outreach_prospects_updated_at
      BEFORE UPDATE ON public.outreach_prospects
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
    END IF;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.outreach_discovery_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'success',
  queries_attempted INTEGER NOT NULL DEFAULT 0,
  tasks_executed INTEGER NOT NULL DEFAULT 0,
  results_found INTEGER NOT NULL DEFAULT 0,
  prospects_upserted INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_outreach_discovery_runs_started_at ON public.outreach_discovery_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_discovery_runs_status ON public.outreach_discovery_runs(status);
-- Fix content_ideas status mismatch: API writes `scheduled`, enum originally did not include it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'idea_status'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum
      WHERE enumtypid = 'idea_status'::regtype
        AND enumlabel = 'scheduled'
    ) THEN
      ALTER TYPE idea_status ADD VALUE 'scheduled';
    END IF;
  END IF;
END $$;
