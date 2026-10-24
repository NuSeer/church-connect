// Checks the safety layer on top of the messaging upgrade: ask-first requests, youth rules and guardians, blocking, announcement
// acknowledgments, who-is-coming for administrators, and the messaging health summary. Runs on an embedded Postgres (PGlite).
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
process.on('uncaughtException', e => { console.error('FAIL', e.message); process.exit(1) });
const db = new PGlite();
const root = new URL('../', import.meta.url);
const sql = f => fs.readFileSync(new URL(f, root), 'utf8');
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;alter default privileges in schema public grant all on tables to anon,authenticated,service_role;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);create function storage.foldername(n text) returns text[] language sql as $$select string_to_array(n,'/')$$;create function storage.filename(n text) returns text language sql as $$select (string_to_array(n,'/'))[array_length(string_to_array(n,'/'),1)]$$;alter table storage.objects enable row level security;grant usage on schema public,auth,storage to anon,authenticated;grant all on all tables in schema storage to authenticated;`);
for (const f of ['fresh-install/01-structure.sql', 'fresh-install/02-features-and-seed.sql', 'messaging-plus-migration.sql', 'messaging-plus-migration.sql']) { await db.exec(sql(f)); console.log('PASS migration', f) }
const U = n => `a${n}000000-0000-0000-0000-00000000000${n}`;
const [ADMIN, BEA, EVE, DAN, YARA, GRACE, OTHER] = [1, 2, 3, 4, 5, 6, 7].map(U);
const CH = 'c1000000-0000-0000-0000-000000000001', CH2 = 'c2000000-0000-0000-0000-000000000002';
const people = [[ADMIN, 'Alice'], [BEA, 'Bea'], [EVE, 'Eve'], [DAN, 'Dan'], [YARA, 'Yara'], [GRACE, 'Grace']];
await db.exec(`insert into auth.users values ${[...people, [OTHER, 'Other']].map(([id, n]) => `('${id}','${n}@example.invalid')`).join(',')};
 insert into public.churches(id,name,slug) values('${CH}','Church A','church-a'),('${CH2}','Church B','church-b');
 insert into public.church_subscriptions(church_id,status,plan) values('${CH}','active','complete'),('${CH2}','active','complete');
 insert into public.member_profiles(user_id,display_name,approved,church_id,directory_visible) values ${people.map(([id, n]) => `('${id}','${n}',true,'${CH}',true)`).join(',')},('${OTHER}','Other',true,'${CH2}',true);
 insert into public.church_admins(user_id,church_id) values('${ADMIN}','${CH}');`);
const as = async u => { await db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${u}',false)`) };
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
const rows = async (q, p = []) => (await db.query(q, p)).rows;
const action = async (c, a, p = {}) => (await one('select public.cc_chat_action($1,$2,$3::jsonb) result', [c, a, JSON.stringify(p)])).result;
let checks = 0;
const test = async (name, fn) => { await fn(); checks++; console.log('PASS', name) };

// ---- date of birth and youth
await as(DAN); await db.query('select public.cc_set_my_birth_date($1)', ['2012-05-01']);
await as(YARA); await db.query('select public.cc_set_my_birth_date($1)', ['2011-03-09']);
await test('a member can save a date of birth once, only a leader can change it', async () => {
  await as(DAN);
  await assert.rejects(db.query('select public.cc_set_my_birth_date($1)', ['2000-01-01']), /already saved/);
  await assert.rejects(db.query('select public.cc_admin_set_birth_date($1,$2)', [DAN, '2000-01-01']), /Administrator/);
  assert.equal((await one('select public.cc_is_youth($1) v', [DAN])).v, true);
  assert.equal((await one('select public.cc_is_youth($1) v', [BEA])).v, false, 'no birth date counts as adult');
});
await test('date of birth is private to the member and administrators', async () => {
  await as(BEA); assert.equal((await rows('select * from public.cc_member_safety')).length, 0);
  await as(DAN); assert.equal((await rows('select * from public.cc_member_safety')).length, 1);
  await as(ADMIN); assert.equal((await rows('select * from public.cc_member_safety')).length, 2);
});
await test('an adult cannot start a private chat with a young member', async () => {
  await as(BEA); await assert.rejects(db.query('select public.start_direct_chat($1)', [DAN]), /adults and youth/);
  await as(DAN); await assert.rejects(db.query('select public.start_direct_chat($1)', [BEA]), /adults and youth/);
});
await test('two young members can chat', async () => {
  await as(DAN); const c = (await one('select public.start_direct_chat($1) id', [YARA])).id;
  await action(c, 'send', {body: 'Hi Yara', client_id: 'd1000000-0000-0000-0000-000000000001'});
});
await test('the directory hides young members from adults and adults from young members', async () => {
  await as(BEA); const r = await rows('select * from public.cc_directory_rules()');
  assert.equal(r.find(x => x.user_id === DAN).hidden, true); assert.equal(r.find(x => x.user_id === EVE).hidden, false);
  await as(DAN); const y = await rows('select * from public.cc_directory_rules()');
  assert.equal(y.find(x => x.user_id === BEA).hidden, true); assert.equal(y.find(x => x.user_id === YARA).hidden, false);
});

