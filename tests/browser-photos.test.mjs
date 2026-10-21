// Headless Edge test of member photos: My Profile (upload / share / remove / gender), the Directory, and the administrator's Membership screens.
// Supabase (database + storage) is mocked. Usage: node browser-photos.test.mjs   (needs: npm i puppeteer-core)
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(process.env.CC_REPO || 'D:/Projects/church-connect');
const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml'};
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end() }
  res.writeHead(200, {'content-type': types[path.extname(f)] || 'text/plain'}); res.end(path.basename(f) === 'config.js' ? fs.readFileSync(f, 'utf8').replace('https://khnakybowzrfpqwakphi.supabase.co', 'https://vizcmyqyoaazkcytcunp.supabase.co').replace('sb_publishable_ftUugSYhXbtSHNLeY-e4vw_dIoNkHlN', 'sb_publishable_ugyikgHimwHU3wGMFmxojg_qGYRCg61') : fs.readFileSync(f)); // tests run on localhost: point it at the project the mocks answer for
}).listen(0);
const port = server.address().port;
const browser = await puppeteer.launch({executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--no-sandbox']});
let fails = 0; const T = (n, ok, extra = '') => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok && !extra ? '' : ' => ' + extra)) };

// a real (tiny) picture to upload
import zlib from 'node:zlib';
// a real, valid 8x8 PNG built here (so the picture code can really decode it)
function makePng(w = 8, h = 8) {
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4); len.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])) >>> 0); return Buffer.concat([len, t, data, crc]) };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 90 + x * 10; raw[o + 1] = 70; raw[o + 2] = 160 } }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PNG = makePng();
const pic = path.join(os.tmpdir(), 'cc-test-photo.png'); fs.writeFileSync(pic, PNG);
const CHURCH = 'c1000000-0000-0000-0000-000000000001';
const ME = {id: 'a1000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'me@example.invalid', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z'};
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const session = {access_token: `${b64({alg: 'HS256'})}.${b64({sub: ME.id, role: 'authenticated', exp: 4102444800})}.sig`, refresh_token: 'r', expires_in: 3600, expires_at: 4102444800, token_type: 'bearer', user: ME};

