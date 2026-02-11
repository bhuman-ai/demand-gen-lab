alter table if exists demanddev_outreach_accounts
  add column if not exists account_type text not null default 'hybrid';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'demanddev_outreach_accounts_account_type_chk'
  ) then
    alter table demanddev_outreach_accounts
      add constraint demanddev_outreach_accounts_account_type_chk
      check (account_type in ('delivery', 'mailbox', 'hybrid'));
  end if;
end
$$;

alter table if exists demanddev_brand_outreach_assignments
  add column if not exists mailbox_account_id text references demanddev_outreach_accounts(id) on delete set null;

create index if not exists demanddev_brand_outreach_assignments_mailbox_idx
  on demanddev_brand_outreach_assignments (mailbox_account_id);
