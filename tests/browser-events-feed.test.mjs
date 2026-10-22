// Headless Edge test of the admin "Events from your church website" panel. Supabase is fully mocked (fake signed-in admin).
// Usage: node browser-events-feed.test.mjs   (needs: npm i puppeteer-core)
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
const EVENTS = [{id: 'e1', title: 'Zoom Corporate Prayer', starts_at: '2026-11-02T00:00:00Z', recurrence: 'none', published: true, source: 'website'}, {id: 'e2', title: 'Typed in by hand', starts_at: '2026-11-03T00:00:00Z', recurrence: 'none', published: true, source: null}];

async function run(name, syncReply, fn, churchRow) {
  const tab = await browser.newPage(); const calls = []; const errors = [];
  tab.on('pageerror', e => errors.push(e.message)); tab.on('dialog', d => d.accept());
  await tab.evaluateOnNewDocument(s => localStorage.setItem('sb-vizcmyqyoaazkcytcunp-auth-token', JSON.stringify(s)), session);
  const cdp = await tab.createCDPSession();
  await cdp.send('Fetch.enable', {patterns: [{urlPattern: '*vizcmyqyoaazkcytcunp.supabase.co*'}]});
  cdp.on('Fetch.requestPaused', async ev => {
    const u = new URL(ev.request.url), m = ev.request.method; let body = [], code = 200;
    if (m === 'OPTIONS') body = '';
    else if (u.pathname === '/auth/v1/user') body = USER;
    else if (u.pathname.endsWith('/rest/v1/church_admins')) body = [{user_id: USER.id}];
    else if (u.pathname.endsWith('/rest/v1/church_events')) body = EVENTS;
    else if (u.pathname.endsWith('/rpc/cc_my_church_id')) body = 'church-1';
    else if (u.pathname.endsWith('/rest/v1/churches')) body = [churchRow || {events_feed_url: 'https://newbeginningsoutreachctrcogic.org/api/events', events_timezone: 'America/Chicago', events_synced_at: '2026-10-20T12:00:00Z', events_sync_status: 'Synced 270 events'}];
    else if (u.pathname.endsWith('/rpc/cc_set_events_feed')) { const b = JSON.parse(ev.request.postData || '{}'); calls.push({fn: 'set', body: b}); if (/^http:/.test(b.p_url || '')) { code = 400; body = {message: 'Use a full https:// web address'} } else body = null }
    else if (u.pathname.endsWith('/functions/v1/sync-website-events')) { calls.push({fn: 'sync', auth: ev.request.headers['Authorization'] || ev.request.headers['authorization'], body: (() => { try { return JSON.parse(ev.request.postData || '{}') } catch { return {} } })()}); code = syncReply.code; body = syncReply.body }
    await cdp.send('Fetch.fulfillRequest', {requestId: ev.requestId, responseCode: code, responseHeaders: [{name: 'content-type', value: 'application/json'}, {name: 'access-control-allow-origin', value: '*'}, {name: 'access-control-allow-headers', value: '*'}, {name: 'access-control-allow-methods', value: '*'}], body: Buffer.from(m === 'OPTIONS' ? '' : JSON.stringify(body)).toString('base64')}).catch(() => {});
  });
  await tab.goto(`http://localhost:${port}/admin.html`, {waitUntil: 'load', timeout: 45000});
  await tab.waitForFunction(() => !document.getElementById('workspace')?.classList.contains('hidden'), {timeout: 25000}).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  console.log(`-- ${name}`);
  await fn(tab, calls, errors);
  await tab.close();
}

