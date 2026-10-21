import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
const repo = process.argv[2] || 'D:/Projects/church-connect/';
const db = new PGlite();
const A = 'aaaaaaaa-0000-0000-0000-000000000001', B = 'bbbbbbbb-0000-0000-0000-000000000002', C = 'cccccccc-0000-0000-0000-000000000003';
const CONV = '11111111-1111-1111-1111-111111111111';

// Stand-in for the base schema (schema-phase3.sql is not in the repo): minimal tables/functions the migrations rely on.
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema storage;
alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
create function storage.foldername(n text) returns text[] language sql as $$ select string_to_array(n,'/') $$;
alter table storage.objects enable row level security;
create table public.church_admins(user_id uuid primary key references auth.users(id));
create table public.member_profiles(user_id uuid primary key references auth.users(id),display_name text,approved boolean default false,bio text,directory_visible boolean default false,directory_contact_visible boolean default false,contact_email text);
create table public.ministries(id uuid primary key default gen_random_uuid(),name text not null);
create table public.ministry_members(ministry_id uuid references public.ministries(id) on delete cascade,user_id uuid references auth.users(id) on delete cascade,is_leader boolean default false,primary key(ministry_id,user_id));
create table public.conversations(id uuid primary key default gen_random_uuid(),kind text,ministry_id uuid);
create table public.conversation_members(conversation_id uuid references public.conversations(id) on delete cascade,user_id uuid references auth.users(id),primary key(conversation_id,user_id));
create table public.messages(id uuid primary key default gen_random_uuid(),conversation_id uuid references public.conversations(id) on delete cascade,sender_id uuid,body text,created_at timestamptz default now());
create table public.ministry_activities(id uuid primary key default gen_random_uuid(),ministry_id uuid references public.ministries(id),title text,details text,starts_at timestamptz);
create function public.can_read_conversation(c uuid,u uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.conversation_members m where m.conversation_id=c and m.user_id=u) $$;
grant usage on schema public,auth to anon,authenticated; grant all on all tables in schema public to authenticated;
grant usage on schema storage to authenticated,anon; grant all on storage.objects,storage.buckets to authenticated;
insert into auth.users values('${A}'),('${B}'),('${C}');
insert into public.church_admins values('${A}');
insert into public.member_profiles(user_id,display_name,approved) values('${A}','Admin',true),('${B}','Bee',true),('${C}','Cee',false);
`);

const order = (process.argv[3] || 'phase4-migration.sql,membership-migration.sql,directory-ministry-migration.sql,ministry-colors-migration.sql,phase3-4-migration.sql,messaging-migration.sql,phase5-website-migration.sql,phase8-media-migration.sql,phase10-sms-migration.sql,phase11-push-migration.sql,phase12-hardening-migration.sql').split(',');
for (const f of order) {
  const sql = fs.readFileSync(repo + f, 'utf8');
  try { await db.exec(sql); console.log('APPLIED ', f) } catch (e) { console.log('FAILED  ', f, '-', e.message) }
  try { await db.exec(sql); console.log('   rerun ok') } catch (e) { console.log('   rerun FAIL:', e.message) }
}

const run = async (role, uid, sql) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid || ''}',false); set role ${role};`);
  try { const r = await db.query(sql); return 'ok ' + JSON.stringify(r.rows).slice(0, 140) }
  catch (e) { return 'ERR ' + e.message } finally { await db.exec('reset role') }
};
const as = (u, sql) => run('authenticated', u, sql);
let fails = 0;
const T = (name, expect, got) => { const pass = got.startsWith(expect); if (!pass) fails++; console.log((pass ? 'PASS ' : 'FAIL ') + name + ' => ' + got) };

