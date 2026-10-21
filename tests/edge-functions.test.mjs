// Runs the REAL Edge Function code (push + website-events sync) in Node with a fake database and fake network.
// Usage: node edge-functions.test.mjs [path-to-events-fixture.json]   (needs: npm i esbuild)
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const repo = path.resolve(process.env.CC_REPO || 'D:/Projects/church-connect');
const fixture = process.argv[2];
let fails = 0; const T = (n, ok, extra = '') => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok && !extra ? '' : ' => ' + extra)) };

// ---- in-memory stand-in for the Supabase client ----
const stubSupabase = `
const UNIQUE = {cc_push_deliveries: ['message_id'], church_events: ['church_id','source','external_id'], member_push_subscriptions: ['endpoint']};
class Q {
  constructor(t) { this.t = t; this.op = 'select'; this.f = []; this.mode = 'many' }
  select() { return this } eq(c, v) { this.f.push(r => r[c] === v); return this } in(c, a) { this.f.push(r => a.includes(r[c])); return this }
  not(c, op, v) { if (op === 'is' && v === null) this.f.push(r => r[c] !== null && r[c] !== undefined); return this }
  insert(p) { this.op = 'insert'; this.p = p; return this } upsert(p, o) { this.op = 'upsert'; this.p = p; this.o = o || {}; return this }
  update(p) { this.op = 'update'; this.p = p; return this } delete() { this.op = 'delete'; return this }
  single() { this.mode = 'single'; return this } maybeSingle() { this.mode = 'maybe'; return this }
  then(res, rej) { return Promise.resolve(this.run()).then(res, rej) }
  run() {
    const T = (globalThis.__db[this.t] ??= []); const match = r => this.f.every(f => f(r));
    const keyOf = (r, cols) => cols.map(c => r[c] ?? null).join('|');
    if (this.op === 'select') { const rows = T.filter(match).map(r => ({...r})); if (this.mode === 'single') return rows.length ? {data: rows[0], error: null} : {data: null, error: {message: 'no rows'}}; if (this.mode === 'maybe') return {data: rows[0] ?? null, error: null}; return {data: rows, error: null} }
    if (this.op === 'insert') { const u = UNIQUE[this.t]; for (const r of [].concat(this.p)) { if (u && r[u[0]] !== undefined && T.some(x => keyOf(x, u) === keyOf(r, u))) return {data: null, error: {code: '23505', message: 'duplicate key'}}; T.push({...r}) } return {data: null, error: null} }
    if (this.op === 'upsert') { const cols = this.o.onConflict.split(','); for (const r of [].concat(this.p)) { const i = T.findIndex(x => keyOf(x, cols) === keyOf(r, cols)); if (i >= 0) T[i] = {...T[i], ...r}; else T.push({...r}) } return {data: null, error: null} }
    if (this.op === 'update') { T.filter(match).forEach(r => Object.assign(r, this.p)); return {data: null, error: null} }
    if (this.op === 'delete') { globalThis.__db[this.t] = T.filter(r => !match(r)); return {data: null, error: null} }
  }
}
export function createClient() { return { from: t => new Q(t), auth: { getUser: async jwt => ({ data: { user: globalThis.__jwts[jwt] ?? null } }) } } }
`;
const stubWebpush = `export default { setVapidDetails() {}, sendNotification: async (sub, payload) => { if (globalThis.__expired?.has(sub.endpoint)) { const e = new Error('gone'); e.statusCode = 410; throw e } globalThis.__sent.push({endpoint: sub.endpoint, payload: JSON.parse(payload)}) } };`;

