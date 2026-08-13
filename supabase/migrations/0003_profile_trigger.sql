-- 0003_profile_trigger.sql
-- Creates a matching public.profiles row whenever a new auth.users row is
-- inserted, instead of relying on the client to insert its own profile row
-- right after signUp(). Doing it client-side is a race: the client's insert
-- can run before the session/JWT from signUp() is fully usable, or can simply
-- fail after the auth user was already created, leaving an orphaned
-- auth.users row with no profile. A database trigger is atomic with the
-- auth.users insert and can't be skipped by a flaky client.
--
-- display_name / phone come from `raw_user_meta_data`, which Postgres/Supabase
-- populates from the `options.data` object passed to
-- `supabase.auth.signUp({ email, password, options: { data: { display_name, phone } } })`.
-- This is the standard Supabase "handle_new_user" pattern.
--
-- is_guest / is_anonymous:
-- Supabase's auth.users table has a first-class `is_anonymous boolean`
-- column (added alongside the Anonymous Sign-ins feature) that is true for
-- users created via `supabase.auth.signInAnonymously()` and false for every
-- other sign-up path (password, OAuth, etc). This is the correct signal to
-- use here -- NOT "is email null", which would also misclassify phone-only
-- or OAuth-only accounts that never set a password/email as guests. Guests
-- created via signInAnonymously() pass no `options.data`, so display_name
-- falls back to 'Guest' since public.profiles.display_name is NOT NULL.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, phone, is_guest)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', 'Guest'),
    new.raw_user_meta_data ->> 'phone',
    coalesce(new.is_anonymous, false)
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
