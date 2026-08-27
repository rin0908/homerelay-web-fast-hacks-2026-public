begin;

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  constraint households_name_length check (char_length(btrim(name)) between 1 and 80)
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null,
  created_at timestamptz not null default now(),
  constraint members_auth_user_unique unique (auth_user_id),
  constraint members_id_household_unique unique (id, household_id),
  constraint members_household_user_unique unique (household_id, auth_user_id),
  constraint members_display_name_length check (char_length(btrim(display_name)) between 1 and 60),
  constraint members_role_allowed check (role in ('family', 'relative', 'helper'))
);

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  author_member_id uuid not null,
  idempotency_key uuid not null,
  payload_hash text not null,
  photo_path text not null,
  photo_alt text not null,
  photo_sha256 text not null,
  condition_summary text not null default '',
  completed_summary text not null default '',
  next_request text not null default '',
  status text not null default 'confirmed',
  claimed_by_member_id uuid,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entries_id_household_unique unique (id, household_id),
  constraint entries_author_idempotency_unique unique (author_member_id, idempotency_key),
  constraint entries_author_same_household foreign key (author_member_id, household_id)
    references public.members(id, household_id) on delete restrict,
  constraint entries_claimed_by_same_household foreign key (claimed_by_member_id, household_id)
    references public.members(id, household_id) on delete restrict,
  constraint entries_summary_present check (
    char_length(btrim(condition_summary)) > 0
    or char_length(btrim(completed_summary)) > 0
    or char_length(btrim(next_request)) > 0
  ),
  constraint entries_summary_lengths check (
    char_length(condition_summary) <= 500
    and char_length(completed_summary) <= 500
    and char_length(next_request) <= 500
  ),
  constraint entries_status_allowed check (status in ('confirmed', 'claimed', 'done')),
  constraint entries_photo_alt_length check (char_length(btrim(photo_alt)) between 1 and 160),
  constraint entries_photo_sha256_format check (photo_sha256 ~ '^[0-9a-f]{64}$'),
  constraint entries_claim_state check (
    (status = 'confirmed' and claimed_by_member_id is null)
    or (status in ('claimed', 'done') and claimed_by_member_id is not null)
  ),
  constraint entries_photo_path_scoped check (
    array_length(string_to_array(photo_path, '/'), 1) = 3
    and split_part(photo_path, '/', 1) = household_id::text
    and split_part(photo_path, '/', 2) = author_member_id::text
    and split_part(split_part(photo_path, '/', 3), '.', 1) = idempotency_key::text
    and lower(photo_path) ~ '[.](jpg|jpeg|png|webp)$'
  )
);

create table public.needed_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  entry_id uuid not null,
  name text not null,
  photo_path text,
  status text not null default 'needed',
  claimed_by_member_id uuid,
  purchased_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint needed_items_id_household_unique unique (id, household_id),
  constraint needed_items_entry_same_household foreign key (entry_id, household_id)
    references public.entries(id, household_id) on delete cascade,
  constraint needed_items_claimed_by_same_household foreign key (claimed_by_member_id, household_id)
    references public.members(id, household_id) on delete restrict,
  constraint needed_items_name_length check (char_length(btrim(name)) between 1 and 120),
  constraint needed_items_status_allowed check (status in ('needed', 'purchase_intent', 'purchased')),
  constraint needed_items_claim_state check (
    (status = 'needed' and claimed_by_member_id is null and purchased_at is null)
    or (status = 'purchase_intent' and claimed_by_member_id is not null and purchased_at is null)
    or (status = 'purchased' and claimed_by_member_id is not null and purchased_at is not null)
  )
);

create unique index needed_items_entry_name_unique
  on public.needed_items (entry_id, lower(name));

