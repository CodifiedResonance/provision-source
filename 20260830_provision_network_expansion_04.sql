-- Provision Network migration 04
-- Editable Source identity, evidence, commitments, private demand aggregation,
-- and external-data ingestion foundations.
-- Additive production migration. provision_event remains append-only and
-- current_offer remains a derived projection.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1. Source roles and editable business identity
-- ---------------------------------------------------------------------------

alter table public.source add column if not exists legal_name text;
alter table public.source add column if not exists public_email text;
alter table public.source add column if not exists public_phone text;
alter table public.source add column if not exists opening_hours jsonb;
alter table public.source add column if not exists collection_notes text;
alter table public.source add column if not exists logo_path text;

create table if not exists public.source_profile_event (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.source(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null default auth.uid(),
  event_type text not null
    check (event_type in ('updated','renamed','location_updated','paused','reactivated')),
  changed_fields jsonb not null default '{}'::jsonb
    check (jsonb_typeof(changed_fields) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists source_profile_event_source_time_idx
  on public.source_profile_event (source_id, created_at desc);

create or replace function public.has_source_role(
  p_source_id uuid,
  p_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.source_member sm
      where sm.source_id = p_source_id
        and sm.user_id = auth.uid()
        and sm.member_role = any (p_roles)
    );
$$;

create or replace function public.is_source_member(p_source_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_source_role(
    p_source_id,
    array['owner','admin','editor','viewer']::text[]
  );
$$;

revoke all on function public.has_source_role(uuid,text[]) from public;
revoke all on function public.is_source_member(uuid) from public;
grant execute on function public.has_source_role(uuid,text[]) to authenticated;
grant execute on function public.is_source_member(uuid) to authenticated;

create or replace function public.prevent_source_profile_event_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'source_profile_event is append-only';
end;
$$;

drop trigger if exists source_profile_event_append_only on public.source_profile_event;
create trigger source_profile_event_append_only
before update or delete on public.source_profile_event
for each row execute function public.prevent_source_profile_event_change();

create or replace function public.prevent_source_with_history_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1 from public.provision_event pe where pe.source_id = old.id
  ) then
    raise exception 'A Source with ledger history cannot be deleted; pause it instead';
  end if;
  return old;
end;
$$;

drop trigger if exists source_preserve_ledger_history on public.source;
create trigger source_preserve_ledger_history
before delete on public.source
for each row execute function public.prevent_source_with_history_delete();

create or replace function public.update_source_business_profile(
  p_source_id uuid,
  p_patch jsonb
)
returns public.source
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_before public.source%rowtype;
  v_after public.source%rowtype;
  v_unknown text[];
  v_hours_unknown text[];
  v_changed jsonb := '{}'::jsonb;
  v_event_type text := 'updated';
  v_field text;
  v_day text;
  v_slot jsonb;
  v_old_location jsonb;
  v_new_location jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not public.has_source_role(p_source_id, array['owner','admin']::text[]) then
    raise exception 'Owner or admin role required';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Profile patch must be a JSON object';
  end if;
  if p_patch = '{}'::jsonb then
    raise exception 'Profile patch is empty';
  end if;

  select array_agg(k order by k)
  into v_unknown
  from jsonb_object_keys(p_patch) as k
  where not (k = any (array[
    'name','legal_name','source_type','description','contact_url',
    'public_email','public_phone','address_line','locality','postcode',
    'longitude','latitude','location_method','opening_hours',
    'collection_notes','logo_path'
  ]::text[]));

  if v_unknown is not null then
    raise exception 'Unsupported profile fields: %', array_to_string(v_unknown, ', ');
  end if;

  foreach v_field in array array[
    'legal_name','description','address_line','locality','postcode',
    'location_method','collection_notes'
  ]::text[] loop
    if p_patch ? v_field
       and p_patch->v_field <> 'null'::jsonb
       and jsonb_typeof(p_patch->v_field) <> 'string' then
      raise exception '% must be a string or null', v_field;
    end if;
  end loop;

  if p_patch ? 'legal_name' and char_length(coalesce(p_patch->>'legal_name','')) > 200 then
    raise exception 'Legal name is too long';
  end if;
  if p_patch ? 'description' and char_length(coalesce(p_patch->>'description','')) > 4000 then
    raise exception 'Description is too long';
  end if;
  if p_patch ? 'address_line' and char_length(coalesce(p_patch->>'address_line','')) > 500 then
    raise exception 'Address is too long';
  end if;
  if p_patch ? 'locality' and char_length(coalesce(p_patch->>'locality','')) > 200 then
    raise exception 'Locality is too long';
  end if;
  if p_patch ? 'postcode' and char_length(coalesce(p_patch->>'postcode','')) > 20 then
    raise exception 'Postcode is too long';
  end if;
  if p_patch ? 'location_method' and char_length(coalesce(p_patch->>'location_method','')) > 80 then
    raise exception 'Location method is too long';
  end if;
  if p_patch ? 'collection_notes' and char_length(coalesce(p_patch->>'collection_notes','')) > 4000 then
    raise exception 'Collection notes are too long';
  end if;

  if p_patch ? 'name' then
    if jsonb_typeof(p_patch->'name') <> 'string'
       or char_length(trim(p_patch->>'name')) not between 2 and 120 then
      raise exception 'Business name must be between 2 and 120 characters';
    end if;
  end if;

  if p_patch ? 'source_type' then
    if jsonb_typeof(p_patch->'source_type') <> 'string'
       or not ((p_patch->>'source_type') = any (array[
         'producer','retailer','market','fishmonger','butcher','bakery',
         'community','directory','public_feed','prototype'
       ]::text[])) then
      raise exception 'Unsupported business type';
    end if;
  end if;

  if p_patch ? 'public_email'
     and p_patch->'public_email' <> 'null'::jsonb
     and (
       jsonb_typeof(p_patch->'public_email') <> 'string'
       or char_length(trim(p_patch->>'public_email')) > 254
       or trim(p_patch->>'public_email') !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'
     ) then
    raise exception 'Public email is invalid';
  end if;

  if p_patch ? 'contact_url'
     and p_patch->'contact_url' <> 'null'::jsonb
     and (
       jsonb_typeof(p_patch->'contact_url') <> 'string'
       or char_length(trim(p_patch->>'contact_url')) > 500
       or trim(p_patch->>'contact_url') !~* '^https?://[^[:space:]]+$'
     ) then
    raise exception 'Website URL must be an http or https URL';
  end if;

  if p_patch ? 'public_phone'
     and p_patch->'public_phone' <> 'null'::jsonb
     and (
       jsonb_typeof(p_patch->'public_phone') <> 'string'
       or char_length(trim(p_patch->>'public_phone')) > 40
       or trim(p_patch->>'public_phone') !~ '^[0-9+() .\-]{5,40}$'
     ) then
    raise exception 'Public phone number is invalid';
  end if;

  if p_patch ? 'logo_path'
     and p_patch->'logo_path' <> 'null'::jsonb
     and (
       jsonb_typeof(p_patch->'logo_path') <> 'string'
       or char_length(trim(p_patch->>'logo_path')) > 500
       or position('..' in p_patch->>'logo_path') > 0
     ) then
    raise exception 'Logo path is invalid';
  end if;

  if p_patch ? 'opening_hours' and p_patch->'opening_hours' <> 'null'::jsonb then
    if jsonb_typeof(p_patch->'opening_hours') <> 'object'
       or octet_length((p_patch->'opening_hours')::text) > 16384 then
      raise exception 'Opening hours must be a JSON object smaller than 16KB';
    end if;

    select array_agg(k order by k)
    into v_hours_unknown
    from jsonb_object_keys(p_patch->'opening_hours') as k
    where not (k = any (array[
      'monday','tuesday','wednesday','thursday','friday','saturday','sunday',
      'timezone','notes'
    ]::text[]));

    if v_hours_unknown is not null then
      raise exception 'Unsupported opening-hours fields: %',
        array_to_string(v_hours_unknown, ', ');
    end if;

    foreach v_day in array array[
      'monday','tuesday','wednesday','thursday','friday','saturday','sunday'
    ]::text[] loop
      if (p_patch->'opening_hours') ? v_day
         and p_patch->'opening_hours'->v_day <> 'null'::jsonb then
        if jsonb_typeof(p_patch->'opening_hours'->v_day) <> 'array' then
          raise exception 'Opening hours for % must be an array or null', v_day;
        end if;
        for v_slot in
          select value from jsonb_array_elements(p_patch->'opening_hours'->v_day)
        loop
          if jsonb_typeof(v_slot) <> 'object'
             or not (v_slot ? 'open' and v_slot ? 'close')
             or jsonb_typeof(v_slot->'open') <> 'string'
             or jsonb_typeof(v_slot->'close') <> 'string'
             or v_slot->>'open' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
             or v_slot->>'close' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          then
            raise exception 'Each opening-hours slot must contain valid HH:MM open and close values';
          end if;
        end loop;
      end if;
    end loop;

    if (p_patch->'opening_hours') ? 'timezone'
       and jsonb_typeof(p_patch->'opening_hours'->'timezone') <> 'string' then
      raise exception 'Opening-hours timezone must be a string';
    end if;
    if (p_patch->'opening_hours') ? 'notes'
       and jsonb_typeof(p_patch->'opening_hours'->'notes') <> 'string' then
      raise exception 'Opening-hours notes must be a string';
    end if;
  end if;

  if (p_patch ? 'longitude') <> (p_patch ? 'latitude') then
    raise exception 'Longitude and latitude must be supplied together';
  end if;
  if p_patch ? 'longitude' then
    if p_patch->'longitude' = 'null'::jsonb and p_patch->'latitude' = 'null'::jsonb then
      null;
    elsif jsonb_typeof(p_patch->'longitude') <> 'number'
       or jsonb_typeof(p_patch->'latitude') <> 'number' then
      raise exception 'Longitude and latitude must both be numbers or null';
    elsif (p_patch->>'longitude')::double precision not between -180 and 180 then
      raise exception 'Longitude out of range';
    elsif (p_patch->>'latitude')::double precision not between -90 and 90 then
      raise exception 'Latitude out of range';
    end if;
  end if;

  select * into v_before
  from public.source
  where id = p_source_id
  for update;

  if not found then
    raise exception 'Source not found';
  end if;

  update public.source
  set
    name = case when p_patch ? 'name' then trim(p_patch->>'name') else name end,
    legal_name = case when p_patch ? 'legal_name' then nullif(trim(p_patch->>'legal_name'),'') else legal_name end,
    source_type = case when p_patch ? 'source_type' then p_patch->>'source_type' else source_type end,
    description = case when p_patch ? 'description' then nullif(trim(p_patch->>'description'),'') else description end,
    contact_url = case when p_patch ? 'contact_url' then nullif(trim(p_patch->>'contact_url'),'') else contact_url end,
    public_email = case when p_patch ? 'public_email' then nullif(lower(trim(p_patch->>'public_email')),'') else public_email end,
    public_phone = case when p_patch ? 'public_phone' then nullif(trim(p_patch->>'public_phone'),'') else public_phone end,
    address_line = case when p_patch ? 'address_line' then nullif(trim(p_patch->>'address_line'),'') else address_line end,
    locality = case when p_patch ? 'locality' then nullif(trim(p_patch->>'locality'),'') else locality end,
    postcode = case when p_patch ? 'postcode' then nullif(upper(trim(p_patch->>'postcode')),'') else postcode end,
    opening_hours = case when p_patch ? 'opening_hours' then p_patch->'opening_hours' else opening_hours end,
    collection_notes = case when p_patch ? 'collection_notes' then nullif(trim(p_patch->>'collection_notes'),'') else collection_notes end,
    logo_path = case when p_patch ? 'logo_path' then nullif(trim(p_patch->>'logo_path'),'') else logo_path end,
    location = case
      when not (p_patch ? 'longitude') then location
      when p_patch->'longitude' = 'null'::jsonb then null
      else extensions.st_setsrid(
        extensions.st_makepoint(
          (p_patch->>'longitude')::double precision,
          (p_patch->>'latitude')::double precision
        ), 4326
      )::extensions.geography
    end,
    metadata = case
      when p_patch ? 'location_method' then
        metadata || jsonb_build_object(
          'location_method', nullif(trim(p_patch->>'location_method'),''),
          'location_updated_at', now()
        )
      else metadata
    end
  where id = p_source_id
  returning * into v_after;

  if v_before.name is distinct from v_after.name then
    v_changed := v_changed || jsonb_build_object('name', jsonb_build_object('from',v_before.name,'to',v_after.name));
  end if;
  if v_before.legal_name is distinct from v_after.legal_name then
    v_changed := v_changed || jsonb_build_object('legal_name', jsonb_build_object('from',v_before.legal_name,'to',v_after.legal_name));
  end if;
  if v_before.source_type is distinct from v_after.source_type then
    v_changed := v_changed || jsonb_build_object('source_type', jsonb_build_object('from',v_before.source_type,'to',v_after.source_type));
  end if;
  if v_before.description is distinct from v_after.description then
    v_changed := v_changed || jsonb_build_object('description', jsonb_build_object('from',v_before.description,'to',v_after.description));
  end if;
  if v_before.contact_url is distinct from v_after.contact_url then
    v_changed := v_changed || jsonb_build_object('contact_url', jsonb_build_object('from',v_before.contact_url,'to',v_after.contact_url));
  end if;
  if v_before.public_email is distinct from v_after.public_email then
    v_changed := v_changed || jsonb_build_object('public_email', jsonb_build_object('from',v_before.public_email,'to',v_after.public_email));
  end if;
  if v_before.public_phone is distinct from v_after.public_phone then
    v_changed := v_changed || jsonb_build_object('public_phone', jsonb_build_object('from',v_before.public_phone,'to',v_after.public_phone));
  end if;
  if v_before.address_line is distinct from v_after.address_line then
    v_changed := v_changed || jsonb_build_object('address_line', jsonb_build_object('from',v_before.address_line,'to',v_after.address_line));
  end if;
  if v_before.locality is distinct from v_after.locality then
    v_changed := v_changed || jsonb_build_object('locality', jsonb_build_object('from',v_before.locality,'to',v_after.locality));
  end if;
  if v_before.postcode is distinct from v_after.postcode then
    v_changed := v_changed || jsonb_build_object('postcode', jsonb_build_object('from',v_before.postcode,'to',v_after.postcode));
  end if;
  if v_before.opening_hours is distinct from v_after.opening_hours then
    v_changed := v_changed || jsonb_build_object('opening_hours', jsonb_build_object('from',v_before.opening_hours,'to',v_after.opening_hours));
  end if;
  if v_before.collection_notes is distinct from v_after.collection_notes then
    v_changed := v_changed || jsonb_build_object('collection_notes', jsonb_build_object('from',v_before.collection_notes,'to',v_after.collection_notes));
  end if;
  if v_before.logo_path is distinct from v_after.logo_path then
    v_changed := v_changed || jsonb_build_object('logo_path', jsonb_build_object('from',v_before.logo_path,'to',v_after.logo_path));
  end if;

  if v_before.location is null then
    v_old_location := null;
  else
    v_old_location := jsonb_build_object(
      'longitude', extensions.st_x(v_before.location::extensions.geometry),
      'latitude', extensions.st_y(v_before.location::extensions.geometry)
    );
  end if;
  if v_after.location is null then
    v_new_location := null;
  else
    v_new_location := jsonb_build_object(
      'longitude', extensions.st_x(v_after.location::extensions.geometry),
      'latitude', extensions.st_y(v_after.location::extensions.geometry)
    );
  end if;
  if v_old_location is distinct from v_new_location then
    v_changed := v_changed || jsonb_build_object('location', jsonb_build_object('from',v_old_location,'to',v_new_location));
  end if;

  if v_changed <> '{}'::jsonb or p_patch ? 'location_method' then
    if v_before.name is distinct from v_after.name then
      v_event_type := 'renamed';
    elsif v_before.location is distinct from v_after.location
       or v_before.address_line is distinct from v_after.address_line
       or v_before.locality is distinct from v_after.locality
       or v_before.postcode is distinct from v_after.postcode
       or p_patch ? 'location_method' then
      v_event_type := 'location_updated';
    end if;

    if p_patch ? 'location_method' then
      v_changed := v_changed || jsonb_build_object(
        'location_method', jsonb_build_object(
          'from', v_before.metadata->'location_method',
          'to', v_after.metadata->'location_method'
        )
      );
    end if;

    insert into public.source_profile_event (
      source_id, actor_user_id, event_type, changed_fields
    ) values (
      p_source_id, auth.uid(), v_event_type, v_changed
    );
  end if;

  return v_after;
end;
$$;

create or replace function public.set_source_active(
  p_source_id uuid,
  p_active boolean
)
returns public.source
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.source%rowtype;
  v_after public.source%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not public.has_source_role(p_source_id, array['owner','admin']::text[]) then
    raise exception 'Owner or admin role required';
  end if;
  if p_active is null then
    raise exception 'Active state is required';
  end if;

  select * into v_before
  from public.source
  where id = p_source_id
  for update;

  if not found then
    raise exception 'Source not found';
  end if;

  if v_before.active = p_active then
    return v_before;
  end if;

  update public.source
  set active = p_active
  where id = p_source_id
  returning * into v_after;

  insert into public.source_profile_event (
    source_id, actor_user_id, event_type, changed_fields
  ) values (
    p_source_id,
    auth.uid(),
    case when p_active then 'reactivated' else 'paused' end,
    jsonb_build_object('active', jsonb_build_object('from',v_before.active,'to',v_after.active))
  );

  return v_after;
end;
$$;

-- Preserve the previous Source location RPC signature while enforcing the new
-- owner/admin business-profile permission model.
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
set search_path = public
as $$
declare
  v_patch jsonb := '{}'::jsonb;
begin
  if (p_longitude is null) <> (p_latitude is null) then
    raise exception 'Longitude and latitude must be supplied together';
  end if;
  if p_address_line is not null then v_patch := v_patch || jsonb_build_object('address_line',p_address_line); end if;
  if p_locality is not null then v_patch := v_patch || jsonb_build_object('locality',p_locality); end if;
  if p_postcode is not null then v_patch := v_patch || jsonb_build_object('postcode',p_postcode); end if;
  if p_longitude is not null then
    v_patch := v_patch || jsonb_build_object('longitude',p_longitude,'latitude',p_latitude);
  end if;
  if p_location_method is not null then
    v_patch := v_patch || jsonb_build_object('location_method',p_location_method);
  end if;
  if v_patch = '{}'::jsonb then
    return;
  end if;
  perform public.update_source_business_profile(p_source_id,v_patch);
end;
$$;

revoke all on function public.update_source_business_profile(uuid,jsonb) from public;
revoke all on function public.set_source_active(uuid,boolean) from public;
revoke all on function public.update_source_profile(uuid,text,text,text,double precision,double precision,text) from public;
grant execute on function public.update_source_business_profile(uuid,jsonb) to authenticated;
grant execute on function public.set_source_active(uuid,boolean) to authenticated;
grant execute on function public.update_source_profile(uuid,text,text,text,double precision,double precision,text) to authenticated;

create or replace view public.source_profiles
with (security_invoker = true)
as
select
  s.id,
  s.slug,
  s.name,
  s.legal_name,
  s.source_type,
  s.description,
  s.contact_url,
  s.public_email,
  s.public_phone,
  s.address_line,
  s.locality,
  s.postcode,
  extensions.st_y(s.location::extensions.geometry) as latitude,
  extensions.st_x(s.location::extensions.geometry) as longitude,
  s.opening_hours,
  s.collection_notes,
  s.logo_path,
  s.verified,
  s.active,
  s.created_at,
  s.updated_at
from public.source s;

alter table public.source_profile_event enable row level security;

drop policy if exists source_public_read on public.source;
drop policy if exists source_member_update on public.source;
create policy source_public_or_member_read on public.source for select
to anon, authenticated
using (active or public.is_source_member(id));

drop policy if exists source_profile_event_member_read on public.source_profile_event;
create policy source_profile_event_member_read on public.source_profile_event for select
to authenticated
using (public.is_source_member(source_id));

revoke insert, update, delete on public.source from anon, authenticated;
grant select on public.source, public.source_profiles to anon, authenticated;
revoke all on public.source_profile_event from anon, authenticated;
grant select on public.source_profile_event to authenticated;

-- Generic membership was previously enough to write lots. Keep viewers
-- read-only and allow the three operational roles to manage lots.
drop policy if exists lot_member_insert on public.lot;
drop policy if exists lot_member_update on public.lot;
create policy lot_operator_insert on public.lot for insert
to authenticated
with check (
  public.has_source_role(source_id,array['owner','admin','editor']::text[])
  and created_by = auth.uid()
);
create policy lot_operator_update on public.lot for update
to authenticated
using (public.has_source_role(source_id,array['owner','admin','editor']::text[]))
with check (public.has_source_role(source_id,array['owner','admin','editor']::text[]));

drop policy if exists provision_event_member_insert on public.provision_event;
create policy provision_event_operator_insert on public.provision_event for insert
to authenticated
with check (
  public.has_source_role(source_id,array['owner','admin','editor']::text[])
  and actor_user_id = auth.uid()
  and exists (
    select 1 from public.source s where s.id = source_id and s.active
  )
);

revoke update, delete on public.provision_event from anon, authenticated;
revoke insert on public.provision_event from anon;
grant select, insert on public.provision_event to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Evidence records and private object storage
-- ---------------------------------------------------------------------------

alter table public.evidence add column if not exists observed_at timestamptz;
alter table public.evidence add column if not exists valid_until timestamptz;
alter table public.evidence add column if not exists caption text;
alter table public.evidence add column if not exists metadata jsonb;

update public.evidence
set
  observed_at = coalesce(observed_at,created_at),
  metadata = coalesce(metadata,'{}'::jsonb)
where observed_at is null or metadata is null;

alter table public.evidence alter column observed_at set default now();
alter table public.evidence alter column observed_at set not null;
alter table public.evidence alter column metadata set default '{}'::jsonb;
alter table public.evidence alter column metadata set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.evidence'::regclass
      and conname='evidence_validity_check'
  ) then
    alter table public.evidence add constraint evidence_validity_check
      check (valid_until is null or valid_until > observed_at);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.evidence'::regclass
      and conname='evidence_metadata_object_check'
  ) then
    alter table public.evidence add constraint evidence_metadata_object_check
      check (jsonb_typeof(metadata)='object');
  end if;
end
$$;

create index if not exists evidence_event_time_idx
  on public.evidence (provision_event_id, observed_at desc);
create index if not exists evidence_public_validity_idx
  on public.evidence (valid_until)
  where is_public;

create or replace function public.validate_evidence_link()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.provision_event pe
    where pe.id = new.provision_event_id
      and pe.source_id = new.source_id
  ) then
    raise exception 'Evidence source must match the immutable Provision event source';
  end if;
  return new;