async function open(url, st) {
  const tab = await (await browser.createBrowserContext()).newPage(); const rec = {patches: [], uploads: [], removes: [], rpcs: [], signs: []}; const errors = [];
  tab.on('pageerror', e => errors.push(e.message)); tab.on('dialog', d => d.accept());
  await tab.evaluateOnNewDocument(s => localStorage.setItem('sb-vizcmyqyoaazkcytcunp-auth-token', JSON.stringify(s)), session);
  const cdp = await tab.createCDPSession();
  await cdp.send('Fetch.enable', {patterns: [{urlPattern: '*vizcmyqyoaazkcytcunp.supabase.co*'}]});
  cdp.on('Fetch.requestPaused', async ev => {
    const u = new URL(ev.request.url), m = ev.request.method, p = u.pathname; let body = [], code = 200, ct = 'application/json', raw = null;
    const post = () => { try { return JSON.parse(ev.request.postData || '{}') } catch { return {} } };
    if (m === 'OPTIONS') body = '';
    else if (p === '/auth/v1/user') body = ME;
    else if (p.endsWith('/rpc/cc_is_admin') || p.endsWith('/rpc/cc_can_broadcast')) body = !!st.isAdmin;
    else if (p.endsWith('/rpc/cc_my_church_id')) body = CHURCH;
    else if (p.endsWith('/rpc/cc_member_access')) body = [];
    else if (p.endsWith('/rest/v1/church_admins')) body = st.isAdmin ? [{user_id: ME.id}] : [];
    else if (p.endsWith('/rpc/cc_set_directory_profile')) { rec.rpcs.push({fn: 'dirprofile', ...post()}); body = null }
    else if (p.endsWith('/rpc/cc_save_directory_member')) { rec.rpcs.push({fn: 'save', ...post()}); body = 'd1000000-0000-0000-0000-0000000000ff' }
    else if (p.startsWith('/storage/v1/object/sign/member-photos') && m === 'POST') { const paths = post().paths || []; rec.signs.push(...paths); body = paths.map(x => ({error: null, path: x, signedURL: '/object/sign/member-photos/' + x + '?token=t'})) }
    else if (p.startsWith('/storage/v1/object/sign/member-photos')) { ct = 'image/png'; raw = PNG }
    else if (p.startsWith('/storage/v1/object/member-photos/') && (m === 'POST' || m === 'PUT')) { rec.uploads.push({path: decodeURIComponent(p.replace('/storage/v1/object/member-photos/', '')), bytes: (ev.request.postData || '').length}); body = {Key: 'member-photos/x'} }
    else if (p === '/storage/v1/object/member-photos' && m === 'DELETE') { rec.removes.push(...(post().prefixes || [])); body = [] }
    else if (p.endsWith('/rest/v1/member_profiles') && m === 'PATCH') { rec.patches.push(post()); Object.assign(st.profile, post()); body = [] }
    else if (p.endsWith('/rest/v1/member_profiles')) body = st.members && ev.request.url.includes('order=created_at') ? st.members : (st.directoryOthers && !ev.request.url.includes('user_id=eq') ? st.directoryOthers : [st.profile]);
    else if (p.endsWith('/rest/v1/cc_directory_members')) body = st.dirMembers || [];
    if (raw) await cdp.send('Fetch.fulfillRequest', {requestId: ev.requestId, responseCode: code, responseHeaders: [{name: 'content-type', value: ct}, {name: 'access-control-allow-origin', value: '*'}], body: raw.toString('base64')}).catch(() => {});
    else await cdp.send('Fetch.fulfillRequest', {requestId: ev.requestId, responseCode: code, responseHeaders: [{name: 'content-type', value: ct}, {name: 'access-control-allow-origin', value: '*'}, {name: 'access-control-allow-headers', value: '*'}, {name: 'access-control-allow-methods', value: '*'}], body: Buffer.from(m === 'OPTIONS' ? '' : JSON.stringify(body)).toString('base64')}).catch(() => {});
  });
  await tab.goto(`http://localhost:${port}/${url}`, {waitUntil: 'load', timeout: 30000});
  await new Promise(r => setTimeout(r, 2000));
  return {tab, rec, errors};
}
const profile = (extra = {}) => ({user_id: ME.id, church_id: CHURCH, display_name: 'Test Member', bio: '', directory_visible: true, directory_contact_visible: false, contact_email: null, approved: true, created_at: '2026-01-01T00:00:00Z', gender: null, photo_path: null, photo_visible: false, ...extra});
const imgSrc = (tab, sel) => tab.evaluate(s => document.querySelector(s + ' img')?.getAttribute('src'), sel);
const shown = (tab, sel) => tab.evaluate(s => { const e = document.querySelector(s); return !!e && !e.classList.contains('hidden') }, sel);
async function openProfile(st) { const r = await open('connect.html', st); await r.tab.click('[data-view="profile"]'); await new Promise(x => setTimeout(x, 500)); return r }

