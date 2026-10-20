// Rebuilds the LIVE database structure from the Supabase export (structure.json), applies the repo migrations on top,
// then proves two churches cannot see or change each other's data.
// Usage: node replica-multichurch.test.mjs <path-to-structure.json> [repo-folder]   (needs: npm i @electric-sql/pglite)
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
const structurePath = process.argv[2], repo = (process.argv[3] || 'D:/Projects/church-connect') + '/';
let d = JSON.parse(fs.readFileSync(structurePath, 'utf8')); if (typeof d === 'string') d = JSON.parse(d);
const db = new PGlite();
const U = {A1: 'a1000000-0000-0000-0000-000000000001', A2: 'a2000000-0000-0000-0000-000000000002', B1: 'b1000000-0000-0000-0000-000000000001', B2: 'b2000000-0000-0000-0000-000000000002', P: 'f0000000-0000-0000-0000-00000000000f', X: 'e0000000-0000-0000-0000-00000000000e', A3: 'a3000000-0000-0000-0000-000000000003'};

await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema storage;
alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
create function storage.foldername(n text) returns text[] language sql as $$ select string_to_array(n,'/') $$;
alter table storage.objects enable row level security;
grant usage on schema public,auth,storage to anon,authenticated; grant all on all tables in schema storage to authenticated;
`);
await db.exec(`insert into auth.users values ${Object.values(U).map(u => `('${u}')`).join(',')};`);

// --- 1. tables from the export (primary keys are not in the export; these are the ones the app relies on)
const PK = {member_profiles: 'user_id', church_admins: 'user_id', member_roles: 'user_id,role', ministry_members: 'ministry_id,user_id', conversation_members: 'conversation_id,user_id',
 church_settings: 'id', church_organization_preferences: 'id', cc_website_content: 'id', member_church_titles: 'user_id', ministry_join_requests: 'user_id,ministry_id', cc_directory_ministries: 'member_id,ministry_id'};
const skip = new Set(['member_push_subscriptions', 'member_sms_preferences']); // created by phase10/phase11 migrations below
for (const t of d.tables) {
  if (skip.has(t.table)) continue;
  const cols = t.columns.map(c => `"${c.name}" ${c.type}${c.not_null ? ' not null' : ''}${c.default ? ' default ' + c.default : ''}`);
  const pk = PK[t.table] || (t.columns.some(c => c.name === 'id') ? 'id' : null);
  if (pk) cols.push(`primary key (${pk})`);
  await db.exec(`create table public."${t.table}" (${cols.join(', ')}); alter table public."${t.table}" enable row level security;`);
}
await db.exec(`alter table public.cc_staff_delegations add unique(user_id,permission);`);
// --- 2. functions and policies exactly as exported
await db.exec('set check_function_bodies = off');
for (const f of d.functions) { if (f.name === 'rls_auto_enable') continue; await db.exec(f.definition) }
for (const p of d.policies) {
  if (skip.has(p.table)) continue;
  const roles = (p.roles || []).map(r => r === 'public' ? 'public' : r).join(',');
  await db.exec(`create policy "${p.name}" on ${p.schema}.${p.table} for ${p.command} to ${roles}${p.using ? ' using (' + p.using + ')' : ''}${p.with_check ? ' with check (' + p.with_check + ')' : ''}`);
}
console.log(`replica built: ${d.tables.length} tables, ${d.functions.length} functions, ${d.policies.length} policies`);

// --- 3. existing single-church data, created BEFORE the multi-church migration
await db.exec(`
insert into public.church_admins(user_id) values('${U.A1}');
insert into public.member_profiles(user_id,display_name,approved,directory_visible) values('${U.A1}','Admin A',true,true),('${U.A2}','Member A',true,true);
insert into public.ministries(id,name) values('aaaaaaaa-1111-1111-1111-111111111111','Ushers A');
insert into public.ministry_members values('aaaaaaaa-1111-1111-1111-111111111111','${U.A2}',false);
insert into public.church_events(title,starts_at,published) values('A Sunday service',now(),true),('A draft meeting',now(),false);
insert into public.conversations(id,kind) values('aaaaaaaa-2222-2222-2222-222222222222','direct');
insert into public.conversation_members values('aaaaaaaa-2222-2222-2222-222222222222','${U.A1}'),('aaaaaaaa-2222-2222-2222-222222222222','${U.A2}');
insert into public.messages(conversation_id,sender_id,body) values('aaaaaaaa-2222-2222-2222-222222222222','${U.A1}','hello from A');
insert into public.church_settings(id) values(true); insert into public.church_organization_preferences(id) values(true);
insert into public.cc_website_content(id,published,draft) values(1,'{"church":"A"}','{"church":"A"}');
`);

// --- 4. migrations, in the documented order; each must apply twice
const order = ['messaging-migration.sql', 'phase10-sms-migration.sql', 'phase11-push-migration.sql', 'phase12-hardening-migration.sql', 'multichurch-migration.sql', 'broadcast-migration.sql'];
let bad = 0;
for (const f of order) {
  const sql = fs.readFileSync(repo + f, 'utf8');
  for (const pass of ['apply', 'rerun']) { try { await db.exec(sql); if (pass === 'apply') console.log('APPLIED ', f) } catch (e) { bad++; console.log(`FAILED   ${f} (${pass}):`, e.message) } }
}
if (bad) { console.log('\nmigration failure, stopping'); process.exit(1) }

const run = async (role, uid, sql) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid || ''}',false); set role ${role};`);
  try { const r = await db.query(sql); return 'ok ' + JSON.stringify(r.rows).slice(0, 160) } catch (e) { return 'ERR ' + e.message } finally { await db.exec('reset role') }
};
const as = (u, sql) => run('authenticated', u, sql);
let fails = 0; const T = (n, exp, got) => { const ok = got.startsWith(exp); if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' => ' + got.slice(0, 200))) };
const rows = async (u, sql) => JSON.parse((await as(u, sql)).slice(3));

