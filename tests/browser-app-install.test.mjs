// Headless Edge test: installing the member app, the Admin tab, and the way back from admin pages. Supabase is mocked.
// Usage: node browser-app-install.test.mjs   (needs: npm i puppeteer-core)
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

const USER = {id: 'a1000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'x@example.invalid', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z'};
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const session = {access_token: `${b64({alg: 'HS256'})}.${b64({sub: USER.id, role: 'authenticated', exp: 4102444800})}.sig`, refresh_token: 'r', expires_in: 3600, expires_at: 4102444800, token_type: 'bearer', user: USER};
const PROFILE = {user_id: USER.id, display_name: 'Test', bio: '', directory_visible: true, directory_contact_visible: false, contact_email: null, approved: true, created_at: '2026-01-01T00:00:00Z'};

async function open(url, {signedIn = true, isAdmin = false, ua, media, preload} = {}) {
  const tab = await (await browser.createBrowserContext()).newPage(); const errors = []; tab.on('pageerror', e => errors.push(e.message));
  if (ua) await tab.setUserAgent(ua);
  if (media) await tab.evaluateOnNewDocument(m => { const real = window.matchMedia.bind(window); window.matchMedia = q => q.includes('display-mode') ? {matches: m, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}} : real(q) }, media === 'standalone');
  if (signedIn) await tab.evaluateOnNewDocument(s => localStorage.setItem('sb-vizcmyqyoaazkcytcunp-auth-token', JSON.stringify(s)), session);
  await tab.evaluateOnNewDocument(() => window.addEventListener('beforeinstallprompt', e => { if (!e.__synthetic) e.stopImmediatePropagation() }, true));
  if (preload) await tab.evaluateOnNewDocument(preload);
  const cdp = await tab.createCDPSession();
  await cdp.send('Fetch.enable', {patterns: [{urlPattern: '*vizcmyqyoaazkcytcunp.supabase.co*'}]});
  cdp.on('Fetch.requestPaused', async ev => {
    const u = new URL(ev.request.url); let body = [];
    if (ev.request.method === 'OPTIONS') body = '';
    else if (u.pathname === '/auth/v1/user') body = USER;
    else if (u.pathname.endsWith('/rpc/cc_is_admin')) body = isAdmin;
    else if (u.pathname.endsWith('/rpc/cc_can_broadcast')) body = isAdmin;
    else if (u.pathname.endsWith('/rest/v1/member_profiles')) body = [PROFILE];
    await cdp.send('Fetch.fulfillRequest', {requestId: ev.requestId, responseCode: 200, responseHeaders: [{name: 'content-type', value: 'application/json'}, {name: 'access-control-allow-origin', value: '*'}, {name: 'access-control-allow-headers', value: '*'}, {name: 'access-control-allow-methods', value: '*'}], body: Buffer.from(ev.request.method === 'OPTIONS' ? '' : JSON.stringify(body)).toString('base64')}).catch(() => {});
  });
  await tab.goto(`http://localhost:${port}/${url}`, {waitUntil: 'load', timeout: 30000});
  await new Promise(r => setTimeout(r, 1800));
  return {tab, errors};
}
const vis = (tab, sel) => tab.evaluate(s => { const e = document.querySelector(s); return !!e && !e.classList.contains('hidden') && e.getBoundingClientRect().width > 0 }, sel);

// ---- the installed app opens at sign-in
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
T('the installed app starts at the member sign-in page', manifest.start_url === './connect.html' && manifest.id === './connect.html', manifest.start_url);
T('it is named Church Connect and runs like an app', manifest.name === 'Church Connect' && manifest.display === 'standalone' && manifest.scope === './');
T('its icons exist', manifest.icons.every(i => fs.existsSync(path.join(root, i.src))));
T('the sign-in page links the manifest', /rel="manifest"/.test(fs.readFileSync(path.join(root, 'connect.html'), 'utf8')));
T('the start page it points to exists', fs.existsSync(path.join(root, 'connect.html')));

