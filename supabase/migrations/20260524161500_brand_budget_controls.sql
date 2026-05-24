create table if not exists demanddev_brand_budgets (
  brand_id text primary key references demanddev_brands(id) on delete cascade,
  currency text not null default 'USD' check (currency = 'USD'),
  total_budget_usd numeric(12, 4) not null default 0 check (total_budget_usd >= 0),
  spent_usd numeric(12, 4) not null default 0 check (spent_usd >= 0),
  reserved_usd numeric(12, 4) not null default 0 check (reserved_usd >= 0),
  status text not null default 'paused' check (status in ('active', 'paused')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (spent_usd + reserved_usd <= total_budget_usd or total_budget_usd = 0)
);

drop trigger if exists demanddev_brand_budgets_updated_at on demanddev_brand_budgets;
create trigger demanddev_brand_budgets_updated_at
before update on demanddev_brand_budgets
for each row execute function demanddev_set_updated_at();

create table if not exists demanddev_brand_budget_ledger (
  id text primary key,
  brand_id text not null references demanddev_brands(id) on delete cascade,
  category text not null default 'other' check (
    category in ('ai', 'ads', 'domains', 'mailboxes', 'email_verification', 'data_enrichment', 'linkedin', 'other')
  ),
  amount_usd numeric(12, 4) not null default 0 check (amount_usd >= 0),
  status text not null default 'spent' check (status in ('reserved', 'spent', 'released', 'refunded', 'cancelled')),
  source_type text not null default '',
  source_id text not null default '',
  description text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object')
);

drop trigger if exists demanddev_brand_budget_ledger_updated_at on demanddev_brand_budget_ledger;
create trigger demanddev_brand_budget_ledger_updated_at
before update on demanddev_brand_budget_ledger
for each row execute function demanddev_set_updated_at();

create index if not exists demanddev_brand_budget_ledger_brand_idx
  on demanddev_brand_budget_ledger (brand_id, created_at desc);

create index if not exists demanddev_brand_budget_ledger_source_idx
  on demanddev_brand_budget_ledger (source_type, source_id);
