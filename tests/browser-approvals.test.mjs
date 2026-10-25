// Headless Edge test of the redesigned membership approvals panel. Supabase is fully mocked (fake admin session, canned replies).
// Usage: node browser-approvals.test.mjs   (needs: npm i puppeteer-core)
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.env.CC_REPO || 'D:/Projects/church-connect');
const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png'};
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end() }
  res.writeHead(200, {'content-type': types[path.extname(f)] || 'text/plain'});
  res.end(path.basename(f) === 'config.js' ? fs.readFileSync(f, 'utf8').replace('https://khnakybowzrfpqwakphi.supabase.co', 'https://vizcmyqyoaazkcytcunp.supabase.co').replace('sb_publishable_ftUugSYhXbtSHNLeY-e4vw_dIoNkHlN', 'sb_publishable_ugyikgHimwHU3wGMFmxojg_qGYRCg61') : fs.readFileSync(f));
}).listen(0);
const port = server.address().port;
const browser = await puppeteer.launch({executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--no-sandbox']});
let fails = 0; const T = (n, ok, extra = '') => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok && !extra ? '' : ' => ' + extra)) };

const ADMIN = 'a1000000-0000-0000-0000-000000000001';
const USER = {id: ADMIN, aud: 'authenticated', role: 'authenticated', email: 'admin@example.invalid', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z'};
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const session = {access_token: `${b64({alg: 'HS256'})}.${b64({sub: ADMIN, role: 'authenticated', exp: 4102444800})}.sig`, refresh_token: 'r', expires_in: 3600, expires_at: 4102444800, token_type: 'bearer', user: USER};
const id = n => `b${String(n).padStart(7, '0')}-0000-0000-0000-000000000000`;
// 2 pending, 30 approved (1 admin, even numbers have push)
const MEMBERS = [
  {user_id: id(1), display_name: 'Pending Pat', approved: false, created_at: '2026-10-25T10:00:00Z'},
  {user_id: id(2), display_name: 'Pending Paul', approved: false, created_at: '2026-10-24T10:00:00Z'},
  ...Array.from({length: 30}, (_, i) => ({user_id: id(100 + i), display_name: `Member ${String(i).padStart(2, '0')}`, approved: true, created_at: `2026-09-${String(i % 28 + 1).padStart(2, '0')}T10:00:00Z`})),
  {user_id: ADMIN, display_name: 'Test Admin', approved: true, created_at: '2026-01-01T00:00:00Z'}
];

async function scenario(name, pushRpcWorks, fn) {
  const tab = await browser.newPage(); const calls = []; const errors = [];
  tab.on('pageerror', e => errors.push(e.message)); tab.on('dialog', d => d.accept());
  await tab.evaluateOnNewDocument(s => localStorage.setItem('sb-vizcmyqyoaazkcytcunp-auth-token', JSON.stringify(s)), session);
  const cdp = await tab.createCDPSession();
  await cdp.send('Fetch.enable', {patterns: [{urlPattern: '*vizcmyqyoaazkcytcunp.supabase.co*'}]});
  cdp.on('Fetch.requestPaused', async ev => {
    const u = new URL(ev.request.url), m = ev.request.method; const accept = ev.request.headers['Accept'] || ev.request.headers['accept'] || '';
    let body = [], code = 200;
    if (m === 'OPTIONS') body = '';
    else if (u.pathname === '/auth/v1/user') body = USER;
    else if (u.pathname.endsWith('/rest/v1/church_admins')) body = /object/.test(accept) ? {user_id: ADMIN} : [{user_id: ADMIN}];
    else if (u.pathname.endsWith('/rest/v1/member_profiles')) body = MEMBERS;
    else if (u.pathname.endsWith('/rpc/cc_member_access')) body = MEMBERS.map(x => ({user_id: x.user_id, is_admin: x.user_id === ADMIN, is_pastor: false, is_me: x.user_id === ADMIN}));
    else if (u.pathname.endsWith('/rpc/cc_member_push_status')) { if (pushRpcWorks) body = MEMBERS.map(x => ({user_id: x.user_id, has_push: x.approved && parseInt(x.user_id.slice(1, 8), 10) % 2 === 0})); else { code = 404; body = {message: 'function not found'} } }
    else if (u.pathname.endsWith('/rpc/cc_manage_member')) { calls.push(JSON.parse(ev.request.postData || '{}')); body = null }
    else if (/object/.test(accept)) { code = 406; body = {message: 'none'} }
    await cdp.send('Fetch.fulfillRequest', {requestId: ev.requestId, responseCode: code, responseHeaders: [{name: 'content-type', value: 'application/json'}, {name: 'access-control-allow-origin', value: '*'}, {name: 'access-control-allow-headers', value: '*'}, {name: 'access-control-allow-methods', value: '*'}], body: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)).toString('base64')});
  });
  await tab.goto(`http://localhost:${port}/membership.html`, {waitUntil: 'load', timeout: 45000});
  await tab.waitForFunction(() => document.querySelectorAll('#members .list-item').length > 0, {timeout: 25000}).catch(() => {});
  await new Promise(r => setTimeout(r, 800));
  console.log(`-- ${name}`);
  await fn(tab, calls, errors);
  T('no page errors', errors.length === 0, errors.join(' | '));
  await tab.close();
}

