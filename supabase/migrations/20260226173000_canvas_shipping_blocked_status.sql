-- Add rental shipping_blocked lifecycle status + previous status tracking for admin retries.

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'canvas_rental_status'
      and e.enumlabel = 'shipping_blocked'
  ) then
    alter type public.canvas_rental_status add value 'shipping_blocked';
  end if;
end $$;
alter table public.canvas_rentals
  add column if not exists shipping_blocked_previous_status public.canvas_rental_status;
create index if not exists canvas_rentals_status_idx
  on public.canvas_rentals(status);
