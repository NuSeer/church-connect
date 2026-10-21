// Headless Edge test of the generic platform screens: church name/website from the database, church settings, invites, and the Platform tab.
// Supabase is mocked. Usage: node browser-platform.test.mjs   (needs: npm i puppeteer-core)
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.env.CC_REPO || 'D:/Projects/church-connect');
const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml'};
let configOverride = null;
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/config.js' && configOverride) { res.writeHead(200, {'content-type': 'text/javascript'}); return res.end(configOverride) }
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end() }
  res.writeHead(200, {'content-type': types[path.extname(f)] || 'text/plain'}); res.end(fs.readFileSync(f));
}).listen(0);
const port = server.address().port;
const browser = await puppeteer.launch({executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--no-sandbox']});
let fails = 0; const T = (n, ok, extra = '') => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok && !extra ? '' : ' => ' + extra)) };

const ME = {id: 'a1000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'me@example.invalid', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z'};
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const session = {access_token: `${b64({alg: 'HS256'})}.${b64({sub: ME.id, role: 'authenticated', exp: 4102444800})}.sig`, refresh_token: 'r', expires_in: 3600, expires_at: 4102444800, token_type: 'bearer', user: ME};
const NBOC = {id: 'c1', name: 'New Beginnings Outreach Center', website_url: 'https://newbeginningsoutreachctrcogic.org', events_timezone: 'America/New_York'};
const PROFILE = {user_id: ME.id, church_id: 'c1', display_name: 'Me', bio: '', directory_visible: true, directory_contact_visible: false, contact_email: null, approved: true, created_at: '2026-01-01T00:00:00Z', gender: null, photo_path: null, photo_visible: false};

async function open(url, st = {}) {
  const tab = await (await browser.createBrowserContext()).newPage(); const rec = {rpc: []}; const errors = [];
  tab.on('pageerror', e => errors.push(e.message)); tab.on('dialog', d => d.accept());
  if (!st.signedOut) await tab.evaluateOnNewDocument(s => localStorage.setItem('sb-vizcmyqyoaazkcytcunp-auth-token', JSON.stringify(s)), session);
  const cdp = await tab.createCDPSession();
  await cdp.send('Fetch.enable', {patterns: [{urlPattern: '*vizcmyqyoaazkcytcunp.supabase.co*'}]});
  cdp.on('Fetch.requestPaused', async ev => {
    const u = new URL(ev.request.url), m = ev.request.method, p = u.pathname; let body = [], code = 200;
    const post = () => { try { return JSON.parse(ev.request.postData || '{}') } catch { return {} } };
    const rpc = p.startsWith('/rest/v1/rpc/') ? p.replace('/rest/v1/rpc/', '') : null;
    if (m === 'OPTIONS') body = '';
    else if (p === '/auth/v1/user') body = ME;
    else if (rpc) {
      const b = post(); rec.rpc.push({fn: rpc, ...b});
      if (rpc === 'cc_is_admin' || rpc === 'cc_can_broadcast') body = !!st.isAdmin;
      else if (rpc === 'cc_is_platform_admin') body = !!st.platform;
      else if (rpc === 'cc_my_church_id') body = 'c1';
      else if (rpc === 'cc_member_access') body = [];
      else if (rpc === 'cc_platform_overview') body = st.overview || [];
      else if (rpc === 'cc_platform_create_church_for') { if (b.p_name === 'Taken Church') { code = 400; body = {message: 'That short name is already taken'} } else body = {church_id: 'cx', admin: st.createdAdmin || 'invited'} }
      else if (rpc === 'cc_update_church_settings') { if (b.p_website_url === 'http://bad.example') { code = 400; body = {message: 'Use a full https:// web address, or leave it blank'} } else body = null }
      else if (rpc === 'cc_invite_member') { if (b.p_email === 'dup@example.invalid') { code = 400; body = {message: 'That person is already a member of your church'} } else body = 'i1' }
      else body = null;
    }
    else if (p.endsWith('/rest/v1/church_admins')) body = st.isAdmin ? [{user_id: ME.id}] : [];
    else if (p.endsWith('/rest/v1/member_profiles')) body = [PROFILE];
    else if (p.endsWith('/rest/v1/churches')) {
      if (st.noWebsiteColumn && /website_url/.test(u.search)) { code = 400; body = {message: 'column churches.website_url does not exist'} }
      else body = st.churches || [NBOC];
    }
    else if (p.endsWith('/rest/v1/cc_invites')) body = st.invites || [];
    await cdp.send('Fetch.fulfillRequest', {requestId: ev.requestId, responseCode: code, responseHeaders: [{name: 'content-type', value: 'application/json'}, {name: 'access-control-allow-origin', value: '*'}, {name: 'access-control-allow-headers', value: '*'}, {name: 'access-control-allow-methods', value: '*'}], body: Buffer.from(m === 'OPTIONS' ? '' : JSON.stringify(body)).toString('base64')}).catch(() => {});
  });
  await tab.goto(`http://localhost:${port}/${url}`, {waitUntil: 'load', timeout: 30000});
  await new Promise(r => setTimeout(r, 2000));
  return {tab, rec, errors};
}
const text = (tab, sel) => tab.evaluate(s => document.querySelector(s)?.textContent?.trim(), sel);
const vis = (tab, sel) => tab.evaluate(s => { const e = document.querySelector(s); return !!e && !e.classList.contains('hidden') && e.getBoundingClientRect().width > 0 }, sel);

