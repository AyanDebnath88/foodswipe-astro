// QA scratch only (findings-only pass) -- drives a SECOND user against the
// live project so the browser can stay logged in as user A. Mirrors the
// wire calls in scripts/test-e2e.mjs / src/lib/*.ts. Safe to delete.
//
//   node --env-file=.env scripts/qa-scratch/second-user.mjs join   B ZJHM
//   node --env-file=.env scripts/qa-scratch/second-user.mjs swipe  B ZJHM italian right
//   node --env-file=.env scripts/qa-scratch/second-user.mjs dish   B ZJHM "Some Place" "Carbonara" right
//   node --env-file=.env scripts/qa-scratch/second-user.mjs state  B ZJHM
//   node --env-file=.env scripts/qa-scratch/second-user.mjs leave  B ZJHM
//   node --env-file=.env scripts/qa-scratch/second-user.mjs delete B ZJHM
import { signInOrSignUp, userByKey, ROOM_COLUMNS } from "../_shared.mjs";

const [, , cmd, userKey, code, ...rest] = process.argv;
const { client, user } = await signInOrSignUp(userByKey(userKey));

async function roomByCode() {
  const { data } = await client
    .from("swipe_sessions")
    .select(ROOM_COLUMNS)
    .eq("code", code.toUpperCase())
    .maybeSingle();
  return data;
}

if (cmd === "join") {
  const { data, error } = await client
    .rpc("join_room_by_code", { p_code: code.toUpperCase() })
    .single();
  console.log(JSON.stringify({ cmd, user: user.email, data, error }, null, 2));
} else if (cmd === "swipe") {
  const room = await roomByCode();
  const [cuisineId, direction] = rest;
  const { error } = await client
    .from("swipes")
    .upsert(
      { session_id: room.id, user_id: user.id, cuisine_id: cuisineId, direction },
      { onConflict: "session_id,user_id,cuisine_id" }
    );
  console.log(JSON.stringify({ cmd, cuisineId, direction, error }, null, 2));
} else if (cmd === "dish") {
  const room = await roomByCode();
  const [restaurantName, dishName, direction] = rest;
  const { error } = await client
    .from("dish_swipes")
    .upsert(
      {
        session_id: room.id,
        user_id: user.id,
        restaurant_name: restaurantName,
        dish_name: dishName,
        direction,
      },
      { onConflict: "session_id,user_id,restaurant_name,dish_name" }
    );
  console.log(JSON.stringify({ cmd, restaurantName, dishName, direction, error }, null, 2));
} else if (cmd === "state") {
  const room = await roomByCode();
  const { data: parts } = await client.rpc("get_room_profiles", { p_room_id: room?.id });
  const { data: matches } = await client.from("dish_matches").select("*").eq("session_id", room?.id);
  console.log(JSON.stringify({ room, participants: parts, dishMatches: matches }, null, 2));
} else if (cmd === "leave") {
  const room = await roomByCode();
  const { error } = await client
    .from("room_participants")
    .delete()
    .eq("room_id", room.id)
    .eq("user_id", user.id);
  console.log(JSON.stringify({ cmd, error }, null, 2));
} else if (cmd === "delete") {
  const room = await roomByCode();
  const { data, error } = await client
    .from("swipe_sessions")
    .delete()
    .eq("id", room.id)
    .select();
  console.log(JSON.stringify({ cmd, deleted: data, error }, null, 2));
} else {
  console.log("unknown cmd");
}
process.exit(0);
