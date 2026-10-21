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
create table auth.users(id uuid primary key, email text);
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
create function storage.foldername(n text) returns text[] language sql as $$ select string_to_array(n,'/') $$;
create function storage.filename(n text) returns text language sql as $$ select (string_to_array(n,'/'))[array_length(string_to_array(n,'/'),1)] $$;
alter table storage.objects enable row level security;
grant usage on schema public,auth,storage to anon,authenticated; grant all on all tables in schema storage to authenticated;
`);
await db.exec(`insert into auth.users(id,email) values ${Object.entries(U).map(([k, u]) => `('${u}','${k.toLowerCase()}@example.invalid')`).join(',')};`);

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
const order = ['messaging-migration.sql', 'phase10-sms-migration.sql', 'phase11-push-migration.sql', 'phase12-hardening-migration.sql', 'multichurch-migration.sql', 'broadcast-migration.sql', 'events-sync-migration.sql', 'photos-security-migration.sql', 'platform-migration.sql'];
let bad = 0;
for (const f of order) {
  const sql = fs.readFileSync(repo + f, 'utf8');
  for (const pass of ['apply', 'rerun']) { try { await db.exec(sql); if (pass === 'apply') console.log('APPLIED ', f) } catch (e) { bad++; console.log(`FAILED   ${f} (${pass}):`, e.message) } }
}
if (bad) { console.log('\nmigration failure, stopping'); process.exit(1) }

const run = async (role, uid, sql) => {
  const em = uid ? ((await db.query(`select email from auth.users where id=$1`, [uid])).rows[0]?.email || '') : '';
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid || ''}',false); select set_config('request.jwt.claims','${JSON.stringify({sub: uid || '', email: em})}',false); set role ${role};`);
  try { const r = await db.query(sql); return 'ok ' + JSON.stringify(r.rows).slice(0, 6000) } catch (e) { return 'ERR ' + e.message } finally { await db.exec('reset role') }
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


// --- events from the church website (feed address + rows marked as website-sourced)
T('new columns exist', 'ok [{"n":"6"}]', await (async () => { const r = await db.query(`select count(*)::text n from information_schema.columns where table_schema='public' and ((table_name='churches' and column_name in ('events_feed_url','events_timezone','events_synced_at','events_sync_status')) or (table_name='church_events' and column_name in ('source','external_id')))`); return 'ok ' + JSON.stringify(r.rows) })());
T('plain member cannot set the feed address', 'ERR Administrator access required', await as(U.A3, `select public.cc_set_events_feed('https://example.org/api/events')`));
for (const [label, url] of [['http (not https)', 'http://example.org/e'], ['an IP address', 'https://10.0.0.5/e'], ['localhost', 'https://localhost/e'], ['a name with no dot', 'https://intranet/e'], ['an .internal name', 'https://db.internal/e'], ['text with spaces', 'https://example.org/a b'], ['a javascript link', 'javascript:alert(1)']])
  T(`feed address rejected: ${label}`, 'ERR', await as(U.A1, `select public.cc_set_events_feed('${url}')`));
