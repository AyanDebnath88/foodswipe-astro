// Phase 2, Task 1: guest join.
//
// Opening a room via a shared code/link must not require a real account.
// ensureGuestSession() is the one place that decides whether a brand-new
// anonymous auth.users row is needed: if the browser already has *any*
// session (guest or real), it's reused as-is; otherwise
// supabase.auth.signInAnonymously() issues a real auth.users row/UUID (see
// 0001_init.sql's header comment -- guests are not a parallel id scheme, so
// RLS treats them identically to registered users everywhere else in the
// schema).
import { createSupabaseBrowserClient } from "./supabase/client";
import type { User } from "@supabase/supabase-js";

export async function getCurrentUser(): Promise<User | null> {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Ensures a usable session exists, creating an anonymous one if needed, and
 * writes `displayName` onto the profile.
 *
 * The `public.profiles` row for a freshly anonymous-signed-in user already
 * exists by the time this function's insert-turned-update runs: it's
 * created by the `handle_new_user()` trigger from
 * 0003_profile_trigger.sql, which fires on every `auth.users` insert
 * (anonymous sign-in included, since Supabase still inserts a real
 * auth.users row for it) and falls back to display_name = 'Guest' since
 * signInAnonymously() passes no `options.data`. So this is always an
 * UPDATE of that trigger-created row, never an INSERT -- consistent with
 * the "profiles: update own row" RLS policy already in 0001_init.sql
 * needing no changes for this phase.
 */
export async function ensureGuestSession(displayName: string): Promise<User> {
  const supabase = createSupabaseBrowserClient();

  const existing = await getCurrentUser();
  let user = existing;

  if (!user) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
    if (!data.user) throw new Error("Anonymous sign-in did not return a user.");
    user = data.user;
  }

  const trimmedName = displayName.trim();
  if (trimmedName.length > 0) {
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ display_name: trimmedName })
      .eq("id", user.id);
    if (profileError) throw profileError;
  }

  return user;
}
