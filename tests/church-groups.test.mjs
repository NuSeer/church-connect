// Checks the Whole Church group, ministry homes (schedule cards with RSVP, files, discussions) and the pastoral care channel.
// Runs on an embedded Postgres (PGlite) built from the same files a new project gets.
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
process.on('uncaughtException', e => { console.error('FAIL', e.message); process.exit(1) });
const db = new PGlite();
const root = new URL('../', import.meta.url);
const sql = f => fs.readFileSync(new URL(f, root), 'utf8');
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;alter default privileges in schema public grant all on tables to anon,authenticated,service_role;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);create function storage.foldername(n text) returns text[] language sql as $$select string_to_array(n,'/')$$;create function storage.filename(n text) returns text language sql as $$select (string_to_array(n,'/'))[array_length(string_to_array(n,'/'),1)]$$;alter table storage.objects enable row level security;grant usage on schema public,auth,storage to anon,authenticated;grant all on all tables in schema storage to authenticated;`);
for (const f of ['fresh-install/01-structure.sql', 'fresh-install/02-features-and-seed.sql', 'church-groups-migration.sql', 'church-groups-migration.sql']) { await db.exec(sql(f)); console.log('PASS migration', f) }
const U = n => `a${n}000000-0000-0000-0000-00000000000${n}`;
const [ADMIN, PASTOR, LEADER, MEMBER, LATER, OTHER] = [1, 2, 3, 4, 5, 6].map(U);
const CH = 'c1000000-0000-0000-0000-000000000001', CH2 = 'c2000000-0000-0000-0000-000000000002';
const first = [[ADMIN, 'Alice Admin'], [PASTOR, 'Pat Pastor'], [LEADER, 'Lee Leader'], [MEMBER, 'Mia Member']];
await db.exec(`insert into auth.users values ${[...first, [LATER, 'Later'], [OTHER, 'Other']].map(([id, n]) => `('${id}','${n.split(' ')[0]}@example.invalid')`).join(',')};
 insert into public.churches(id,name,slug) values('${CH}','Church A','church-a'),('${CH2}','Church B','church-b');
 insert into public.church_subscriptions(church_id,status,plan) values('${CH}','active','complete'),('${CH2}','active','complete');
 insert into public.church_admins(user_id,church_id) values('${ADMIN}','${CH}');
 insert into public.member_roles(user_id,role,church_id) values('${PASTOR}','pastor','${CH}');
 insert into public.member_profiles(user_id,display_name,approved,church_id,directory_visible) values ${first.map(([id, n]) => `('${id}','${n}',true,'${CH}',true)`).join(',')},('${LATER}','Lena Later',false,'${CH}',true),('${OTHER}','Other church',true,'${CH2}',true);`);
const as = async u => { await db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${u}',false)`) };
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
const rows = async (q, p = []) => (await db.query(q, p)).rows;
const action = async (c, a, p = {}) => (await one('select public.cc_chat_action($1,$2,$3::jsonb) result', [c, a, JSON.stringify(p)])).result;
let checks = 0;
const test = async (name, fn) => { await fn(); checks++; console.log('PASS', name) };

// ---- Whole Church
let whole;
await test('every approved member is in the Whole Church group, other churches have their own', async () => {
  await db.exec('reset role');
  const r = await rows("select id,church_id from conversations where whole_church"); assert.equal(r.length, 2);
  whole = r.find(x => x.church_id === CH).id;
  const m = (await rows('select user_id from conversation_members where conversation_id=$1', [whole])).map(x => x.user_id).sort();
  assert.deepEqual(m, [ADMIN, PASTOR, LEADER, MEMBER].sort());
});
await test('a newly approved member joins it, an unapproved one leaves it', async () => {
  await db.exec(`reset role; update public.member_profiles set approved=true where user_id='${LATER}'`);
  assert.equal((await rows('select 1 from conversation_members where conversation_id=$1 and user_id=$2', [whole, LATER])).length, 1);
  await db.exec(`update public.member_profiles set approved=false where user_id='${LATER}'`);
  assert.equal((await rows('select 1 from conversation_members where conversation_id=$1 and user_id=$2', [whole, LATER])).length, 0);
  await db.exec(`update public.member_profiles set approved=true where user_id='${LATER}'`);
});
await test('everyone can talk in it, and it appears in each persons chat list', async () => {
  await as(MEMBER); await action(whole, 'send', {body: 'Praise the Lord', client_id: 'd1000000-0000-0000-0000-000000000001'});
  const list = await one('select public.cc_chat_list() l'); const w = list.l.find(x => x.id === whole);
  assert.ok(w && w.whole_church === true && w.label === 'Whole Church');
});
await test('a pastor or administrator can make it announcements-only, a member cannot', async () => {
  await as(MEMBER); await assert.rejects(action(whole, 'manage', {announcement_only: true}), /Leader/);
  await as(PASTOR); await action(whole, 'manage', {announcement_only: true});
  await as(MEMBER); await assert.rejects(action(whole, 'send', {body: 'Member post', client_id: 'd1000000-0000-0000-0000-000000000002'}), /leaders/);
  await as(PASTOR); await action(whole, 'send', {body: 'Service at nine', client_id: 'd1000000-0000-0000-0000-000000000003'});
  await as(ADMIN); await action(whole, 'manage', {announcement_only: false});
});
await test('muting works for the group', async () => {
  await as(MEMBER); await action(whole, 'preferences', {muted: true});
  assert.equal((await one('select public.cc_chat_list() l')).l.find(x => x.id === whole).muted, true);
});
await test('other churches cannot see it', async () => { await as(OTHER); assert.equal((await rows('select id from conversations where id=$1', [whole])).length, 0) });

