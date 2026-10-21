// Headless Edge test of the member-portal Broadcast tab. Supabase is fully mocked (fake signed-in session, canned replies).
// Usage: node browser-broadcast.test.mjs   (needs: npm i puppeteer-core)
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.env.CC_REPO || 'D:/Projects/church-connect');
const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png'};
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end() }
  res.writeHead(200, {'content-type': types[path.extname(f)] || 'text/plain'}); res.end(path.basename(f) === 'config.js' ? fs.readFileSync(f, 'utf8').replace('https://khnakybowzrfpqwakphi.supabase.co', 'https://vizcmyqyoaazkcytcunp.supabase.co').replace('sb_publishable_ftUugSYhXbtSHNLeY-e4vw_dIoNkHlN', 'sb_publishable_ugyikgHimwHU3wGMFmxojg_qGYRCg61') : fs.readFileSync(f)); // tests run on localhost: point it at the project the mocks answer for
}).listen(0);
const port = server.address().port;
const browser = await puppeteer.launch({executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--no-sandbox']});
let fails = 0; const T = (n, ok, extra = '') => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok && !extra ? '' : ' => ' + extra)) };

const USER = {id: 'a1000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'admin@example.invalid', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z'};
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const session = {access_token: `${b64({alg: 'HS256'})}.${b64({sub: USER.id, role: 'authenticated', exp: 4102444800})}.sig`, refresh_token: 'r', expires_in: 3600, expires_at: 4102444800, token_type: 'bearer', user: USER};
const PROFILE = {user_id: USER.id, display_name: 'Test Admin', bio: '', directory_visible: true, directory_contact_visible: false, contact_email: null, approved: true, created_at: '2026-01-01T00:00:00Z'};

async function scenario(name, canBroadcast, fn) {
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
    else if (u.pathname.endsWith('/rpc/cc_can_broadcast')) body = canBroadcast;
    else if (u.pathname.endsWith('/rpc/cc_send_broadcast')) { calls.push({fn: 'send', body: JSON.parse(ev.request.postData || '{}')}); body = 'b0000000-0000-0000-0000-000000000001' }
    else if (u.pathname.endsWith('/rpc/cc_broadcast_sms_recipients')) { calls.push({fn: 'sms', body: JSON.parse(ev.request.postData || '{}')}); body = [{phone: '+19045550101'}, {phone: '+19045551111'}] }
    else if (u.pathname.endsWith('/rest/v1/member_profiles')) body = /object/.test(accept) ? PROFILE : [PROFILE];
    else if (/object/.test(accept)) { code = 406; body = {message: 'none'} }
    await cdp.send('Fetch.fulfillRequest', {requestId: ev.requestId, responseCode: code, responseHeaders: [{name: 'content-type', value: 'application/json'}, {name: 'access-control-allow-origin', value: '*'}, {name: 'access-control-allow-headers', value: '*'}, {name: 'access-control-allow-methods', value: '*'}], body: Buffer.from(typeof body === 'string' && m === 'OPTIONS' ? '' : JSON.stringify(body)).toString('base64')}).catch(() => {});
  });
  await tab.goto(`http://localhost:${port}/connect.html`, {waitUntil: 'load', timeout: 45000});
  await tab.waitForFunction(() => !document.getElementById('portal')?.classList.contains('hidden'), {timeout: 25000}).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  console.log(`-- ${name}`);
  await fn(tab, calls, errors);
  await tab.close();
}