// ---- guardians
await test('only an administrator can link a guardian', async () => {
  await as(BEA); await assert.rejects(db.query('select public.cc_set_guardian($1,$2,true)', [DAN, BEA]), /Administrator/);
  await as(ADMIN); await db.query('select public.cc_set_guardian($1,$2,true)', [DAN, GRACE]);
});
await test('a guardian can start a chat with their young member', async () => {
  await as(GRACE); const c = (await one('select public.start_direct_chat($1) id', [DAN])).id;
  await action(c, 'send', {body: 'Dinner at six', client_id: 'd1000000-0000-0000-0000-000000000002'});
});
await test('a guardian can read, not write in, the young members conversations', async () => {
  await as(DAN); const dy = (await rows('select id from public.conversations')).map(x => x.id);
  assert.ok(dy.length >= 2);
  await as(GRACE);
  const mine = await rows('select * from public.cc_my_youth_conversations()');
  assert.ok(mine.some(x => x.youth_name === 'Dan'));
  const yc = (await rows('select id from public.conversations')).map(x => x.id);
  for (const id of dy) assert.ok(yc.includes(id), 'guardian sees conversation');
  const dy2 = mine.find(x => x.label === 'Yara').conversation_id;
  assert.ok((await rows('select * from public.messages where conversation_id=$1', [dy2])).length >= 1, 'guardian reads messages');
  await assert.rejects(action(dy2, 'send', {body: 'Guardian reply'}), /unavailable/);
  const ppl = await rows('select * from public.cc_guardian_people($1)', [dy2]); assert.ok(ppl.some(p => p.display_name === 'Dan'));
});
await test('unrelated adults cannot read a young members conversations', async () => {
  await as(EVE); assert.equal((await rows('select * from public.messages')).length, 0);
});

// ---- ask first, and "no one"
await test('"ask me first" turns the first message into a request', async () => {
  await as(BEA); await db.query('select public.cc_set_chat_mode($1)', ['ask']);
  await as(EVE); const c = (await one('select public.start_direct_chat($1) id', [BEA])).id;
  assert.equal((await one('select status,requested_by from conversations where id=$1', [c])).status, 'request');
  await action(c, 'send', {body: 'Hello Bea', client_id: 'd1000000-0000-0000-0000-000000000003'});
  await assert.rejects(action(c, 'send', {body: 'Second', client_id: 'd1000000-0000-0000-0000-000000000004'}), /waiting to be accepted/);
  const again = await action(c, 'send', {body: 'Hello Bea', client_id: 'd1000000-0000-0000-0000-000000000003'});
  assert.ok(again.id, 'resending the same message is not an error');
  await as(BEA); await assert.rejects(action(c, 'send', {body: 'Reply too soon'}), /waiting to be accepted/);
  await assert.rejects(db.query('select public.cc_respond_chat($1,$2)', [c, 'maybe']), /accept, decline or block/);
  await db.query('select public.cc_respond_chat($1,$2)', [c, 'accept']);
  await action(c, 'send', {body: 'Welcome', client_id: 'd1000000-0000-0000-0000-000000000005'});
  await as(EVE); await action(c, 'send', {body: 'Thanks', client_id: 'd1000000-0000-0000-0000-000000000006'});
});
await test('the sender cannot accept their own request', async () => {
  await as(DAN); await db.query('select public.cc_set_chat_mode($1)', ['ask']);
  await as(YARA);
  // Yara and Dan already have a chat, so use a fresh pair: Eve asks Grace
  await as(GRACE); await db.query('select public.cc_set_chat_mode($1)', ['ask']);
  await as(EVE); const c = (await one('select public.start_direct_chat($1) id', [GRACE])).id;
  await assert.rejects(db.query('select public.cc_respond_chat($1,$2)', [c, 'accept']), /Not authorized/);
});
await test('declining a request removes it, blocking also blocks the sender', async () => {
  await as(GRACE); const c = (await one("select id from conversations where status='request' and requested_by=$1", [EVE])).id;
  await db.query('select public.cc_respond_chat($1,$2)', [c, 'block']);
  assert.equal((await rows('select id from conversations where id=$1', [c])).length, 0);
  await as(EVE); await assert.rejects(db.query('select public.start_direct_chat($1)', [GRACE]), /not available/);
  const r = (await rows('select * from public.cc_directory_rules()')).find(x => x.user_id === GRACE);
  assert.equal(r.hidden, true, 'a member who blocked you disappears from your directory');
});
await test('"no one" stops new private chats but keeps existing ones', async () => {
  await as(BEA); await db.query('select public.cc_set_chat_mode($1)', ['off']);
  await as(ADMIN); await assert.rejects(db.query('select public.start_direct_chat($1)', [BEA]), /not accepting/);
  const r = (await rows('select * from public.cc_directory_rules()')).find(x => x.user_id === BEA);
  assert.equal(r.can_message, false);
  await as(EVE); const c = (await one('select public.start_direct_chat($1) id', [BEA])).id;
  await action(c, 'send', {body: 'Still works', client_id: 'd1000000-0000-0000-0000-000000000007'});
});
await test('blocked members cannot message each other', async () => {
  await as(ADMIN); await db.query('select public.cc_set_chat_mode($1)', ['open']);
  await as(EVE); await db.query('select public.cc_set_chat_mode($1)', ['open']);
  await as(ADMIN); const c = (await one('select public.start_direct_chat($1) id', [EVE])).id;
  await action(c, 'send', {body: 'Before block', client_id: 'd1000000-0000-0000-0000-000000000008'});
  await as(EVE); await action(c, 'block', {user_id: ADMIN, enabled: true});
  await as(ADMIN); await assert.rejects(action(c, 'send', {body: 'After block', client_id: 'd1000000-0000-0000-0000-000000000009'}), /blocked/);
});