// platform owner + second church
await db.exec(`insert into public.cc_platform_admins values('${U.P}')`);
const defaultChurch = (await db.query(`select id from public.churches where slug='default'`)).rows[0].id;
T('existing data kept and assigned to the default church', 'ok [{"n":"0"}]', (await (async () => { const r = await db.query(`select (select count(*) from public.member_profiles where church_id<>'${defaultChurch}')::text n`); return 'ok ' + JSON.stringify(r.rows) })()));
T('default church is active and old messages survived', 'ok [{"c":"1"', await (async () => { const r = await db.query(`select (select count(*) from public.messages)::text c`); return 'ok ' + JSON.stringify(r.rows) })());
T('non-owner cannot create a church', 'ERR', await as(U.A1, `select public.cc_platform_create_church('Evil','evil','${U.A1}')`));
T('platform owner creates church B with its admin', 'ok', await as(U.P, `select public.cc_platform_create_church('Grace Chapel','grace','${U.B1}')`));
await db.exec(`insert into public.member_profiles(user_id,display_name,approved,directory_visible,church_id) select '${U.B2}','Member B',true,true,id from public.churches where slug='grace'`);
const B = (await db.query(`select id from public.churches where slug='grace'`)).rows[0].id;

// B's data, created by B's admin through the real functions
T('B admin creates a ministry', 'ok', await as(U.B1, `select public.cc_manage_ministry(null,'Choir B','save')`));
T('B admin adds a directory member', 'ok', await as(U.B1, `select public.cc_save_directory_member(null,'Sister B','9045550000',null,'Sis.','{}',null,null,true,'{}',true)`));
T('B admin posts an event', 'ok', await as(U.B1, `insert into public.church_events(title,starts_at,published) values('B Sunday service',now(),true) returning id`));
T('new event landed in church B, not A', 'ok [{"n":"1"}]', await (async () => { const r = await db.query(`select count(*)::text n from public.church_events where title='B Sunday service' and church_id='${B}'`); return 'ok ' + JSON.stringify(r.rows) })());
await as(U.A1, `select public.cc_save_directory_member(null,'Sister A','9045552222',null,'Sis.','{}',null,null,true,'{}',true)`);
const choirB = (await db.query(`select id from public.ministries where name='Choir B'`)).rows[0].id;
const dirB = (await db.query(`select id from public.cc_directory_members where full_name='Sister B'`)).rows[0].id;