// ---- Ministry home
let ministry, activity, topic;
await test('a new ministry gets its group chat automatically', async () => {
  await db.exec(`reset role; insert into public.ministries(name,church_id) values('Choir','${CH}'); `);
  ministry = (await one("select id from ministries where name='Choir'")).id;
  assert.equal((await rows("select id from conversations where kind='ministry' and ministry_id=$1", [ministry])).length, 1);
  await db.exec(`insert into public.ministry_members(ministry_id,user_id,is_leader) values('${ministry}','${LEADER}',true),('${ministry}','${MEMBER}',false)`);
});
await test('only a ministry leader can add to the schedule', async () => {
  await as(MEMBER); await assert.rejects(db.query('select public.cc_save_ministry_activity(null,$1,$2,$3,$4)', [ministry, 'Rehearsal', 'Bring music', '2026-12-02T23:00:00Z']), /ministry leaders/);
  await as(LEADER); activity = (await one('select public.cc_save_ministry_activity(null,$1,$2,$3,$4) id', [ministry, 'Rehearsal', 'Bring music', '2026-12-02T23:00:00Z'])).id;
  topic = (await one('select conversation_id from ministry_activities where id=$1', [activity])).conversation_id; assert.ok(topic);
});
await test('the activity has a discussion that the ministry members can read, with the announcement in it', async () => {
  await as(MEMBER); const m = await rows('select body from messages where conversation_id=$1', [topic]);
  assert.ok(m.length === 1 && /New: Rehearsal/.test(m[0].body), JSON.stringify(m));
  await action(topic, 'send', {body: 'I will be there', client_id: 'd1000000-0000-0000-0000-000000000004'});
  await as(OTHER); assert.equal((await rows('select 1 from messages where conversation_id=$1', [topic])).length, 0);
});
await test('someone who joins the ministry later is added to the discussion', async () => {
  await db.exec(`reset role; insert into public.ministry_members(ministry_id,user_id) values('${ministry}','${LATER}')`);
  await as(LATER); assert.ok((await rows('select 1 from conversations where id=$1', [topic])).length === 1);
});
await test('changing the time updates the card and tells the group in the discussion', async () => {
  await as(LEADER); await db.query('select public.cc_save_ministry_activity($1,$2,$3,$4,$5)', [activity, ministry, 'Rehearsal', 'Bring music', '2026-12-03T00:00:00Z']);
  await as(MEMBER); const m = await rows('select body from messages where conversation_id=$1 order by created_at,id', [topic]);
  assert.ok(m.some(x => /Time changed: Rehearsal is now/.test(x.body)), JSON.stringify(m));
  assert.equal((await one('select starts_at from ministry_activities where id=$1', [activity])).starts_at.toISOString(), '2026-12-03T00:00:00.000Z');
});
await test('members can RSVP, see the totals, and only leaders see the names', async () => {
  await as(MEMBER); await db.query('select public.cc_activity_rsvp($1,$2)', [activity, 'going']);
  await as(LATER); await db.query('select public.cc_activity_rsvp($1,$2)', [activity, 'maybe']);
  await as(MEMBER); const o = (await rows('select * from public.cc_activity_overview($1)', [ministry])).find(x => x.activity_id === activity);
  assert.equal(Number(o.going), 1); assert.equal(Number(o.maybe), 1); assert.equal(o.mine, 'going');
  await assert.rejects(db.query('select * from public.cc_activity_rsvp_names($1)', [activity]), /leaders/);
  await as(LEADER); const n = await rows('select * from public.cc_activity_rsvp_names($1)', [activity]); assert.equal(n.length, 2);
  await as(OTHER); await assert.rejects(db.query('select public.cc_activity_rsvp($1,$2)', [activity, 'going']), /unavailable/);
});
await test('leaders add files, members can read them, outsiders cannot', async () => {
  await db.exec(`reset role; insert into storage.objects(bucket_id,name) values('ministry-files','${ministry}/${activity}/song.pdf')`);
  await as(MEMBER); await assert.rejects(db.query('select public.cc_add_activity_file($1,$2,$3,$4,$5,$6)', [ministry, activity, `${ministry}/${activity}/song.pdf`, 'song.pdf', 'application/pdf', 1000]), /leaders/);
  await as(LEADER); await assert.rejects(db.query('select public.cc_add_activity_file($1,$2,$3,$4,$5,$6)', [ministry, activity, `${ministry}/${activity}/missing.pdf`, 'missing.pdf', 'application/pdf', 1000]), /not uploaded/);
  const id = (await one('select public.cc_add_activity_file($1,$2,$3,$4,$5,$6) id', [ministry, activity, `${ministry}/${activity}/song.pdf`, 'song.pdf', 'application/pdf', 1000])).id;
  await as(MEMBER); assert.equal((await rows('select * from cc_activity_files')).length, 1);
  await as(OTHER); assert.equal((await rows('select * from cc_activity_files')).length, 0);
  await as(MEMBER); await assert.rejects(db.query('select public.cc_remove_activity_file($1)', [id]), /leaders/);
  await as(LEADER); assert.equal((await one('select public.cc_remove_activity_file($1) p', [id])).p, `${ministry}/${activity}/song.pdf`);
});
await test('the roster shows names and leaders to the ministry', async () => {
  await as(MEMBER); const r = await rows('select * from public.cc_ministry_roster($1)', [ministry]);
  assert.equal(r[0].display_name, 'Lee Leader'); assert.equal(r[0].is_leader, true); assert.ok(r.length >= 3);
  await as(OTHER); assert.equal((await rows('select * from public.cc_ministry_roster($1)', [ministry])).length, 0);
});
await test('a leader can delete an activity and its discussion is archived, not erased', async () => {
  await as(MEMBER); await assert.rejects(db.query('select public.cc_delete_ministry_activity($1)', [activity]), /leaders/);
  await as(LEADER); await db.query('select public.cc_delete_ministry_activity($1)', [activity]);
  assert.equal((await one('select archived from conversations where id=$1', [topic])).archived, true);
});