async function load(fnName) {
  const out = await esbuild.build({entryPoints: [path.join(repo, 'supabase/functions', fnName, 'index.ts')], bundle: true, format: 'esm', write: false, platform: 'node', logLevel: 'silent',
    plugins: [{name: 'npm-stubs', setup(b) {
      b.onResolve({filter: /^npm:/}, a => ({path: a.path, namespace: 'stub'}));
      b.onLoad({filter: /.*/, namespace: 'stub'}, a => ({contents: a.path.includes('supabase-js') ? stubSupabase : stubWebpush, loader: 'js'}));
    }}]});
  const file = path.join(os.tmpdir(), `cc-edge-${fnName}-${Date.now()}.mjs`); fs.writeFileSync(file, out.outputFiles[0].text);
  globalThis.Deno = {env: {get: k => ({SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'svc', CC_PUSH_WEBHOOK_SECRET: 'sekret', CC_VAPID_PUBLIC_KEY: 'pub', CC_VAPID_PRIVATE_KEY: 'priv', CC_VAPID_CONTACT_EMAIL: 'a@b.invalid'})[k]}, serve: h => { globalThis.__handler = h }};
  const mod = await import(pathToFileURL(file).href); const handler = globalThis.__handler; return {mod, handler};
}
const post = (handler, body, headers = {}) => handler(new Request('http://x/fn', {method: 'POST', headers: {'content-type': 'application/json', ...headers}, body: JSON.stringify(body)}));
const reset = db => { globalThis.__db = structuredClone(db); globalThis.__sent = []; globalThis.__expired = new Set() };
const A = 'church-a', B = 'church-b';
const sub = (user, ep) => ({id: ep, user_id: user, endpoint: ep, p256dh: 'k', auth: 'a'});
const SEC = {'x-cc-webhook-secret': 'sekret'};