end;
$$;

drop trigger if exists evidence_validate_link on public.evidence;
create trigger evidence_validate_link
before insert on public.evidence
for each row execute function public.validate_evidence_link();

drop policy if exists evidence_member_insert on public.evidence;
create policy evidence_operator_insert on public.evidence for insert
to authenticated
with check (
  public.has_source_role(source_id,array['owner','admin','editor']::text[])
  and submitted_by = auth.uid()
  and exists (
    select 1 from public.provision_event pe
    where pe.id = provision_event_id and pe.source_id = source_id
  )
);

revoke update, delete on public.evidence from anon, authenticated;
revoke insert on public.evidence from anon;
grant select on public.evidence to authenticated;
grant insert on public.evidence to authenticated;
grant select (
  id,source_id,provision_event_id,evidence_type,observed_at,valid_until,
  caption,status,storage_path,external_url,created_at,is_public
) on public.evidence to anon;

create or replace view public.public_evidence
with (security_invoker = true)
as
select
  e.id,
  e.source_id,
  e.provision_event_id,
  e.evidence_type,
  e.observed_at,
  e.valid_until,
  e.caption,
  e.status,
  e.storage_path,
  e.external_url,
  e.created_at,
  (e.valid_until is null or e.valid_until > now()) as temporally_current
