-- 0010_fix_create_room_codegen.sql
--
-- Fixes a bug introduced by 0009's create_room(): it generated the room code
-- with gen_random_bytes(), which is a pgcrypto function. On Supabase pgcrypto
-- is installed into the `extensions` schema, but create_room() is declared
-- `set search_path = public` (correct, for SECURITY DEFINER hardening), so
-- the function was not resolvable and every call failed with:
--   function gen_random_bytes(integer) does not exist
--
-- Rather than widen the search_path or schema-qualify a pgcrypto call, the
-- code generator is replaced with plain built-in SQL: four random letters
-- A-Z. Room codes are a short human-typeable handle for a room the user is
-- already sharing deliberately -- they are not a security boundary (RLS is),
-- so cryptographic randomness buys nothing here. Collisions are handled by
-- the existing retry loop against the `code` unique constraint.
create or replace function public.create_room()
returns table (
  id uuid,
  code text,
  creator_id uuid,
  status text,
  matched_cuisine_id text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_room_id uuid;
  v_code text;
  v_attempts int := 0;
begin
  if v_uid is null then
    raise exception 'Must be signed in to create a room.';
  end if;

  loop
    v_attempts := v_attempts + 1;

    select string_agg(chr(65 + floor(random() * 26)::int), '')
      into v_code
      from generate_series(1, 4);

    exit when not exists (select 1 from public.swipe_sessions s where s.code = v_code);

    if v_attempts >= 20 then
      raise exception 'Could not allocate a unique room code, please retry.';
    end if;
  end loop;

  insert into public.swipe_sessions (code, creator_id, status)
  values (v_code, v_uid, 'waiting')
  returning swipe_sessions.id into v_room_id;

  insert into public.room_participants (room_id, user_id)
  values (v_room_id, v_uid);

  return query
    select s.id, s.code, s.creator_id, s.status, s.matched_cuisine_id
    from public.swipe_sessions s
    where s.id = v_room_id;
end;
$$;

revoke all on function public.create_room() from public;
grant execute on function public.create_room() to authenticated;