// ---- announcements
let upd;
await test('a broadcast can be pinned and given an expiry', async () => {
  await as(ADMIN); upd = (await one("select public.cc_send_broadcast('Service time','We start at nine',true,now()+interval '2 days') id")).id;
  const r = await one('select pinned,expires_at from member_updates where id=$1', [upd]);
  assert.equal(r.pinned, true); assert.ok(r.expires_at);
  await assert.rejects(db.query("select public.cc_send_broadcast('Old news','x',false,now()-interval '1 day')"), /future/);
  await as(BEA); await assert.rejects(db.query("select public.cc_send_broadcast('Hi there','x')"), /Only administrators/);
});
await test('"I\'ve seen this" is counted for leaders and private to each member', async () => {
  await as(BEA); await db.query('select public.cc_ack_update($1)', [upd]); await db.query('select public.cc_ack_update($1)', [upd]);
  await as(EVE); await db.query('select public.cc_ack_update($1)', [upd]);
  assert.equal((await rows('select * from public.cc_update_acks')).length, 1, 'a member sees only their own');
  await as(ADMIN);
  const s = (await rows('select * from public.cc_update_ack_summary()')).find(x => x.update_id === upd);
  assert.equal(Number(s.acked), 2); assert.ok(Number(s.total) >= 6);
  await as(BEA); await assert.rejects(db.query('select * from public.cc_update_ack_summary()'), /Not authorized/);
  await as(OTHER); await assert.rejects(db.query('select public.cc_ack_update($1)', [upd]), /not found/);
});

// ---- events
await test('administrators can see who is coming; members only see their own answer', async () => {
  await db.exec('reset role');
  const ev = (await one(`insert into public.church_events(title,starts_at,church_id,published) values('Choir rehearsal',now()+interval '3 days','${CH}',true) returning id`)).id;
  await as(BEA); await db.query('select public.cc_event_rsvp($1,$2)', [ev, 'going']);
  await as(EVE); await db.query('select public.cc_event_rsvp($1,$2)', [ev, 'maybe']);
  assert.equal((await rows('select * from public.cc_event_rsvps')).length, 1);
  await assert.rejects(db.query('select * from public.cc_event_rsvp_names($1)', [ev]), /Administrator/);
  await as(ADMIN); const names = await rows('select * from public.cc_event_rsvp_names($1)', [ev]);
  assert.deepEqual(names.map(x => x.display_name).sort(), ['Bea', 'Eve']);
});

// ---- health
await test('the health summary keeps the earlier keys and adds members with notifications on', async () => {
  await db.exec('reset role');
  await db.exec(`insert into public.member_push_subscriptions(user_id,endpoint,p256dh,auth) values('${BEA}','https://push.example/1','k','a')`);
  await as(ADMIN); const h = (await one('select public.cc_messaging_health() h')).h;
  assert.ok('reports' in h && 'push' in h); assert.equal(Number(h.members_with_devices), 1); assert.ok(Number(h.approved_members) >= 6);
  await as(BEA); await assert.rejects(db.query('select public.cc_messaging_health()'), /Administrator/);
});
console.log(`${checks} messaging safety checks passed`);
