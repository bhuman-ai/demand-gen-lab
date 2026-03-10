create table if not exists demanddev_customerio_profile_admissions (
  id text primary key,
  account_id text not null references demanddev_outreach_accounts(id) on delete cascade,
  billing_period_start timestamptz not null,
  profile_identifier text not null,
  source_run_id text not null default '',
  source_message_id text not null default '',
  created_at timestamptz not null default now()
);

create unique index if not exists demanddev_customerio_profile_admissions_unique_idx
  on demanddev_customerio_profile_admissions (account_id, billing_period_start, profile_identifier);

create index if not exists demanddev_customerio_profile_admissions_period_idx
  on demanddev_customerio_profile_admissions (account_id, billing_period_start, created_at desc);

create or replace function demanddev_claim_customerio_profile_admission(
  p_account_id text,
  p_billing_period_start timestamptz,
  p_profile_identifier text,
  p_source_run_id text,
  p_source_message_id text,
  p_effective_limit integer
)
returns table (
  status text,
  current_count integer,
  admission_id text,
  created_at timestamptz
)
language plpgsql
as $$
declare
  v_normalized_identifier text := lower(trim(coalesce(p_profile_identifier, '')));
  v_existing demanddev_customerio_profile_admissions%rowtype;
  v_inserted demanddev_customerio_profile_admissions%rowtype;
  v_current_count integer := 0;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(
      coalesce(p_account_id, '') || '|' || coalesce(p_billing_period_start::text, ''),
      0
    )
  );

  if v_normalized_identifier = '' then
    status := 'blocked';
    current_count := 0;
    admission_id := null;
    created_at := null;
    return next;
    return;
  end if;

  select *
  into v_existing
  from demanddev_customerio_profile_admissions
  where account_id = p_account_id
    and billing_period_start = p_billing_period_start
    and profile_identifier = v_normalized_identifier
  limit 1;

  if found then
    select count(*)
    into v_current_count
    from demanddev_customerio_profile_admissions
    where account_id = p_account_id
      and billing_period_start = p_billing_period_start;

    status := 'existing';
    current_count := v_current_count;
    admission_id := v_existing.id;
    created_at := v_existing.created_at;
    return next;
    return;
  end if;

  select count(*)
  into v_current_count
  from demanddev_customerio_profile_admissions
  where account_id = p_account_id
    and billing_period_start = p_billing_period_start;

  if greatest(coalesce(p_effective_limit, 0), 0) <= 0 or v_current_count >= greatest(coalesce(p_effective_limit, 0), 0) then
    status := 'blocked';
    current_count := v_current_count;
    admission_id := null;
    created_at := null;
    return next;
    return;
  end if;

  insert into demanddev_customerio_profile_admissions (
    id,
    account_id,
    billing_period_start,
    profile_identifier,
    source_run_id,
    source_message_id
  )
  values (
    'cioadm_' || md5(random()::text || clock_timestamp()::text || p_account_id || v_normalized_identifier),
    p_account_id,
    p_billing_period_start,
    v_normalized_identifier,
    coalesce(p_source_run_id, ''),
    coalesce(p_source_message_id, '')
  )
  returning *
  into v_inserted;

  select count(*)
  into v_current_count
  from demanddev_customerio_profile_admissions
  where account_id = p_account_id
    and billing_period_start = p_billing_period_start;

  if v_current_count > greatest(coalesce(p_effective_limit, 0), 0) then
    delete from demanddev_customerio_profile_admissions
    where id = v_inserted.id;

    status := 'blocked';
    current_count := v_current_count - 1;
    admission_id := null;
    created_at := null;
    return next;
    return;
  end if;

  status := 'admitted';
  current_count := v_current_count;
  admission_id := v_inserted.id;
  created_at := v_inserted.created_at;
  return next;
end;
$$;
