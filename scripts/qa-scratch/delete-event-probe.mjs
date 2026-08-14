// Scratch probe (not part of either suite): when a room's creator DELETEs the
// swipe_sessions row, does a *participant's* Realtime channel actually receive
// the DELETE event? The participant's own room_participants row cascades away
// in the same statement, and Realtime evaluates RLS per record, so this is not
// obviously yes -- and the answer decides whether "the room was closed" can be
// driven by Realtime alone or needs a verification fallback.
//
//   node --env-file=.env scripts/qa-scratch/delete-event-probe.mjs
import { userByKey, signInOrSignUp, sleep } from "../_shared.mjs";

async function createRoom(client) {
  const { data, error } = await client.rpc("create_room").single();
  if (error) throw error;
  return data;
}

const A = await signInOrSignUp(userByKey("A"));
const B = await signInOrSignUp(userByKey("B"));

const room = await createRoom(A.client);
await B.client.rpc("join_room_by_code", { p_code: room.code });
console.log(`room ${room.code} (${room.id}) created by A, joined by B`);

const events = { session: [], participants: [] };
const channel = B.client
  .channel(`probe:${room.id}`)
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "swipe_sessions", filter: `id=eq.${room.id}` },
    (p) => events.session.push({ type: p.eventType, old: p.old, new: p.new })
  )
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "room_participants", filter: `room_id=eq.${room.id}` },
    (p) => events.participants.push({ type: p.eventType, old: p.old })
  );

const subscribed = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), 15000);
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      clearTimeout(timer);
      resolve(true);
    }
  });
});
console.log("subscribed:", subscribed);

await sleep(1000);
const del = await A.client.from("swipe_sessions").delete().eq("id", room.id).select("id");
console.log("creator delete ->", del.error ?? `${del.data?.length ?? 0} row(s)`);

await sleep(6000);
console.log("session events:", JSON.stringify(events.session, null, 2));
console.log("participant events:", JSON.stringify(events.participants, null, 2));

const read = await B.client.from("swipe_sessions").select("id").eq("id", room.id).maybeSingle();
console.log("B reads room after delete:", read.data, read.error?.message ?? "");

await B.client.removeChannel(channel);
process.exit(0);