// --- isolation: what B can see
T('B admin sees only B profiles', 'ok [{"display_name":"Member B"}', (await as(U.B1, `select display_name from public.member_profiles order by display_name desc`)));
T("B admin cannot see A's ministries", 'ok [{"name":"Choir B"}]', await as(U.B1, `select name from public.ministries`));
T("B admin cannot see A's directory", 'ok [{"full_name":"Sister B"}]', await as(U.B1, `select full_name from public.cc_directory_members`));
T("B admin cannot see A's conversations/messages", 'ok []', await as(U.B1, `select * from public.messages`));
T("B admin sees B's draft+published events only", 'ok [{"title":"B Sunday service"}]', await as(U.B1, `select title from public.church_events where church_id=(select public.cc_my_church_id())`));
T("B member cannot read A's draft events", 'ok []', await as(U.B2, `select title from public.church_events where title='A draft meeting'`));
T("B member can still read A's PUBLISHED event (public website data)", 'ok [{"title":"A Sunday service"}]', await as(U.B2, `select title from public.church_events where title like 'A Sunday%'`));
T('A admin sees only A profiles', 'ok [{"display_name":"Member A"}', await as(U.A1, `select display_name from public.member_profiles order by display_name desc`));
T("A admin cannot see B's directory", 'ok [{"full_name":"Sister A"}]', await as(U.A1, `select full_name from public.cc_directory_members`));
T("A admin cannot see B's ministries", 'ok [{"name":"Ushers A"}]', await as(U.A1, `select name from public.ministries`));

// --- isolation: what B's admin cannot DO to A (the security-definer functions bypass RLS, so each is checked)
T("cannot approve/suspend A's member", 'ERR Member not found', await as(U.B1, `select public.cc_manage_member('${U.A2}','suspend_member')`));
T("cannot set_member_approval on A's member", 'ERR', await as(U.B1, `select public.set_member_approval('${U.A2}',false)`));
T("cannot verify titles for A's member", 'ERR Member not found', await as(U.B1, `select public.cc_verify_titles('${U.A2}',array['Pastor'])`));
T("cannot delegate staff powers to A's member", 'ERR', await as(U.B1, `select public.cc_set_staff_delegation('${U.A2}','membership_manage',true)`));
T("cannot rename A's ministry", 'ERR Ministry not found', await as(U.B1, `select public.cc_manage_ministry('aaaaaaaa-1111-1111-1111-111111111111','Hijacked','save')`));
T("cannot schedule an activity in A's ministry", 'ERR Ministry not found', await as(U.B1, `select public.cc_create_ministry_activity('aaaaaaaa-1111-1111-1111-111111111111','Hijack','x',now())`));
T("cannot attach a directory member to A's ministry", 'ERR Invalid ministry', await as(U.B1, `select public.cc_save_directory_member(null,'Sneaky','1',null,'Sis.','{}',null,null,false,array['aaaaaaaa-1111-1111-1111-111111111111']::uuid[],true)`));
const dirA = (await db.query(`select id from public.cc_directory_members where full_name='Sister A'`)).rows[0].id;
T("cannot edit one of A's directory records", 'ERR Directory member not found', await as(U.B1, `select public.cc_save_directory_member('${dirA}','Renamed','1',null,'Sis.','{}',null,null,false,'{}',true)`));
T("cannot start a direct chat with A's member", 'ERR', await as(U.B2, `select public.start_direct_chat('${U.A2}')`));
T("cannot post into A's conversation", 'ERR', await as(U.B2, `insert into public.messages(conversation_id,sender_id,body) values('aaaaaaaa-2222-2222-2222-222222222222','${U.B2}','intruder')`));
T("cannot add self to A's ministry", 'ERR', await as(U.B1, `insert into public.ministry_members values('aaaaaaaa-1111-1111-1111-111111111111','${U.B2}',true)`));
T("cannot write an event into church A", 'ERR', await as(U.B1, `insert into public.church_events(title,starts_at,church_id) values('x',now(),'${defaultChurch}')`));
T("cannot delete A's events", 'ok []', await as(U.B1, `delete from public.church_events where title like 'A %' returning id`));
T("cannot read A's text numbers", 'ERR', await as(U.B1, `select * from public.cc_phone_sms_recipients('aaaaaaaa-2222-2222-2222-222222222222',false)`));