// ---------------- My Profile ----------------
{ const st = {profile: profile()}; const {tab, rec, errors} = await openProfile(st);
  T('with no photo and no gender: the neutral picture shows', /avatar-neutral\.svg$/.test(await imgSrc(tab, '#myAvatar')), await imgSrc(tab, '#myAvatar'));
  T('"Show my photo" is off and cannot be ticked until there is a photo', await tab.evaluate(() => { const c = document.getElementById('photoVisible'); return !c.checked && c.disabled }));
  T('there is no Remove button yet', !(await shown(tab, '#photoRemove')));
  await tab.select('#gender', 'female');
  T('choosing Female shows the woman picture right away', /avatar-woman\.svg$/.test(await imgSrc(tab, '#myAvatar')));
  await tab.select('#gender', 'male');
  T('choosing Male shows the man picture', /avatar-man\.svg$/.test(await imgSrc(tab, '#myAvatar')));
  await tab.select('#gender', '');
  await tab.select('#gender', 'female'); await tab.click('#profileForm button:not([type]), #profileForm .btn[type=submit], #profileForm button[type=submit]').catch(() => {});
  await new Promise(r => setTimeout(r, 800));
  T('saving the profile stores the gender', rec.patches.some(p => p.gender === 'female'), JSON.stringify(rec.patches));
  T('the profile save never sends approval or church fields', rec.patches.every(p => !('approved' in p) && !('church_id' in p)), JSON.stringify(rec.patches));
  const input = await tab.$('#photoFile'); await input.uploadFile(pic); await new Promise(r => setTimeout(r, 1800));
  T('a chosen photo is uploaded to the member\'s own private file', rec.uploads.length === 1 && rec.uploads[0].path === `${CHURCH}/${ME.id}.jpg`, JSON.stringify(rec.uploads));
  T('the profile records the photo location', rec.patches.some(p => p.photo_path === `${CHURCH}/${ME.id}.jpg`), JSON.stringify(rec.patches.slice(-2)));
  T('the new photo is shown (from a private link)', /object\/sign\/member-photos\//.test(await imgSrc(tab, '#myAvatar') || ''), await imgSrc(tab, '#myAvatar'));
  T('sharing is still OFF after uploading', await tab.evaluate(() => !document.getElementById('photoVisible').checked && !document.getElementById('photoVisible').disabled));
  await tab.click('#photoVisible'); await new Promise(r => setTimeout(r, 700));
  T('turning sharing on is saved', rec.patches.some(p => p.photo_visible === true));
  await tab.click('#photoRemove'); await new Promise(r => setTimeout(r, 900));
  T('removing deletes the file and clears the record and the sharing', rec.removes.includes(`${CHURCH}/${ME.id}.jpg`) && rec.patches.some(p => p.photo_path === null && p.photo_visible === false), JSON.stringify({removes: rec.removes, last: rec.patches.slice(-1)}));
  T('and the picture goes back to the generic one', /avatar-woman\.svg$/.test(await imgSrc(tab, '#myAvatar')));
  T('no script errors', errors.length === 0, errors.join(' | ').slice(0, 200)); await tab.close() }
{ const st = {profile: profile({gender: 'male', photo_path: `${CHURCH}/${ME.id}.jpg`, photo_visible: true})}; const {tab, errors} = await openProfile(st);
  T('an existing shared photo loads with sharing ticked and Remove available', /object\/sign\/member-photos\//.test(await imgSrc(tab, '#myAvatar') || '') && await tab.evaluate(() => document.getElementById('photoVisible').checked) && await shown(tab, '#photoRemove'));
  T('gender is restored in the box', await tab.evaluate(() => document.getElementById('gender').value) === 'male'); await tab.close() }

// ---------------- Directory: other members' pictures ----------------
{ const others = [{user_id: 'u2', display_name: 'Sister Shared', bio: '', directory_visible: true, directory_contact_visible: false, contact_email: null, gender: 'female', photo_path: `${CHURCH}/u2.jpg`, photo_visible: true},
                  {user_id: 'u3', display_name: 'Brother Private', bio: '', directory_visible: true, directory_contact_visible: false, contact_email: null, gender: 'male', photo_path: `${CHURCH}/u3.jpg`, photo_visible: false},
                  {user_id: 'u4', display_name: 'Member Nogender', bio: '', directory_visible: true, directory_contact_visible: false, contact_email: null, gender: null, photo_path: null, photo_visible: false}];
  const st = {profile: profile(), directoryOthers: others}; const {tab, rec, errors} = await open('connect.html', st);
  await tab.click('[data-view="directory"]'); await tab.type('#directorySearch', 'er'); await new Promise(r => setTimeout(r, 700));
  const rows = await tab.evaluate(() => [...document.querySelectorAll('#directoryList .list-item')].map(r => ({name: r.querySelector('strong')?.textContent, src: r.querySelector('.avatar img')?.getAttribute('src')})));
  const by = n => rows.find(r => r.name === n);
  T('a member who shares their photo shows it', by('Sister Shared') && /object\/sign\/member-photos\//.test(by('Sister Shared').src), JSON.stringify(rows));
  T('a member who does NOT share shows the generic man picture (their real photo is never requested)', by('Brother Private') && /avatar-man\.svg$/.test(by('Brother Private').src) && !rec.signs.includes(`${CHURCH}/u3.jpg`), JSON.stringify({rows, signs: rec.signs}));
  T('a member with no gender shows the neutral picture', by('Member Nogender') && /avatar-neutral\.svg$/.test(by('Member Nogender').src));
  T('only shared photos were asked for', rec.signs.includes(`${CHURCH}/u2.jpg`) && !rec.signs.includes(`${CHURCH}/u3.jpg`), JSON.stringify(rec.signs));
  T('no script errors', errors.length === 0, errors.join(' | ').slice(0, 200)); await tab.close() }

// ---------------- Administrator: Membership ----------------
{ const members = [{user_id: 'u2', display_name: 'Sister Shared', approved: true, created_at: '2026-01-02T00:00:00Z', church_id: CHURCH, gender: 'female', photo_path: `${CHURCH}/u2.jpg`, photo_visible: false},
                   {user_id: 'u5', display_name: 'Brother Plain', approved: false, created_at: '2026-01-01T00:00:00Z', church_id: CHURCH, gender: 'male', photo_path: null, photo_visible: false}];
  const dirMembers = [{id: 'd1', full_name: 'Mother Ann', courtesy_title: 'Sis.', primary_title: null, church_titles: [], phone: '9045550142', email: null, notes: null, sms_consent: true, active: true, gender: 'female', photo_path: null, photo_visible: false}];
  const st = {profile: profile(), isAdmin: true, members, dirMembers};
  const {tab, rec, errors} = await open('membership.html', st);
  await new Promise(r => setTimeout(r, 800));
  const info = await tab.evaluate(() => ({ok: !document.getElementById('dashboard').classList.contains('hidden'), rows: [...document.querySelectorAll('#members .list-item')].map(r => ({name: r.querySelector('strong')?.textContent, src: r.querySelector('.avatar img')?.getAttribute('src'), remove: [...r.querySelectorAll('button')].some(b => b.textContent === 'Remove photo')})), dir: [...document.querySelectorAll('#directoryList .list-item')].map(r => ({name: r.querySelector('strong')?.textContent, src: r.querySelector('.avatar img')?.getAttribute('src')}))}));
  T('administrator can open Membership', info.ok);
  const sh = info.rows.find(r => r.name === 'Sister Shared'), bp = info.rows.find(r => r.name === 'Brother Plain');
  T('administrators see a member\'s real photo even when sharing is off, with a Remove photo button', sh && /object\/sign\/member-photos\//.test(sh.src) && sh.remove, JSON.stringify(info.rows));
  T('a member without a photo shows the generic picture and no Remove button', bp && /avatar-man\.svg$/.test(bp.src) && !bp.remove);
  T('staff-entered members show their generic picture too', info.dir[0] && /avatar-woman\.svg$/.test(info.dir[0].src), JSON.stringify(info.dir));
  // remove a member's photo
  await tab.evaluate(() => [...document.querySelectorAll('#members .list-item')].find(r => /Sister Shared/.test(r.textContent)).querySelector('button').click()).catch(() => {});
  await tab.evaluate(() => [...document.querySelectorAll('#members button')].find(b => b.textContent === 'Remove photo').click()); await new Promise(r => setTimeout(r, 900));
  T('Remove photo deletes the file and clears the record', rec.removes.includes(`${CHURCH}/u2.jpg`) && rec.patches.some(p => p.photo_path === null && p.photo_visible === false), JSON.stringify({removes: rec.removes, patches: rec.patches}));
  // add a staff-entered member with a photo
  await tab.click('#addMember'); await tab.type('#directoryName', 'Elder Joe'); await tab.select('#directoryGender', 'male');
  const f = await tab.$('#directoryPhotoFile'); await f.uploadFile(pic); await new Promise(r => setTimeout(r, 500));
  T('the chosen photo previews before saving', await tab.evaluate(() => /^blob:/.test(document.querySelector('#directoryAvatar img')?.getAttribute('src') || '')));
  await tab.click('#directoryPhotoVisible'); await tab.click('#memberForm button[type=submit]'); await new Promise(r => setTimeout(r, 1800));
  const save = rec.rpcs.find(r => r.fn === 'save'), dp = rec.rpcs.find(r => r.fn === 'dirprofile');
  T('the member is saved first', !!save && save.p_name === 'Elder Joe');
  T('then the photo is uploaded to that person\'s private file', rec.uploads.some(u => u.path === `${CHURCH}/dir-d1000000-0000-0000-0000-0000000000ff.jpg`), JSON.stringify(rec.uploads));
  T('gender, photo location and the person\'s agreement are recorded together', dp && dp.p_gender === 'male' && dp.p_photo_path === `${CHURCH}/dir-d1000000-0000-0000-0000-0000000000ff.jpg` && dp.p_photo_visible === true, JSON.stringify(dp));
  T('no script errors', errors.length === 0, errors.join(' | ').slice(0, 200)); await tab.close() }
// the generic pictures exist and are valid images
for (const f of ['avatar-woman.svg', 'avatar-man.svg', 'avatar-neutral.svg']) { const s = fs.readFileSync(path.join(root, f), 'utf8'); T(`${f} is a valid SVG`, /^<svg[\s\S]*<\/svg>\s*$/.test(s) && s.includes('viewBox')) }
await browser.close(); server.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
