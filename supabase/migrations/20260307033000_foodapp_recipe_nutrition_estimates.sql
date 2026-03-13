create table if not exists foodapp_recipe_nutrition_estimates (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references foodapp_recipes_published(id) on delete cascade,
  estimate_version text not null default 'v1',
  estimate_model text,
  source_hash text not null,
  data jsonb not null,
  estimated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recipe_id)
);
create index if not exists foodapp_recipe_nutrition_estimates_recipe_idx
  on foodapp_recipe_nutrition_estimates(recipe_id);
create index if not exists foodapp_recipe_nutrition_estimates_updated_idx
  on foodapp_recipe_nutrition_estimates(updated_at desc);
alter table foodapp_recipe_nutrition_estimates enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='foodapp_recipe_nutrition_estimates'
      and policyname='admin_read_recipe_nutrition_estimates'
  ) then
    create policy "admin_read_recipe_nutrition_estimates"
    on foodapp_recipe_nutrition_estimates
    for select
    using (foodapp_is_admin());
  end if;
end $$;
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='foodapp_recipe_nutrition_estimates'
      and policyname='admin_write_recipe_nutrition_estimates'
  ) then
    create policy "admin_write_recipe_nutrition_estimates"
    on foodapp_recipe_nutrition_estimates
    for all
    using (foodapp_is_admin())
    with check (foodapp_is_admin());
  end if;
end $$;
create or replace function foodapp_recipe_nutrition_estimates_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists foodapp_recipe_nutrition_estimates_set_updated_at
  on foodapp_recipe_nutrition_estimates;
create trigger foodapp_recipe_nutrition_estimates_set_updated_at
before update on foodapp_recipe_nutrition_estimates
for each row execute function foodapp_recipe_nutrition_estimates_set_updated_at();