T('admin sets the church feed address', 'ok', await as(U.A1, `select public.cc_set_events_feed('https://newbeginningsoutreachctrcogic.org/api/events','America/New_York')`));
T('it was stored for church A only', 'ok [{"slug":"default","events_feed_url":"https://newbeginningsoutreachctrcogic.org/api/events"', await (async () => { const r = await db.query(`select slug,events_feed_url,events_sync_status from public.churches where events_feed_url is not null`); return 'ok ' + JSON.stringify(r.rows) })());
T('status says it is waiting for the first sync', 'ok [{"events_sync_status":"Waiting for first sync"}]', await (async () => { const r = await db.query(`select events_sync_status from public.churches where slug='default'`); return 'ok ' + JSON.stringify(r.rows) })());
T("church B admin changes only church B's address", 'ok [{"n":"1"}]', await (async () => { await as(U.B1, `select public.cc_set_events_feed('https://grace.example.org/events.json','America/Chicago')`); const r = await db.query(`select count(*)::text n from public.churches where slug='default' and events_feed_url like 'https://newbeginnings%'`); return 'ok ' + JSON.stringify(r.rows) })());
T('an unknown time zone is rejected', 'ERR Unknown time zone', await as(U.A1, `select public.cc_set_events_feed('https://newbeginningsoutreachctrcogic.org/api/events','Mars/Phobos')`));
T('anyone can read the church row (public site) but cannot change it', 'ERR', await as(U.A3, `update public.churches set events_feed_url='https://evil.example.org/x'`));
await db.exec(`insert into public.church_events(church_id,title,starts_at,source,external_id) values('${defaultChurch}','From site','2026-11-01 14:00+00','website','271')`);
T('the same website event cannot be stored twice for one church', 'ERR', await (async () => { try { await db.exec(`insert into public.church_events(church_id,title,starts_at,source,external_id) values('${defaultChurch}','Dupe','2026-11-01 14:00+00','website','271')`); return 'ok' } catch (e) { return 'ERR ' + e.message } })());
T('another church may reuse the same website event number', 'ok', await (async () => { try { await db.exec(`insert into public.church_events(church_id,title,starts_at,source,external_id) values('${B}','Other church 271','2026-11-01 14:00+00','website','271')`); return 'ok' } catch (e) { return 'ERR ' + e.message } })());
T('hand-made events (no source) are never treated as duplicates', 'ok', await (async () => { try { await db.exec(`insert into public.church_events(church_id,title,starts_at) values('${defaultChurch}','Hand 1','2026-11-02 14:00+00'),('${defaultChurch}','Hand 2','2026-11-02 14:00+00')`); return 'ok' } catch (e) { return 'ERR ' + e.message } })());
T('upsert on (church, source, external id) updates in place', 'ok [{"title":"From site (edited)"}]', await (async () => { await db.exec(`insert into public.church_events(church_id,title,starts_at,source,external_id) values('${defaultChurch}','From site (edited)','2026-11-01 15:00+00','website','271') on conflict (church_id,source,external_id) do update set title=excluded.title,starts_at=excluded.starts_at`); const r = await db.query(`select title from public.church_events where church_id='${defaultChurch}' and source='website' and external_id='271'`); return 'ok ' + JSON.stringify(r.rows) })());
T('members read synced events like any other event', 'ok [{"title":"From site (edited)"}]', await as(U.A3, `select title from public.church_events where source='website' and church_id='${defaultChurch}'`));
T("church B members cannot see church A's unpublished synced rows", 'ok []', await (async () => { await db.exec(`update public.church_events set published=false where source='website' and church_id='${defaultChurch}'`); return await as(U.B2, `select title from public.church_events where source='website' and church_id='${defaultChurch}'`) })());
T('admin clears the address', 'ok', await as(U.A1, `select public.cc_set_events_feed('')`));
T('clearing removes the feed and the status', 'ok [{"events_feed_url":null,"events_sync_status":null}]', await (async () => { const r = await db.query(`select events_feed_url,events_sync_status from public.churches where slug='default'`); return 'ok ' + JSON.stringify(r.rows) })());