T('admin adds directory member', 'ok', await as(A, "select public.cc_save_directory_member(null,'Mother Ann','+15551230000',null,'Sis.',array['Mother'],'Mother','n',true,'{}',true)"));
T('non-admin cannot add directory member', 'ERR', await as(B, "select public.cc_save_directory_member(null,'Hacker','1',null,'Sis.','{}',null,null,false,'{}',true)"));
T('non-admin sees no directory rows', 'ok []', await as(B, "select * from public.cc_directory_members"));
T('admin reads directory', 'ok [{', await as(A, "select full_name from public.cc_directory_members"));
T('member cannot self-verify titles', 'ERR', await as(B, `select public.cc_verify_titles('${B}',array['Pastor'])`));
T('member cannot write verified_titles', 'ERR', await as(B, `insert into public.member_church_titles(user_id,verified_titles) values('${B}',array['Pastor'])`));
T('member saves own sms prefs', 'ok', await as(B, `insert into public.member_sms_preferences(user_id,phone,opted_in,has_app) values('${B}','+15551112222',true,false) returning user_id`));
T('bad phone format rejected', 'ERR', await as(B, `update public.member_sms_preferences set phone='555' where user_id='${B}'`));
T('opt-in without phone rejected', 'ERR', await as(A, `insert into public.member_sms_preferences(user_id,phone,opted_in) values('${A}',null,true)`));
T('cannot read others sms prefs', 'ok []', await as(A, `select * from public.member_sms_preferences where user_id='${B}'`));
await db.exec(`insert into public.conversations(id,kind) values('${CONV}','direct'); insert into public.conversation_members values('${CONV}','${A}'),('${CONV}','${B}');`);
T('participant gets opted-in phones', 'ok [{"phone":"+15551112222"}]', await as(A, `select * from public.cc_phone_sms_recipients('${CONV}',true)`));
T('outsider denied phones', 'ERR', await as(C, `select * from public.cc_phone_sms_recipients('${CONV}',true)`));
T('unapproved cannot subscribe push', 'ERR', await as(C, `insert into public.member_push_subscriptions(user_id,endpoint,p256dh,auth) values('${C}','https://x/1','k','a')`));
T('approved can subscribe push', 'ok', await as(B, `insert into public.member_push_subscriptions(user_id,endpoint,p256dh,auth) values('${B}','https://x/2','k','a') returning id`));
T('cannot subscribe as someone else', 'ERR', await as(B, `insert into public.member_push_subscriptions(user_id,endpoint,p256dh,auth) values('${A}','https://x/3','k','a')`));
T('cannot read others subscriptions', 'ok []', await as(A, "select * from public.member_push_subscriptions"));
T('anon blocked from subscriptions', 'ERR', await run('anon', '', "select * from public.member_push_subscriptions"));
T('anon sees no directory rows', 'ERR', await run('anon', '', "select * from public.cc_directory_members"));
T('anon can call public website fn', 'ok', await run('anon', '', "select public.cc_public_website()"));
T('anon cannot read website table', 'ERR', await run('anon', '', "select * from public.cc_website_content"));
T('non-admin cannot save website draft', 'ERR', await as(B, "select public.cc_save_website_draft('{}'::jsonb)"));
T('admin saves website draft', 'ok', await as(A, "select public.cc_save_website_draft('{\"x\":1}'::jsonb)"));
T('non-admin cannot set ministry color', 'ok []', await as(B, "update public.ministries set color='#112233' returning id"));
T('delegation needs admin', 'ERR', await as(B, `select public.cc_set_staff_delegation('${B}','membership_view',true)`));
T('admin delegation to approved member', 'ok', await as(A, `select public.cc_set_staff_delegation('${B}','membership_view',true)`));
T('admin cannot delegate to unapproved', 'ERR', await as(A, `select public.cc_set_staff_delegation('${C}','membership_view',true)`));

// --- phase 12 checks ---
const MIN='dddddddd-0000-0000-0000-00000000000d', MC='22222222-2222-2222-2222-222222222222';
await db.exec(`insert into public.ministries(id,name) values('${MIN}','Ushers'); insert into public.conversations(id,kind,ministry_id) values('${MC}','ministry','${MIN}');
 insert into public.conversation_members values('${MC}','${A}'),('${MC}','${B}');
 insert into public.ministry_members values('${MIN}','${B}',false);`);
console.log("setup:", await as(A, `select public.cc_save_directory_member(null,'Elder Joe','(904) 555-0142',null,'Bro.','{}',null,null,true,array['${MIN}']::uuid[],true)`));
console.log("setup:", await as(A, `select public.cc_save_directory_member(null,'No Consent','904-555-0199',null,'Bro.','{}',null,null,false,array['${MIN}']::uuid[],true)`));
console.log("setup:", await as(A, `select public.cc_save_directory_member(null,'Bad Number','12345',null,'Bro.','{}',null,null,true,array['${MIN}']::uuid[],true)`));
T('admin gets consented directory phones only, normalized', 'ok [{"phone":"+19045550142"}]', await as(A, `select * from public.cc_directory_sms_recipients('${MC}')`));
T('plain member (not leader) refused directory phones', 'ERR', await as(B, `select * from public.cc_directory_sms_recipients('${MC}')`));
await db.exec(`update public.ministry_members set is_leader=true where user_id='${B}'`);
T('ministry leader gets directory phones', 'ok [{"phone":"+19045550142"}]', await as(B, `select * from public.cc_directory_sms_recipients('${MC}')`));
T('outsider refused directory phones', 'ERR', await as(C, `select * from public.cc_directory_sms_recipients('${MC}')`));
T('direct chat returns no directory phones', 'ok []', await as(A, `select * from public.cc_directory_sms_recipients('${CONV}')`));
T('members cannot read push delivery log', 'ERR', await as(B, "select * from public.cc_push_deliveries"));
const MSG='99999999-9999-9999-9999-999999999999';
await db.exec(`insert into public.cc_push_deliveries(message_id) values('${MSG}')`);
let dup='no error'; try{await db.exec(`insert into public.cc_push_deliveries(message_id) values('${MSG}')`)}catch(e){dup='ERR code '+e.code}
T('duplicate message id is rejected (idempotency)', 'ERR code 23505', dup);
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
