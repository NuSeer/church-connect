// Headless Edge test of the member portal with the messaging upgrade AND the safety layer together (Supabase is fully mocked).
// Usage: node browser-messaging-merge.test.mjs   (needs: npm i puppeteer-core)
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.env.CC_REPO || 'D:/Projects/church-connect');
const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml'};
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end() }
  res.writeHead(200, {'content-type': types[path.extname(f)] || 'text/plain'});
  res.end(path.basename(f) === 'config.js' ? fs.readFileSync(f, 'utf8').replace('https://khnakybowzrfpqwakphi.supabase.co', 'https://vizcmyqyoaazkcytcunp.supabase.co').replace('sb_publishable_ftUugSYhXbtSHNLeY-e4vw_dIoNkHlN', 'sb_publishable_ugyikgHimwHU3wGMFmxojg_qGYRCg61') : fs.readFileSync(f));
}).listen(0);
const port = server.address().port;
const browser = await puppeteer.launch({executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--no-sandbox']});
let fails = 0; const T = (n, ok, extra = '') => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok && !extra ? '' : ' => ' + extra)) };
const wait = ms => new Promise(r => setTimeout(r, ms));

const ME = 'a1000000-0000-0000-0000-000000000001', BEA = 'a2000000-0000-0000-0000-000000000002';
const USER = {id: ME, aud: 'authenticated', role: 'authenticated', email: 'me@example.invalid', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z'};
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const session = {access_token: `${b64({alg: 'HS256'})}.${b64({sub: ME, role: 'authenticated', exp: 4102444800})}.sig`, refresh_token: 'r', expires_in: 3600, expires_at: 4102444800, token_type: 'bearer', user: USER};
const PROFILE = {user_id: ME, display_name: 'Me Member', bio: '', directory_visible: true, directory_contact_visible: false, contact_email: null, approved: true, created_at: '2026-01-01T00:00:00Z'};
const dirRow = (id, name) => ({user_id: id, display_name: name, bio: '', directory_visible: true, directory_contact_visible: false, contact_email: null, gender: null, photo_path: null, photo_visible: false});
const HIDDEN = 'a3000000-0000-0000-0000-000000000003', NOMSG = 'a4000000-0000-0000-0000-000000000004', OKAY = 'a5000000-0000-0000-0000-000000000005';
const DIR = [PROFILE, dirRow(HIDDEN, 'Mara Hidden'), dirRow(NOMSG, 'Marcus Nomsg'), dirRow(OKAY, 'Maria Okay')];
const day = n => new Date(Date.now() + n * 86400000).toISOString();
const CHATS = [
  {id: 'c1000000-0000-0000-0000-000000000001', kind: 'direct', label: 'Bea Lee', status: 'request', requested_by: BEA, archived: false, muted: false, can_manage: false, preview: 'Hello from Bea', last_at: day(-0.1), parent_id: null, announcement_only: false},
  {id: 'c2000000-0000-0000-0000-000000000002', kind: 'ministry', label: 'Choir', status: 'active', requested_by: null, archived: false, muted: false, can_manage: false, preview: 'Rehearsal is Wednesday', last_at: day(-1), parent_id: null, ministry_id: 'm1000000-0000-0000-0000-000000000001', announcement_only: false}];
const UPDATES = [
  {id: 'u1000000-0000-0000-0000-000000000001', title: 'Old news', body: 'expired', created_at: day(-9), pinned: false, expires_at: day(-1), ministry_id: null},
  {id: 'u2000000-0000-0000-0000-000000000002', title: 'Newer note', body: 'recent', created_at: day(-1), pinned: false, expires_at: null, ministry_id: null},
  {id: 'u3000000-0000-0000-0000-000000000003', title: 'Pinned notice', body: 'important', created_at: day(-5), pinned: true, expires_at: null, ministry_id: null}];
const YOUTH = [{conversation_id: 'c9000000-0000-0000-0000-000000000009', youth_id: 'y1000000-0000-0000-0000-000000000001', youth_name: 'Dan Young', kind: 'direct', label: 'Yara'}];

async function scenario(name, fn, opts = {}) {
  const tab = await browser.newPage(); const calls = []; const errors = [];
  tab.on('pageerror', e => errors.push(e.message)); tab.on('dialog', d => d.accept());
  await tab.evaluateOnNewDocument(s => localStorage.setItem('sb-vizcmyqyoaazkcytcunp-auth-token', JSON.stringify(s)), session);
  const cdp = await tab.createCDPSession();
  await cdp.send('Fetch.enable', {patterns: [{urlPattern: '*vizcmyqyoaazkcytcunp.supabase.co*'}]});
  cdp.on('Fetch.requestPaused', async ev => {
    const u = new URL(ev.request.url), m = ev.request.method, p = u.pathname; const accept = ev.request.headers['Accept'] || ev.request.headers['accept'] || '';
    const obj = /object/.test(accept); let body, code = 200;
    const post = () => { try { return JSON.parse(ev.request.postData || '{}') } catch { return {} } };
    const rpc = n => p.endsWith('/rpc/' + n);
    if (m === 'OPTIONS') body = '';
    else if (p === '/auth/v1/user') body = USER;
    else if (rpc('cc_can_broadcast')) body = true;
    else if (rpc('cc_is_admin') || rpc('cc_is_platform_admin') || rpc('cc_is_webmaster')) body = false;
    else if (rpc('cc_chat_list')) body = CHATS;
    else if (rpc('cc_chat_people')) body = [{user_id: ME, display_name: 'Me Member'}, {user_id: BEA, display_name: 'Bea Lee'}];
    else if (rpc('cc_directory_rules')) if (opts.noRules) { code = 404; body = {code: 'PGRST202', message: 'Could not find the function public.cc_directory_rules in the schema cache'} } else body = [{user_id: HIDDEN, hidden: true, can_message: false, blocked_by_me: false}, {user_id: NOMSG, hidden: false, can_message: false, blocked_by_me: false}, {user_id: OKAY, hidden: false, can_message: true, blocked_by_me: false}];
    else if (rpc('cc_my_youth_conversations')) body = YOUTH;
    else if (rpc('cc_guardian_people')) body = [{user_id: 'y1000000-0000-0000-0000-000000000001', display_name: 'Dan Young'}, {user_id: 'y2000000-0000-0000-0000-000000000002', display_name: 'Yara Friend'}];
    else if (rpc('cc_update_ack_summary')) body = [{update_id: 'u3', title: 'Pinned notice', created_at: day(-5), acked: 2, total: 5}];
    else if (['cc_respond_chat', 'cc_set_chat_mode', 'cc_set_my_birth_date', 'cc_ack_update', 'cc_send_broadcast', 'cc_broadcast_sms_recipients'].some(rpc)) { calls.push({fn: p.split('/').pop(), body: post()}); body = rpc('cc_send_broadcast') ? 'b0000000-0000-0000-0000-000000000001' : rpc('cc_broadcast_sms_recipients') ? [] : null }
    else if (p.endsWith('/rest/v1/member_profiles')) body = obj ? PROFILE : (u.searchParams.get('user_id') === 'eq.' + ME ? [PROFILE] : DIR);
    else if (p.endsWith('/rest/v1/member_updates')) body = UPDATES;
    else if (p.endsWith('/rest/v1/cc_messaging_settings')) body = obj ? {allow_direct: true, request_first: false} : [];
    else if (p.endsWith('/rest/v1/cc_member_safety')) body = obj ? {birth_date: null} : [];
    else if (p.endsWith('/rest/v1/messages')) body = ev.request.url.includes('c9000000') ? [{id: 'm1', body: 'See you at six', created_at: day(-1), sender_id: 'y2000000-0000-0000-0000-000000000002', deleted_at: null}] : [];
    if (body === undefined) { if (obj) { code = 406; body = {message: 'none'} } else body = [] }
    await cdp.send('Fetch.fulfillRequest', {requestId: ev.requestId, responseCode: code, responseHeaders: [{name: 'content-type', value: 'application/json'}, {name: 'access-control-allow-origin', value: '*'}, {name: 'access-control-allow-headers', value: '*'}, {name: 'access-control-allow-methods', value: '*'}], body: Buffer.from(JSON.stringify(body ?? null)).toString('base64')});
  });
  await tab.goto(`http://localhost:${port}/connect.html`, {waitUntil: 'load', timeout: 45000});
  await tab.waitForFunction(() => !document.getElementById('portal')?.classList.contains('hidden'), {timeout: 25000}).catch(() => {});
  await wait(1800);
  console.log(`-- ${name}`); if (process.env.DBG) console.log('ERR', errors, await tab.evaluate(() => document.getElementById('notice')?.textContent));
  await fn(tab, calls, errors);
  await tab.close();
}
const text = (tab, sel) => tab.evaluate(s => document.querySelector(s)?.textContent || '', sel);

await scenario('messages, requests, updates, directory and safety together', async (tab, calls, errors) => {
  T('portal opened', await tab.evaluate(() => !document.getElementById('portal').classList.contains('hidden')));
  const list = await text(tab, '#conversationList');
  T('conversations show the person and ministry names with the latest message', /Bea Lee/.test(list) && /Choir/.test(list) && /Rehearsal is Wednesday/.test(list), list.slice(0, 200));
  T('a first message from someone new is marked as a request', /Message request/.test(list), list.slice(0, 200));
  await tab.click('[data-view="messages"]'); await wait(200);
  await tab.evaluate(() => [...document.querySelectorAll('#conversationList .chat-row')].find(b => /Bea Lee/.test(b.textContent)).click()); await wait(900);
  T('the request banner offers Accept, Decline and Block', await tab.evaluate(() => { const b = document.getElementById('requestBanner'); return !b.classList.contains('hidden') && ['Accept', 'Decline', 'Block'].every(t => [...b.querySelectorAll('button')].some(x => x.textContent === t)) }));
  T('the person who was asked cannot type until they accept', await tab.evaluate(() => document.getElementById('messageBody').disabled));
  await tab.evaluate(() => [...document.querySelectorAll('#requestBanner button')].find(x => x.textContent === 'Accept').click()); await wait(800);
  T('Accept tells the database to accept that conversation', calls.some(c => c.fn === 'cc_respond_chat' && c.body.p_action === 'accept' && c.body.p_conversation === CHATS[0].id), JSON.stringify(calls.filter(c => c.fn === 'cc_respond_chat')));

  await tab.click('[data-view="updates"]');
  const ups = await tab.evaluate(() => [...document.querySelectorAll('#updateList .list-item')].map(x => x.textContent));
  T('pinned notice comes first and the expired one is hidden', ups.length === 2 && /Pinned notice/.test(ups[0]) && !ups.some(x => /Old news/.test(x)), JSON.stringify(ups));
  T('each announcement has an "I\'ve seen this" button', ups.every(x => /I've seen this/.test(x)), JSON.stringify(ups));
  await tab.evaluate(() => [...document.querySelectorAll('#updateList button')][0].click()); await wait(700);
  T('tapping it records the acknowledgment', calls.some(c => c.fn === 'cc_ack_update' && c.body.p_update_id === UPDATES[2].id), JSON.stringify(calls.filter(c => c.fn === 'cc_ack_update')));
  T('and shows "You have seen this"', /You have seen this/.test(await text(tab, '#updateList .list-item')));

  await tab.click('[data-view="directory"]'); await tab.type('#directorySearch', 'ma'); await wait(300);
  const dir = await text(tab, '#directoryList');
  T('a member hidden by the rules is not listed', !/Mara Hidden/.test(dir), dir.slice(0, 160));
  T('a member not taking new messages shows a note instead of a Message button', await tab.evaluate(() => { const r = [...document.querySelectorAll('#directoryList .list-item')].find(x => /Marcus/.test(x.textContent)); return !!r && /Not taking new messages/.test(r.textContent) && ![...r.querySelectorAll('button')].some(b => b.textContent === 'Message') }));
  T('an ordinary member still has a Message button', await tab.evaluate(() => { const r = [...document.querySelectorAll('#directoryList .list-item')].find(x => /Maria/.test(x.textContent)); return !!r && [...r.querySelectorAll('button')].some(b => b.textContent === 'Message') }));

  await tab.click('[data-view="profile"]');
  T('Messages and safety is shown in My Profile', await tab.evaluate(() => !document.getElementById('safetySection').classList.contains('hidden')));
  await tab.select('#safetyChatMode', 'ask'); await wait(500);
  T('choosing "ask me first" is saved', calls.some(c => c.fn === 'cc_set_chat_mode' && c.body.p_mode === 'ask'), JSON.stringify(calls.filter(c => c.fn === 'cc_set_chat_mode')));
  await tab.evaluate(() => { document.getElementById('birthDate').value = '2012-05-01' });
  await tab.click('#birthDateSave'); await wait(600);
  T('the date of birth is sent to the database', calls.some(c => c.fn === 'cc_set_my_birth_date' && c.body.p_date === '2012-05-01'), JSON.stringify(calls.filter(c => c.fn === 'cc_set_my_birth_date')));
  await tab.click('#largeText');
  T('Larger text turns on and is remembered', await tab.evaluate(() => document.documentElement.classList.contains('cc-large') && localStorage.getItem('cc-large-text') === '1'));
  T('there is a step-by-step notification guide', await tab.evaluate(() => /Add to Home Screen/.test(document.querySelector('.cc-guide')?.textContent || '')));

  T('a guardian sees a read-only list for their young member', /Dan Young · Yara/.test(await text(tab, '#guardianChats')));
  await tab.click('[data-view="messages"]');
  await tab.evaluate(() => document.querySelector('#guardianChats button').click()); await wait(700);
  const gv = await text(tab, '#guardianView');
  T('and can read the conversation with names', /Yara Friend/.test(gv) && /See you at six/.test(gv), gv.slice(0, 200));

  await tab.click('#broadcastTab');
  T('Broadcast offers pin and expiry', await tab.evaluate(() => !document.getElementById('broadcastPlus').classList.contains('hidden')));
  await tab.type('#broadcastTitle', 'Choir trip'); await tab.type('#broadcastBody', 'Buses leave at eight.');
  await tab.click('#broadcastPinned'); await tab.select('#broadcastExpires', '7'); await tab.click('#broadcastSend'); await wait(1200);
  const sent = calls.find(c => c.fn === 'cc_send_broadcast');
  T('the broadcast carries the pin and a one-week expiry', sent && sent.body.p_pinned === true && Math.abs(new Date(sent.body.p_expires_at) - (Date.now() + 7 * 86400000)) < 60000, JSON.stringify(sent));
  T('leaders see who has seen recent announcements', /2 of 5 members/.test(await text(tab, '#ackSummary')));
  T('no script errors', errors.length === 0, errors.join(' | ').slice(0, 300));
});
await scenario('a project without the safety update still works', async (tab, calls, errors) => {
  T('portal opened', await tab.evaluate(() => !document.getElementById('portal').classList.contains('hidden')));
  T('Messages and safety stays hidden', await tab.evaluate(() => document.getElementById('safetySection').classList.contains('hidden')));
  T('everyone is still listed with a Message button', await (async () => { await tab.click('[data-view="directory"]'); await tab.type('#directorySearch', 'ma'); await wait(300); return tab.evaluate(() => [...document.querySelectorAll('#directoryList button')].filter(b => b.textContent === 'Message').length === 3) })());
  T('no script errors', errors.length === 0, errors.join(' | ').slice(0, 300));
}, {noRules: true});
await browser.close(); server.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); process.exit(fails ? 1 : 0);