// ======================================= push function =======================================
{
  const {handler} = await load('send-message-push');
  const base = {
    member_profiles: [{user_id: 'a-admin', church_id: A, approved: true, display_name: 'Admin A'}, {user_id: 'a-pastor', church_id: A, approved: true}, {user_id: 'a-m1', church_id: A, approved: true}, {user_id: 'a-m2', church_id: A, approved: true}, {user_id: 'a-new', church_id: A, approved: false}, {user_id: 'b-admin', church_id: B, approved: true}, {user_id: 'b-m1', church_id: B, approved: true}],
    church_admins: [{user_id: 'a-admin', church_id: A}, {user_id: 'a-pastor', church_id: A}, {user_id: 'b-admin', church_id: B}],
    member_push_subscriptions: ['a-admin', 'a-pastor', 'a-m1', 'a-m2', 'a-new', 'b-admin', 'b-m1'].map(u => sub(u, 'ep-' + u)),
    ministries: [{id: 'min-a', name: 'Ushers', church_id: A}],
    conversations: [{id: 'c1', kind: 'direct', ministry_id: null}], conversation_members: [{conversation_id: 'c1', user_id: 'a-m1'}, {conversation_id: 'c1', user_id: 'a-m2'}],
    ministry_members: [], cc_push_deliveries: []};
  const eps = () => globalThis.__sent.map(s => s.endpoint).sort();

  reset(base);
  T('wrong secret is refused', (await post(handler, {}, {'x-cc-webhook-secret': 'nope'})).status === 401);
  T('no secret is refused', (await post(handler, {})).status === 401);

  const bc = {type: 'INSERT', table: 'member_updates', record: {id: 'u1', church_id: A, title: 'Service moved to 11am', body: 'x', ministry_id: null, created_by: 'a-admin'}};
  let r = await post(handler, bc, SEC);
  T('broadcast reaches approved members of that church (not the sender, not unapproved)', JSON.stringify(eps()) === JSON.stringify(['ep-a-m1', 'ep-a-m2', 'ep-a-pastor']), eps().join(','));
  T('broadcast never reaches the other church', !eps().some(e => e.startsWith('ep-b-')));
  T('broadcast notification shows the title and opens Updates', globalThis.__sent[0].payload.title === 'Church announcement' && globalThis.__sent[0].payload.body === 'Service moved to 11am' && globalThis.__sent[0].payload.view === 'updates', JSON.stringify(globalThis.__sent[0].payload));
  globalThis.__sent = []; r = await post(handler, bc, SEC);
  T('a retried webhook does not notify twice', globalThis.__sent.length === 0 && (await r.text()) === 'Duplicate');
  globalThis.__sent = []; await post(handler, {...bc, record: {...bc.record, id: 'u2', ministry_id: 'min-a'}}, SEC);
  T('a ministry-only update is not a church-wide broadcast', globalThis.__sent.length === 0);

  reset(base);
  await post(handler, {type: 'INSERT', table: 'member_profiles', record: {user_id: 'a-new', church_id: A, approved: false, display_name: 'Sister Newly Joined'}}, SEC);
  T("new sign-up alerts that church's administrators and pastors only", JSON.stringify(eps()) === JSON.stringify(['ep-a-admin', 'ep-a-pastor']), eps().join(','));
  T('sign-up alert opens the Membership page and names the person', globalThis.__sent[0].payload.page === 'membership' && /Sister Newly Joined/.test(globalThis.__sent[0].payload.body) && globalThis.__sent[0].payload.title === 'New member waiting for approval', JSON.stringify(globalThis.__sent[0].payload));
  globalThis.__sent = []; await post(handler, {type: 'INSERT', table: 'member_profiles', record: {user_id: 'a-new', church_id: A, approved: false, display_name: 'Sister Newly Joined'}}, SEC);
  T('retried sign-up alert is not repeated', globalThis.__sent.length === 0);
  globalThis.__sent = []; await post(handler, {type: 'INSERT', table: 'member_profiles', record: {user_id: 'x', church_id: A, approved: true, display_name: 'Pre-approved'}}, SEC);
  T('an already-approved profile triggers no alert', globalThis.__sent.length === 0);
  globalThis.__sent = []; await post(handler, {type: 'INSERT', table: 'member_profiles', record: {user_id: 'y', church_id: 'no-admins-church', approved: false}}, SEC);
  T('a church with no administrators is handled without error', globalThis.__sent.length === 0);

  reset(base);
  await post(handler, {type: 'INSERT', table: 'ministry_join_requests', record: {user_id: 'a-m1', ministry_id: 'min-a', status: 'pending'}}, SEC);
  T("ministry request alerts that church's administrators", JSON.stringify(eps()) === JSON.stringify(['ep-a-admin', 'ep-a-pastor']) && /asked to join Ushers/.test(globalThis.__sent[0].payload.body), JSON.stringify(globalThis.__sent[0]?.payload));
  globalThis.__sent = []; await post(handler, {type: 'INSERT', table: 'ministry_join_requests', record: {user_id: 'a-m1', ministry_id: 'min-a', status: 'approved'}}, SEC);
  T('a non-pending request triggers no alert', globalThis.__sent.length === 0);

  reset(base); await post(handler, {type: 'INSERT', table: 'messages', record: {id: 'm1', conversation_id: 'c1', sender_id: 'a-m1', body: 'secret text'}}, SEC);
  T('direct messages still notify only the other participant, without the message text', JSON.stringify(eps()) === JSON.stringify(['ep-a-m2']) && !JSON.stringify(globalThis.__sent).includes('secret text'));
  reset(base); globalThis.__expired.add('ep-a-m1'); await post(handler, bc, SEC);
  T('an expired phone subscription (410) is removed', !globalThis.__db.member_push_subscriptions.some(s => s.endpoint === 'ep-a-m1'));
}