create table public.acknowledgements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  entry_id uuid not null,
  member_id uuid not null,
  action text not null,
  created_at timestamptz not null default now(),
  constraint acknowledgements_entry_same_household foreign key (entry_id, household_id)
    references public.entries(id, household_id) on delete cascade,
  constraint acknowledgements_member_same_household foreign key (member_id, household_id)
    references public.members(id, household_id) on delete cascade,
  constraint acknowledgements_action_allowed check (action in ('confirmed', 'claimed', 'done')),
  constraint acknowledgements_once unique (entry_id, member_id, action)
);

create index members_household_idx on public.members (household_id);
create index entries_household_created_idx on public.entries (household_id, created_at desc);
create index entries_claimed_by_idx on public.entries (claimed_by_member_id) where claimed_by_member_id is not null;
create index needed_items_household_status_idx on public.needed_items (household_id, status, updated_at desc);
create index needed_items_entry_idx on public.needed_items (entry_id);
create index needed_items_claimed_by_idx on public.needed_items (claimed_by_member_id) where claimed_by_member_id is not null;
create index acknowledgements_household_created_idx on public.acknowledgements (household_id, created_at desc);
create index acknowledgements_entry_idx on public.acknowledgements (entry_id);
create index acknowledgements_member_idx on public.acknowledgements (member_id);

create or replace function private.current_member_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
  from public.members as m
  where (select auth.uid()) is not null
    and m.auth_user_id = (select auth.uid())
  limit 1
$$;

create or replace function private.current_household_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.household_id
  from public.members as m
  where (select auth.uid()) is not null
    and m.auth_user_id = (select auth.uid())
  limit 1
$$;

