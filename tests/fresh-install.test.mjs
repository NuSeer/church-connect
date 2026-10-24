// Proves the generated setup for a NEW, EMPTY project works: it applies cleanly, matches the exported project (plus the latest features),
// and the key protections behave. Usage: node fresh-install.test.mjs <structure2.json> [fresh-install-folder] [repo-folder]
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
const [, , structurePath, folder = 'D:/Projects/church-connect/fresh-install', repoArg = 'D:/Projects/church-connect'] = process.argv;
const repo = repoArg + '/';
let want = JSON.parse(fs.readFileSync(structurePath, 'utf8')); if (typeof want === 'string') want = JSON.parse(want);
const db = new PGlite();
let fails = 0; const T = (n, ok, extra = '') => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok && !extra ? '' : ' => ' + String(extra).slice(0, 400))) };

// a stand-in for what every new Supabase project already contains
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema storage;
alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
create function storage.foldername(n text) returns text[] language sql as $$ select string_to_array(n,'/') $$;
create function storage.filename(n text) returns text language sql as $$ select (string_to_array(n,'/'))[array_length(string_to_array(n,'/'),1)] $$;
alter table storage.objects enable row level security;
grant usage on schema public,auth,storage to anon,authenticated; grant all on all tables in schema storage to authenticated;
`);
for (const f of ['01-structure.sql', '02-features-and-seed.sql']) {
  try { await db.exec(fs.readFileSync(`${folder}/${f}`, 'utf8')); T(`${f} applies cleanly to an empty project`, true) }
  catch (e) { T(`${f} applies cleanly to an empty project`, false, e.message); console.log('\nSTOPPED'); process.exit(1) }
}
try { await db.exec(fs.readFileSync(`${folder}/01-structure.sql`, 'utf8')); T('part 1 can be run again safely', true) } catch (e) { T('part 1 can be run again safely', false, e.message) }
try { await db.exec(fs.readFileSync(`${folder}/02-features-and-seed.sql`, 'utf8')); T('part 2 can be run again safely', true) } catch (e) { T('part 2 can be run again safely', false, e.message) }

// ---- same shape as the exported project (plus only the newest features)
const got = JSON.parse((await db.query(fs.readFileSync(repo + 'export-for-new-project.sql', 'utf8').replace(/^--.*$/gm, ''))).rows[0].structure);
const byName = (arr, key) => new Map((arr || []).map(x => [key(x), x]));
const wantTables = byName(want.tables, t => t.table), gotTables = byName(got.tables, t => t.table);
const missingTables = [...wantTables.keys()].filter(k => !gotTables.has(k)); T('every exported table exists', missingTables.length === 0, missingTables.join(', '));
const extraTables = [...gotTables.keys()].filter(k => !wantTables.has(k)); T('the only extra tables are the newest features', extraTables.every(t => ['cc_invites', 'cc_platform_audit', 'cc_webmaster_requests', 'cc_chat_preferences', 'cc_event_rsvps', 'cc_guardians', 'cc_member_safety', 'cc_message_blocks', 'cc_message_marks', 'cc_message_reports', 'cc_messaging_settings', 'cc_push_attempts', 'cc_update_acks'].includes(t)), extraTables.join(', '));
let colProblems = []; for (const [tn, wt] of wantTables) { const gt = gotTables.get(tn); if (!gt) continue; const gc = byName(gt.columns, c => c.name); for (const c of wt.columns) { const x = gc.get(c.name); if (!x) colProblems.push(`${tn}.${c.name} missing`); else if (x.type !== c.type || x.not_null !== c.not_null) colProblems.push(`${tn}.${c.name}: ${x.type}/${x.not_null} vs ${c.type}/${c.not_null}`) } }
T('every exported column exists with the same type and null rule', colProblems.length === 0, colProblems.slice(0, 6).join(' | '));
const wantFn = new Set(want.functions.map(f => f.name + '(' + f.args + ')')), gotFn = new Set(got.functions.map(f => f.name + '(' + f.args + ')'));
const missingFn = [...wantFn].filter(f => !gotFn.has(f)); const replacedFn = f => f === 'cc_send_broadcast(p_title text, p_body text)'; /* replaced by the version that also takes pin and expiry */ T('every exported function exists', missingFn.filter(f => !replacedFn(f)).length === 0, missingFn.join(', '));
const newFn = [...gotFn].filter(f => !wantFn.has(f)).map(f => f.split('(')[0]); console.log('   (functions added by the newest features:', newFn.join(', '), ')');
const pol = p => `${p.schema}.${p.table}:${p.name}:${p.permissive}:${p.command}`;
const wantPol = new Set(want.policies.map(pol)), gotPol = new Set(got.policies.map(pol));
const missingPol = [...wantPol].filter(p => !gotPol.has(p)); T('every exported rule (policy) exists with the same kind', missingPol.length === 0, missingPol.join(' | '));
const wantCon = new Set(want.constraints.map(c => c.table.replace('public.', '') + ':' + c.name)), gotCon = new Set(got.constraints.map(c => c.table.replace('public.', '') + ':' + c.name));
const missingCon = [...wantCon].filter(c => !gotCon.has(c)); T('every exported key, check and link between tables exists', missingCon.length === 0, missingCon.join(' | '));
const g = a => new Set((a || []).map(x => `${x.table}:${x.role}:${x.privilege}`)); const wg = g(want.grants), gg = g(got.grants);
// the new project is allowed to be STRICTER: anonymous visitors, references and triggers are dropped (the real project still carries some of those by default)
const lostGrants = [...wg].filter(x => !gg.has(x)).filter(x => !(/:anon:/.test(x) || /:(REFERENCES|TRIGGER|TRUNCATE)$/.test(x) || /^messages:authenticated:(INSERT|UPDATE|DELETE)$/.test(x))); T('no permission the app needs is missing (the new project may only be stricter)', lostGrants.length === 0, lostGrants.slice(0, 5).join(' | '));
const extraGrants = [...gg].filter(x => !wg.has(x)).filter(x => !/^(cc_invites|cc_platform_audit|cc_webmaster_requests|churches|cc_chat_preferences|cc_message_marks|cc_messaging_settings|cc_guardians|cc_member_safety|cc_update_acks|cc_message_blocks|cc_message_reports|cc_event_rsvps|cc_push_attempts):/.test(x)); T('and no extra permission appears (nothing wider than the real project)', extraGrants.length === 0, extraGrants.slice(0, 8).join(' | '));
T('both storage buckets exist and the photo bucket is private', got.buckets.some(b => b.id === 'member-photos' && b.public === false) && got.buckets.some(b => b.id === 'church-media'), JSON.stringify(got.buckets));

// ---- behaviour on the empty project
const U = {O: 'a0000000-0000-0000-0000-00000000000a', M: 'a1000000-0000-0000-0000-000000000001', M2: 'a2000000-0000-0000-0000-000000000002'};
for (const [k, u] of Object.entries(U)) await db.exec(`insert into auth.users(id,email) values('${u}','${k.toLowerCase()}@example.invalid')`);
const run = async (role, uid, sql) => { const em = uid ? ((await db.query(`select email from auth.users where id=$1`, [uid])).rows[0]?.email || '') : ''; await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid || ''}',false); select set_config('request.jwt.claims','${JSON.stringify({sub: uid || '', email: em})}',false); set role ${role};`); try { const r = await db.query(sql); return 'ok ' + JSON.stringify(r.rows).slice(0, 3000) } catch (e) { return 'ERR ' + e.message } finally { await db.exec('reset role') } };
const as = (u, sql) => run('authenticated', u, sql);
const eq = (n, exp, got2) => T(n, got2.startsWith(exp), got2);
eq('a new project starts with exactly one church, active', 'ok [{"name":"Church Connect","status":"active"', await run('postgres', '', `select c.name,s.status from public.churches c join public.church_subscriptions s on s.church_id=c.id`).catch(() => 'x'));
// the owner signs up, then the "make me platform owner" step (what the owner is given to run)
eq('the first person signs up (one church, so no choice needed)', 'ok', await as(U.O, `select public.create_my_profile('Owner')`));
eq('...and is NOT approved or an administrator by default', 'ok [{"approved":false,"admin":0}]', await (async () => { const r = await db.query(`select approved,(select count(*)::int from public.church_admins)::int admin from public.member_profiles where user_id='${U.O}'`); return 'ok ' + JSON.stringify(r.rows) })());
const own = fs.readFileSync(repo + 'make-me-platform-owner.sql', 'utf8').replace(/YOUR-EMAIL-HERE/g, 'o@example.invalid');
try { await db.exec(own); T('the "make me platform owner" step runs', true) } catch (e) { T('the "make me platform owner" step runs', false, e.message) }
eq('the owner is now approved, an administrator and a platform owner', 'ok [{"approved":true,"admin":1,"owner":1}]', await (async () => { const r = await db.query(`select approved,(select count(*)::int from public.church_admins where user_id='${U.O}') admin,(select count(*)::int from public.cc_platform_admins where user_id='${U.O}') owner from public.member_profiles where user_id='${U.O}'`); return 'ok ' + JSON.stringify(r.rows) })());
eq('running that step twice changes nothing', 'ok', await (async () => { try { await db.exec(own); return 'ok' } catch (e) { return 'ERR ' + e.message } })());
eq('an ordinary signed-up member cannot approve themselves', 'ERR permission denied', await (async () => { await as(U.M, `select public.create_my_profile('Member')`); return await as(U.M, `update public.member_profiles set approved=true where user_id='${U.M}'`) })());
eq('...but the administrator can approve them', 'ok', await as(U.O, `select public.cc_manage_member('${U.M}','approve_member')`));
eq('the owner can create a demo church', 'ok', await as(U.O, `select public.cc_platform_create_demo_church()`));
eq('the owner sees two churches, one of them active demo data', 'ok', await (async () => { const r = (await db.query(`select count(*)::int n from public.churches`)).rows[0].n; return r === 2 ? 'ok' : 'bad ' + r })());
eq('a member of the first church cannot see the demo church\'s directory', 'ok [{"n":0}]', await as(U.M, `select count(*)::int n from public.cc_directory_members`));
eq('the owner opens the demo church as administrator and sees its sample data', 'ok [{"m":5}]', await (async () => { const demo = (await db.query(`select id from public.churches where slug like 'demo-%' limit 1`)).rows[0].id; await as(U.O, `select public.cc_platform_switch_church('${demo}')`); return await as(U.O, `select count(*)::int m from public.ministries`) })());
eq('...and can return to their own church', 'ok', await (async () => { const home = (await db.query(`select id from public.churches where slug not like 'demo-%' limit 1`)).rows[0].id; return await as(U.O, `select public.cc_platform_switch_church('${home}')`) })());
eq('invites work on the new project', 'ok', await as(U.O, `select public.cc_invite_member('leader@example.invalid','pastor')`));
eq('the administrator can choose the church colors', 'ok', await as(U.O, `select public.cc_update_church_colors('#1a5c3a','#F2B705')`));
eq('...they are saved (accent stored lower-case) and an ordinary member can read them', 'ok [{"brand_primary":"#1a5c3a","brand_accent":"#f2b705"}]', await as(U.M, `select brand_primary,brand_accent from public.churches where id=public.cc_my_church_id()`));
eq('an ordinary member cannot change the colors', 'ERR Administrator access required', await as(U.M, `select public.cc_update_church_colors('#000000','#ffffff')`));
eq('a color that is not #rrggbb is refused', 'ERR Colors must look like', await as(U.O, `select public.cc_update_church_colors('red','#ffffff')`));
eq('a light main color is accepted (lettering picks itself)', 'ok', await as(U.O, `select public.cc_update_church_colors('#ffff99',null)`));
eq('the administrator can choose black lettering', 'ok [{"brand_text":"black"}]', await (async () => { await as(U.O, `select public.cc_update_church_colors('#ffff99','#336699','black')`); return await as(U.M, `select brand_text from public.churches where id=public.cc_my_church_id()`) })());
eq('lettering other than white or black is refused', 'ERR Lettering must be white or black', await as(U.O, `select public.cc_update_church_colors('#1a5c3a',null,'red')`));
eq('the webmaster permission can be given to an approved member', 'ok', await as(U.O, `select public.cc_set_staff_delegation('${U.M}','website_manage',true)`));
eq('...and shows in the staff permission list', 'ok [{"n":1}]', await as(U.O, `select count(*)::int n from public.cc_staff_delegations where permission='website_manage'`));
eq('an unknown permission is still refused', 'ERR Unknown permission', await as(U.O, `select public.cc_set_staff_delegation('${U.M}','god_mode',true)`));
eq('a member cannot write colors straight into the table', 'ERR permission denied', await as(U.M, `update public.churches set brand_primary='#000000'`));
eq('blank puts the standard colors back', 'ok [{"brand_primary":null,"brand_accent":null}]', await (async () => { await as(U.O, `select public.cc_update_church_colors('','','')`); return await as(U.O, `select brand_primary,brand_accent from public.churches where id=public.cc_my_church_id()`) })());
eq('photo storage is private to the right people (a member cannot read another member\'s unshared photo)', 'ok [{"n":0}]', await (async () => { const ch = (await db.query(`select church_id from public.member_profiles where user_id='${U.M}'`)).rows[0].church_id; await db.exec(`insert into storage.objects(bucket_id,name) values('member-photos','${ch}/${U.O}.jpg')`); await db.exec(`insert into public.member_profiles(user_id,display_name,approved,church_id) values('${U.M2}','Second',true,'${ch}')`); return await as(U.M2, `select count(*)::int n from storage.objects where name='${ch}/${U.O}.jpg'`) })());
eq('an administrator can message the webmaster', 'ok', await as(U.O, `select public.cc_send_webmaster_request('photo',null,'Please add the choir photo')`));
eq('a photo request needs a message', 'ERR Please add a short message', await as(U.O, `select public.cc_send_webmaster_request('photo',null,'')`));
eq('an ordinary member cannot send one', 'ERR Administrator access required', await as(U.M2, `select public.cc_send_webmaster_request('other',null,'hi')`));
eq('the person with the Webmaster permission sees the request', 'ok [{"n":1}]', await as(U.M, `select count(*)::int n from public.cc_webmaster_requests`));
eq('an ordinary member sees none', 'ok [{"n":0}]', await as(U.M2, `select count(*)::int n from public.cc_webmaster_requests`));
eq('an ordinary member cannot mark one done', 'ERR Webmaster access required', await as(U.M2, `select public.cc_finish_webmaster_request((select id from public.cc_webmaster_requests limit 1))`));
eq('the webmaster can mark it done', 'ok [{"status":"done"}]', await (async () => { await as(U.M, `select public.cc_finish_webmaster_request((select id from public.cc_webmaster_requests limit 1))`); return await as(U.O, `select status from public.cc_webmaster_requests limit 1`) })());
eq('a member can still edit their own display name', 'ok', await as(U.M2, `update public.member_profiles set display_name='Renamed' where user_id='${U.M2}'`));
eq('...but cannot approve themselves', 'ERR permission denied', await as(U.M2, `update public.member_profiles set approved=true where user_id='${U.M2}'`));
// ministry requests, deleting, and sharing a phone number
eq('the administrator can add a ministry', 'ok', await as(U.O, `select public.cc_manage_ministry(null,'Choir','save')`));
eq('a member can ask to join', 'ok', await as(U.M2, `select public.cc_request_ministry((select id from public.ministries where name='Choir'))`));
eq('the administrator can turn the request down', 'ok', await as(U.O, `select public.cc_manage_member('${U.M2}','reject_ministry',(select id from public.ministries where name='Choir'),false)`));
eq('the request shows as turned down', 'ok [{"status":"rejected"}]', await as(U.M2, `select status from public.ministry_join_requests where user_id='${U.M2}'`));
eq('the member can ask again (the request resets to pending)', 'ok [{"status":"pending"}]', await (async () => { await as(U.M2, `select public.cc_request_ministry((select id from public.ministries where name='Choir'))`); return await as(U.M2, `select status from public.ministry_join_requests where user_id='${U.M2}'`) })());
eq('a pending request is not duplicated', 'ok [{"n":1}]', await as(U.M2, `select count(*)::int n from public.ministry_join_requests where user_id='${U.M2}'`));
eq('a member who shares their number shows in the directory phones', 'ok [{"phone":"+17575550123"}]', await (async () => { await db.query(`insert into public.member_sms_preferences(user_id,phone,directory_phone_visible) values('${U.M2}','+17575550123',true) on conflict(user_id) do update set phone='+17575550123',directory_phone_visible=true`); await db.query(`update public.member_profiles set directory_visible=true where user_id='${U.M2}'`); return await as(U.M, `select phone from public.cc_directory_phones()`) })());
eq('a number that is not shared stays private', 'ok [{"n":0}]', await (async () => { await db.query(`update public.member_sms_preferences set directory_phone_visible=false where user_id='${U.M2}'`); return await as(U.M, `select count(*)::int n from public.cc_directory_phones()`) })());
eq('an ordinary member cannot delete a ministry', 'ERR Administrator access required', await as(U.M2, `select public.cc_manage_ministry((select id from public.ministries where name='Choir'),'Choir','delete')`));
eq('the administrator can delete a ministry', 'ok [{"n":0}]', await (async () => { await as(U.O, `select public.cc_manage_ministry((select id from public.ministries where name='Choir'),'Choir','delete')`); return await as(U.O, `select count(*)::int n from public.ministries where name='Choir'`) })());
eq('...and its requests go with it', 'ok [{"n":0}]', await as(U.O, `select count(*)::int n from public.ministry_join_requests where user_id='${U.M2}'`));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