// ---- install hint
{ const {tab, errors} = await open('connect.html', {signedIn: false, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'});
  T('iPhone: shows the Add to Home Screen steps (no install button)', await vis(tab, '#installHint') && !(await vis(tab, '#installBtn')) && /Add to Home Screen/.test(await tab.evaluate(() => document.getElementById('installText').textContent)));
  await tab.click('#installLater'); T('"Not now" hides it', !(await vis(tab, '#installHint')));
  await tab.reload({waitUntil: 'load'}); await new Promise(r => setTimeout(r, 1200)); T('...and it stays hidden after reloading', !(await vis(tab, '#installHint')));
  T('no script errors', errors.length === 0, errors.join(' | ').slice(0, 160)); await tab.close() }
{ const {tab} = await open('connect.html', {signedIn: false});
  T('desktop/Android before the browser offers install: hint hidden', !(await vis(tab, '#installHint')));
  await tab.evaluate(() => { const e = new Event('beforeinstallprompt', {cancelable: true}); e.__synthetic = true; e.prompt = () => { window.__prompted = true }; e.userChoice = Promise.resolve({outcome: 'accepted'}); window.dispatchEvent(e) });
  T('when the browser offers install, the Install button appears', await vis(tab, '#installHint') && await vis(tab, '#installBtn'));
  await tab.click('#installBtn'); await new Promise(r => setTimeout(r, 400));
  T('tapping it opens the browser\'s install prompt, then hides the hint', await tab.evaluate(() => window.__prompted === true) && !(await vis(tab, '#installHint')));
  await tab.close() }
{ const {tab} = await open('connect.html', {signedIn: false, media: 'standalone'});
  await tab.evaluate(() => { const e = new Event('beforeinstallprompt', {cancelable: true}); e.__synthetic = true; e.prompt = () => {}; window.dispatchEvent(e) });
  T('already installed (running as an app): no install hint', !(await vis(tab, '#installHint'))); await tab.close() }

// ---- Admin tab
{ const {tab, errors} = await open('connect.html', {isAdmin: true});
  T('administrator/pastor sees the Admin tab', await vis(tab, '#adminTab'));
  await tab.click('#adminTab');
  const links = await tab.evaluate(() => [...document.querySelectorAll('#admin a.btn')].map(a => a.getAttribute('href')));
  T('it lists every admin page', JSON.stringify(links) === JSON.stringify(['admin-center.html', 'admin.html', 'membership.html', 'ministries-admin.html', 'website-editor.html']), JSON.stringify(links));
  T('the other tabs are hidden while it is open', await tab.evaluate(() => document.getElementById('updates').classList.contains('hidden') && !document.getElementById('admin').classList.contains('hidden')));
  T('every link goes to a page that exists', links.every(l => fs.existsSync(path.join(root, l))));
  T('no script errors', errors.length === 0, errors.join(' | ').slice(0, 160)); await tab.close() }
{ const {tab, errors} = await open('connect.html', {isAdmin: false});
  T('an ordinary member does NOT see the Admin tab', !(await vis(tab, '#adminTab')));
  T('opening ?view=admin does nothing for a member', await (async () => { await tab.goto(`http://localhost:${port}/connect.html?view=admin`, {waitUntil: 'load'}); await new Promise(r => setTimeout(r, 1500)); return !(await vis(tab, '#admin')) })());
  T('no script errors', errors.length === 0, errors.join(' | ').slice(0, 160)); await tab.close() }

// ---- the way back from every admin page
for (const p of ['admin.html', 'admin-center.html', 'membership.html', 'ministries-admin.html', 'website-editor.html']) {
  const {tab} = await open(p, {signedIn: false});
  const href = await tab.evaluate(() => { const a = [...document.querySelectorAll('header nav a')].find(x => /Member area/.test(x.textContent)); return a && a.getAttribute('href') });
  T(`${p}: has a "Member area" link back to the app`, href === 'connect.html', String(href)); await tab.close();
}
await browser.close(); server.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