// --- own church still works (regression)
T('A admin still adds a directory member', 'ok', await as(U.A1, `select public.cc_save_directory_member(null,'Mother A','9045551111',null,'Sis.','{}',null,null,true,array['aaaaaaaa-1111-1111-1111-111111111111']::uuid[],true)`));
T('A admin approves own member', 'ok', await as(U.A1, `select public.cc_manage_member('${U.A2}','approve_member')`));
T('A member reads own conversation', 'ok [{"body":"hello from A"}]', await as(U.A2, `select body from public.messages`));
T('A member sends a message', 'ok', await as(U.A2, `insert into public.messages(conversation_id,sender_id,body) values('aaaaaaaa-2222-2222-2222-222222222222','${U.A2}','hi back') returning id`));

// --- website content per church
T('A admin saves + publishes its site', 'ok', await as(U.A1, `select public.cc_save_website_draft('{"church":"A2"}'::jsonb)`));
await as(U.A1, `select public.cc_publish_website()`);
await as(U.B1, `select public.cc_save_website_draft('{"church":"B"}'::jsonb)`); await as(U.B1, `select public.cc_publish_website()`);
T('public site shows church A for A', 'ok [{"cc_public_website":{"church":"A2"}}]', await run('anon', '', `select public.cc_public_website('${defaultChurch}')`));
T('public site shows church B for B', 'ok [{"cc_public_website":{"church":"B"}}]', await run('anon', '', `select public.cc_public_website('${B}')`));

// --- sign-up
await db.exec(`insert into public.cc_platform_admins values('${U.X}') on conflict do nothing`); await db.exec(`delete from public.cc_platform_admins where user_id='${U.X}'`);
T('sign-up without choosing a church fails when 2 churches exist', 'ERR Choose a church', await as(U.X, `select public.create_my_profile('New Person')`));
T('sign-up with a church id works', 'ok', await as(U.X, `select public.create_my_profile('New Person','${B}')`));
T('new sign-up is NOT approved and sits in church B', 'ok [{"approved":false', await as(U.X, `select approved,(church_id='${B}') ok from public.member_profiles where user_id='${U.X}'`));

// --- subscriptions
T('subscription visible to its own admin only', 'ok [{"status":"trialing"}]', await as(U.B1, `select status from public.church_subscriptions`));
T('plain member cannot read subscription', 'ok []', await as(U.B2, `select status from public.church_subscriptions`));
T('non-owner cannot change subscription', 'ERR', await as(U.B1, `select public.cc_platform_set_subscription('${B}','pro','active')`));
T('owner cancels church B', 'ok', await as(U.P, `select public.cc_platform_set_subscription('${B}','pro','canceled')`));
T('canceled church can still READ its data', 'ok [{"name":"Choir B"}]', await as(U.B1, `select name from public.ministries`));
T('canceled church cannot post events', 'ERR', await as(U.B1, `insert into public.church_events(title,starts_at) values('late',now())`));
T('canceled church cannot add ministries', 'ERR', await as(U.B1, `select public.cc_manage_ministry(null,'Late','save')`));
T('canceled church cannot add directory members', 'ERR', await as(U.B1, `select public.cc_save_directory_member(null,'Late Person','1',null,'Sis.','{}',null,null,false,'{}',true)`));
T('canceled church cannot start chats', 'ERR', await as(U.B2, `select public.start_direct_chat('${U.B1}')`));
T('church A unaffected by B cancellation', 'ok', await as(U.A1, `insert into public.church_events(title,starts_at) values('A still works',now()) returning id`));
T('owner reactivates church B', 'ok', await as(U.P, `select public.cc_platform_set_subscription('${B}','pro','active')`));
T('reactivated church can post again', 'ok', await as(U.B1, `insert into public.church_events(title,starts_at) values('back',now()) returning id`));
await db.exec(`update public.church_subscriptions set status='trialing',trial_ends_at=now()-interval '1 day' where church_id='${B}'`);
T('expired trial behaves like canceled', 'ERR', await as(U.B1, `insert into public.church_events(title,starts_at) values('expired',now())`));