create or replace function private.is_household_member(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and target_household_id is not null
    and exists (
      select 1
      from public.members as m
      where m.auth_user_id = (select auth.uid())
        and m.household_id = target_household_id
    )
$$;

create or replace function private.storage_path_uuid(object_name text, path_part integer)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if object_name is null or path_part < 1 then
    return null;
  end if;
  return nullif(split_part(object_name, '/', path_part), '')::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

revoke all on function private.current_member_id() from public, anon;
revoke all on function private.current_household_id() from public, anon;
revoke all on function private.is_household_member(uuid) from public, anon;
revoke all on function private.storage_path_uuid(text, integer) from public, anon;
grant execute on function private.current_member_id() to authenticated, service_role;
grant execute on function private.current_household_id() to authenticated, service_role;
grant execute on function private.is_household_member(uuid) to authenticated, service_role;
grant execute on function private.storage_path_uuid(text, integer) to authenticated, service_role;

alter table public.households enable row level security;
alter table public.members enable row level security;
alter table public.entries enable row level security;
alter table public.needed_items enable row level security;
alter table public.acknowledgements enable row level security;

create policy households_select_members
  on public.households for select
  to authenticated
  using ((select private.is_household_member(id)));

create policy members_select_household
  on public.members for select
  to authenticated
  using ((select private.is_household_member(household_id)));

create policy entries_select_household
  on public.entries for select
  to authenticated
  using ((select private.is_household_member(household_id)));

create policy needed_items_select_household
  on public.needed_items for select
  to authenticated
  using ((select private.is_household_member(household_id)));

create policy acknowledgements_select_household
  on public.acknowledgements for select
  to authenticated
  using ((select private.is_household_member(household_id)));

revoke all on table public.households from anon, authenticated;
revoke all on table public.members from anon, authenticated;
revoke all on table public.entries from anon, authenticated;
revoke all on table public.needed_items from anon, authenticated;
revoke all on table public.acknowledgements from anon, authenticated;

grant select on table public.households to authenticated;
grant select on table public.members to authenticated;
grant select on table public.entries to authenticated;
grant select on table public.needed_items to authenticated;
grant select on table public.acknowledgements to authenticated;

create or replace function public.share_handoff(
  p_idempotency_key uuid,
  p_photo_path text,
  p_photo_alt text,
  p_photo_sha256 text,
  p_condition_summary text,
  p_completed_summary text,
  p_next_request text,
  p_needed_items text[] default array[]::text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid;
  v_household_id uuid;
  v_entry_id uuid;
  v_existing_hash text;
  v_payload_hash text;
  v_needed_items text[];
begin
  v_member_id := private.current_member_id();
  v_household_id := private.current_household_id();

  if v_member_id is null or v_household_id is null then
    raise exception using errcode = '42501', message = 'membership_required';
  end if;

  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'idempotency_key_required';
  end if;

  if coalesce(char_length(p_photo_path), 0) > 500
    or p_photo_path !~ (
      '^' || v_household_id::text || '/' || v_member_id::text || '/'
      || p_idempotency_key::text || '[.](jpg|jpeg|png|webp)$'
    ) then
    raise exception using errcode = '22023', message = 'invalid_photo_path';
  end if;

  if char_length(btrim(coalesce(p_photo_alt, ''))) not between 1 and 160 then
    raise exception using errcode = '22023', message = 'invalid_photo_alt';
  end if;

  if coalesce(p_photo_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_photo_sha256';
  end if;

  if coalesce(char_length(p_condition_summary), 0) > 500
    or coalesce(char_length(p_completed_summary), 0) > 500
    or coalesce(char_length(p_next_request), 0) > 500
    or (
      char_length(btrim(coalesce(p_condition_summary, ''))) = 0
      and char_length(btrim(coalesce(p_completed_summary, ''))) = 0
      and char_length(btrim(coalesce(p_next_request, ''))) = 0
    ) then
    raise exception using errcode = '22023', message = 'invalid_summary';
  end if;

  if coalesce(array_length(p_needed_items, 1), 0) > 10 then
    raise exception using errcode = '22023', message = 'too_many_needed_items';
  end if;

  select coalesce(array_agg(item order by item), array[]::text[])
  into v_needed_items
  from (
    select distinct btrim(value) as item
    from unnest(coalesce(p_needed_items, array[]::text[])) as value
    where char_length(btrim(value)) between 1 and 120
  ) as normalized;

  if coalesce(array_length(v_needed_items, 1), 0)
    <> coalesce((select count(*) from unnest(coalesce(p_needed_items, array[]::text[]))), 0) then
    raise exception using errcode = '22023', message = 'invalid_needed_item';
  end if;

  v_payload_hash := md5(concat_ws(
    chr(31),
    p_photo_path,
    btrim(p_photo_alt),
    p_photo_sha256,
    btrim(coalesce(p_condition_summary, '')),
    btrim(coalesce(p_completed_summary, '')),
    btrim(coalesce(p_next_request, '')),
    array_to_string(v_needed_items, chr(30))
  ));

  insert into public.entries (
    household_id,
    author_member_id,
    idempotency_key,
    payload_hash,
    photo_path,
    photo_alt,
    photo_sha256,
    condition_summary,
    completed_summary,
    next_request
  )
  values (
    v_household_id,
    v_member_id,
    p_idempotency_key,
    v_payload_hash,
    p_photo_path,
    btrim(p_photo_alt),
    p_photo_sha256,
    btrim(coalesce(p_condition_summary, '')),
    btrim(coalesce(p_completed_summary, '')),
    btrim(coalesce(p_next_request, ''))
  )
  on conflict (author_member_id, idempotency_key) do nothing
  returning id into v_entry_id;

  if v_entry_id is null then
    select e.id, e.payload_hash
    into v_entry_id, v_existing_hash
    from public.entries as e
    where e.author_member_id = v_member_id
      and e.idempotency_key = p_idempotency_key;

    if v_existing_hash is distinct from v_payload_hash then
      raise exception using errcode = '22023', message = 'idempotency_conflict';
    end if;

    return v_entry_id;
  end if;

  insert into public.needed_items (household_id, entry_id, name)
  select v_household_id, v_entry_id, item
  from unnest(v_needed_items) as item;

  return v_entry_id;
end;
$$;

create or replace function public.acknowledge_entry(p_entry_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid := private.current_member_id();
  v_household_id uuid := private.current_household_id();
  v_inserted boolean;
begin
  if v_member_id is null or v_household_id is null then
    raise exception using errcode = '42501', message = 'membership_required';
  end if;

  if not exists (
    select 1 from public.entries as e
    where e.id = p_entry_id and e.household_id = v_household_id
  ) then
    raise exception using errcode = '42501', message = 'entry_not_available';
  end if;

  insert into public.acknowledgements (household_id, entry_id, member_id, action)
  values (v_household_id, p_entry_id, v_member_id, 'confirmed')
  on conflict (entry_id, member_id, action) do nothing
  returning true into v_inserted;

  return coalesce(v_inserted, false);
end;
$$;

create or replace function public.claim_entry(p_entry_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid := private.current_member_id();
  v_household_id uuid := private.current_household_id();
  v_changed boolean;
  v_status text;
  v_claimed_by uuid;
begin
  if v_member_id is null or v_household_id is null then
    raise exception using errcode = '42501', message = 'membership_required';
  end if;

  update public.entries
  set status = 'claimed', claimed_by_member_id = v_member_id, updated_at = now()
  where id = p_entry_id
    and household_id = v_household_id
    and status = 'confirmed'
  returning true into v_changed;

  if not coalesce(v_changed, false) then
    select e.status, e.claimed_by_member_id
    into v_status, v_claimed_by
    from public.entries as e
    where e.id = p_entry_id and e.household_id = v_household_id;

    if v_status is null then
      raise exception using errcode = '42501', message = 'entry_not_available';
    end if;
    if v_status = 'claimed' and v_claimed_by = v_member_id then
      return false;
    end if;
    raise exception using errcode = 'P0001', message = 'entry_already_claimed';
  end if;

  insert into public.acknowledgements (household_id, entry_id, member_id, action)
  values (v_household_id, p_entry_id, v_member_id, 'claimed')
  on conflict (entry_id, member_id, action) do nothing;

  return true;
end;
$$;

create or replace function public.complete_entry(p_entry_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid := private.current_member_id();
  v_household_id uuid := private.current_household_id();
  v_changed boolean;
  v_status text;
  v_claimed_by uuid;
begin
  if v_member_id is null or v_household_id is null then
    raise exception using errcode = '42501', message = 'membership_required';
  end if;

  update public.entries
  set status = 'done', updated_at = now()
  where id = p_entry_id
    and household_id = v_household_id
    and status = 'claimed'
    and claimed_by_member_id = v_member_id
  returning true into v_changed;

  if not coalesce(v_changed, false) then
    select e.status, e.claimed_by_member_id
    into v_status, v_claimed_by
    from public.entries as e
    where e.id = p_entry_id and e.household_id = v_household_id;

    if v_status is null then
      raise exception using errcode = '42501', message = 'entry_not_available';
    end if;
    if v_status = 'done' and v_claimed_by = v_member_id then
      return false;
    end if;
    raise exception using errcode = 'P0001', message = 'entry_not_claimed_by_member';
  end if;

  insert into public.acknowledgements (household_id, entry_id, member_id, action)
  values (v_household_id, p_entry_id, v_member_id, 'done')
  on conflict (entry_id, member_id, action) do nothing;

  return true;
end;
$$;

create or replace function public.claim_needed_item(p_item_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid := private.current_member_id();
  v_household_id uuid := private.current_household_id();
  v_changed boolean;
  v_status text;
  v_claimed_by uuid;
begin
  if v_member_id is null or v_household_id is null then
    raise exception using errcode = '42501', message = 'membership_required';
  end if;

  update public.needed_items
  set status = 'purchase_intent', claimed_by_member_id = v_member_id, updated_at = now()
  where id = p_item_id
    and household_id = v_household_id
    and status = 'needed'
  returning true into v_changed;

  if not coalesce(v_changed, false) then
    select i.status, i.claimed_by_member_id
    into v_status, v_claimed_by
    from public.needed_items as i
    where i.id = p_item_id and i.household_id = v_household_id;

    if v_status is null then
      raise exception using errcode = '42501', message = 'item_not_available';
    end if;
    if v_status = 'purchase_intent' and v_claimed_by = v_member_id then
      return false;
    end if;
    raise exception using errcode = 'P0001', message = 'item_already_claimed';
  end if;

  return true;
end;
$$;

create or replace function public.complete_needed_item(p_item_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid := private.current_member_id();
  v_household_id uuid := private.current_household_id();
  v_changed boolean;
  v_status text;
  v_claimed_by uuid;
begin
  if v_member_id is null or v_household_id is null then
    raise exception using errcode = '42501', message = 'membership_required';
  end if;

  update public.needed_items
  set status = 'purchased', purchased_at = now(), updated_at = now()
  where id = p_item_id
    and household_id = v_household_id
    and status = 'purchase_intent'
    and claimed_by_member_id = v_member_id
  returning true into v_changed;

  if not coalesce(v_changed, false) then
    select i.status, i.claimed_by_member_id
    into v_status, v_claimed_by
    from public.needed_items as i
    where i.id = p_item_id and i.household_id = v_household_id;

    if v_status is null then
      raise exception using errcode = '42501', message = 'item_not_available';
    end if;
    if v_status = 'purchased' and v_claimed_by = v_member_id then
      return false;
    end if;
    raise exception using errcode = 'P0001', message = 'item_not_claimed_by_member';
  end if;

  return true;
end;
$$;

revoke all on function public.share_handoff(uuid, text, text, text, text, text, text, text[]) from public, anon;
revoke all on function public.acknowledge_entry(uuid) from public, anon;
revoke all on function public.claim_entry(uuid) from public, anon;
revoke all on function public.complete_entry(uuid) from public, anon;
revoke all on function public.claim_needed_item(uuid) from public, anon;
revoke all on function public.complete_needed_item(uuid) from public, anon;

grant execute on function public.share_handoff(uuid, text, text, text, text, text, text, text[]) to authenticated;
grant execute on function public.acknowledge_entry(uuid) to authenticated;
grant execute on function public.claim_entry(uuid) to authenticated;
grant execute on function public.complete_entry(uuid) to authenticated;
grant execute on function public.claim_needed_item(uuid) to authenticated;
grant execute on function public.complete_needed_item(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'handoff-photos',
  'handoff-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy handoff_photos_select_household
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'handoff-photos'
    and (select private.is_household_member(private.storage_path_uuid(name, 1)))
  );

create policy handoff_photos_insert_own_path
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'handoff-photos'
    and private.storage_path_uuid(name, 1) = (select private.current_household_id())
    and private.storage_path_uuid(name, 2) = (select private.current_member_id())
    and owner_id = (select auth.uid())::text
    and lower(name) ~ '[.](jpg|jpeg|png|webp)$'
  );

create policy handoff_photos_update_own_path
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'handoff-photos'
    and private.storage_path_uuid(name, 1) = (select private.current_household_id())
    and private.storage_path_uuid(name, 2) = (select private.current_member_id())
    and owner_id = (select auth.uid())::text
  )
  with check (
    bucket_id = 'handoff-photos'
    and private.storage_path_uuid(name, 1) = (select private.current_household_id())
    and private.storage_path_uuid(name, 2) = (select private.current_member_id())
    and owner_id = (select auth.uid())::text
    and lower(name) ~ '[.](jpg|jpeg|png|webp)$'
  );

create policy handoff_photos_delete_own_path
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'handoff-photos'
    and private.storage_path_uuid(name, 1) = (select private.current_household_id())
    and private.storage_path_uuid(name, 2) = (select private.current_member_id())
    and owner_id = (select auth.uid())::text
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'entries'
  ) then
    alter publication supabase_realtime add table public.entries;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'needed_items'
  ) then
    alter publication supabase_realtime add table public.needed_items;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'acknowledgements'
  ) then
    alter publication supabase_realtime add table public.acknowledgements;
  end if;
end;
$$;

commit;