const rows = tab => tab.evaluate(() => [...document.querySelectorAll('#members .membership-row')].map(r => r.innerText.replace(/\s+/g, ' ')));
const tabLabels = tab => tab.evaluate(() => [...document.querySelectorAll('#memberTabs .tab')].map(t => t.textContent));

await scenario('push status function installed', true, async (tab, calls) => {
  T('opens on Awaiting approval with the two pending people', (await rows(tab)).length === 2, JSON.stringify(await rows(tab)));
  const labels = await tabLabels(tab);
  T('tabs show counts', labels[0] === 'Awaiting approval (2)' && labels[1] === 'Approved (31)' && labels[2] === 'All (33)', JSON.stringify(labels));
  T('newest pending first', (await rows(tab))[0].startsWith('Pending Pat'));
  T('summary says 2 waiting', /2 waiting/.test(await tab.evaluate(() => document.getElementById('approvalSummary').textContent)));
  T('pending rows offer Approve + Copy welcome message', await tab.evaluate(() => { const b = [...document.querySelector('#members .membership-row').querySelectorAll('button')].map(x => x.textContent); return b.includes('Approve member') && b.includes('Copy welcome message') }));
  T('Approve everyone shown is visible', await tab.evaluate(() => !document.getElementById('approveAll').classList.contains('hidden')));
  await tab.click('#approveAll'); await new Promise(r => setTimeout(r, 800));
  T('bulk approve calls approve_member for both', calls.length === 2 && calls.every(c => c.p_action === 'approve_member') && calls[0].p_user_id === id(1), JSON.stringify(calls));

  await tab.click('#memberTabs [data-tab=approved]'); await new Promise(r => setTimeout(r, 300));
  T('approved tab pages at 25', (await rows(tab)).length === 25, String((await rows(tab)).length));
  T('Show more is visible, then reveals the rest', await tab.evaluate(async () => { const b = document.getElementById('showMore'); if (b.classList.contains('hidden')) return false; b.click(); return document.querySelectorAll('#members .membership-row').length === 31 && document.getElementById('showMore').classList.contains('hidden') }));
  T('approved rows show notification state', (await rows(tab)).every(r => /Phone notifications: (on|NOT on)/.test(r)));
  T('NOT-on rows get Copy welcome message inside Manage, others do not', await tab.evaluate(() => [...document.querySelectorAll('#members .membership-row')].every(r => { const off = /NOT on/.test(r.innerText); const has = [...r.querySelectorAll('button')].some(b => b.textContent === 'Copy welcome message'); return off === has })));
  T('approved actions are tucked in a Manage dropdown', await tab.evaluate(() => document.querySelectorAll('#members details > summary').length > 0));
  await tab.type('#search', 'Member 07'); await new Promise(r => setTimeout(r, 300));
  T('search narrows the list', (await rows(tab)).length === 1, JSON.stringify(await rows(tab)));
  await tab.evaluate(() => { document.getElementById('search').value = ''; document.getElementById('search').dispatchEvent(new Event('input')) });
  await tab.select('#sortBy', 'name'); await new Promise(r => setTimeout(r, 300));
  T('sort by name A-Z', (await rows(tab))[0].startsWith('Member 00'), (await rows(tab))[0]);
});

await scenario('push status function NOT installed yet (page must still work)', false, async (tab) => {
  T('still lists pending people', (await rows(tab)).length === 2);
  await tab.click('#memberTabs [data-tab=approved]'); await new Promise(r => setTimeout(r, 300));
  T('no notification claims when status is unknown', (await rows(tab)).every(r => !/Phone notifications/.test(r)));
});

console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
await browser.close(); server.close(); process.exit(fails ? 1 : 0);