// --- SECURITY FIX (members could approve themselves) + member photos
const PH = u => `${defaultChurch}/${u}.jpg`;
await db.exec(`insert into auth.users(id,email) values('a4000000-0000-0000-0000-000000000004','a4@example.invalid') on conflict do nothing`);
await db.exec(`insert into public.member_profiles(user_id,display_name,approved,directory_visible,church_id) values('a4000000-0000-0000-0000-000000000004','Unapproved A4',false,false,'${defaultChurch}') on conflict do nothing`);
const A4 = 'a4000000-0000-0000-0000-000000000004';
T('a member can NOT approve themselves', 'ERR permission denied', await as(A4, `update public.member_profiles set approved=true where user_id='${A4}' returning approved`));
T('a member can NOT move themselves to another church', 'ERR permission denied', await as(A4, `update public.member_profiles set church_id='${B}' where user_id='${A4}'`));
T('a member can NOT change their own user id / creation date', 'ERR permission denied', await as(A4, `update public.member_profiles set created_at=now() where user_id='${A4}'`));
T('a member CAN still edit their own bio', 'ok [{"bio":"Hello"}]', await as(A4, `update public.member_profiles set bio='Hello' where user_id='${A4}' returning bio`));
T('...but still cannot edit someone else', 'ok []', await as(A4, `update public.member_profiles set bio='Hacked' where user_id='${U.A2}' returning bio`));
T('an unapproved member is still unapproved', 'ok [{"approved":false}]', await (async () => { const r = await db.query(`select approved from public.member_profiles where user_id='${A4}'`); return 'ok ' + JSON.stringify(r.rows) })());
T('the administrator can still approve them (through the approval function)', 'ok', await as(U.A1, `select public.cc_manage_member('${A4}','approve_member')`));
await db.exec(`update public.member_profiles set approved=false where user_id='${A4}'`);
T('gender must be female or male', 'ERR', await as(U.A2, `update public.member_profiles set gender='other' where user_id='${U.A2}'`));
T('a member sets their gender (for the default picture)', 'ok [{"gender":"female"}]', await as(U.A2, `update public.member_profiles set gender='female' where user_id='${U.A2}' returning gender`));
T('photo sharing starts OFF', 'ok [{"photo_visible":false}]', await as(U.A2, `select photo_visible from public.member_profiles where user_id='${U.A2}'`));
T('a photo location must be your own file', 'ERR', await as(U.A2, `update public.member_profiles set photo_path='${PH(U.A3)}' where user_id='${U.A2}'`));
T('private bucket', 'ok [{"public":false}]', await (async () => { const r = await db.query(`select public from storage.buckets where id='member-photos'`); return 'ok ' + JSON.stringify(r.rows) })());
// storage rules
const put = (u, name) => as(u, `insert into storage.objects(bucket_id,name) values('member-photos','${name}') returning name`);
T('a member uploads their own photo', 'ok', await put(U.A2, PH(U.A2)));
T("a member can NOT upload into someone else's photo", 'ERR', await put(U.A3, PH(U.A2)));
T("a member from ANOTHER church can NOT put a file in this church's folder", 'ERR', await put(U.B2, PH(U.B2).replace(B, defaultChurch)));
T('files in another bucket are not covered by these rules', 'ERR', await as(U.A2, `insert into storage.objects(bucket_id,name) values('church-media','${PH(U.A2)}')`));
T('owner can open their own photo', 'ok [{"n":"1"}]', await as(U.A2, `select count(*)::text n from storage.objects where bucket_id='member-photos' and name='${PH(U.A2)}'`));
T('while sharing is OFF, other members cannot open it', 'ok [{"n":"0"}]', await as(U.A3, `select count(*)::text n from storage.objects where bucket_id='member-photos' and name='${PH(U.A2)}'`));
T('administrators can open it', 'ok [{"n":"1"}]', await as(U.A1, `select count(*)::text n from storage.objects where bucket_id='member-photos' and name='${PH(U.A2)}'`));
await as(U.A2, `update public.member_profiles set photo_path='${PH(U.A2)}', photo_visible=true where user_id='${U.A2}'`);
T('after they turn sharing ON, an approved member of the same church can open it', 'ok [{"n":"1"}]', await as(U.A3, `select count(*)::text n from storage.objects where bucket_id='member-photos' and name='${PH(U.A2)}'`));
T('an UNAPPROVED member still cannot', 'ok [{"n":"0"}]', await as(A4, `select count(*)::text n from storage.objects where bucket_id='member-photos' and name='${PH(U.A2)}'`));
T("another church's members still cannot", 'ok [{"n":"0"}]', await as(U.B2, `select count(*)::text n from storage.objects where bucket_id='member-photos' and name='${PH(U.A2)}'`));
T("another member can NOT delete or replace it", 'ok []', await as(U.A3, `delete from storage.objects where bucket_id='member-photos' and name='${PH(U.A2)}' returning name`));
T("another church's administrator can NOT touch it", 'ok []', await as(U.B1, `delete from storage.objects where bucket_id='member-photos' and name='${PH(U.A2)}' returning name`));
T('an administrator can remove it', 'ok [{"name"', await as(U.A1, `delete from storage.objects where bucket_id='member-photos' and name='${PH(U.A2)}' returning name`));
await put(U.A2, PH(U.A2));
T('a member can remove their own photo', 'ok [{"name"', await as(U.A2, `delete from storage.objects where bucket_id='member-photos' and name='${PH(U.A2)}' returning name`));
// staff-entered members
const dirIdA = (await db.query(`select id from public.cc_directory_members where church_id='${defaultChurch}' limit 1`)).rows[0].id;
const DP = `${defaultChurch}/dir-${dirIdA}.jpg`;
T('administrator uploads a staff-entered member\'s photo', 'ok', await put(U.A1, DP));
T('an ordinary member cannot see staff-entered photos', 'ok [{"n":"0"}]', await as(U.A3, `select count(*)::text n from storage.objects where name='${DP}'`));
T('an ordinary member cannot upload one', 'ERR', await put(U.A3, DP));
T("another church's administrator cannot see them", 'ok [{"n":"0"}]', await as(U.B1, `select count(*)::text n from storage.objects where name='${DP}'`));
T('administrator records gender + photo + consent for a staff-entered member', 'ok', await as(U.A1, `select public.cc_set_directory_profile('${dirIdA}','male','${DP}',true)`));
T('it is stored', 'ok [{"gender":"male","photo_visible":true}]', await (async () => { const r = await db.query(`select gender,photo_visible from public.cc_directory_members where id='${dirIdA}'`); return 'ok ' + JSON.stringify(r.rows) })());
T('removing the photo also turns sharing off', 'ok [{"photo_path":null,"photo_visible":false}]', await (async () => { await as(U.A1, `select public.cc_set_directory_profile('${dirIdA}','male',null,true)`); const r = await db.query(`select photo_path,photo_visible from public.cc_directory_members where id='${dirIdA}'`); return 'ok ' + JSON.stringify(r.rows) })());
T('a wrong photo location is refused', 'ERR Invalid photo location', await as(U.A1, `select public.cc_set_directory_profile('${dirIdA}','male','${defaultChurch}/dir-other.jpg',false)`));
T('gender must be female or male here too', 'ERR Gender', await as(U.A1, `select public.cc_set_directory_profile('${dirIdA}','x',null,false)`));
T('only administrators may use it', 'ERR Administrator access required', await as(U.A3, `select public.cc_set_directory_profile('${dirIdA}','male',null,false)`));
T("an administrator of another church cannot change this church's staff-entered member", 'ERR Directory member not found', await as(U.B1, `select public.cc_set_directory_profile('${dirIdA}','male',null,false)`));