await scenario('administrator / pastor (server says yes)', true, async (tab, calls, errors) => {
  T('portal opened for the signed-in member', await tab.evaluate(() => !document.getElementById('portal').classList.contains('hidden')));
  T('Broadcast tab is visible', await tab.evaluate(() => !document.getElementById('broadcastTab').classList.contains('hidden')));
  await tab.click('#broadcastTab');
  T('clicking it opens the broadcast panel and hides Updates', await tab.evaluate(() => !document.getElementById('broadcast').classList.contains('hidden') && document.getElementById('updates').classList.contains('hidden')));
  T('text options start hidden', await tab.evaluate(() => document.getElementById('broadcastTextOptions').classList.contains('hidden')));
  await tab.type('#broadcastTitle', 'Service moved');
  await tab.type('#broadcastBody', 'We meet at 11am this Sunday.');
  await tab.click('#broadcastText');
  T('ticking "Also send as text" reveals the text options', await tab.evaluate(() => !document.getElementById('broadcastTextOptions').classList.contains('hidden')));
  await tab.click('#broadcastSend');
  await new Promise(r => setTimeout(r, 1500));
  const send = calls.find(c => c.fn === 'send');
  T('sent exactly the typed title and message to the server', send && send.body.p_title === 'Service moved' && send.body.p_body === 'We meet at 11am this Sunday.', JSON.stringify(send));
  T('asked only for people without the app (default)', calls.find(c => c.fn === 'sms')?.body.p_without_app === true);
  const status = await tab.evaluate(() => document.getElementById('broadcastStatus').textContent);
  T('shows a "Sent" confirmation', /Sent\./.test(status), status);
  const links = await tab.evaluate(() => [...document.querySelectorAll('#broadcastSms a')].map(a => a.getAttribute('href')));
  T('one-at-a-time mode gives one text button per person (2)', links.length === 2, JSON.stringify(links));
  T('each button is an sms: link carrying the message', links.every(l => l.startsWith('sms:+1904') && decodeURIComponent(l).includes('Service moved: We meet at 11am')), links[0]);
  T('form is cleared after sending', await tab.evaluate(() => document.getElementById('broadcastTitle').value === '' && document.getElementById('broadcastBody').value === ''));
  T('no script errors', errors.length === 0, errors.join(' | ').slice(0, 200));
});
await scenario('ordinary member (server says no)', false, async (tab, calls, errors) => {
  T('portal opened', await tab.evaluate(() => !document.getElementById('portal').classList.contains('hidden')));
  T('Broadcast tab stays hidden', await tab.evaluate(() => document.getElementById('broadcastTab').classList.contains('hidden')));
  T('no script errors', errors.length === 0, errors.join(' | ').slice(0, 200));
});
await scenario('notification tap opens the Updates tab (?view=updates)', true, async () => {});
{
  const tab = await browser.newPage(); const errors = [];
  tab.on('pageerror', e => errors.push(e.message));
  await tab.evaluateOnNewDocument(s => localStorage.setItem('sb-vizcmyqyoaazkcytcunp-auth-token', JSON.stringify(s)), session);
  const cdp = await tab.createCDPSession();
  await cdp.send('Fetch.enable', {patterns: [{urlPattern: '*vizcmyqyoaazkcytcunp.supabase.co*'}]});
  cdp.on('Fetch.requestPaused', async ev => {
    const u = new URL(ev.request.url); const accept = ev.request.headers['Accept'] || ev.request.headers['accept'] || '';
    let body = [], code = 200;
    if (u.pathname === '/auth/v1/user') body = USER; else if (u.pathname.endsWith('/rpc/cc_can_broadcast')) body = true;
    else if (u.pathname.endsWith('/rest/v1/member_profiles')) body = /object/.test(accept) ? PROFILE : [PROFILE]; else if (/object/.test(accept)) { code = 406; body = {} }
    await cdp.send('Fetch.fulfillRequest', {requestId: ev.requestId, responseCode: code, responseHeaders: [{name: 'content-type', value: 'application/json'}, {name: 'access-control-allow-origin', value: '*'}, {name: 'access-control-allow-headers', value: '*'}, {name: 'access-control-allow-methods', value: '*'}], body: Buffer.from(ev.request.method === 'OPTIONS' ? '' : JSON.stringify(body)).toString('base64')}).catch(() => {});
  });
  await tab.goto(`http://localhost:${port}/connect.html?view=messages`, {waitUntil: 'load'});
  await tab.waitForFunction(() => !document.getElementById('portal')?.classList.contains('hidden'), {timeout: 25000}).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  T('?view=messages opens that tab directly', await tab.evaluate(() => !document.getElementById('messages').classList.contains('hidden') && document.getElementById('updates').classList.contains('hidden')));
  await tab.close();
}
await browser.close(); server.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
