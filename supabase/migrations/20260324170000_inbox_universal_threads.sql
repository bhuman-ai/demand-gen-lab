alter table if exists demanddev_reply_threads
  alter column campaign_id drop not null;

alter table if exists demanddev_reply_threads
  alter column run_id drop not null;

alter table if exists demanddev_reply_threads
  alter column lead_id drop not null;

alter table if exists demanddev_reply_threads
  add column if not exists source_type text not null default 'outreach',
  add column if not exists mailbox_account_id text references demanddev_outreach_accounts(id) on delete set null,
  add column if not exists contact_email text not null default '',
  add column if not exists contact_name text not null default '',
  add column if not exists contact_company text not null default '';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'demanddev_reply_threads_source_type_chk'
  ) then
    alter table demanddev_reply_threads
      add constraint demanddev_reply_threads_source_type_chk
      check (source_type in ('outreach', 'mailbox'));
  end if;
end
$$;

update demanddev_reply_threads
set source_type = 'outreach'
where source_type not in ('outreach', 'mailbox');

update demanddev_reply_threads as thread
set
  contact_email = coalesce(nullif(thread.contact_email, ''), lead.email, ''),
  contact_name = coalesce(nullif(thread.contact_name, ''), lead.name, ''),
  contact_company = coalesce(nullif(thread.contact_company, ''), lead.company, '')
from demanddev_outreach_run_leads as lead
where thread.lead_id = lead.id;

create index if not exists demanddev_reply_threads_brand_source_idx
  on demanddev_reply_threads (brand_id, source_type, last_message_at desc);

create index if not exists demanddev_reply_threads_contact_email_idx
  on demanddev_reply_threads (brand_id, lower(contact_email));

alter table if exists demanddev_reply_messages
  alter column run_id drop not null;

alter table if exists demanddev_reply_drafts
  alter column run_id drop not null;

alter table if exists demanddev_reply_thread_state
  alter column run_id drop not null;