// ======================================= website events sync =======================================
{
  const {mod, handler} = await load('sync-website-events');
  const {zonedToUtc, mapEvent, safeFeedUrl} = mod;
  T('winter time: 7:00 PM Eastern = 00:00 UTC next day', zonedToUtc('2026-02-02', '7:00 PM', 'America/New_York') === '2026-02-03T00:00:00.000Z', zonedToUtc('2026-02-02', '7:00 PM', 'America/New_York'));
  T('summer (daylight) time: 12:00 PM Eastern = 16:00 UTC', zonedToUtc('2026-07-04', '12:00 PM', 'America/New_York') === '2026-07-04T16:00:00.000Z');
  T('12:00 AM is midnight, 12:30 AM is just after', zonedToUtc('2026-02-02', '12:00 AM', 'America/New_York') === '2026-02-02T05:00:00.000Z' && zonedToUtc('2026-02-02', '12:30 AM', 'America/New_York') === '2026-02-02T05:30:00.000Z');
  T('daylight-saving switch day is handled (Nov 1 2026, 9:00 AM)', zonedToUtc('2026-11-01', '9:00 AM', 'America/New_York') === '2026-11-01T14:00:00.000Z');
  T('a bad date is rejected', zonedToUtc('02/02/2026', '7:00 PM', 'America/New_York') === null);
  const m = mapEvent({id: 273, title: 'Zoom <b>Prayer</b>', date: '2026-02-02', time: '', loc: '<a href="https://us02web.zoom.us/j/65?pwd=x" target="_blank">Online via Zoom</a>', desc: '<script>alert(1)</script>Join us', endTime: '8:00 PM'}, 'America/New_York');
  T('website HTML is turned into plain text and script/style content is dropped', m.title === 'Zoom Prayer' && m.location === 'Online via Zoom' && !/[<>]/.test(m.description + m.location + m.title) && !/alert/.test(m.description), JSON.stringify(m));
  T('all-day events are labelled and the link is kept', /All day\./.test(m.description) && /Link: https:\/\/us02web\.zoom\.us/.test(m.description) && /Ends 8:00 PM/.test(m.description), m.description);
  T('events with no place or description save empty text, never null (the database requires text)', typeof mapEvent({id: 9, title: 'No place', date: '2026-02-02', time: '7:00 PM'}, 'America/New_York').location === 'string' && typeof mapEvent({id: 9, title: 'No place', date: '2026-02-02', time: '7:00 PM'}, 'America/New_York').description === 'string' && mapEvent({id: 9, title: 'No place', date: '2026-02-02', time: '7:00 PM'}, 'America/New_York').location === '');
  T('events without a title or valid date are skipped', mapEvent({id: 1, title: '', date: '2026-02-02'}, 'America/New_York') === null && mapEvent({id: 2, title: 'x', date: 'soon'}, 'America/New_York') === null);
  T('only public https addresses are allowed', safeFeedUrl('https://example.org/api/events') && !safeFeedUrl('http://example.org/e') && !safeFeedUrl('https://127.0.0.1/e') && !safeFeedUrl('https://localhost/e') && !safeFeedUrl('https://intranet/e') && !safeFeedUrl('https://x.internal/e') && !safeFeedUrl('file:///etc/passwd') && !safeFeedUrl('https://[::1]/e'));

  const FEED = 'https://newbeginningsoutreachctrcogic.org/api/events';
  const feedJson = fixture ? JSON.parse(fs.readFileSync(fixture, 'utf8')) : {events: [{id: 1, title: 'Sunday Worship', date: '2026-11-01', time: '9:00 AM', loc: 'Main Sanctuary', desc: null}, {id: 2, title: 'Bible Study', date: '2026-11-04', time: '7:00 PM'}]};
  const total = feedJson.events.length;
  let fetched = [], respond = () => new Response(JSON.stringify(feedJson), {status: 200});
  globalThis.fetch = async (u) => { fetched.push(String(u)); const r = respond(String(u)); Object.defineProperty(r, 'url', {value: r.__url || String(u)}); return r };
  const base = {
    churches: [{id: A, events_feed_url: FEED, events_timezone: 'America/New_York', events_synced_at: null}, {id: B, events_feed_url: null, events_timezone: 'America/New_York'}],
    church_admins: [{user_id: 'a-admin', church_id: A}, {user_id: 'b-admin', church_id: B}],
    church_events: [{id: 'manual-1', church_id: A, title: 'Typed in by hand', source: null, external_id: null}, {id: 'b-manual', church_id: B, title: 'B event', source: null, external_id: null}]};
  globalThis.__jwts = {'jwt-a-admin': {id: 'a-admin'}, 'jwt-b-admin': {id: 'b-admin'}, 'jwt-member': {id: 'just-a-member'}};
  const call = (jwt, headers = {}) => handler(new Request('http://x/fn', {method: 'POST', headers: {...(jwt ? {authorization: 'Bearer ' + jwt} : {}), ...headers}, body: '{}'}));
  const websiteRows = ch => globalThis.__db.church_events.filter(e => e.church_id === ch && e.source === 'website');

  reset(base);
  T('no login is refused', (await call(null)).status === 401);
  T('a signed-in non-administrator is refused', (await call('jwt-member')).status === 403);
  T('church B has no address set, so its admin gets a clear message', (await call('jwt-b-admin')).status === 400);
  let res = await call('jwt-a-admin'); const out = await res.json();
  T('administrator sync succeeds', res.status === 200 && out.ok === true, JSON.stringify(out));
  T('no saved website event has a null description or location (database rule)', websiteRows(A).every(e => typeof e.description === 'string' && typeof e.location === 'string'));
  T(`${total} website events -> ${out.synced} saved (+${out.skipped} incomplete skipped)`, out.synced + out.skipped === total && websiteRows(A).length === out.synced);
  T('events were read from the church website address and nowhere else', fetched.length === 1 && fetched[0] === FEED, fetched.join(','));
  T('hand-made events are untouched, other church untouched', globalThis.__db.church_events.some(e => e.id === 'manual-1') && globalThis.__db.church_events.some(e => e.id === 'b-manual') && websiteRows(B).length === 0);
  T('every synced event is published, non-recurring and has a start time', websiteRows(A).every(e => e.published === true && e.recurrence === 'none' && !isNaN(Date.parse(e.starts_at))));
  T('no website HTML survives into saved text', websiteRows(A).every(e => !/[<>]/.test((e.title || '') + (e.description || '') + (e.location || ''))));
  T('status is recorded on the church', /Synced \d+ events/.test(globalThis.__db.churches[0].events_sync_status), globalThis.__db.churches[0].events_sync_status);
  res = await call('jwt-a-admin');
  T('syncing again straight away is throttled', res.status === 429);
  globalThis.__db.churches[0].events_synced_at = new Date(Date.now() - 120000).toISOString();
  const n1 = websiteRows(A).length; res = await call('jwt-a-admin');
  T('syncing again later changes nothing (no duplicates)', res.status === 200 && websiteRows(A).length === n1);
  if (!fixture) {
    feedJson.events = [{id: 1, title: 'Sunday Worship (updated)', date: '2026-11-01', time: '10:00 AM'}];
    globalThis.__db.churches[0].events_synced_at = null; await call('jwt-a-admin');
    T('an edited event is updated in place', websiteRows(A).length === 1 && websiteRows(A)[0].title === 'Sunday Worship (updated)');
    T('an event removed from the website is removed here', !websiteRows(A).some(e => e.external_id === '2'));
  }
  const keep = websiteRows(A).length;
  respond = () => new Response(JSON.stringify({events: []}), {status: 200}); globalThis.__db.churches[0].events_synced_at = null; await call('jwt-a-admin');
  T('an empty feed does not wipe existing events', websiteRows(A).length === keep);
  respond = () => new Response('<html>not json</html>', {status: 200}); globalThis.__db.churches[0].events_synced_at = null; res = await call('jwt-a-admin'); const bad = await res.json();
  T('a broken feed is reported, not saved', bad.ok === false && websiteRows(A).length === keep && /Could not read/.test(globalThis.__db.churches[0].events_sync_status), globalThis.__db.churches[0].events_sync_status);
  respond = () => new Response('oops', {status: 500}); globalThis.__db.churches[0].events_synced_at = null; res = await call('jwt-a-admin');
  T('a website error is reported', (await res.json()).ok === false && /error \(500\)/.test(globalThis.__db.churches[0].events_sync_status));
  respond = () => { const r = new Response('{"events":[]}', {status: 200}); r.__url = 'https://evil.example.net/x'; return r }; globalThis.__db.churches[0].events_synced_at = null; res = await call('jwt-a-admin');
  T('a redirect to a different website is refused', (await res.json()).ok === false && /redirected/.test(globalThis.__db.churches[0].events_sync_status));
  globalThis.__db.churches[0].events_feed_url = 'http://127.0.0.1/admin'; globalThis.__db.churches[0].events_synced_at = null; fetched = []; res = await call('jwt-a-admin');
  T('an internal address is never fetched', (await res.json()).ok === false && fetched.length === 0);

  reset({...base, churches: [{...base.churches[0]}, {id: B, events_feed_url: FEED, events_timezone: 'America/New_York'}]}); respond = () => new Response(JSON.stringify(feedJson), {status: 200}); fetched = [];
  T('a scheduled call with the wrong secret is refused', (await call(null, {'x-cc-webhook-secret': 'bad'})).status === 401);
  res = await call(null, SEC); const sched = await res.json();
  T('the schedule syncs every church that has an address', sched.results.length === 2 && sched.results.every(x => x.ok) && fetched.length === 2);
  T('each church only gets its own rows', websiteRows(A).every(e => e.church_id === A) && websiteRows(B).every(e => e.church_id === B) && websiteRows(B).length > 0);

  // ---------- standard calendar (.ics) feeds ----------
  const {icsToEvents, classifyFeed, candidateUrls, detectFeed} = mod;
  const NOW = new Date('2026-10-21T12:00:00Z');
  const ICS = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'UID:worship', 'SUMMARY:Sunday Worship', 'DTSTART;TZID=America/New_York:20261101T090000', 'DTEND;TZID=America/New_York:20261101T110000', 'LOCATION:Main Sanctuary', 'DESCRIPTION:Join us\\, all welcome. A very long line that is folded', ' onto the next line.', 'RRULE:FREQ=WEEKLY;BYDAY=SU;COUNT=3', 'EXDATE;TZID=America/New_York:20261108T090000', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:prayer', 'SUMMARY:Prayer (UTC time)', 'DTSTART:20261104T000000Z', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:fast', 'SUMMARY:Day of Fasting', 'DTSTART;VALUE=DATE:20261125', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:first-sun', 'SUMMARY:Communion', 'DTSTART;TZID=America/New_York:20261101T100000', 'RRULE:FREQ=MONTHLY;BYDAY=1SU;COUNT=2', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:old', 'SUMMARY:Last year', 'DTSTART:20250101T150000Z', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:cx', 'SUMMARY:Cancelled thing', 'DTSTART:20261201T150000Z', 'STATUS:CANCELLED', 'END:VEVENT',
    'END:VCALENDAR'].join('\r\n');
  const ev = icsToEvents(ICS, 'America/New_York', NOW), by = t => ev.filter(e => e.title === t);
  T('a repeating weekly event on Sundays is expanded (3 times, minus the skipped date)', JSON.stringify(by('Sunday Worship').map(e => e.date)) === '["2026-11-01","2026-11-15"]', JSON.stringify(by('Sunday Worship').map(e => e.date)));
  T('times keep the church local time and the end time is carried', by('Sunday Worship')[0].time === '9:00 AM' && by('Sunday Worship')[0].endTime === '11:00 AM', JSON.stringify(by('Sunday Worship')[0]));
  T('escaped commas and folded lines are read properly', /Join us, all welcome\. A very long line that is foldedonto the next line\./.test(by('Sunday Worship')[0].desc), by('Sunday Worship')[0].desc);
  T('a UTC time is converted to the church time zone (00:00Z on Nov 4 = 7:00 PM Eastern on Nov 3)', by('Prayer (UTC time)')[0].date === '2026-11-03' && by('Prayer (UTC time)')[0].time === '7:00 PM', JSON.stringify(by('Prayer (UTC time)')));
  T('an all-day event has no time', by('Day of Fasting')[0].date === '2026-11-25' && by('Day of Fasting')[0].time === '');
  T('"first Sunday of the month" repeats on the right days', JSON.stringify(by('Communion').map(e => e.date)) === '["2026-11-01","2026-12-06"]', JSON.stringify(by('Communion').map(e => e.date)));
  T('old one-time events and cancelled events are left out', by('Last year').length === 0 && by('Cancelled thing').length === 0);
  T('every converted event passes the same checks as website events', ev.every(e => mapEvent(e, 'America/New_York')), 'x');
  T('feeds are recognised: calendar, website list, and neither', classifyFeed(ICS) === 'ics' && classifyFeed('{"events":[{"id":1,"title":"A","date":"2026-11-01"}]}') === 'json' && classifyFeed('<html>hello</html>') === null && classifyFeed('{"events":[]}') === null && classifyFeed('BEGIN:VCALENDAR\r\nEND:VCALENDAR') === null);

  reset(base); globalThis.__db.churches[0].events_feed_url = 'https://churchsite.org/cal/feed.ics'; respond = () => new Response(ICS, {status: 200}); fetched = [];
  res = await call('jwt-a-admin'); const icsOut = await res.json();
  T('a church whose events address is a .ics calendar syncs its events', res.status === 200 && icsOut.ok === true && websiteRows(A).length > 0 && websiteRows(A).every(e => e.source === 'website' && e.published === true), JSON.stringify(icsOut));

  // ---------- finding the events list automatically ----------
  const site = new URL('https://churchsite.org/');
  const html = '<html><head><link rel="alternate" type="text/calendar" href="/cal/feed.ics"></head><body><a href="webcal://churchsite.org/other.ics">Subscribe</a><a href="https://calendar.example.com/ical/x/basic.ics">Google</a><a href="http://insecure.example/x.ics">no</a><a href="https://127.0.0.1/x.ics">no</a></body></html>';
  const cands = candidateUrls(html, site);
  T('places to look come from the page first, then the usual addresses', cands[0] === 'https://churchsite.org/cal/feed.ics' && cands.includes('https://churchsite.org/other.ics') && cands.includes('https://calendar.example.com/ical/x/basic.ics') && cands.includes('https://churchsite.org/api/events'), JSON.stringify(cands.slice(0, 5)));
  T('addresses that are not public https are never tried', !cands.some(u => /insecure|127\.0\.0\.1/.test(u)));
  const serve = map => u => { const k = Object.keys(map).find(x => u === x); return k ? new Response(map[k], {status: 200}) : new Response('nope', {status: 404}) };
  const detectCall = (jwt, body) => handler(new Request('http://x/fn', {method: 'POST', headers: {authorization: 'Bearer ' + jwt}, body: JSON.stringify(body)}));
  const withSite = (url, feed = null) => ({...base, churches: [{...base.churches[0], website_url: url, events_feed_url: feed}, base.churches[1]]});
  reset(withSite('https://churchsite.org')); respond = serve({'https://churchsite.org/': html, 'https://churchsite.org/cal/feed.ics': ICS}); fetched = [];
  res = await detectCall('jwt-a-admin', {detect: true}); const dOut = await res.json();
  T('detect finds the calendar feed the website page points to, saves it, and copies the events', dOut.found === true && dOut.type === 'ics' && dOut.feed === 'https://churchsite.org/cal/feed.ics' && dOut.ok === true && globalThis.__db.churches[0].events_feed_url === dOut.feed && websiteRows(A).length > 0, JSON.stringify(dOut));
  reset(withSite('https://churchsite.org')); respond = serve({'https://churchsite.org/api/events': JSON.stringify(feedJson)}); fetched = [];
  res = await detectCall('jwt-a-admin', {detect: true}); const d2 = await res.json();
  T('detect also finds a website events list at the usual address (like /api/events)', d2.found === true && d2.type === 'json' && globalThis.__db.churches[0].events_feed_url === 'https://churchsite.org/api/events', JSON.stringify(d2));
  reset(withSite('https://churchsite.org')); respond = serve({}); res = await detectCall('jwt-a-admin', {detect: true}); const d3 = await res.json();
  T('when nothing is found it says so plainly and changes nothing', d3.found === false && /could not find/.test(d3.error) && !globalThis.__db.churches[0].events_feed_url && websiteRows(A).length === 0, JSON.stringify(d3));
  reset(withSite(null)); res = await detectCall('jwt-a-admin', {detect: true});
  T('with no website address saved it asks for one', res.status === 400 && /website address/.test((await res.json()).error));
  reset(withSite('https://churchsite.org', FEED)); fetched = []; respond = serve({}); res = await detectCall('jwt-a-admin', {detect: true, ifEmpty: true}); const d4 = await res.json();
  T('automatic detection never replaces an address the church already set', d4.found === false && fetched.length === 0 && globalThis.__db.churches[0].events_feed_url === FEED, JSON.stringify(d4) + fetched.join());
  reset(withSite('https://churchsite.org')); res = await detectCall('jwt-member', {detect: true});
  T('only an administrator can run detection', res.status === 403);
  reset(withSite('http://127.0.0.1/')); fetched = []; res = await detectCall('jwt-a-admin', {detect: true});
  T('an internal website address is never fetched', res.status === 400 && fetched.length === 0);
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