await run('administrator sets the address and syncs', {code: 200, body: {church: 'church-1', ok: true, synced: 270, skipped: 0, removed: 0}}, async (tab, calls, errors) => {
  T('admin workspace opened', await tab.evaluate(() => !document.getElementById('workspace').classList.contains('hidden')));
  T('panel shows the saved address and time zone', await tab.evaluate(() => document.getElementById('feedUrl').value === 'https://newbeginningsoutreachctrcogic.org/api/events' && document.getElementById('feedZone').value === 'America/Chicago'));
  T('panel shows the last sync result', await tab.evaluate(() => /Synced 270 events/.test(document.getElementById('feedStatus').textContent)), await tab.evaluate(() => document.getElementById('feedStatus').textContent));
  const picks = await tab.evaluate(() => [...document.querySelectorAll('#eventPick option')].map(o => o.textContent));
  T('the event dropdown lists every event and marks the ones from the website', picks.length === 3 && picks.some(x => /from website/.test(x)) && picks.some(x => /Typed in by hand/.test(x) && !/from website/.test(x)), picks.join(' | '));
  T('there is no long list of events any more', await tab.evaluate(() => !document.getElementById('eventList')));
  await tab.$eval('#feedUrl', el => { el.value = '' });
  await tab.type('#feedUrl', 'https://yourchurch.org/api/events');
  await tab.select('#feedZone', 'America/New_York');
  await tab.click('#feedForm button[type=submit]');
  await new Promise(r => setTimeout(r, 1000));
  const set = calls.find(c => c.fn === 'set');
  T('saving sends the typed address and chosen time zone', set && set.body.p_url === 'https://yourchurch.org/api/events' && set.body.p_timezone === 'America/New_York', JSON.stringify(set));
  await tab.click('#feedSync');
  await new Promise(r => setTimeout(r, 1500));
  const sync = calls.find(c => c.fn === 'sync');
  T('Sync now calls the sync function with the administrator\'s login', sync && /^Bearer /.test(sync.auth || ''), JSON.stringify(sync));
  T('button is usable again afterwards', await tab.evaluate(() => !document.getElementById('feedSync').disabled));
  T('no script errors', errors.length === 0, errors.join(' | ').slice(0, 200));
});
await run('the sync function reports a problem', {code: 429, body: {error: 'Synced moments ago. Please wait a little before trying again.'}}, async (tab, calls, errors) => {
  await tab.click('#feedSync'); await new Promise(r => setTimeout(r, 1500));
  const msg = await tab.evaluate(() => document.getElementById('feedStatus').textContent);
  T('the server\'s plain-language message is shown', /Synced moments ago/.test(msg), msg);
  T('no script errors', errors.length === 0, errors.join(' | ').slice(0, 200));
});
await run('find my events automatically: found', {code: 200, body: {ok: true, found: true, feed: 'https://yourchurch.org/cal/feed.ics', type: 'ics', synced: 12}}, async (tab, calls, errors) => {
  T('the panel has a "Find my events automatically" button', await tab.evaluate(() => /Find my events automatically/.test(document.getElementById('feedDetect')?.textContent || '')));
  await tab.click('#feedDetect'); await new Promise(r => setTimeout(r, 1500));
  const det = calls.find(c => c.fn === 'sync' && c.body.detect === true);
  T('it asks the function to look for the events list, with the administrator login', det && /^Bearer /.test(det.auth || ''), JSON.stringify(det));
  const msg = await tab.evaluate(() => document.getElementById('feedStatus').textContent);
  T('it says what it found and how many events it copied', /Found it and copied 12 events from https:\/\/yourchurch\.org\/cal\/feed\.ics/.test(msg), msg);
  T('the button is usable again', await tab.evaluate(() => !document.getElementById('feedDetect').disabled));
  T('no script errors', errors.length === 0, errors.join(' | ').slice(0, 200));
});
await run('find my events automatically: nothing found', {code: 200, body: {ok: false, found: false, error: 'We could not find an events list on your website. Add events by hand.'}}, async (tab) => {
  await tab.click('#feedDetect'); await new Promise(r => setTimeout(r, 1500));
  const msg = await tab.evaluate(() => document.getElementById('feedStatus').textContent);
  T('when nothing is found the plain-language reason is shown', /could not find an events list/.test(msg), msg);
});
await run('a rejected address shows the reason', {code: 200, body: {ok: true}}, async (tab, calls) => {
  await tab.$eval('#feedUrl', el => { el.value = 'http://example.org/e' });
  await tab.click('#feedForm button[type=submit]'); await new Promise(r => setTimeout(r, 1000));
  const msg = await tab.evaluate(() => document.getElementById('feedStatus').textContent);
  T('a non-https address is refused with a clear message', /full https:\/\//.test(msg), msg);
});
await run('no address set yet', {code: 200, body: {ok: true}}, async tab => {
  T('Sync now is disabled and the panel says no address is set', await tab.evaluate(() => document.getElementById('feedSync').disabled && /No website address set yet/.test(document.getElementById('feedStatus').textContent)));
}, {events_feed_url: null, events_timezone: 'America/New_York', events_synced_at: null, events_sync_status: null});
await browser.close(); server.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
