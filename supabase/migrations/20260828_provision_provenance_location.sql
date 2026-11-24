-- Provision Network: provenance + source location + human counting defaults
-- Apply after 20260828_provision_foundation.sql

begin;

-- Human-friendly counting defaults. The event model still keeps quantity and unit separate.
update public.food set default_unit = 'each'  where slug in ('courgette','tomato','red-snapper');
update public.food set default_unit = 'kg'    where slug = 'potato';
update public.food set default_unit = 'dozen' where slug = 'eggs';
update public.food set default_unit = 'loaf'  where slug = 'bread';

-- Carry a deliberately small, public-safe provenance summary into the current projection.
alter table public.current_offer add column if not exists update_channel text not null default 'unknown';
alter table public.current_offer add column if not exists update_label text;
alter table public.current_offer add column if not exists update_authenticated boolean not null default false;

create or replace function public.project_current_offer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_active boolean;
  v_update_channel text;
  v_update_label text;
  v_update_authenticated boolean;
begin
  v_is_active :=
    new.event_type not in ('withdraw','sold_out')
    and new.state not in ('gone','unavailable')
    and coalesce(new.quantity, 0) > 0
    and (new.valid_until is null or new.valid_until > now());

  v_update_channel := coalesce(
    nullif(new.metadata->>'update_channel',''),
    case
      when new.metadata->>'source_client' = 'provision-source-pwa' then 'source_direct'
      when new.truth_class = 'inferred' then 'provision_inference'
      when new.truth_class = 'observed' then 'community_observation'
      else 'declared'
    end
  );

  select coalesce(nullif(new.metadata->>'update_label',''), s.name)
  into v_update_label
  from public.source s
  where s.id = new.source_id;

  select exists (
    select 1
    from public.source_member sm
    where sm.source_id = new.source_id
      and sm.user_id = new.actor_user_id
  ) into v_update_authenticated;

  insert into public.current_offer (
    source_id, food_id, lot_id, latest_event_id, state, quantity, unit, price,
    currency, price_basis, bundle_quantity, note, truth_class,
    evidence_strength, asserted_at, valid_until, is_active, updated_at,
    update_channel, update_label, update_authenticated
  )
  values (
    new.source_id, new.food_id, new.lot_id, new.id, new.state, new.quantity,
    new.unit, new.price, new.currency, new.price_basis, new.bundle_quantity,
    new.note, new.truth_class, new.evidence_strength, new.asserted_at,
    new.valid_until, v_is_active, now(),
    v_update_channel, v_update_label, v_update_authenticated
  )
  on conflict (offer_key) do update set
    latest_event_id = excluded.latest_event_id,
    state = excluded.state,
    quantity = excluded.quantity,
    unit = excluded.unit,
    price = excluded.price,
    currency = excluded.currency,
    price_basis = excluded.price_basis,
    bundle_quantity = excluded.bundle_quantity,
    note = excluded.note,
    truth_class = excluded.truth_class,
    evidence_strength = excluded.evidence_strength,
    asserted_at = excluded.asserted_at,
    valid_until = excluded.valid_until,
    is_active = excluded.is_active,
    updated_at = now(),
    update_channel = excluded.update_channel,
    update_label = excluded.update_label,
    update_authenticated = excluded.update_authenticated
  where excluded.asserted_at >= public.current_offer.asserted_at;

  return new;
end;
$$;

-- Backfill current projections from their latest immutable events.
update public.current_offer co
set
  update_channel = coalesce(
    nullif(pe.metadata->>'update_channel',''),
    case
      when pe.metadata->>'source_client' = 'provision-source-pwa' then 'source_direct'
      when pe.truth_class = 'inferred' then 'provision_inference'
      when pe.truth_class = 'observed' then 'community_observation'
      else 'declared'
    end
  ),
  update_label = coalesce(nullif(pe.metadata->>'update_label',''), s.name),
  update_authenticated = exists (
    select 1 from public.source_member sm
    where sm.source_id = pe.source_id
      and sm.user_id = pe.actor_user_id
  )
from public.provision_event pe
join public.source s on s.id = pe.source_id
where pe.id = co.latest_event_id;

-- Safe source profile updater used by Provision Source after postcode/device geocoding.
create or replace function public.update_source_profile(
  p_source_id uuid,
  p_address_line text default null,
  p_locality text default null,
  p_postcode text default null,
  p_longitude double precision default null,
  p_latitude double precision default null,
  p_location_method text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if auth.uid() is null or not public.is_source_member(p_source_id) then
    raise exception 'Source membership required';
  end if;

  if (p_longitude is null) <> (p_latitude is null) then
    raise exception 'Longitude and latitude must be supplied together';
  end if;

  if p_longitude is not null and (p_longitude < -180 or p_longitude > 180) then
    raise exception 'Longitude out of range';
  end if;
  if p_latitude is not null and (p_latitude < -90 or p_latitude > 90) then
    raise exception 'Latitude out of range';
  end if;

  update public.source
  set
    address_line = coalesce(nullif(trim(p_address_line),''), address_line),
    locality = coalesce(nullif(trim(p_locality),''), locality),
    postcode = coalesce(nullif(upper(trim(p_postcode)),''), postcode),
    location = case
      when p_longitude is not null and p_latitude is not null
      then extensions.st_setsrid(extensions.st_makepoint(p_longitude,p_latitude),4326)::extensions.geography
      else location
    end,
    metadata = metadata || case
      when nullif(trim(p_location_method),'') is not null
      then jsonb_build_object('location_method', trim(p_location_method), 'location_updated_at', now())
      else '{}'::jsonb
    end
  where id = p_source_id;
end;
$$;

grant execute on function public.update_source_profile(uuid,text,text,text,double precision,double precision,text) to authenticated;

-- Public consumer query surface: add only safe provenance fields; never expose actor_user_id.
create or replace view public.current_offers
with (security_invoker = true)
as
select
  co.id,
  co.latest_event_id,
  co.source_id,
  s.slug as source_slug,
  s.name as source_name,
  s.source_type,
  s.verified as source_verified,
  s.locality,
  s.postcode,
  extensions.st_y(s.location::extensions.geometry) as latitude,
  extensions.st_x(s.location::extensions.geometry) as longitude,
  co.food_id,
  f.slug as food_slug,
  f.common_name as food_name,
  f.category as food_category,
  co.lot_id,
  co.state,
  co.quantity,
  co.unit,
  co.price,
  co.currency,
  co.price_basis,
  co.bundle_quantity,
  co.note,
  co.truth_class,
  co.evidence_strength,
  co.asserted_at,
  co.valid_until,
  co.updated_at,
  co.update_channel,
  co.update_label,
  co.update_authenticated,
  s.contact_url as source_contact_url
from public.current_offer co
join public.source s on s.id = co.source_id
join public.food f on f.id = co.food_id
where co.is_active
  and s.active
  and f.active
  and co.quantity > 0
  and (co.valid_until is null or co.valid_until > now());

grant select on public.current_offers to anon, authenticated;

-- Source location/profile changes should also refresh consumer distance/provenance without a new food event.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'source'
  ) then
    alter publication supabase_realtime add table public.source;
  end if;
end
$$;

commit;
