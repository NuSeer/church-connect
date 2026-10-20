import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('D:/Projects/church-connect');
const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'};
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]); const f = path.join(root, p === '/' ? 'index.html' : p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf') }
  res.writeHead(200, {'content-type': types[path.extname(f)] || 'text/plain'}); res.end(fs.readFileSync(f));
}).listen(0);
const port = server.address().port;
const browser = await puppeteer.launch({executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--no-sandbox']});
let fails = 0; const T = (n, ok, extra = '') => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? ' => ' + extra : '')) };

for (const page of ['connect', 'admin', 'admin-center', 'membership', 'ministries-admin', 'website-editor', 'reset-password', 'admin-dashboard', 'index']) {
  const tab = await browser.newPage(); const errors = []; const recoverCalls = [];
  tab.on('pageerror', e => errors.push(e.message));
  tab.on('console', m => { if (m.type() === 'error') errors.push(m.text()) });
  // Only Supabase calls are intercepted (so no real email is ever sent); everything else loads normally.
  const cdp = await tab.createCDPSession();
  await cdp.send('Fetch.enable', {patterns: [{urlPattern: '*vizcmyqyoaazkcytcunp.supabase.co*'}]});
  cdp.on('Fetch.requestPaused', async ev => {
    const u = ev.request.url; if (u.includes('/auth/v1/recover') && ev.request.method === 'POST') recoverCalls.push(u);
    const headers = [{name: 'content-type', value: 'application/json'}, {name: 'access-control-allow-origin', value: '*'}, {name: 'access-control-allow-headers', value: '*'}, {name: 'access-control-allow-methods', value: '*'}];
    await cdp.send('Fetch.fulfillRequest', {requestId: ev.requestId, responseCode: 200, responseHeaders: headers, body: Buffer.from(u.includes('/auth/v1/recover') ? '{}' : '[]').toString('base64')}).catch(() => {});
  });
  await tab.goto(`http://localhost:${port}/${page}.html`, {waitUntil: 'load', timeout: 45000}).catch(e => errors.push('goto: ' + e.message));
  const needsForgot = ['connect','admin','admin-center','membership','ministries-admin','website-editor'].includes(page);
  if (needsForgot) await tab.waitForFunction(() => [...document.querySelectorAll('a')].some(a => a.textContent.trim() === 'Forgot password?'), {timeout: 20000}).catch(() => {});
  else await new Promise(r => setTimeout(r, 3500));
  const info = await tab.evaluate(() => {
    const pw = [...document.querySelectorAll('input[type="password"],input[data-was-password]')];
    const all = [...document.querySelectorAll('input')].filter(i => i.closest('.password-wrap') || i.type === 'password');
    return {inputs: all.length, withToggle: all.filter(i => i.closest('.password-wrap')?.querySelector('.password-toggle')).length || all.filter(i => i.nextElementSibling?.tagName === 'BUTTON').length, forgot: !![...document.querySelectorAll('a')].find(a => a.textContent.trim() === 'Forgot password?')};
  });
  const sansNoise = errors.filter(e => !/favicon|Failed to load resource|ERR_|manifest/i.test(e));
  T(`${page}: loads without script errors`, sansNoise.length === 0, sansNoise.join(' | ').slice(0, 200));
  if (info.inputs) T(`${page}: every password box has a Show button (${info.withToggle}/${info.inputs})`, info.withToggle === info.inputs);
  // click each Show button and confirm the field becomes visible, then hides again
  const toggled = await tab.evaluate(() => {
    const out = [];
    for (const i of document.querySelectorAll('input[type="password"]')) {
      const b = i.closest('.password-wrap')?.querySelector('.password-toggle') || (i.nextElementSibling?.tagName === 'BUTTON' ? i.nextElementSibling : null);
      if (!b) { out.push('nobutton'); continue }
      b.click(); const shown = i.type === 'text'; b.click(); out.push(shown && i.type === 'password' ? 'ok' : 'bad');
    }
    return out;
  });
  if (toggled.length) T(`${page}: Show/Hide actually toggles (${toggled.join(',')})`, toggled.every(x => x === 'ok'));
  if (['connect', 'admin', 'admin-center', 'membership', 'ministries-admin', 'website-editor'].includes(page)) {
    T(`${page}: has Forgot password link`, info.forgot);
    // Empty email -> helpful nudge, no request. Then valid email -> mocked recover call with a redirect back to reset-password.html
    await tab.evaluate(() => { [...document.querySelectorAll('a')].find(a => a.textContent.trim() === 'Forgot password?')?.click() });
    await new Promise(r => setTimeout(r, 300));
    const nudge = await tab.evaluate(() => document.body.innerText.includes('Type your email'));
    T(`${page}: empty email gets a nudge, not a request`, nudge && recoverCalls.length === 0);
    await tab.evaluate(() => { const e = [...document.querySelectorAll('input[type="email"]')].find(x => x.closest('form')?.querySelector('input[type="password"]')); e.value = 'test@example.invalid'; [...document.querySelectorAll('a')].find(a => a.textContent.trim() === 'Forgot password?').click() });
    await new Promise(r => setTimeout(r, 1200));
    const sent = await tab.evaluate(() => document.body.innerText.includes('reset link is on its way'));
    T(`${page}: reset request sent (mocked) and confirmation shown`, sent && recoverCalls.length === 1 && /redirect_to=[^&]*reset-password\.html/.test(decodeURIComponent(recoverCalls[0])), recoverCalls[0] ? decodeURIComponent(recoverCalls[0]).slice(-90) : 'no call');
  }
  if (page === 'reset-password') {
    const msg = await tab.evaluate(() => document.getElementById('status').textContent);
    T('reset-password: no session shows expired-link message', /missing or has expired/.test(msg), msg.slice(0, 80));
  }
  await tab.close();
}
await browser.close(); server.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
