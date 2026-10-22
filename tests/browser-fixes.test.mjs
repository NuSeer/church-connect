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
  res.writeHead(200, {'content-type': types[path.extname(f)] || 'text/plain'}); res.end(path.basename(f) === 'config.js' ? fs.readFileSync(f, 'utf8').replace('https://khnakybowzrfpqwakphi.supabase.co', 'https://vizcmyqyoaazkcytcunp.supabase.co').replace('sb_publishable_ftUugSYhXbtSHNLeY-e4vw_dIoNkHlN', 'sb_publishable_ugyikgHimwHU3wGMFmxojg_qGYRCg61') : fs.readFileSync(f)); // tests run on localhost: point it at the project the mocks answer for
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
      else if (rpc === 'cc_is_webmaster') body = !!st.isAdmin;
      else if (rpc === 'cc_send_webmaster_request') body = 'r1';
      else if (rpc === 'cc_member_access') body = [];
      else if (rpc === 'cc_public_website') body = st.site || null
      else if (rpc === 'cc_platform_overview') body = st.overview || [];
      else if (rpc === 'cc_platform_create_church_for') { if (b.p_name === 'Taken Church') { code = 400; body = {message: 'That short name is already taken'} } else body = {church_id: 'cx', admin: st.createdAdmin || 'invited'} }
      else if (rpc === 'cc_update_church_settings') { if (b.p_website_url === 'http://bad.example') { code = 400; body = {message: 'Use a full https:// web address, or leave it blank'} } else body = null }
      else if (rpc === 'cc_update_church_colors') { if (b.p_primary === '#ffff99') { code = 400; body = {message: 'The main color is too light for white text. Choose a darker one.'} } else body = null }
      else if (rpc === 'cc_invite_member') { if (b.p_email === 'dup@example.invalid') { code = 400; body = {message: 'That person is already a member of your church'} } else body = 'i1' }
      else body = null;
    }
    else if (p.endsWith('/rest/v1/church_admins')) body = st.isAdmin ? [{user_id: ME.id}] : [];
    else if (p.endsWith('/rest/v1/member_profiles')) body = st.noProfile && !rec.rpc.some(r => r.fn === 'create_my_profile') ? [] : [PROFILE];
    else if (p.endsWith('/rest/v1/member_sms_preferences')) { if (m === 'POST') (rec.sms ??= []).push(post()); body = m === 'POST' ? [] : null }
    else if (p.endsWith('/rest/v1/churches')) {
      if (st.noColorsColumn && /brand_primary/.test(u.search)) { code = 400; body = {message: 'column churches.brand_primary does not exist'} }
      else if (st.noWebsiteColumn && /website_url/.test(u.search)) { code = 400; body = {message: 'column churches.website_url does not exist'} }
      else body = st.churches || [NBOC];
    }
    else if (p.endsWith('/rest/v1/church_events')) body = st.events || [];
    else if (p.endsWith('/rest/v1/cc_invites')) body = st.invites || [];
    else if (p.endsWith('/rest/v1/cc_webmaster_requests')) body = st.reqs || [];
    await cdp.send('Fetch.fulfillRequest', {requestId: ev.requestId, responseCode: code, responseHeaders: [{name: 'content-type', value: 'application/json'}, {name: 'access-control-allow-origin', value: '*'}, {name: 'access-control-allow-headers', value: '*'}, {name: 'access-control-allow-methods', value: '*'}], body: Buffer.from(m === 'OPTIONS' ? '' : JSON.stringify(body)).toString('base64')}).catch(() => {});
  });
  await tab.goto(`http://localhost:${port}/${url}`, {waitUntil: 'load', timeout: 30000});
  await new Promise(r => setTimeout(r, 2000));
  return {tab, rec, errors};
}
const text = (tab, sel) => tab.evaluate(s => document.querySelector(s)?.textContent?.trim(), sel);
const vis = (tab, sel) => tab.evaluate(s => { const e = document.querySelector(s); return !!e && !e.classList.contains('hidden') && e.getBoundingClientRect().width > 0 }, sel);

// ---------------- the church's own name and website (no church is built into the code) ----------------


