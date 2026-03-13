alter table if exists demanddev_brand_outreach_assignments
  add column if not exists account_ids text[] not null default '{}'::text[];
update demanddev_brand_outreach_assignments
set account_ids = array[account_id]
where (account_ids is null or cardinality(account_ids) = 0)
  and coalesce(account_id, '') <> '';
create index if not exists demanddev_brand_outreach_assignments_account_ids_idx
  on demanddev_brand_outreach_assignments using gin (account_ids);