// --- anonymous visitors
T('anon reads published events of any church (public site)', 'ok [{"title"', await run('anon', '', `select title from public.church_events order by title limit 1`));
T('anon cannot read drafts', 'ok []', await run('anon', '', `select title from public.church_events where not published`));
T('anon cannot read members', 'ERR', await run('anon', '', `select * from public.member_profiles`));
T('anon cannot read messages', 'ERR', await run('anon', '', `select * from public.messages`));
T('anon cannot TRUNCATE anything', 'ERR', await run('anon', '', `truncate public.church_events`));
T('members cannot TRUNCATE', 'ERR', await as(U.A1, `truncate public.church_events`));
T('anon cannot write events', 'ERR', await run('anon', '', `insert into public.church_events(title,starts_at,church_id) values('x',now(),'${defaultChurch}')`));
T('nobody can change the platform owner list', 'ERR', await as(U.A1, `insert into public.cc_platform_admins values('${U.A1}')`));
T('nobody can read the platform owner list', 'ERR', await as(U.A1, `select * from public.cc_platform_admins`));


// --- church-wide broadcast + pastor access
await db.exec(`insert into public.member_profiles(user_id,display_name,approved,directory_visible,church_id) values('${U.A3}','Member A3',true,true,'${defaultChurch}')`);
await db.exec(`insert into public.member_sms_preferences(user_id,phone,opted_in,has_app) values('${U.A2}','+19045550101',true,false),('${U.B2}','+19045550202',true,false)`);
T('admin can broadcast (cc_can_broadcast)', 'ok [{"cc_can_broadcast":true}]', await as(U.A1, `select public.cc_can_broadcast()`));
T('plain member cannot broadcast (cc_can_broadcast)', 'ok [{"cc_can_broadcast":false}]', await as(U.A3, `select public.cc_can_broadcast()`));
T('plain member is refused when sending', 'ERR Only administrators and pastors', await as(U.A3, `select public.cc_send_broadcast('Hi','There')`));
T('admin sends a broadcast', 'ok', await as(U.A1, `select public.cc_send_broadcast('Sunday moved','Service is at 11am')`));
T('title and message are validated', 'ERR Title must be', await as(U.A1, `select public.cc_send_broadcast('x','body')`));
T('members of the same church see it under Updates', 'ok [{"title":"Sunday moved"}]', await as(U.A3, `select title from public.member_updates where ministry_id is null`));
T("another church's members do NOT see it", 'ok []', await as(U.B2, `select title from public.member_updates where title='Sunday moved'`));
T('broadcast row carries the right church and no ministry', 'ok [{"n":"1"}]', await (async () => { const r = await db.query(`select count(*)::text n from public.member_updates where title='Sunday moved' and church_id='${defaultChurch}' and ministry_id is null`); return 'ok ' + JSON.stringify(r.rows) })());
// pastor access
T('plain member cannot grant pastor access', 'ERR Administrator access required', await as(U.A3, `select public.cc_set_pastor_access('${U.A2}',true)`));
T('admin cannot change own access', 'ERR You cannot change your own access', await as(U.A1, `select public.cc_set_pastor_access('${U.A1}',false)`));
T("another church's admin cannot grant access to A's member", 'ERR Select an approved member', await (async () => { await as(U.P, `select public.cc_platform_set_subscription('${B}','pro','active')`); return await as(U.B1, `select public.cc_set_pastor_access('${U.A2}',true)`) })());
T('before: member cannot open admin pages (no church_admins row)', 'ok []', await as(U.A2, `select user_id from public.church_admins`));
T('admin gives A2 pastor access', 'ok', await as(U.A1, `select public.cc_set_pastor_access('${U.A2}',true)`));
T('pastor can now pass the admin-page check', 'ok [{"user_id":"' + U.A2 + '"}]', await as(U.A2, `select user_id from public.church_admins`));
T('pastor has admin functions (cc_is_admin)', 'ok [{"cc_is_admin":true}]', await as(U.A2, `select public.cc_is_admin()`));
T('pastor can add directory members', 'ok', await as(U.A2, `select public.cc_save_directory_member(null,'Added by pastor','9045559999',null,'Bro.','{}',null,null,false,'{}',true)`));
T('pastor can broadcast', 'ok', await as(U.A2, `select public.cc_send_broadcast('From the pastor','Prayer tonight at 7')`));
T("pastor still cannot reach another church's data", 'ok []', await as(U.A2, `select * from public.cc_directory_members where full_name='Sister B'`));
T('access list shows only my church', 'ok [{"n":"3"}]', await as(U.A1, `select count(*)::text n from public.cc_member_access()`));
T('access list flags the pastor', 'ok [{"user_id":"' + U.A2 + '"', await as(U.A1, `select user_id,is_pastor from public.cc_member_access() where is_pastor`));
T('cannot remove access from someone never given it', 'ERR This person was not given pastor access', await as(U.A1, `select public.cc_set_pastor_access('${U.A3}',false)`));
T('admin removes pastor access', 'ok', await as(U.A1, `select public.cc_set_pastor_access('${U.A2}',false)`));
T('former pastor is no longer an admin', 'ok []', await as(U.A2, `select user_id from public.church_admins`));
T('former pastor can no longer broadcast', 'ERR Only administrators and pastors', await as(U.A2, `select public.cc_send_broadcast('x1','y')`));
// texting the broadcast
T('broadcast text list = opted-in app-less members + consented directory members, own church only', 'ok [{"n":"3"}]', await as(U.A1, `select count(*)::text n from public.cc_broadcast_sms_recipients(true)`));
T("another church's numbers are never included", 'ok [{"n":"0"}]', await as(U.A1, `select count(*)::text n from public.cc_broadcast_sms_recipients(false) where phone like '%0202'`));
T('plain member cannot list numbers to text', 'ERR Only administrators and pastors', await as(U.A3, `select * from public.cc_broadcast_sms_recipients(true)`));
// limits and subscription
await db.exec(`insert into public.member_updates(church_id,title,body,created_by,created_at) select '${defaultChurch}','filler '||g,'x','${U.A1}',now() from generate_series(1,8) g`);
T('11th broadcast within an hour is blocked', 'ERR Too many broadcasts', await as(U.A1, `select public.cc_send_broadcast('One too many','x')`));
T('canceled church cannot broadcast', 'ERR This church', await (async () => { await as(U.P, `select public.cc_platform_set_subscription('${B}','pro','canceled')`); return await as(U.B1, `select public.cc_send_broadcast('Late news','x')`) })());
await as(U.P, `select public.cc_platform_set_subscription('${B}','pro','active')`);
T('church B admin can broadcast to church B', 'ok', await as(U.B1, `select public.cc_send_broadcast('B news','Welcome to Grace Chapel')`));
T("church A members do not see B's broadcast", 'ok []', await as(U.A3, `select title from public.member_updates where title='B news'`));

