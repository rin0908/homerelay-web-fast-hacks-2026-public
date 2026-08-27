begin;

select plan(27);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

do $$
declare
  created_entry_id uuid;
begin
  created_entry_id := public.share_handoff(
    'a3000000-0000-4000-8000-000000000010',
    'a0000000-0000-4000-8000-000000000001/a1000000-0000-4000-8000-000000000002/a3000000-0000-4000-8000-000000000010.jpg',
    '架空の昼食写真',
    repeat('a', 64),
    '昼食は半分ほど召し上がりました',
    '水分を用意しました',
    '夕方に水分をご確認ください',
    array['トイレットペーパー']
  );
  perform set_config('homerelay.test_entry_id', created_entry_id::text, true);
end;
$$;

select ok(current_setting('homerelay.test_entry_id')::uuid is not null, 'confirmed share returns an entry id');
select is(
  (select count(*) from public.entries where id = current_setting('homerelay.test_entry_id')::uuid),
  1::bigint,
  'confirmed share inserts one visible entry'
);
select is(
  (select status from public.entries where id = current_setting('homerelay.test_entry_id')::uuid),
  'confirmed',
  'newly shared entry is confirmed'
);
select is(
  (select count(*) from public.needed_items where entry_id = current_setting('homerelay.test_entry_id')::uuid),
  1::bigint,
  'share inserts one needed item'
);
select is(
  public.share_handoff(
    'a3000000-0000-4000-8000-000000000010',
    'a0000000-0000-4000-8000-000000000001/a1000000-0000-4000-8000-000000000002/a3000000-0000-4000-8000-000000000010.jpg',
    '架空の昼食写真',
    repeat('a', 64),
    '昼食は半分ほど召し上がりました',
    '水分を用意しました',
    '夕方に水分をご確認ください',
    array['トイレットペーパー']
  ),
  current_setting('homerelay.test_entry_id')::uuid,
  'same idempotency key and payload returns the original id'
);
select is(
  (select count(*) from public.entries where idempotency_key = 'a3000000-0000-4000-8000-000000000010'),
  1::bigint,
  'duplicate share does not create a second entry'
);
select throws_ok(
  $$
    select public.share_handoff(
      'a3000000-0000-4000-8000-000000000010',
      'a0000000-0000-4000-8000-000000000001/a1000000-0000-4000-8000-000000000002/a3000000-0000-4000-8000-000000000010.jpg',
      '架空の昼食写真',
      repeat('a', 64),
      '異なる本文',
      '水分を用意しました',
      '夕方に水分をご確認ください',
      array['トイレットペーパー']
    )
  $$,
  '22023',
  'idempotency_conflict',
  'same idempotency key with a changed payload is rejected'
);
select ok(public.acknowledge_entry(current_setting('homerelay.test_entry_id')::uuid), 'first acknowledgement is recorded');
select ok(not public.acknowledge_entry(current_setting('homerelay.test_entry_id')::uuid), 'duplicate acknowledgement is idempotent');
select ok(public.claim_entry(current_setting('homerelay.test_entry_id')::uuid), 'first entry claim succeeds');
select ok(not public.claim_entry(current_setting('homerelay.test_entry_id')::uuid), 'same member duplicate entry claim is idempotent');

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select throws_ok(
  $$select public.claim_entry(current_setting('homerelay.test_entry_id')::uuid)$$,
  'P0001',
  'entry_already_claimed',
  'a second member cannot steal an entry claim'
);
select throws_ok(
  $$select public.complete_entry(current_setting('homerelay.test_entry_id')::uuid)$$,
  'P0001',
  'entry_not_claimed_by_member',
  'a non-claiming member cannot complete the entry'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

select ok(public.complete_entry(current_setting('homerelay.test_entry_id')::uuid), 'claiming member completes the entry');
select ok(not public.complete_entry(current_setting('homerelay.test_entry_id')::uuid), 'duplicate entry completion is idempotent');
select is(
  (select status from public.entries where id = current_setting('homerelay.test_entry_id')::uuid),
  'done',
  'entry reaches done state'
);
select is(
  (
    select claimed_by_member_id
    from public.entries
    where id = current_setting('homerelay.test_entry_id')::uuid
  ),
  'a1000000-0000-4000-8000-000000000002'::uuid,
  'entry keeps the attributable claimant'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

do $$
begin
  perform set_config(
    'homerelay.test_item_id',
    (
      select id::text from public.needed_items
      where entry_id = current_setting('homerelay.test_entry_id')::uuid
    ),
    true
  );
end;
$$;

select ok(public.claim_needed_item(current_setting('homerelay.test_item_id')::uuid), 'first purchase claim succeeds');
select ok(not public.claim_needed_item(current_setting('homerelay.test_item_id')::uuid), 'same member duplicate purchase claim is idempotent');

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

select throws_ok(
  $$select public.complete_needed_item(current_setting('homerelay.test_item_id')::uuid)$$,
  'P0001',
  'item_not_claimed_by_member',
  'a non-claiming member cannot complete the purchase'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select ok(public.complete_needed_item(current_setting('homerelay.test_item_id')::uuid), 'claiming member completes the purchase');
select ok(not public.complete_needed_item(current_setting('homerelay.test_item_id')::uuid), 'duplicate purchase completion is idempotent');
select is(
  (select status from public.needed_items where id = current_setting('homerelay.test_item_id')::uuid),
  'purchased',
  'needed item reaches purchased state'
);
select is(
  (
    select claimed_by_member_id
    from public.needed_items
    where id = current_setting('homerelay.test_item_id')::uuid
  ),
  'a1000000-0000-4000-8000-000000000001'::uuid,
  'purchase keeps the attributable claimant'
);
select is(
  (
    select count(*) from public.acknowledgements
    where entry_id = current_setting('homerelay.test_entry_id')::uuid
  ),
  3::bigint,
  'acknowledgement, claim, and completion audit rows exist once each'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select throws_ok(
  $$select public.acknowledge_entry(current_setting('homerelay.test_entry_id')::uuid)$$,
  '42501',
  'entry_not_available',
  'another household cannot acknowledge the entry'
);
select throws_ok(
  $$select public.claim_needed_item(current_setting('homerelay.test_item_id')::uuid)$$,
  '42501',
  'item_not_available',
  'another household cannot mutate the item'
);

reset role;
select * from finish();
rollback;
