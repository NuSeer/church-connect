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
    await cdp.send('Fetch.fulfillRequest', {requestId: ev.requestId, responseCode: code, responseHeaders: [{name: 'content-type', value: 'application/json'}, {name: 'access-control-allow-origin', value: '*'}, {name: 'access-control-allow-headers', value: '*'}, {name: 'access-control-allow-methods', value: '*'}], body: Buffer.from(m === 'OPTIONS' ? '' : JSON.stringify(body)).toString('base64')}).catch(() => {});
  });
  await tab.goto(`http://localhost:${port}/${url}`, {waitUntil: 'load', timeout: 30000});
  await new Promise(r => setTimeout(r, 2000));
  return {tab, rec, errors};
}
const text = (tab, sel) => tab.evaluate(s => document.querySelector(s)?.textContent?.trim(), sel);
const vis = (tab, sel) => tab.evaluate(s => { const e = document.querySelector(s); return !!e && !e.classList.contains('hidden') && e.getBoundingClientRect().width > 0 }, sel);

// ---------------- the church's own name and website (no church is built into the code) ----------------

// ---------------- member area: one-time tips, Help tab, profile Save ----------------
{
  const {tab, errors} = await open('connect.html', {isAdmin: false});
  T('a first-time visitor sees the Updates tip with a Got it button', await vis(tab, '#updates .cc-intro') && await vis(tab, '#updates .cc-gotit'));
  await tab.click('#updates .cc-gotit');
  T('after Got it the tip is hidden', !(await vis(tab, '#updates .cc-intro')));
  await tab.reload({waitUntil: 'load'}); await new Promise(r => setTimeout(r, 1800));
  T('...and stays hidden after reopening the app', !(await vis(tab, '#updates .cc-intro')));
  T('another section still shows its own tip the first time', await (async () => { await tab.click('[data-view="events"]'); return await vis(tab, '#events .cc-intro') })());
  await tab.click('[data-view="help"]');
  const help = await tab.evaluate(() => [...document.querySelectorAll('#helpList .cc-help-item strong')].map(x => x.textContent.trim()));
  T('Help lists the member sections', ['Home.', 'Events.', 'Messages.', 'Ministries.', 'Directory.', 'My Profile.', 'My Giving.'].every(x => help.includes(x)), help.join(','));
  T('a member does not see Broadcast or Admin help, and nothing about Platform', !help.includes('Broadcast.') && !help.includes('Admin.') && !help.some(x => /platform/i.test(x)));
  const allText = await text(tab, '#help');
  T('no Platform wording anywhere in the Help tab', !/platform/i.test(allText), allText.slice(0, 200));
  await tab.click('#helpReset');
  await tab.click('[data-view="updates"]');
  T('Show the first-time tips again brings the Updates tip back', await vis(tab, '#updates .cc-intro'));
  await tab.click('[data-view="profile"]');
  T('My Profile has a Save button right under About me', await tab.evaluate(() => { const b = document.getElementById('saveProfileTop'), t = document.getElementById('bio'); return !!b && !!(t.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) && b.textContent.trim() === 'Save' }));
  T('the old Save privacy settings wording is gone', !(await tab.evaluate(() => document.body.textContent.includes('Save privacy'))));
  T('the privacy boxes sit under a plain Who can see me heading', await tab.evaluate(() => [...document.querySelectorAll('#profile h3')].some(h => h.textContent.trim() === 'Who can see me')));
  await tab.click('#saveProfileTop'); await new Promise(r => setTimeout(r, 900));
  T('pressing Save says Saved', /Saved/.test(await text(tab, '#profileSaveMsg') || ''), await text(tab, '#profileSaveMsg'));
  T('no page errors', !errors.length, errors.join(' | '));
  await tab.close();
}
{
  const {tab} = await open('connect.html', {isAdmin: true});
  await tab.click('[data-view="help"]');
  const help = await tab.evaluate(() => [...document.querySelectorAll('#helpList .cc-help-item strong')].map(x => x.textContent.trim()));
  T('an administrator sees the Announcements and Admin help', help.includes('Announcements.') && help.includes('Admin.'), help.join(','));
  await tab.close();
}

