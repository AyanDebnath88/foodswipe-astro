// scripts/seed-test-users.mjs
//
// Creates (or signs into, if they already exist) the four deterministic
// Food Swipe test accounts, then makes each one write its own
// profiles.dietary_restrictions -- owner-writable per the
// "profiles: update own row" RLS policy in 0001_init.sql, so each user has
// to do it as themselves. There is no service_role key here on purpose.
//
// Idempotent: safe to re-run any number of times.
//
//   node --env-file=.env scripts/seed-test-users.mjs
import { TEST_USERS, TEST_PASSWORD, signInOrSignUp } from "./_shared.mjs";

function pad(s, n) {
  s = String(s ?? "");
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

async function main() {
  const rows = [];
  let failures = 0;

  for (const spec of TEST_USERS) {
    process.stdout.write(`Seeding ${spec.email} ... `);
    try {
      const { client, user, created } = await signInOrSignUp(spec);

      // The handle_new_user() trigger (0003_profile_trigger.sql) already
      // created the profiles row from raw_user_meta_data, so this is an
      // UPDATE, never an INSERT.
      const { error: updateError } = await client
        .from("profiles")
        .update({
          display_name: spec.displayName,
          phone: spec.phone,
          dietary_restrictions: spec.dietaryRestrictions,
        })
        .eq("id", user.id);
      if (updateError) throw new Error(`profile update: ${updateError.message}`);

      const { data: profile, error: readError } = await client
        .from("profiles")
        .select("id, display_name, phone, dietary_restrictions, is_guest")
        .eq("id", user.id)
        .single();
      if (readError) throw new Error(`profile read-back: ${readError.message}`);

      rows.push({
        key: spec.key,
        email: spec.email,
        userId: user.id,
        displayName: profile.display_name,
        dietary: (profile.dietary_restrictions ?? []).join(",") || "(none)",
        isGuest: profile.is_guest,
        state: created ? "created" : "existing",
      });

      await client.auth.signOut();
      console.log(created ? "created" : "already existed");
    } catch (err) {
      failures++;
      console.log(`FAILED -- ${err.message}`);
      rows.push({
        key: spec.key,
        email: spec.email,
        userId: "-",
        displayName: "-",
        dietary: "-",
        isGuest: "-",
        state: "FAILED",
      });
    }
  }

  console.log("\nTest accounts");
  console.log("=".repeat(132));
  console.log(
    pad("KEY", 4) +
      pad("EMAIL", 34) +
      pad("DISPLAY NAME", 15) +
      pad("DIETARY RESTRICTIONS", 24) +
      pad("GUEST", 7) +
      pad("STATE", 10) +
      "USER ID"
  );
  console.log("-".repeat(132));
  for (const r of rows) {
    console.log(
      pad(r.key, 4) +
        pad(r.email, 34) +
        pad(r.displayName, 15) +
        pad(r.dietary, 24) +
        pad(String(r.isGuest), 7) +
        pad(r.state, 10) +
        r.userId
    );
  }
  console.log("=".repeat(132));
  console.log(`\nShared password for ALL of the above:  ${TEST_PASSWORD}`);
  console.log("Log in at:  http://localhost:4321/login\n");

  if (failures > 0) {
    console.error(`${failures} account(s) failed to seed.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
