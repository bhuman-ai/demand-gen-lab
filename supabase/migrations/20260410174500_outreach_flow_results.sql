create table if not exists demanddev_outreach_flow_results (
  brand_id text primary key references demanddev_brands(id) on delete cascade,
  brief jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists demanddev_outreach_flow_results_updated_at_idx
  on demanddev_outreach_flow_results (updated_at desc);

drop trigger if exists demanddev_outreach_flow_results_updated_at on demanddev_outreach_flow_results;
create trigger demanddev_outreach_flow_results_updated_at
before update on demanddev_outreach_flow_results
for each row execute function demanddev_set_updated_at();