// ---------------- Administration: order, lettering choice, webmaster ----------------
{
  const {tab, rec, errors} = await open('admin-center.html', {isAdmin: true});
  const order = await tab.evaluate(() => [...document.querySelectorAll('#workspace > section h2')].map(h => h.textContent.trim()));
  const iP = order.indexOf('Delegated staff permissions'), iS = order.indexOf('Church settings'), iC = order.indexOf('Church colors');
  T('Church settings and Church colors come right after Staff permissions', iP >= 0 && iS === iP + 1 && iC === iP + 2, order.join(' > '));
  const perms = await tab.evaluate(() => [...document.querySelectorAll('#permissionChoices label')].map(l => l.textContent.trim()));
  T('the Webmaster permission is listed apart from the Ministry leader ones', perms.some(x => /^Webmaster/.test(x)) && perms.filter(x => /^Ministry leader/.test(x)).length === 2, perms.join(' | '));
  T('Church colors has Automatic / White / Black lettering', await tab.evaluate(() => [...document.querySelectorAll('input[name=colorText]')].map(r => r.value).join() === ',white,black'));
  await tab.evaluate(() => { document.querySelector('input[name=colorText][value=black]').click() });
  await tab.evaluate(() => { const c = document.getElementById('colorPrimary'); c.value = '#f2e394'; c.dispatchEvent(new Event('input', {bubbles: true})) });
  const navInk = () => tab.evaluate(() => getComputedStyle(document.querySelector('.nav')).color);
  T('choosing black lettering changes the header lettering at once', await navInk() === 'rgb(17, 17, 17)', await navInk());
  await tab.evaluate(() => { document.querySelector('input[name=colorText][value=white]').click() });
  T('...and white lettering switches it back', await navInk() === 'rgb(255, 255, 255)', await navInk());
  await tab.evaluate(() => { document.querySelector('input[name=colorText][value=black]').click() });
  await tab.click('#colorsForm button[type=submit]'); await new Promise(r => setTimeout(r, 800));
  const sv = rec.rpc.find(r => r.fn === 'cc_update_church_colors');
  T('saving sends the lettering choice', sv && sv.p_text === 'black' && sv.p_primary === '#f2e394', JSON.stringify(sv));
  T('no page errors', !errors.length, errors.join(' | '));
  await tab.close();
}

// ---------------- Brand Studio: hero color and lettering ----------------
{
  const {tab, errors} = await open('website-editor.html', {isAdmin: true, churches: [{...NBOC, brand_primary: '#7a1f3d', brand_accent: '#f2b705'}]});
  T('Brand Studio has a hero color, a Same-as-primary tick and a lettering choice', await tab.evaluate(() => !!document.getElementById('heroColor') && !!document.getElementById('heroColorSame') && [...document.querySelectorAll('#heroText option')].map(o => o.value).join() === 'auto,white,black'));
  const shown = await tab.evaluate(() => !document.getElementById('editor').classList.contains('hidden'));
  if (!shown) { T('editor opened (needs the draft mock)', false, 'editor hidden'); }
  else {
    const heroBg = () => tab.evaluate(() => getComputedStyle(document.querySelector('#preview .cc-hero')).backgroundImage);
    await tab.evaluate(() => { const p = document.getElementById('primaryColor'); p.value = '#1a5c3a'; p.dispatchEvent(new Event('input', {bubbles: true})) });
    T('with no photograph the hero follows the primary color', /26, 92, 58/.test(await heroBg()), await heroBg());
    await tab.evaluate(() => { const h = document.getElementById('heroColor'); h.value = '#caa43a'; h.dispatchEvent(new Event('input', {bubbles: true})) });
    T('picking a hero color uses it instead (the Same-as-primary tick turns off)', /202, 164, 58/.test(await heroBg()) && !(await tab.evaluate(() => document.getElementById('heroColorSame').checked)), await heroBg());
    const ink = () => tab.evaluate(() => getComputedStyle(document.querySelector('#preview .cc-hero h2')).color);
    T('a light hero color automatically gets dark lettering', await ink() === 'rgb(17, 17, 17)', await ink());
    await tab.select('#heroText', 'white');
    T('white lettering can be forced', await ink() === 'rgb(255, 255, 255)', await ink());
    await tab.select('#heroText', 'black');
    T('black lettering can be forced', await ink() === 'rgb(17, 17, 17)', await ink());
    await tab.click('#useChurchColors');
    T('Use my church colors copies the Administration colors', await tab.evaluate(() => document.getElementById('primaryColor').value) === '#7a1f3d', await tab.evaluate(() => document.getElementById('primaryColor').value));
  }
  T('no page errors', !errors.length, errors.join(' | '));
  await tab.close();
}
// ---------------- the church's own public page follows the Brand Studio colors ----------------
{
  const site = {enabled: true, primaryColor: '#1a5c3a', accentColor: '#f2b705', heroColor: '#caa43a', heroText: 'auto', heroImage: '', template: 'kingdom', fontStyle: 'modern'};
  const {tab, errors} = await open('index.html', {signedOut: true, site});
  const hero = () => tab.evaluate(() => { const h = document.querySelector('.hero'); return {bg: getComputedStyle(h).backgroundImage, ink: getComputedStyle(h.querySelector('h1')).color} });
  const h1 = await hero();
  T('the public page hero uses the hero color when there is no photograph', /202, 164, 58/.test(h1.bg), h1.bg);
  T('...with dark lettering on a light hero color', h1.ink === 'rgb(17, 17, 17)', h1.ink);
  T('...and the header follows the primary color', await tab.evaluate(() => getComputedStyle(document.querySelector('.nav')).backgroundColor) === 'rgb(26, 92, 58)');
  T('no page errors', !errors.length, errors.join(' | '));
  await tab.close();
  const t2 = await open('index.html', {signedOut: true, site: {...site, heroColor: '', heroText: 'white'}});
  const h2 = await t2.tab.evaluate(() => { const h = document.querySelector('.hero'); return {bg: getComputedStyle(h).backgroundImage, ink: getComputedStyle(h.querySelector('h1')).color} });
  T('with no hero color it follows the primary color, with white lettering when chosen', /26, 92, 58/.test(h2.bg) && h2.ink === 'rgb(255, 255, 255)', JSON.stringify(h2));
  await t2.tab.close();
}
await browser.close(); server.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