from public.evidence e
where e.is_public;

grant select on public.public_evidence to anon, authenticated;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values (
  'provision-evidence',
  'provision-evidence',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','application/pdf']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_upload_provision_evidence_object(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_source_id uuid;
  v_event_id uuid;
begin
  if p_name !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$' then
    return false;
  end if;
  v_source_id := split_part(p_name,'/',1)::uuid;
  v_event_id := split_part(p_name,'/',2)::uuid;
  return public.has_source_role(v_source_id,array['owner','admin','editor']::text[])
    and exists (
      select 1 from public.provision_event pe
      where pe.id=v_event_id and pe.source_id=v_source_id
    );
exception when others then
  return false;
end;
$$;

create or replace function public.can_read_provision_evidence_object(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_source_id uuid;
begin
  if p_name !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' then
    return false;
  end if;
  v_source_id := split_part(p_name,'/',1)::uuid;
  return public.is_source_member(v_source_id)
    or exists (
      select 1
      from public.evidence e
      where e.storage_path=p_name and e.is_public
    );
exception when others then
  return false;
end;
$$;

revoke all on function public.can_upload_provision_evidence_object(text) from public;
revoke all on function public.can_read_provision_evidence_object(text) from public;
grant execute on function public.can_upload_provision_evidence_object(text) to authenticated;
grant execute on function public.can_read_provision_evidence_object(text) to anon, authenticated;

drop policy if exists provision_evidence_insert on storage.objects;
drop policy if exists provision_evidence_read on storage.objects;
create policy provision_evidence_insert on storage.objects for insert
to authenticated
with check (
  bucket_id='provision-evidence'
  and public.can_upload_provision_evidence_object(name)
);
create policy provision_evidence_read on storage.objects for select
to anon, authenticated
using (
  bucket_id='provision-evidence'
  and public.can_read_provision_evidence_object(name)
);

-- Intentionally no UPDATE or DELETE storage policies: evidence objects cannot
-- be overwritten or deleted by clients. New evidence creates a new object.

-- ---------------------------------------------------------------------------
-- 3. Claims as an atomic commitment layer
-- ---------------------------------------------------------------------------

alter table public.claim add column if not exists expires_at timestamptz;
alter table public.claim add column if not exists responded_at timestamptz;
alter table public.claim add column if not exists fulfilled_at timestamptz;
alter table public.claim add column if not exists cancelled_at timestamptz;

alter table public.current_offer
  add column if not exists reserved_quantity numeric not null default 0;
alter table public.current_offer
  add column if not exists accepted_claim_count integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.current_offer'::regclass
      and conname='current_offer_reserved_quantity_check'
  ) then
    alter table public.current_offer add constraint current_offer_reserved_quantity_check
      check (reserved_quantity >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.current_offer'::regclass
      and conname='current_offer_accepted_claim_count_check'
  ) then
    alter table public.current_offer add constraint current_offer_accepted_claim_count_check
      check (accepted_claim_count >= 0);
  end if;
end
$$;

create index if not exists claim_offer_status_idx
  on public.claim (current_offer_id,status);
create index if not exists claim_source_created_idx
  on public.claim (source_id,created_at desc);
create index if not exists claim_claimant_created_idx
  on public.claim (claimant_user_id,created_at desc);

create or replace function public.refresh_offer_commitments(p_current_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.current_offer co
  set
    reserved_quantity = x.reserved_quantity,
    accepted_claim_count = x.accepted_claim_count,
    updated_at = now()
  from (
    select
      co2.id,
      coalesce(sum(c.quantity) filter (
        where c.status='accepted'
          and (c.expires_at is null or c.expires_at > now())
      ),0) as reserved_quantity,
      count(c.id) filter (
        where c.status='accepted'
          and (c.expires_at is null or c.expires_at > now())
      )::integer as accepted_claim_count
    from public.current_offer co2
    left join public.claim c on c.current_offer_id=co2.id
    where co2.id=p_current_offer_id
    group by co2.id
  ) x
  where co.id=x.id
    and (
      co.reserved_quantity is distinct from x.reserved_quantity
      or co.accepted_claim_count is distinct from x.accepted_claim_count
    );
end;
$$;

create or replace function public.claim_refresh_offer_commitments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op='DELETE' then
    perform public.refresh_offer_commitments(old.current_offer_id);
    return old;
  end if;
  perform public.refresh_offer_commitments(new.current_offer_id);
  if tg_op='UPDATE' and old.current_offer_id is distinct from new.current_offer_id then
    perform public.refresh_offer_commitments(old.current_offer_id);
  end if;
  return new;
end;
$$;

drop trigger if exists claim_refresh_offer_projection on public.claim;
create trigger claim_refresh_offer_projection
after insert or update of status,quantity,current_offer_id,expires_at or delete on public.claim
for each row execute function public.claim_refresh_offer_commitments();

-- Backfill commitment projections without touching physical offer quantity.
do $$
declare v_offer_id uuid;
begin
  for v_offer_id in select id from public.current_offer loop
    perform public.refresh_offer_commitments(v_offer_id);
  end loop;
end
$$;

create or replace function public.request_claim(
  p_current_offer_id uuid,
  p_quantity numeric,
  p_expires_at timestamptz default null,
  p_collection_window_start timestamptz default null,
  p_collection_window_end timestamptz default null,
  p_note text default null
)
returns public.claim
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.current_offer%rowtype;
  v_claim public.claim%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Claim quantity must be greater than zero'; end if;
  if p_expires_at is not null and p_expires_at <= now() then raise exception 'Claim expiry must be in the future'; end if;
  if p_collection_window_start is not null and p_collection_window_end is not null
     and p_collection_window_end <= p_collection_window_start then
    raise exception 'Collection window end must be after its start';
  end if;

  select * into v_offer
  from public.current_offer
  where id=p_current_offer_id
  for share;

  if not found then raise exception 'Offer not found'; end if;
  if not v_offer.is_active or coalesce(v_offer.quantity,0) <= 0
     or (v_offer.valid_until is not null and v_offer.valid_until <= now()) then
    raise exception 'Offer is not active';
  end if;
  if p_quantity > v_offer.quantity then
    raise exception 'Claim quantity exceeds physical offer quantity';
  end if;

  insert into public.claim (
    current_offer_id,source_id,claimant_user_id,quantity,status,
    expires_at,collection_window_start,collection_window_end,note
  ) values (
    v_offer.id,v_offer.source_id,auth.uid(),p_quantity,'requested',
    p_expires_at,p_collection_window_start,p_collection_window_end,nullif(trim(p_note),'')
  ) returning * into v_claim;

  return v_claim;
end;
$$;

create or replace function public.respond_to_claim(
  p_claim_id uuid,
  p_accept boolean
)
returns public.claim
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.claim%rowtype;
  v_offer public.current_offer%rowtype;
  v_reserved numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_accept is null then raise exception 'A response is required'; end if;

  select * into v_claim from public.claim where id=p_claim_id for update;
  if not found then raise exception 'Claim not found'; end if;
  if not public.has_source_role(v_claim.source_id,array['owner','admin','editor']::text[]) then
    raise exception 'Source operator role required';
  end if;
  if v_claim.status <> 'requested' then
    raise exception 'Only requested claims may be accepted or declined';
  end if;
  if v_claim.expires_at is not null and v_claim.expires_at <= now() then
    raise exception 'Claim has expired';
  end if;

  select * into v_offer
  from public.current_offer
  where id=v_claim.current_offer_id
  for update;

  if not found or v_offer.source_id <> v_claim.source_id then
    raise exception 'Claim offer is invalid';
  end if;

  if p_accept then
    if not v_offer.is_active or coalesce(v_offer.quantity,0) <= 0
       or (v_offer.valid_until is not null and v_offer.valid_until <= now()) then
      raise exception 'Offer is not active';
    end if;
    select coalesce(sum(quantity),0) into v_reserved
    from public.claim
    where current_offer_id=v_offer.id
      and status='accepted'
      and (expires_at is null or expires_at > now());
    if v_claim.quantity > greatest(coalesce(v_offer.quantity,0)-v_reserved,0) then
      raise exception 'Claim exceeds remaining uncommitted quantity';
    end if;
    update public.claim
    set status='accepted',responded_at=now()
    where id=v_claim.id
    returning * into v_claim;
  else
    update public.claim
    set status='declined',responded_at=now()
    where id=v_claim.id
    returning * into v_claim;
  end if;

  return v_claim;
end;
$$;

create or replace function public.cancel_claim(p_claim_id uuid)
returns public.claim
language plpgsql
security definer
set search_path = public
as $$
declare v_claim public.claim%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_claim from public.claim where id=p_claim_id for update;
  if not found then raise exception 'Claim not found'; end if;
  if v_claim.claimant_user_id <> auth.uid() then raise exception 'Only the claimant may cancel this claim'; end if;
  if v_claim.status not in ('requested','accepted') then
    raise exception 'Only requested or accepted claims may be cancelled';
  end if;
  update public.claim
  set status='cancelled',cancelled_at=now()
  where id=v_claim.id
  returning * into v_claim;
  return v_claim;
end;
$$;

create or replace function public.fulfil_claim(p_claim_id uuid)
returns public.claim
language plpgsql
security definer
set search_path = public
as $$
declare v_claim public.claim%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_claim from public.claim where id=p_claim_id for update;
  if not found then raise exception 'Claim not found'; end if;
  if not public.has_source_role(v_claim.source_id,array['owner','admin','editor']::text[]) then
    raise exception 'Source operator role required';
  end if;
  if v_claim.status <> 'accepted' then raise exception 'Only accepted claims may be fulfilled'; end if;
  update public.claim
  set status='fulfilled',fulfilled_at=now(),responded_at=coalesce(responded_at,now())
  where id=v_claim.id
  returning * into v_claim;
  return v_claim;
end;
$$;

drop policy if exists claim_owner_insert on public.claim;
drop policy if exists claim_owner_or_source_update on public.claim;
drop policy if exists claim_owner_or_source_read on public.claim;
create policy claim_owner_or_source_read on public.claim for select
to authenticated
using (claimant_user_id=auth.uid() or public.is_source_member(source_id));

revoke insert, update, delete on public.claim from anon, authenticated;
grant select on public.claim to authenticated;

revoke all on function public.refresh_offer_commitments(uuid) from public;
revoke all on function public.request_claim(uuid,numeric,timestamptz,timestamptz,timestamptz,text) from public;
revoke all on function public.respond_to_claim(uuid,boolean) from public;
revoke all on function public.cancel_claim(uuid) from public;
revoke all on function public.fulfil_claim(uuid) from public;
grant execute on function public.request_claim(uuid,numeric,timestamptz,timestamptz,timestamptz,text) to authenticated;
grant execute on function public.respond_to_claim(uuid,boolean) to authenticated;
grant execute on function public.cancel_claim(uuid) to authenticated;
grant execute on function public.fulfil_claim(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Private demand signals and thresholded Source summaries
-- ---------------------------------------------------------------------------

alter table public.demand_signal add column if not exists updated_at timestamptz;
update public.demand_signal set updated_at=coalesce(updated_at,created_at) where updated_at is null;
alter table public.demand_signal alter column updated_at set default now();
alter table public.demand_signal alter column updated_at set not null;

drop trigger if exists demand_signal_set_updated_at on public.demand_signal;
create trigger demand_signal_set_updated_at
before update on public.demand_signal
for each row execute function public.set_updated_at();

create unique index if not exists demand_signal_one_active_per_user_food_cadence
  on public.demand_signal (user_id,food_id,(coalesce(cadence,'once')))
  where active;

create index if not exists demand_signal_active_location_idx
  on public.demand_signal using gist (location)
  where active and location is not null;

create or replace function public.upsert_demand_signal(
  p_food_id uuid,
  p_quantity numeric,
  p_unit text,
  p_cadence text,
  p_max_price numeric default null,
  p_longitude double precision default null,
  p_latitude double precision default null,
  p_valid_until timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.food f where f.id=p_food_id and f.active) then
    raise exception 'Active food not found';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Desired quantity must be greater than zero'; end if;
  if nullif(trim(p_unit),'') is null or char_length(trim(p_unit)) > 40 then raise exception 'Unit is required'; end if;
  if p_cadence is null or p_cadence not in ('once','daily','weekly','fortnightly','monthly') then
    raise exception 'Unsupported cadence';
  end if;
  if p_max_price is not null and p_max_price < 0 then raise exception 'Maximum price cannot be negative'; end if;
  if (p_longitude is null) <> (p_latitude is null) then raise exception 'Longitude and latitude must be supplied together'; end if;
  if p_longitude is not null and p_longitude not between -180 and 180 then raise exception 'Longitude out of range'; end if;
  if p_latitude is not null and p_latitude not between -90 and 90 then raise exception 'Latitude out of range'; end if;
  if p_valid_until is not null and p_valid_until <= now() then raise exception 'Demand validity must end in the future'; end if;

  insert into public.demand_signal (
    food_id,user_id,location,radius_m,desired_quantity,unit,cadence,
    max_price,active,valid_until,metadata
  ) values (
    p_food_id,
    auth.uid(),
    case when p_longitude is null then null else
      extensions.st_setsrid(extensions.st_makepoint(p_longitude,p_latitude),4326)::extensions.geography
    end,
    10000,
    p_quantity,
    trim(p_unit),
    p_cadence,
    p_max_price,
    true,
    p_valid_until,
    '{}'::jsonb
  )
  on conflict (user_id,food_id,(coalesce(cadence,'once'))) where active
  do update set
    location=excluded.location,
    radius_m=excluded.radius_m,
    desired_quantity=excluded.desired_quantity,
    unit=excluded.unit,
    max_price=excluded.max_price,
    valid_until=excluded.valid_until,
    metadata=excluded.metadata,
    updated_at=now()
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.cancel_demand_signal(p_demand_signal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.demand_signal
  set active=false,updated_at=now()
  where id=p_demand_signal_id and user_id=auth.uid() and active;
  if not found then raise exception 'Active demand signal not found'; end if;
end;
$$;

create or replace function public.get_source_demand_summary(p_source_id uuid)
returns table (
  food_id uuid,
  food_name text,
  band_km integer,
  household_count bigint,
  desired_quantity numeric,
  unit text,
  cadence text,
  average_max_price numeric
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if auth.uid() is null or not public.is_source_member(p_source_id) then
    raise exception 'Source membership required';
  end if;
  if not exists (select 1 from public.source s where s.id=p_source_id and s.location is not null) then
    raise exception 'Source location is required for demand summaries';
  end if;

  return query
  with src as (
    select s.location from public.source s where s.id=p_source_id
  ),
  bands(band_km,meters) as (
    values (3,3000::double precision),(5,5000::double precision),(10,10000::double precision)
  ),
  eligible as (
    select
      ds.food_id,
      f.common_name as food_name,
      b.band_km,
      ds.user_id,
      ds.desired_quantity,
      ds.unit,
      ds.cadence,
      ds.max_price
    from src s
    cross join bands b
    join public.demand_signal ds
      on ds.active
     and ds.location is not null
     and (ds.valid_until is null or ds.valid_until > now())
     and extensions.st_dwithin(ds.location,s.location,b.meters)
    join public.food f on f.id=ds.food_id and f.active
  )
  select
    e.food_id,
    e.food_name,
    e.band_km,
    count(distinct e.user_id) as household_count,
    sum(e.desired_quantity) as desired_quantity,
    e.unit,
    e.cadence,
    case when count(e.max_price) >= 3 then round(avg(e.max_price),2) else null end as average_max_price
  from eligible e
  group by e.food_id,e.food_name,e.band_km,e.unit,e.cadence
  having count(distinct e.user_id) >= 3
  order by e.band_km,e.food_name,e.cadence,e.unit;
end;
$$;

drop policy if exists demand_signal_owner_insert on public.demand_signal;
drop policy if exists demand_signal_owner_update on public.demand_signal;
drop policy if exists demand_signal_owner_read on public.demand_signal;
create policy demand_signal_owner_read on public.demand_signal for select
to authenticated
using (user_id=auth.uid());

revoke insert, update, delete on public.demand_signal from anon, authenticated;
grant select on public.demand_signal to authenticated;

revoke all on function public.upsert_demand_signal(uuid,numeric,text,text,numeric,double precision,double precision,timestamptz) from public;
revoke all on function public.cancel_demand_signal(uuid) from public;
revoke all on function public.get_source_demand_summary(uuid) from public;
grant execute on function public.upsert_demand_signal(uuid,numeric,text,text,numeric,double precision,double precision,timestamptz) to authenticated;
grant execute on function public.cancel_demand_signal(uuid) to authenticated;
grant execute on function public.get_source_demand_summary(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Public/live ingestion foundation
-- ---------------------------------------------------------------------------

create table if not exists public.data_feed (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  provider text not null,
  feed_name text not null,
  feed_type text not null check (feed_type in ('topology','context','offer','safety','routing')),
  attribution text,
  licence_name text,
  licence_url text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists data_feed_set_updated_at on public.data_feed;
create trigger data_feed_set_updated_at
before update on public.data_feed
for each row execute function public.set_updated_at();

create table if not exists public.ingestion_run (
  id uuid primary key default gen_random_uuid(),
  feed_id uuid not null references public.data_feed(id) on delete restrict,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'running'
    check (status in ('queued','running','succeeded','partial','failed')),
  records_seen integer not null default 0 check (records_seen >= 0),
  records_inserted integer not null default 0 check (records_inserted >= 0),
  records_updated integer not null default 0 check (records_updated >= 0),
  safe_error_summary text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

create index if not exists ingestion_run_feed_started_idx
  on public.ingestion_run (feed_id,started_at desc);

create table if not exists public.external_source_ref (
  id uuid primary key default gen_random_uuid(),
  feed_id uuid not null references public.data_feed(id) on delete restrict,
  external_id text not null,
  source_id uuid not null references public.source(id) on delete restrict,
  external_url text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (feed_id,external_id)
);

create index if not exists external_source_ref_source_idx
  on public.external_source_ref (source_id);

create table if not exists public.context_observation (
  id uuid primary key default gen_random_uuid(),
  feed_id uuid not null references public.data_feed(id) on delete restrict,
  external_record_id text,
  observation_type text not null,
  food_id uuid references public.food(id) on delete restrict,
  source_id uuid references public.source(id) on delete restrict,
  location extensions.geography(Point,4326),
  observed_at timestamptz not null,
  valid_until timestamptz,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object'),
  created_at timestamptz not null default now(),
  check (valid_until is null or valid_until > observed_at)
);

create unique index if not exists context_observation_feed_external_uidx
  on public.context_observation (feed_id,external_record_id)
  where external_record_id is not null;
create index if not exists context_observation_type_time_idx
  on public.context_observation (observation_type,observed_at desc);
create index if not exists context_observation_validity_idx
  on public.context_observation (valid_until)
  where valid_until is not null;

create or replace function public.prevent_context_observation_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'context_observation is append-only; add a newer observation instead';
end;
$$;

drop trigger if exists context_observation_append_only on public.context_observation;
create trigger context_observation_append_only
before update or delete on public.context_observation
for each row execute function public.prevent_context_observation_change();

alter table public.data_feed enable row level security;
alter table public.ingestion_run enable row level security;
alter table public.external_source_ref enable row level security;
alter table public.context_observation enable row level security;

drop policy if exists data_feed_public_read on public.data_feed;
create policy data_feed_public_read on public.data_feed for select
to anon, authenticated
using (active);

revoke all on public.data_feed, public.ingestion_run,
  public.external_source_ref, public.context_observation from anon, authenticated;
grant select on public.data_feed to anon, authenticated;

insert into public.data_feed (
  slug,provider,feed_name,feed_type,attribution,licence_name,licence_url,metadata
)
values
  (
    'food-standards-agency',
    'Food Standards Agency',
    'Food hygiene ratings and approved establishment topology',
    'topology',
    'Contains public sector information licensed under the Open Government Licence.',
    'Open Government Licence',
    'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
    '{"intended_rail":"source topology and safety context","creates_offer":false}'::jsonb
  ),
  (
    'openstreetmap',
    'OpenStreetMap contributors',
    'OpenStreetMap food-place topology',
    'topology',
    '© OpenStreetMap contributors',
    'Open Data Commons Open Database License',
    'https://www.openstreetmap.org/copyright',
    '{"intended_rail":"source and access topology","creates_offer":false}'::jsonb
  ),
  (
    'met-office',
    'Met Office',
    'Weather observations, forecasts and warnings',
    'context',
    'Met Office data subject to the licence applicable to the configured feed.',
    null,
    null,
    '{"intended_rail":"weather and perishability context","creates_offer":false}'::jsonb
  )
on conflict (slug) do update set
  provider=excluded.provider,
  feed_name=excluded.feed_name,
  feed_type=excluded.feed_type,
  attribution=excluded.attribution,
  licence_name=excluded.licence_name,
  licence_url=excluded.licence_url,
  metadata=public.data_feed.metadata || excluded.metadata,
  active=true,
  updated_at=now();

-- ---------------------------------------------------------------------------
-- 6. Public projection, provenance and Realtime
-- ---------------------------------------------------------------------------

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
  case
    when co.update_channel='source_direct' then s.name
    else co.update_label
  end as update_label,
  co.update_authenticated,
  s.contact_url as source_contact_url,
  commitments.reserved_quantity,
  commitments.accepted_claim_count,
  greatest(coalesce(co.quantity,0)-commitments.reserved_quantity,0) as available_to_claim
from public.current_offer co
join public.source s on s.id=co.source_id
join public.food f on f.id=co.food_id
left join lateral (
  select
    coalesce(sum(c.quantity),0) as reserved_quantity,
    count(c.id)::integer as accepted_claim_count
  from public.claim c
  where c.current_offer_id=co.id
    and c.status='accepted'
    and (c.expires_at is null or c.expires_at > now())
) commitments on true
where co.is_active
  and s.active
  and f.active
  and co.quantity > 0
  and (co.valid_until is null or co.valid_until > now());

grant select on public.current_offer, public.current_offers to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='source'
  ) then alter publication supabase_realtime add table public.source; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='current_offer'
  ) then alter publication supabase_realtime add table public.current_offer; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='claim'
  ) then alter publication supabase_realtime add table public.claim; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='evidence'
  ) then alter publication supabase_realtime add table public.evidence; end if;
end
$$;

-- Keep the ledger append-only guard in place and make direct mutation grants
-- explicit in case an earlier default grant changed.
revoke update, delete on public.provision_event from anon, authenticated;
revoke update, delete on public.source_profile_event from anon, authenticated;
revoke update, delete on public.context_observation from anon, authenticated;

commit;
