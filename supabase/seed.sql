-- Synthetic HomeRelay-only local accounts. These reserved .test addresses are not real people.
-- Every reset assigns an unreachable random seed password; verification rotates it at runtime.

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  is_sso_user,
  is_anonymous
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'family-a@homerelay.test',
    crypt(encode(gen_random_bytes(32), 'hex'), gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    '',
    false,
    false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'helper-a@homerelay.test',
    crypt(encode(gen_random_bytes(32), 'hex'), gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    '',
    false,
    false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'relative-a@homerelay.test',
    crypt(encode(gen_random_bytes(32), 'hex'), gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    '',
    false,
    false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '20000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'family-b@homerelay.test',
    crypt(encode(gen_random_bytes(32), 'hex'), gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    '',
    false,
    false
  )
on conflict (id) do nothing;

insert into auth.identities (
  id,
  user_id,
  provider_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
select
  u.id,
  u.id,
  u.email,
  jsonb_build_object(
    'sub', u.id::text,
    'email', u.email,
    'email_verified', true,
    'phone_verified', false
  ),
  'email',
  now(),
  now(),
  now()
from auth.users as u
where u.id in (
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000001'
)
on conflict do nothing;

insert into public.households (id, name)
values
  ('a0000000-0000-4000-8000-000000000001', '架空の青空家'),
  ('b0000000-0000-4000-8000-000000000001', '架空の木漏れ日家')
on conflict (id) do nothing;

insert into public.members (id, household_id, auth_user_id, display_name, role)
values
  (
    'a1000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'デモ家族 あおい',
    'family'
  ),
  (
    'a1000000-0000-4000-8000-000000000002',
    'a0000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'デモヘルパー さくら',
    'helper'
  ),
  (
    'a1000000-0000-4000-8000-000000000003',
    'a0000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003',
    'デモ親族 ひなた',
    'relative'
  ),
  (
    'b1000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '別世帯デモ かえで',
    'family'
  )
on conflict (id) do nothing;