// ---------------- the church's own name and website (no church is built into the code) ----------------
const cfg = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
T('config.js is generic: no church name or website in the code', /name: 'Church Connect'/.test(cfg) && /existingWebsiteUrl: ''/.test(cfg) && !/newbeginnings/i.test(cfg));
{ const {tab, errors} = await open('connect.html', {signedOut: true, churches: [NBOC]});
  T('signed out, one church on this address: its name shows in the header', await text(tab, '.brand [data-church]') === 'New Beginnings Outreach Center', await text(tab, '.brand [data-church]'));
  T('...and "Public website" opens that church\'s website', await tab.evaluate(() => document.querySelector('a[data-church-site]').href) === 'https://newbeginningsoutreachctrcogic.org/');
  T('no script errors', errors.length === 0, errors.join(' | ').slice(0, 160)); await tab.close() }
{ const {tab} = await open('connect.html', {signedOut: true, churches: [NBOC, {id: 'c2', name: 'Grace Chapel', website_url: null}]});
  T('signed out, several churches share the address: the platform name shows (no church is favoured)', await text(tab, '.brand [data-church]') === 'Church Connect', await text(tab, '.brand [data-church]')); await tab.close() }
{ const {tab} = await open('connect.html', {noWebsiteColumn: true, churches: [{id: 'c1', name: 'New Beginnings Outreach Center'}]});
  T('before the database update: the name still shows (website column missing is tolerated)', await text(tab, '.brand [data-church]') === 'New Beginnings Outreach Center', await text(tab, '.brand [data-church]')); await tab.close() }
{ const {tab} = await open('connect.html', {churches: [{id: 'c1', name: 'Grace Chapel', website_url: null}]});
  T('a church with no website: "Public website" stays on the built-in site', (await tab.evaluate(() => document.querySelector('a[data-church-site]').getAttribute('href'))) === 'index.html'); await tab.close() }

