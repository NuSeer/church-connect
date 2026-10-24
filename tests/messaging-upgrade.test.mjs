import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";
process.on("uncaughtException", (e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
const db = new PGlite();
const root = new URL("../", import.meta.url);
const sql = (f) => fs.readFileSync(new URL(f, root), "utf8");
await db.exec(
  `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;alter default privileges in schema public grant all on tables to anon,authenticated,service_role;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);create function storage.foldername(n text) returns text[] language sql as $$select string_to_array(n,'/')$$;create function storage.filename(n text) returns text language sql as $$select (string_to_array(n,'/'))[array_length(string_to_array(n,'/'),1)]$$;alter table storage.objects enable row level security;grant usage on schema public,auth,storage to anon,authenticated;grant all on all tables in schema storage to authenticated;`,
);
for (const f of [
  "fresh-install/01-structure.sql",
  "fresh-install/02-features-and-seed.sql",
  "messaging-upgrade.sql",
  "messaging-upgrade.sql",
]) {
  await db.exec(sql(f));
  console.log("PASS migration", f);
}
const A = "a1000000-0000-0000-0000-000000000001",
  B = "a2000000-0000-0000-0000-000000000002",
  C = "b1000000-0000-0000-0000-000000000003";
const CH = "c1000000-0000-0000-0000-000000000001",
  CH2 = "c2000000-0000-0000-0000-000000000002";
await db.exec(
  `insert into auth.users values('${A}','a@example.invalid'),('${B}','b@example.invalid'),('${C}','c@example.invalid');insert into public.churches(id,name,slug) values('${CH}','Church A','church-a'),('${CH2}','Church B','church-b');insert into public.church_subscriptions(church_id,status,plan) values('${CH}','active','complete'),('${CH2}','active','complete');insert into public.member_profiles(user_id,display_name,approved,church_id,directory_visible) values('${A}','Alice',true,'${CH}',true),('${B}','Bea',true,'${CH}',true),('${C}','Other church',true,'${CH2}',true);`,
);
async function as(u) {
  await db.exec(
    `reset role;set role authenticated;select set_config('request.jwt.claim.sub','${u}',false)`,
  );
}
async function action(c, a, p = {}) {
  return (
    await db.query("select public.cc_chat_action($1,$2,$3::jsonb) result", [
      c,
      a,
      JSON.stringify(p),
    ])
  ).rows[0].result;
}
let checks = 0;
async function test(name, fn) {
  await fn();
  checks++;
  console.log("PASS", name);
}
await as(A);
const group = (await action(null, "create", { title: "Choir", members: [B] }))
  .id;
await test("same-church group identities", async () => {
  const r = await db.query("select * from public.cc_chat_people($1)", [group]);
  assert.deepEqual(r.rows.map((x) => x.display_name).sort(), ["Alice", "Bea"]);
});
await test("cross-church invitation rejected", async () =>
  assert.rejects(
    action(null, "create", { title: "Bad group", members: [C] }),
    /unavailable/,
  ));
const sent = await action(group, "send", {
  body: "Rehearsal is Wednesday",
  client_id: "d1000000-0000-0000-0000-000000000001",
});
await test("retries do not duplicate messages", async () => {
  const r = await action(group, "send", {
    body: "Rehearsal is Wednesday",
    client_id: "d1000000-0000-0000-0000-000000000001",
  });
  assert.equal(r.id, sent.id);
  assert.equal(
    (
      await db.query(
        "select count(*) n from messages where conversation_id=$1",
        [group],
      )
    ).rows[0].n,
    1,
  );
});
await as(B);
await test("member cannot edit another sender", async () =>
  assert.rejects(
    action(group, "edit", { message_id: sent.id, body: "Changed" }),
    /Cannot change/,
  ));
await test("member cannot change group settings", async () =>
  assert.rejects(
    action(group, "manage", { announcement_only: true }),
    /Leader/,
  ));
await test("member can react, save and acknowledge", async () => {
  await action(group, "mark", {
    message_id: sent.id,
    reaction: "🙏",
    saved: true,
    acknowledged: true,
  });
  const r = await db.query("select public.cc_message_activity($1) a", [group]);
  assert.equal(r.rows[0].a[0].acknowledged, 1);
  assert.equal(r.rows[0].a[0].mine.saved, true);
});
await test("invalid reaction rejected", async () =>
  assert.rejects(
    action(group, "mark", { message_id: sent.id, reaction: "invalid" }),
  ));
await test("ordinary table insert cannot bypass checked sender", async () =>
  assert.rejects(
    db.query(
      "insert into messages(conversation_id,sender_id,body) values($1,$2,$3)",
      [group, B, "Bypass"],
    ),
    /permission denied/,
  ));
await test("member can report a message", async () => {
  await action(group, "report", {
    message_id: sent.id,
    reason: "Please review this message",
  });
  assert.equal(
    (await db.query("select count(*) n from cc_message_reports")).rows[0].n,
    1,
  );
});
await as(A);
await action(group, "manage", { announcement_only: true });
await as(B);
await test("announcement group blocks member posting", async () =>
  assert.rejects(action(group, "send", { body: "Member post" }), /leaders/));
await as(A);
const poll = (
  await action(group, "send", {
    body: "Which day?",
    poll: { question: "Which day?", options: ["Tuesday", "Wednesday"] },
  })
).id;
await as(B);
await test("poll accepts a vote and rejects an invalid option", async () => {
  await action(group, "mark", { message_id: poll, vote: 1 });
  await assert.rejects(
    action(group, "mark", { message_id: poll, vote: 9 }),
    /Invalid/,
  );
});
await as(A);
const topic = (
  await action(null, "create", { title: "Sunday music", parent_id: group })
).id;
await test("topic inherits the approved participants", async () =>
  assert.equal(
    (
      await db.query("select count(*) n from public.cc_chat_people($1)", [
        topic,
      ])
    ).rows[0].n,
    2,
  ));
await action(group, "manage", { member_id: B, remove: true });
await as(B);
await test("removed participant loses group and topic access", async () => {
  assert.equal(
    (
      await db.query("select public.can_read_conversation($1,auth.uid()) v", [
        group,
      ])
    ).rows[0].v,
    false,
  );
  assert.equal(
    (
      await db.query("select public.can_read_conversation($1,auth.uid()) v", [
        topic,
      ])
    ).rows[0].v,
    false,
  );
});
await as(C);
await test("other churches cannot read or send", async () => {
  assert.equal(
    (await db.query("select * from messages where conversation_id=$1", [group]))
      .rows.length,
    0,
  );
  await assert.rejects(
    action(group, "send", { body: "Intrusion" }),
    /unavailable/,
  );
});
await as(A);
await test("unuploaded attachment path rejected", async () =>
  assert.rejects(
    action(group, "send", {
      body: "File",
      attachment: { path: group + "/" + A + "/missing.pdf" },
    }),
    /Attachment/,
  ));
await test("edits and soft deletion preserve message identity", async () => {
  await action(group, "edit", {
    message_id: sent.id,
    body: "Rehearsal is Thursday",
  });
  await action(group, "delete", { message_id: sent.id });
  const r = await db.query("select * from messages where id=$1", [sent.id]);
  assert.equal(r.rows[0].body, "Message deleted");
  assert.ok(r.rows[0].deleted_at);
});
await action(group, "manage", { archived: true });
await test("archived conversations reject sends", async () =>
  assert.rejects(action(group, "send", { body: "Later" }), /leaders/));
await as(B);
await action(null, "settings", { allow_direct: false });
await as(A);
await test("new private messages respect recipient preferences", async () =>
  assert.rejects(
    db.query("select public.start_direct_chat($1)", [B]),
    /not accepting/,
  ));
await db.exec(`reset role;set role service_role`);
await test("push claims are per device and retry failed attempts", async () => {
  const one = await db.query("select public.cc_claim_push($1,$2) v", [poll, 7]);
  assert.equal(one.rows[0].v, true);
  assert.equal(
    (await db.query("select public.cc_claim_push($1,$2) v", [poll, 7])).rows[0]
      .v,
    false,
  );
  await db.query(
    "update public.cc_push_attempts set status='pending' where message_id=$1",
    [poll],
  );
  assert.equal(
    (await db.query("select public.cc_claim_push($1,$2) v", [poll, 7])).rows[0]
      .v,
    true,
  );
});
console.log(`${checks} messaging access and behavior checks passed`);
await db.close();