// --- rollback: restores the single-church shape and the original functions
await db.exec(`reset role`);
let refused = 'no error'; try { await db.exec(fs.readFileSync(repo + 'multichurch-rollback.sql', 'utf8')) } catch (e) { refused = 'ERR ' + e.message }
T('rollback refuses while a second church exists', 'ERR More than one church', refused);
await db.exec(`delete from public.churches where id='${B}'`); // cascades away church B's rows
await db.exec(fs.readFileSync(repo + 'multichurch-rollback.sql', 'utf8'));
await db.exec(fs.readFileSync(repo + 'multichurch-rollback.sql', 'utf8')); // re-runnable
T('rollback removes church_id', 'ok [{"n":"0"}]', await (async () => { const r = await db.query(`select count(*)::text n from information_schema.columns where table_schema='public' and column_name='church_id'`); return 'ok ' + JSON.stringify(r.rows) })());
T('rollback restores the original no-argument site function', 'ok [{"cc_public_website"', await run('anon', '', `select public.cc_public_website()`));
T('rollback leaves data in place', 'ok [{"n":"2"}]', await (async () => { const r = await db.query(`select count(*)::text n from public.messages`); return 'ok ' + JSON.stringify(r.rows) })());
T('after rollback the original rules still hold (A admin adds directory member)', 'ok', await as(U.A1, `select public.cc_save_directory_member(null,'After Rollback','9045553333',null,'Sis.','{}',null,null,true,'{}',true)`));
T('after rollback members still cannot read admin data', 'ok []', await as(U.A2, `select * from public.cc_directory_members`));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
