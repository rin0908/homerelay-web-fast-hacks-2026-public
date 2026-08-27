begin;

select plan(23);

insert into public.entries (
  id, household_id, author_member_id, idempotency_key, payload_hash, photo_path,
  photo_alt, photo_sha256, condition_summary, completed_summary, next_request
)
values
  (
    'a2000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000002',
    'a3000000-0000-4000-8000-000000000001',
    'fixture-a',
    'a0000000-0000-4000-8000-000000000001/a1000000-0000-4000-8000-000000000002/a3000000-0000-4000-8000-000000000001.jpg',
    '架空の世帯Aの写真',
    repeat('a', 64),
    '架空の世帯Aの様子',
    '水分を用意しました',
    ''
  ),
  (
    'b2000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000001',
    'fixture-b',
    'b0000000-0000-4000-8000-000000000001/b1000000-0000-4000-8000-000000000001/b3000000-0000-4000-8000-000000000001.jpg',
    '架空の世帯Bの写真',
    repeat('b', 64),
    '架空の世帯Bの様子',
    '',
    ''
  );

insert into public.needed_items (id, household_id, entry_id, name)
values
  (
    'a4000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    '架空のティッシュ'
  ),
  (
    'b4000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    '架空のタオル'
  );

insert into storage.objects (bucket_id, name, owner_id, metadata)
values
  (
    'handoff-photos',
    'a0000000-0000-4000-8000-000000000001/a1000000-0000-4000-8000-000000000002/a3000000-0000-4000-8000-000000000001.jpg',
    '10000000-0000-4000-8000-000000000002',
    '{"mimetype":"image/jpeg"}'::jsonb
  ),
  (
    'handoff-photos',
    'b0000000-0000-4000-8000-000000000001/b1000000-0000-4000-8000-000000000001/b3000000-0000-4000-8000-000000000001.jpg',
    '20000000-0000-4000-8000-000000000001',
    '{"mimetype":"image/jpeg"}'::jsonb
  );

select is(
  (
    select count(*)::integer
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('households', 'members', 'entries', 'needed_items', 'acknowledgements')
      and c.relrowsecurity
  ),
  5,
  'RLS is enabled on every exposed HomeRelay table'
);
select ok(not has_table_privilege('anon', 'public.entries', 'SELECT'), 'anon cannot select entries');
select ok(has_table_privilege('authenticated', 'public.entries', 'SELECT'), 'authenticated can select entries through RLS');
select ok(not has_table_privilege('authenticated', 'public.entries', 'INSERT'), 'direct entry inserts are denied');
select ok(not has_table_privilege('authenticated', 'public.entries', 'UPDATE'), 'direct entry updates are denied');
select ok(has_function_privilege('authenticated', 'public.share_handoff(uuid,text,text,text,text,text,text,text[])', 'EXECUTE'), 'authenticated can execute the guarded share RPC');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select is((select count(*) from public.households), 1::bigint, 'household A member sees one household');
select is((select count(*) from public.members), 3::bigint, 'household A member sees only A members');
select ok(
  (
    select count(*) > 0
      and bool_and(household_id = 'a0000000-0000-4000-8000-000000000001')
    from public.entries
  ),
  'household A member sees entries and every visible entry belongs to A'
);
select ok(
  (
    select count(*) > 0
      and bool_and(household_id = 'a0000000-0000-4000-8000-000000000001')
    from public.needed_items
  ),
  'household A member sees items and every visible item belongs to A'
);
select ok(
  (
    select count(*) > 0
      and bool_and(name like 'a0000000-0000-4000-8000-000000000001/%')
    from storage.objects
    where bucket_id = 'handoff-photos'
  ),
  'household A member sees photos and every visible photo belongs to A'
);
select is(
  (select count(*) from public.entries where id = 'b2000000-0000-4000-8000-000000000001'),
  0::bigint,
  'household A cannot select household B entry by known id'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select is((select count(*) from public.households), 1::bigint, 'household B member sees one household');
select is((select count(*) from public.members), 1::bigint, 'household B member sees only B members');
select is((select count(*) from public.entries), 1::bigint, 'household B member sees only B entries');
select is(
  (select count(*) from public.entries where id = 'a2000000-0000-4000-8000-000000000001'),
  0::bigint,
  'household B cannot select household A entry by known id'
);
select is((select count(*) from storage.objects where bucket_id = 'handoff-photos'), 1::bigint, 'household B sees only B photos');
select is(
  (
    select count(*) from storage.objects
    where name like 'a0000000-0000-4000-8000-000000000001/%'
  ),
  0::bigint,
  'household B cannot select household A photo by path'
);
select throws_ok(
  $$select public.claim_entry('a2000000-0000-4000-8000-000000000001')$$,
  '42501',
  'entry_not_available',
  'household B cannot mutate household A entry through RPC'
);
select throws_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values (
      'handoff-photos',
      'a0000000-0000-4000-8000-000000000001/b1000000-0000-4000-8000-000000000001/b3000000-0000-4000-8000-000000000099.jpg',
      '20000000-0000-4000-8000-000000000001',
      '{"mimetype":"image/jpeg"}'::jsonb
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'household B cannot insert a photo into household A path'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

select lives_ok(
  $$
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values (
      'handoff-photos',
      'a0000000-0000-4000-8000-000000000001/a1000000-0000-4000-8000-000000000002/a3000000-0000-4000-8000-000000000099.jpg',
      '10000000-0000-4000-8000-000000000002',
      '{"mimetype":"image/jpeg"}'::jsonb
    )
  $$,
  'household A uploader can insert into their own scoped path'
);
select lives_ok(
  $$
    update storage.objects
    set metadata = '{"mimetype":"image/jpeg","cacheControl":"3600"}'::jsonb
    where name = 'a0000000-0000-4000-8000-000000000001/a1000000-0000-4000-8000-000000000002/a3000000-0000-4000-8000-000000000099.jpg'
  $$,
  'household A uploader can update their own photo for Storage upsert support'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

do $$
declare
  changed_rows integer;
begin
  update storage.objects
  set metadata = '{"mimetype":"image/png"}'::jsonb
  where name = 'a0000000-0000-4000-8000-000000000001/a1000000-0000-4000-8000-000000000002/a3000000-0000-4000-8000-000000000099.jpg';
  get diagnostics changed_rows = row_count;
  perform set_config('homerelay.test_changed_rows', changed_rows::text, true);
end;
$$;
select is(
  current_setting('homerelay.test_changed_rows')::integer,
  0,
  'household B cannot update household A photo'
);

reset role;
select * from finish();
rollback;