// ---- Pastoral care
await test('with no care team, the pastor receives it; the person sees who before sending', async () => {
  await as(MEMBER); const r = await rows('select * from public.cc_care_recipients()'); assert.deepEqual(r.map(x => x.display_name), ['Pat Pastor']);
});
await test('an administrator can name a care team, and it replaces the pastor list', async () => {
  await as(MEMBER); await assert.rejects(db.query('select public.cc_set_care_member($1,true)', [LEADER]), /Administrator/);
  await as(ADMIN); await db.query('select public.cc_set_care_member($1,true)', [LEADER]); await db.query('select public.cc_set_care_member($1,true)', [PASTOR]);
  await as(MEMBER); assert.deepEqual((await rows('select * from public.cc_care_recipients()')).map(x => x.display_name).sort(), ['Lee Leader', 'Pat Pastor']);
  await as(ADMIN); assert.equal((await rows('select * from public.cc_care_team_list()')).length, 2);
});
let care;
await test('a request becomes a private conversation with only that person and the care team', async () => {
  await as(MEMBER); care = (await one('select public.cc_send_pastoral_care($1,$2) id', ['Prayer request', 'Please pray for my family'])).id;
  const m = (await rows('select user_id from conversation_members where conversation_id=$1', [care])).map(x => x.user_id).sort();
  assert.deepEqual(m, [MEMBER, LEADER, PASTOR].sort());
  await as(PASTOR); assert.equal((await rows('select body from messages where conversation_id=$1', [care]))[0].body, 'Please pray for my family');
  await action(care, 'send', {body: 'We are praying with you', client_id: 'd1000000-0000-0000-0000-000000000005'});
});
await test('nobody else can read it, not even an administrator who is not on the team', async () => {
  await as(ADMIN); assert.equal((await rows('select 1 from messages where conversation_id=$1', [care])).length, 0);
  await as(LATER); assert.equal((await rows('select 1 from conversations where id=$1', [care])).length, 0);
});
await test('nobody can add people to it or change it', async () => {
  await as(PASTOR); await assert.rejects(action(care, 'manage', {member_id: ADMIN, remove: false}), /Leader/);
  await as(ADMIN); await assert.rejects(action(care, 'manage', {title: 'Renamed'}), /unavailable|Leader/);
});
await test('what it is about must be one of the listed topics, and there is a daily limit', async () => {
  await as(MEMBER); await assert.rejects(db.query('select public.cc_send_pastoral_care($1,$2)', ['Gossip', 'x']), /Choose what/);
  for (let i = 0; i < 4; i++) await db.query('select public.cc_send_pastoral_care($1,$2)', ['Something else', 'Hello ' + i]);
  await assert.rejects(db.query('select public.cc_send_pastoral_care($1,$2)', ['Something else', 'One too many']), /several requests/);
});
console.log(`${checks} church group checks passed`);