// --- generic platform: church settings, invites, platform owner tools
const mkUser = async (id, email) => db.exec(`insert into auth.users(id,email) values('${id}','${email}') on conflict do nothing`);
const E1 = 'e1000000-0000-0000-0000-0000000000e1', N1 = 'f1000000-0000-0000-0000-0000000000a1', N2 = 'f2000000-0000-0000-0000-0000000000a2', N3 = 'f3000000-0000-0000-0000-0000000000a3', N4 = 'f4000000-0000-0000-0000-0000000000a4';
await mkUser(E1, 'e1@example.invalid'); await mkUser(N1, 'newperson@example.invalid'); await mkUser(N2, 'pastor@example.invalid'); await mkUser(N3, 'stranger@example.invalid'); 
// church B is active again for these tests
await as(U.P, `select public.cc_platform_set_subscription('${B}','pro','active')`);
// ---- church settings
T('administrator renames the church and sets its website + time zone', 'ok', await as(U.A1, `select public.cc_update_church_settings('New Beginnings Outreach Center','https://newbeginningsoutreachctrcogic.org','America/New_York')`));
T('it is stored for that church only', 'ok [{"name":"New Beginnings Outreach Center","website_url":"https://newbeginningsoutreachctrcogic.org"}]', await (async () => { const r = await db.query(`select name,website_url from public.churches where id='${defaultChurch}'`); return 'ok ' + JSON.stringify(r.rows) })());
T("another church's settings are untouched", 'ok [{"n":"0"}]', await (async () => { const r = await db.query(`select count(*)::text n from public.churches where id='${B}' and name='New Beginnings Outreach Center'`); return 'ok ' + JSON.stringify(r.rows) })());
T('a member cannot change church settings', 'ERR Administrator access required', await as(U.A3, `select public.cc_update_church_settings('Hacked','https://evil.example.org',null)`));
T('a too-short name is refused', 'ERR The church name', await as(U.A1, `select public.cc_update_church_settings('x','https://example.org',null)`));
T('an http address is refused', 'ERR', await as(U.A1, `select public.cc_update_church_settings('Good Name','http://example.org',null)`));
T('an IP address is refused', 'ERR Use the public address', await as(U.A1, `select public.cc_update_church_settings('Good Name','https://10.0.0.1/x',null)`));
T('a blank website is allowed (the built-in site is used)', 'ok', await as(U.A1, `select public.cc_update_church_settings('New Beginnings Outreach Center','',null)`));
T('an unknown time zone is refused', 'ERR Unknown time zone', await as(U.A1, `select public.cc_update_church_settings('New Beginnings Outreach Center','https://newbeginningsoutreachctrcogic.org','Mars/Phobos')`));
await as(U.A1, `select public.cc_update_church_settings('New Beginnings Outreach Center','https://newbeginningsoutreachctrcogic.org','America/New_York')`);
T('anyone (even signed out) can read the church name and website for the sign-in page', 'ok [{"name":"New Beginnings Outreach Center","website_url":"https://newbeginningsoutreachctrcogic.org"}]', await run('anon', '', `select name,website_url from public.churches where id='${defaultChurch}'`));
// ---- invites
const asE = async (uid, sql) => as(uid, sql);
T('administrator invites an email as a member', 'ok', await as(U.A1, `select public.cc_invite_member('NewPerson@Example.invalid','member')`));
T('a second invite for the same email replaces the first', 'ok [{"n":"1"}]', await (async () => { await as(U.A1, `select public.cc_invite_member('newperson@example.invalid','member')`); const r = await db.query(`select count(*)::text n from public.cc_invites where email='newperson@example.invalid' and used_at is null`); return 'ok ' + JSON.stringify(r.rows) })());
T('a bad email is refused', 'ERR Enter a valid email', await as(U.A1, `select public.cc_invite_member('not-an-email','member')`));
T('an administrator cannot invite someone as administrator (only the platform owner)', 'ERR Choose Member or Pastor', await as(U.A1, `select public.cc_invite_member('x@example.invalid','admin')`));
T('a member cannot invite', 'ERR Administrator access required', await as(U.A3, `select public.cc_invite_member('x@example.invalid','member')`));
T('inviting someone who is already a member is refused', 'ERR That person is already a member', await as(U.A1, `select public.cc_invite_member('a3@example.invalid','member')`));
T('administrators see their own invites', 'ok [{"email":"newperson@example.invalid"', await as(U.A1, `select email,role from public.cc_invites where used_at is null`));
T("another church's administrator cannot see them", 'ok []', await as(U.B1, `select email from public.cc_invites`));
T('members cannot see invites', 'ok []', await as(U.A3, `select email from public.cc_invites`));
T('nobody can write invites directly', 'ERR permission denied', await as(U.A1, `insert into public.cc_invites(church_id,email,role) values('${defaultChurch}','x@example.invalid','admin')`));
await as(U.A1, `select public.cc_invite_member('pastor@example.invalid','pastor')`);
// sign-up with an invite (two churches exist, so the invite decides the church)
T('an invited person signs up WITHOUT choosing a church: placed in the invited church and approved', 'ok [{"approved":true,"in_a":true}]', await (async () => { await as(N1, `select public.create_my_profile('New One')`); const r = await db.query(`select approved,(church_id='${defaultChurch}') in_a from public.member_profiles where user_id='${N1}'`); return 'ok ' + JSON.stringify(r.rows) })());
T('the invite is marked used', 'ok [{"n":"0"}]', await (async () => { const r = await db.query(`select count(*)::text n from public.cc_invites where email='newperson@example.invalid' and used_at is null`); return 'ok ' + JSON.stringify(r.rows) })());
T('an invited member is NOT an administrator', 'ok [{"n":"0"}]', await (async () => { const r = await db.query(`select count(*)::text n from public.church_admins where user_id='${N1}'`); return 'ok ' + JSON.stringify(r.rows) })());
T('an invited pastor is approved, has the pastor role and administrator access', 'ok [{"approved":true,"pastor":1,"admin":1}]', await (async () => { await as(N2, `select public.create_my_profile('Pastor Pat')`); const r = await db.query(`select (select approved from public.member_profiles where user_id='${N2}') approved,(select count(*)::int from public.member_roles where user_id='${N2}' and role='pastor') pastor,(select count(*)::int from public.church_admins where user_id='${N2}') admin`); return 'ok ' + JSON.stringify(r.rows[0]).replace(/^/, '[').replace(/$/, ']') })());
T('the invited pastor really can use administrator functions', 'ok [{"cc_is_admin":true}]', await as(N2, `select public.cc_is_admin()`));
T('someone WITHOUT an invite must choose a church when there are several', 'ERR Choose a church', await as(N3, `select public.create_my_profile('Stranger')`));
T('...and is NOT approved when they do', 'ok [{"approved":false}]', await (async () => { await as(N3, `select public.create_my_profile('Stranger','${defaultChurch}')`); const r = await db.query(`select approved from public.member_profiles where user_id='${N3}'`); return 'ok ' + JSON.stringify(r.rows) })());
T('an invite for church A does not approve someone who joins church B', 'ok [{"approved":false}]', await (async () => { await as(U.A1, `select public.cc_invite_member('stranger2@example.invalid','member')`); await mkUser('f5000000-0000-0000-0000-0000000000a5', 'stranger2@example.invalid'); await as('f5000000-0000-0000-0000-0000000000a5', `select public.create_my_profile('Stranger Two','${B}')`); const r = await db.query(`select approved from public.member_profiles where user_id='f5000000-0000-0000-0000-0000000000a5'`); return 'ok ' + JSON.stringify(r.rows) })());
T('an administrator can cancel a pending invite', 'ok [{"n":"0"}]', await (async () => { const id = (await db.query(`select id from public.cc_invites where email='stranger2@example.invalid'`)).rows[0].id; await as(U.A1, `select public.cc_cancel_invite('${id}')`); const r = await db.query(`select count(*)::text n from public.cc_invites where id='${id}'`); return 'ok ' + JSON.stringify(r.rows) })());
// ---- platform owner
await db.exec(`insert into public.member_profiles(user_id,display_name,approved,church_id) values('${U.P}','Platform Owner',true,'${defaultChurch}') on conflict do nothing`);
T('the platform owner sees every church with counts', 'ok', await (async () => { const r = JSON.parse((await as(U.P, `select name,members,administrators,is_current,is_home from public.cc_platform_overview()`)).slice(3)); return r.length >= 2 && r.some(x => x.is_current === true) ? 'ok ' + r.length : 'bad ' + JSON.stringify(r) })());
T('nobody else can see the church list', 'ERR Platform administrator access required', await as(U.A1, `select * from public.cc_platform_overview()`));
T('creating a church for an email that already belongs to a church is refused', 'ERR That email already belongs', await as(U.P, `select public.cc_platform_create_church_for('Nope Church','nope','a3@example.invalid')`));
T('creating a church for an existing person with no church links them as its administrator', 'ok', await as(U.P, `select public.cc_platform_create_church_for('Hope Chapel','hope','e1@example.invalid')`));
T('they are approved and administrator of the NEW church only', 'ok [{"approved":true,"is_admin":1,"named":"Hope Chapel"}]', await (async () => { const r = await db.query(`select p.approved,(select count(*)::int from public.church_admins a where a.user_id='${E1}') is_admin,(select c.name from public.churches c where c.id=p.church_id) named from public.member_profiles p where p.user_id='${E1}'`); return 'ok ' + JSON.stringify(r.rows) })());
T('the new church has a 30-day trial and its settings rows', 'ok [{"status":"trialing","settings":1}]', await (async () => { const r = await db.query(`select s.status,(select count(*)::int from public.church_settings x where x.church_id=c.id) settings from public.churches c join public.church_subscriptions s on s.church_id=c.id where c.slug='hope'`); return 'ok ' + JSON.stringify(r.rows) })());
T('creating a church for an email nobody has used yet sends an invite as administrator', 'ok [{"admin":"invited"}]', await (async () => { const r = await as(U.P, `select public.cc_platform_create_church_for('Faith Center','faith','faith.admin@example.invalid')`); return r.includes('"invited"') ? 'ok [{"admin":"invited"}]' : r })());
T('...and that person becomes its administrator when they sign up', 'ok [{"approved":true,"admin":1,"named":"Faith Center"}]', await (async () => { await mkUser(N4, 'faith.admin@example.invalid'); await as(N4, `select public.create_my_profile('Faith Admin')`); const r = await db.query(`select p.approved,(select count(*)::int from public.church_admins a where a.user_id='${N4}') admin,(select c.name from public.churches c where c.id=p.church_id) named from public.member_profiles p where p.user_id='${N4}'`); return 'ok ' + JSON.stringify(r.rows) })());
T('a taken short name is refused', 'ERR That short name is already taken', await as(U.P, `select public.cc_platform_create_church_for('Another','hope','z@example.invalid')`));
T('a bad short name is refused', 'ERR The short name may use only letters', await as(U.P, `select public.cc_platform_create_church_for('Another','Bad Name!','z@example.invalid')`));
T('only the platform owner can create churches', 'ERR Platform administrator access required', await as(U.A1, `select public.cc_platform_create_church_for('Evil','evil','z@example.invalid')`));
T('the internal church builder is not callable by anyone signed in', 'ERR permission denied', await as(U.P, `select public.cc_platform_new_church('X','xx','active','x')`));
// demo church
T('the platform owner creates a demo church', 'ok', await as(U.P, `select public.cc_platform_create_demo_church()`));
const demo = (await db.query(`select id from public.churches where slug like 'demo-%' order by created_at desc limit 1`)).rows[0].id;
T('it has sample ministries, events, announcements and staff-entered members', 'ok [{"m":5,"e":6,"a":3,"d":6,"status":"active"}]', await (async () => { const r = await db.query(`select (select count(*)::int from public.ministries where church_id='${demo}') m,(select count(*)::int from public.church_events where church_id='${demo}') e,(select count(*)::int from public.church_announcements where church_id='${demo}') a,(select count(*)::int from public.cc_directory_members where church_id='${demo}') d,(select status from public.church_subscriptions where church_id='${demo}') status`); return 'ok ' + JSON.stringify(r.rows) })());
T('only the platform owner can create a demo', 'ERR Platform administrator access required', await as(U.A1, `select public.cc_platform_create_demo_church()`));
// open as administrator, and back
T('only the platform owner can open another church as administrator', 'ERR Platform administrator access required', await as(U.A1, `select public.cc_platform_switch_church('${demo}')`));
T('the platform owner opens the demo church as its administrator', 'ok', await as(U.P, `select public.cc_platform_switch_church('${demo}')`));
T('they now see the DEMO church\'s data as an administrator', 'ok [{"n":5}]', await (async () => { const r = JSON.parse((await as(U.P, `select count(*)::int n from public.ministries`)).slice(3)); return 'ok ' + JSON.stringify(r) })());
T('...and none of the first church\'s private data', 'ok [{"n":0}]', await as(U.P, `select count(*)::int n from public.messages`));
T('the home church is remembered', 'ok [{"is_home":true}]', await (async () => { const r = JSON.parse((await as(U.P, `select is_home from public.cc_platform_overview() where id='${defaultChurch}'`)).slice(3)); return 'ok ' + JSON.stringify(r) })());
T('they can go back to their own church', 'ok', await as(U.P, `select public.cc_platform_switch_church('${defaultChurch}')`));
T('and are administrator of their own church again (and of no other)', 'ok [{"in_default":1,"elsewhere":0}]', await (async () => { const r = await db.query(`select count(*) filter (where church_id='${defaultChurch}')::int in_default,count(*) filter (where church_id<>'${defaultChurch}')::int elsewhere from public.church_admins where user_id='${U.P}'`); return 'ok ' + JSON.stringify(r.rows) })());
T('every platform action was logged', 'ok [{"actions":true}]', await (async () => { const r = await db.query(`select (count(*) >= 5) actions from public.cc_platform_audit`); return 'ok ' + JSON.stringify(r.rows) })());
T('nobody can read the platform log', 'ERR permission denied', await as(U.P, `select * from public.cc_platform_audit`));