{
  const {tab, rec, errors} = await open('connect.html', {isAdmin: false, churches: [{...NBOC, brand_text: 'black'}]});
  T('the sign-in box is not showing for a signed-in person', !(await vis(tab, '#signin')));
  T('Help is a button next to Refresh, not a tab', await tab.evaluate(() => { const r = document.getElementById('refresh'), h = document.getElementById('helpBtn'); return !!h && h.parentElement === r.parentElement && !document.querySelector('.tabs [data-view="help"]') }));
  await tab.click('#helpBtn');
  T('the Help button opens the help', await vis(tab, '#help'));
  T('the phone number sits in the main profile section, before contact email', await tab.evaluate(() => { const p = document.getElementById('smsPhone'), c = document.getElementById('contactEmail'); return !p.closest('.sms-preferences') && !!(p.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) }));
  T('lettering choice works even with the standard colors', await tab.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--on-primary').trim()) === '#111111');
  await tab.click('[data-view="profile"]');
  await tab.type('#smsPhone', '7575550123');
  await tab.click('#saveProfileTop'); await new Promise(r => setTimeout(r, 900));
  T('saving the profile also saves the phone number', (rec.sms || []).some(x => x.phone), JSON.stringify(rec.sms));
  T('and says Saved', /Saved/.test(await text(tab, '#profileSaveMsg') || ''), await text(tab, '#profileSaveMsg'));
  T('no page errors', !errors.length, errors.join(' | '));
  await tab.close();
}
{
  const {tab, rec, errors} = await open('admin-center.html', {isAdmin: true});
  const kinds = await tab.evaluate(() => [...document.querySelectorAll('#wmKind option')].map(o => o.textContent));
  T('Message to the webmaster has the request types, without Change website text', kinds.length === 4 && !kinds.some(k => /website text/i.test(k)), kinds.join(' | '));
  const perms = await tab.evaluate(() => [...document.querySelectorAll('#permissionChoices label')].map(l => l.textContent.trim()));
  T('Manage events and Manage announcements are gone from permissions', !perms.some(x => /Manage events|Manage announcements/.test(x)), perms.join(' | '));
  T('the Administration page has a Back to Admin button that returns to the member Admin tab', await tab.evaluate(() => document.querySelector('.cc-back a')?.getAttribute('href') === 'connect.html?view=admin'));
  await tab.select('#wmKind', 'photo');
  await tab.type('#wmMessage', 'Please put the choir photo on the Ministries page');
  await tab.click('#wmForm button[type=submit]'); await new Promise(r => setTimeout(r, 900));
  const sent = rec.rpc.find(r => r.fn === 'cc_send_webmaster_request');
  T('sending files the request', sent && sent.p_kind === 'photo' && /choir/.test(sent.p_message), JSON.stringify(sent));
  T('no page errors', !errors.length, errors.join(' | '));
  await tab.close();
}
for (const page of ['admin.html', 'membership.html', 'ministries-admin.html', 'website-editor.html']) {
  const {tab} = await open(page, {isAdmin: true});
  T(page + ' has a Back to Administration button', await tab.evaluate(() => { const a = document.querySelector('.cc-back a'); return !!a && a.getAttribute('href') === 'admin-center.html' }));
  await tab.close();
}
{
  const {tab, errors} = await open('admin.html', {isAdmin: true, events: [{id: 'e9', title: 'Choir Night', description: '', starts_at: '2026-12-01T18:00:00Z', location: '', recurrence: 'none', published: true, source: null}]});
  T('Events page has a dropdown to pick an event and no mailto form', await tab.evaluate(() => !!document.getElementById('eventPick') && !document.getElementById('webmasterRequestForm') && !!document.getElementById('wmKind')));
  await tab.select('#eventPick', 'e9');
  T('picking an event enables Edit and Delete', await tab.evaluate(() => !document.getElementById('eventEdit').disabled && !document.getElementById('eventDelete').disabled));
  await tab.click('#eventEdit');
  T('Edit fills the form', await tab.evaluate(() => document.getElementById('eventTitle').value) === 'Choir Night');
  T('no page errors', !errors.length, errors.join(' | '));
  await tab.close();
}
{
  const {tab, rec, errors} = await open('connect.html', {isAdmin: false});
  await tab.click('[data-view="profile"]');
  await tab.type('#smsPhone', '7575550123');
  T('the phone number gets its hyphens as it is typed', await tab.evaluate(() => document.getElementById('smsPhone').value) === '757-555-0123', await tab.evaluate(() => document.getElementById('smsPhone').value));
  await tab.click('#smsDirectory');
  await tab.click('#saveProfileTop'); await new Promise(r => setTimeout(r, 900));
  T('ticking Include my number in the member directory is saved', (rec.sms || []).some(x => x.directory_phone_visible === true && x.phone), JSON.stringify(rec.sms));
  T('no page errors', !errors.length, errors.join(' | '));
  await tab.close();
}
{
  const {tab, errors} = await open('admin.html', {isAdmin: true, events: [{id: 'e1', title: 'Zoom Prayer', description: '', starts_at: '2026-12-01T18:00:00Z', location: '', recurrence: 'none', published: true, source: 'website'}, {id: 'e2', title: 'Choir Night', description: '', starts_at: '2026-12-02T18:00:00Z', location: '', recurrence: 'none', published: true, source: null}]});
  const opts = await tab.evaluate(() => [...document.querySelectorAll('#eventPick option')].length);
  T('the event dropdown shows all events, not just one', opts === 3, String(opts));
  await tab.select('#eventPick', 'e1');
  T('a website event cannot be edited or deleted here', await tab.evaluate(() => document.getElementById('eventEdit').disabled && document.getElementById('eventDelete').disabled));
  T('...but offers to ask the webmaster', await tab.evaluate(() => !document.getElementById('eventAsk').hidden));
  T('the note says website events are NOT changed here', await tab.evaluate(() => /are not changed here/.test(document.getElementById('eventPickNote').textContent)));
  await tab.click('#eventAsk');
  T('asking the webmaster fills in the request', await tab.evaluate(() => document.getElementById('wmKind').value === 'event_change' && document.getElementById('wmEvent').value === 'e1'));
  T('no page errors', !errors.length, errors.join(' | '));
  await tab.close();
}
{
  const {tab, errors} = await open('ministries-admin.html', {isAdmin: true});
  T('the Ministries page loads without errors', !errors.length, errors.join(' | '));
  await tab.close();
}
{
  // colors are remembered on the device, so moving between pages does not flash the standard colors
  const tab = await (await browser.createBrowserContext()).newPage();
  await tab.evaluateOnNewDocument(() => localStorage.setItem('cc-brand', JSON.stringify({name: 'Remembered Church', primary: '#7a1f3d', accent: '#f2b705', text: 'white'})));
  await tab.setRequestInterception(true);
  tab.on('request', r => /supabase.co/.test(r.url()) ? r.abort() : r.continue());
  await tab.goto('http://localhost:' + port + '/admin-center.html', {waitUntil: 'domcontentloaded'});
  T('the remembered main color is applied straight away', await tab.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--church-primary').trim()) === '#7a1f3d');
  T('the remembered church name shows before anything loads', await tab.evaluate(() => document.querySelector('[data-church]').textContent) === 'Remembered Church');
  await tab.close();
}
await browser.close(); server.close();
console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
