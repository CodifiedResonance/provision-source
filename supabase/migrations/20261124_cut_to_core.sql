-- Provision: cut down to core (2026-11-24)
--
-- Removes the "integrity" test harness that had been layered over the core
-- and restores the original contract (migrations 20260828 + 20260830_04)
-- that the Provision Source app in this repo is built against.
--
-- Everything removed here was snapshotted first into the locked schema
-- archive_20261124 (definitions + data). Edge function sources are in
-- archive/integrity-edge-functions/.
--
-- Core kept: source, source_member, food, lot, provision_event (append-only
-- ledger), current_offer (+ current_offers view), evidence, claim
-- (pre-orders with collection windows), demand_signal, source_profile_event.

-- 1. Detach the integrity layer from the core tables ------------------------
drop trigger if exists integrity_claim_audit on public.claim;
drop trigger if exists claim_principal on public.claim;
drop trigger if exists integrity_lot_revision_journal on public.lot;
drop trigger if exists integrity_food_unit_lot on public.lot;
drop trigger if exists event_principal on public.provision_event;
drop trigger if exists profile_principal on public.source_profile_event;
drop trigger if exists integrity_food_unit_demand on public.demand_signal;

do $$ declare r record; begin
  for r in select schemaname, tablename from pg_policies where policyname='integrity_server' and schemaname='public' loop
    execute format('drop policy integrity_server on %I.%I', r.schemaname, r.tablename);
  end loop;
end $$;
drop policy if exists integrity_storage_inventory on storage.objects;

alter table public.provision_event drop constraint if exists provision_event_actor_user_id_fkey;
alter table public.source_profile_event drop constraint if exists source_profile_event_actor_user_id_fkey;
alter table public.claim drop constraint if exists claim_claimant_user_id_fkey;
do $$ declare r record; begin
  for r in select conrelid::regclass::text t, conname from pg_constraint
           where contype='f' and connamespace='public'::regnamespace
             and confrelid in (select oid from pg_class where relnamespace='integrity'::regnamespace) loop
    execute format('alter table %s drop constraint %I', r.t, r.conname);
  end loop;
end $$;
-- People are auth users again. NOT VALID: a few synthetic test rows point at
-- erased test accounts; new rows are checked.
alter table public.claim add constraint claim_claimant_user_id_fkey
  foreign key (claimant_user_id) references auth.users(id) not valid;

-- 2. Restore the original offer projection and views ------------------------
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

drop view if exists public.current_offers;
create view public.current_offers
with (security_invoker = true)
as
select
  co.id, co.latest_event_id, co.source_id,
  s.slug as source_slug, s.name as source_name, s.source_type,
  s.verified as source_verified, s.locality, s.postcode,
  extensions.st_y(s.location::extensions.geometry) as latitude,
  extensions.st_x(s.location::extensions.geometry) as longitude,
  co.food_id, f.slug as food_slug, f.common_name as food_name, f.category as food_category,
  co.lot_id, co.state, co.quantity, co.unit, co.price, co.currency, co.price_basis,
  co.bundle_quantity, co.note, co.truth_class, co.evidence_strength, co.asserted_at,
  co.valid_until, co.updated_at, co.update_channel,
  case when co.update_channel='source_direct' then s.name else co.update_label end as update_label,
  co.update_authenticated,
  s.contact_url as source_contact_url,
  commitments.reserved_quantity,
  commitments.accepted_claim_count,
  greatest(coalesce(co.quantity,0)-commitments.reserved_quantity,0) as available_to_claim
from public.current_offer co
join public.source s on s.id=co.source_id
join public.food f on f.id=co.food_id
left join lateral (
  select coalesce(sum(c.quantity),0) as reserved_quantity, count(c.id)::integer as accepted_claim_count
  from public.claim c
  where c.current_offer_id=co.id and c.status='accepted'
    and (c.expires_at is null or c.expires_at > now())
) commitments on true
where co.is_active and s.active and f.active and co.quantity > 0
  and (co.valid_until is null or co.valid_until > now());

drop trigger if exists claim_refresh_offer_projection on public.claim;
create trigger claim_refresh_offer_projection
after insert or update of status,quantity,current_offer_id,expires_at or delete on public.claim
for each row execute function public.claim_refresh_offer_commitments();

-- 3. Remove the integrity layer ---------------------------------------------
do $$ declare r record; begin
  for r in select oid::regprocedure::text f from pg_proc
           where pronamespace='public'::regnamespace and proname like 'integrity\_%' loop
    execute 'drop function '||r.f||' cascade';
  end loop;
end $$;
drop table if exists public.integrity_change cascade;
drop schema if exists integrity cascade;

-- Unused ingestion stubs (never populated).
drop table if exists public.context_observation cascade;
drop table if exists public.external_source_ref cascade;
drop table if exists public.ingestion_run cascade;
drop table if exists public.data_feed cascade;
drop function if exists public.prevent_context_observation_change();

-- Integrity columns on core tables.
alter table public.claim
  drop column if exists integrity_revision, drop column if exists integrity_terms,
  drop column if exists integrity_outcome, drop column if exists integrity_reason,
  drop column if exists integrity_reference;
alter table public.current_offer
  drop column if exists integrity_revision, drop column if exists integrity_classification,
  drop column if exists integrity_lifecycle, drop column if exists integrity_visibility,
  drop column if exists integrity_reservable, drop column if exists integrity_withdrawal,
  drop column if exists integrity_price, drop column if exists integrity_confirmed_at,
  drop column if exists integrity_collection_start, drop column if exists integrity_collection_end;
alter table public.demand_signal
  drop column if exists integrity_area, drop column if exists integrity_confirmed_at;
alter table public.evidence
  drop column if exists integrity_bytes, drop column if exists integrity_revision,
  drop column if exists integrity_attachment_state, drop column if exists integrity_checksum,
  drop column if exists integrity_mime;
alter table public.lot
  drop column if exists integrity_revision, drop column if exists integrity_dates,
  drop column if exists integrity_unit;
alter table public.source
  drop column if exists integrity_revision, drop column if exists business_control;

-- 4. Grants: the original contract, row-level policies do the gating --------
grant select on public.food, public.source, public.current_offer,
  public.current_offers, public.source_profiles, public.public_evidence to anon, authenticated;
grant select (
  id,source_id,provision_event_id,evidence_type,observed_at,valid_until,
  caption,status,storage_path,external_url,created_at,is_public
) on public.evidence to anon;
grant select on public.source_member, public.lot, public.provision_event, public.evidence,
  public.claim, public.demand_signal, public.source_profile_event to authenticated;
grant insert, update on public.lot to authenticated;
grant insert on public.provision_event, public.evidence to authenticated;

do $$ declare r record; begin
  for r in select oid::regprocedure f from pg_proc where pronamespace='public'::regnamespace
    and proname in ('create_source','update_source_profile','update_source_business_profile','set_source_active',
                    'request_claim','respond_to_claim','cancel_claim','fulfil_claim',
                    'upsert_demand_signal','cancel_demand_signal','get_source_demand_summary',
                    'has_source_role','is_source_member','can_upload_provision_evidence_object') loop
    execute format('revoke all on function %s from public, anon', r.f);
    execute format('grant execute on function %s to authenticated', r.f);
  end loop;
end $$;
grant execute on function public.can_read_provision_evidence_object(text) to anon, authenticated;