// --- rollback: restores the single-church shape and the original functions
await db.exec(`reset role`);
let refused = 'no error'; try { await db.exec(fs.readFileSync(repo + 'multichurch-rollback.sql', 'utf8')) } catch (e) { refused = 'ERR ' + e.message }
T('rollback refuses while a second church exists', 'ERR More than one church', refused);
await db.exec(`delete from public.churches where slug<>'default'`); // cascades away every extra church's rows
await db.exec(fs.readFileSync(repo + 'multichurch-rollback.sql', 'utf8'));
await db.exec(fs.readFileSync(repo + 'multichurch-rollback.sql', 'utf8')); // re-runnable
T('rollback removes church_id', 'ok [{"n":"0"}]', await (async () => { const r = await db.query(`select count(*)::text n from information_schema.columns where table_schema='public' and column_name='church_id'`); return 'ok ' + JSON.stringify(r.rows) })());
T('rollback restores the original no-argument site function', 'ok [{"cc_public_website"', await run('anon', '', `select public.cc_public_website()`));
T('rollback leaves data in place', 'ok [{"n":"2"}]', await (async () => { const r = await db.query(`select count(*)::text n from public.messages`); return 'ok ' + JSON.stringify(r.rows) })());
T('after rollback the original rules still hold (A admin adds directory member)', 'ok', await as(U.A1, `select public.cc_save_directory_member(null,'After Rollback','9045553333',null,'Sis.','{}',null,null,true,'{}',true)`));
T('after rollback members still cannot read admin data', 'ok []', await as(U.A2, `select * from public.cc_directory_members`));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