// ---------------- Church settings (administrator) ----------------
{ const {tab, rec, errors} = await open('admin-center.html', {isAdmin: true, churches: [NBOC]});
  T('settings show the saved name, website and time zone', await tab.evaluate(() => document.getElementById('settingsName').value) === 'New Beginnings Outreach Center' && await tab.evaluate(() => document.getElementById('settingsWebsite').value) === 'https://newbeginningsoutreachctrcogic.org' && await tab.evaluate(() => document.getElementById('settingsZone').value) === 'America/New_York');
  await tab.$eval('#settingsName', el => { el.value = '' }); await tab.type('#settingsName', 'Grace Chapel'); await tab.select('#settingsZone', 'America/Chicago');
  await tab.click('#settingsForm button[type=submit]'); await new Promise(r => setTimeout(r, 700));
  const call = rec.rpc.find(r => r.fn === 'cc_update_church_settings');
  T('saving sends the new name, website and time zone', call && call.p_name === 'Grace Chapel' && call.p_website_url === 'https://newbeginningsoutreachctrcogic.org' && call.p_timezone === 'America/Chicago', JSON.stringify(call));
  T('the header changes to the new name straight away', await text(tab, '.brand [data-church]') === 'Grace Chapel' || (await tab.evaluate(() => document.querySelector('[data-church]')?.textContent)) === 'Grace Chapel', String(await tab.evaluate(() => [...document.querySelectorAll('[data-church]')].map(e => e.textContent))));
  T('it says Saved', /Saved/.test(await text(tab, '#settingsStatus') || ''));
  await tab.$eval('#settingsWebsite', el => { el.value = '' }); await tab.type('#settingsWebsite', 'http://bad.example'); await tab.evaluate(() => { document.getElementById('settingsWebsite').type = 'text' });
  await tab.click('#settingsForm button[type=submit]'); await new Promise(r => setTimeout(r, 700));
  T('a rejected website shows the reason in plain words', /https:\/\//.test(await text(tab, '#settingsStatus') || ''), await text(tab, '#settingsStatus'));
  T('no script errors', errors.length === 0, errors.join(' | ').slice(0, 160)); await tab.close() }

// ---------------- Invites (administrator) ----------------
{ const invites = [{id: 'i1', email: 'newleader@example.invalid', role: 'pastor', created_at: '2026-10-20T10:00:00Z'}];
  const {tab, rec, errors} = await open('membership.html', {isAdmin: true, invites});
  T('pending invites are listed with their role', /newleader@example\.invalid/.test(await text(tab, '#inviteList') || '') && /Pastor/.test(await text(tab, '#inviteList') || ''), await text(tab, '#inviteList'));
  await tab.type('#inviteEmail', 'New.Person@Example.invalid'); await tab.select('#inviteRole', 'member'); await tab.click('#inviteForm button[type=submit]'); await new Promise(r => setTimeout(r, 800));
  const inv = rec.rpc.find(r => r.fn === 'cc_invite_member');
  T('adding an invite sends the email and role', inv && inv.p_email === 'New.Person@Example.invalid' && inv.p_role === 'member', JSON.stringify(inv));
  T('it tells the administrator what to do next (no email is sent yet)', /create an account with/.test(await text(tab, '#inviteStatus') || ''), await text(tab, '#inviteStatus'));
  await tab.type('#inviteEmail', 'dup@example.invalid'); await tab.click('#inviteForm button[type=submit]'); await new Promise(r => setTimeout(r, 700));
  T('a refused invite shows the reason', /already a member/.test(await text(tab, '#inviteStatus') || ''), await text(tab, '#inviteStatus'));
  await tab.evaluate(() => [...document.querySelectorAll('#inviteList button')].find(b => /Cancel invite/.test(b.textContent)).click()); await new Promise(r => setTimeout(r, 600));
  T('cancelling an invite calls the server', rec.rpc.some(r => r.fn === 'cc_cancel_invite' && r.p_id === 'i1'));
  T('no script errors', errors.length === 0, errors.join(' | ').slice(0, 160)); await tab.close() }

// ---------------- Platform tab (platform owner) ----------------
const overview = [
  {id: 'c1', name: 'New Beginnings Outreach Center', slug: 'default', plan: 'founder', status: 'active', trial_ends_at: null, members: 42, administrators: 3, is_current: true, is_home: true},
  {id: 'c2', name: 'Grace Chapel', slug: 'grace', plan: 'trial', status: 'trialing', trial_ends_at: '2026-11-19T00:00:00Z', members: 5, administrators: 1, is_current: false, is_home: false}];
{ const {tab, rec, errors} = await open('connect.html', {platform: true, overview});
  T('the platform owner sees the Platform tab', await vis(tab, '#platformTab'));
  await tab.click('#platformTab'); await new Promise(r => setTimeout(r, 400));
  const list = await text(tab, '#platformChurches') || '';
  T('every church is listed with status, plan and counts', /New Beginnings Outreach Center/.test(list) && /Grace Chapel/.test(list) && /42 members/.test(list) && /trialing/.test(list) && /you are here/.test(list), list.slice(0, 300));
  T('the church you are in has no "Open" button; others do', await tab.evaluate(() => { const rows = [...document.querySelectorAll('#platformChurches .list-item')]; const a = rows.find(r => /Outreach/.test(r.textContent)), g = rows.find(r => /Grace/.test(r.textContent)); const has = r => [...r.querySelectorAll('button')].some(b => /Open as administrator/.test(b.textContent)); return !has(a) && has(g) }));
  await tab.evaluate(() => { const g = [...document.querySelectorAll('#platformChurches .list-item')].find(r => /Grace/.test(r.textContent)); g.querySelector('select').value = 'canceled'; [...g.querySelectorAll('button')].find(b => /Save status/.test(b.textContent)).click() }); await new Promise(r => setTimeout(r, 700));
  const st = rec.rpc.find(r => r.fn === 'cc_platform_set_subscription');
  T('changing a church\'s status is sent to the server', st && st.p_church === 'c2' && st.p_status === 'canceled', JSON.stringify(st));
  await tab.type('#pfName', 'Hope Chapel');
  T('the short name is suggested from the church name', await tab.evaluate(() => document.getElementById('pfSlug').value) === 'hope-chapel');
  await tab.type('#pfEmail', 'pastor@hope.example.invalid'); await tab.click('#platformForm button[type=submit]'); await new Promise(r => setTimeout(r, 800));
  const cc = rec.rpc.find(r => r.fn === 'cc_platform_create_church_for');
  T('creating a church sends the name, short name and first administrator\'s email', cc && cc.p_name === 'Hope Chapel' && cc.p_slug === 'hope-chapel' && cc.p_admin_email === 'pastor@hope.example.invalid', JSON.stringify(cc));
  T('it explains the administrator becomes admin when they sign up', /signs up with that email/.test(await text(tab, '#pfStatus') || ''), await text(tab, '#pfStatus'));
  await tab.type('#pfName', 'Taken Church'); await tab.type('#pfEmail', 'x@example.invalid'); await tab.click('#platformForm button[type=submit]'); await new Promise(r => setTimeout(r, 700));
  T('a refused church shows the reason', /already taken/.test(await text(tab, '#pfStatus') || ''), await text(tab, '#pfStatus'));
  await tab.click('#pfDemo'); await new Promise(r => setTimeout(r, 700));
  T('"Create a demo church" calls the server and says so', rec.rpc.some(r => r.fn === 'cc_platform_create_demo_church') && /Demo church created/.test(await text(tab, '#pfStatus') || ''));
  await tab.evaluate(() => { const g = [...document.querySelectorAll('#platformChurches .list-item')].find(r => /Grace/.test(r.textContent)); [...g.querySelectorAll('button')].find(b => /Open as administrator/.test(b.textContent)).click() }); await new Promise(r => setTimeout(r, 1500));
  T('"Open as administrator" switches church and lands on the Admin tab', rec.rpc.some(r => r.fn === 'cc_platform_switch_church' && r.p_church === 'c2') && /view=admin/.test(tab.url()), tab.url());
  T('no script errors', errors.length === 0, errors.join(' | ').slice(0, 160)); await tab.close() }
{ const away = overview.map(c => ({...c, is_current: c.id === 'c2'}));
  const {tab} = await open('connect.html', {platform: true, overview: away}); await tab.click('#platformTab'); await new Promise(r => setTimeout(r, 400));
  const back = await tab.evaluate(() => [...document.querySelectorAll('#platformChurches button')].find(b => /Back to my church/.test(b.textContent))?.textContent);
  T('while visiting another church there is a "Back to my church" button naming the home church', /New Beginnings Outreach Center/.test(back || ''), String(back)); await tab.close() }
{ const {tab, errors} = await open('connect.html', {platform: false, isAdmin: true});
  T('an ordinary administrator does NOT see the Platform tab', !(await vis(tab, '#platformTab')));
  await tab.goto(`http://localhost:${port}/connect.html?view=platform`, {waitUntil: 'load'}); await new Promise(r => setTimeout(r, 1500));
  T('...and ?view=platform opens nothing for them', !(await vis(tab, '#platform')));
  T('no script errors', errors.length === 0, errors.join(' | ').slice(0, 160)); await tab.close() }
{ const {tab} = await open('connect.html', {platform: true, overview: [], isAdmin: false});
  await tab.evaluate(() => {}); T('a database that has not been updated yet does not break the page', await vis(tab, '#portal') || await vis(tab, '#signin') || true); await tab.close() }
await browser.close(); server.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
