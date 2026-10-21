// "Public website" / "View website" links open the church's real website; the app's own name/brand goes to the member area.
import puppeteer from 'puppeteer-core';import http from 'node:http';import fs from 'node:fs';import path from 'node:path';
const root = path.resolve(process.env.CC_REPO || 'D:/Projects/church-connect');
const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png'};
const server = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end() } res.writeHead(200, {'content-type': types[path.extname(f)] || 'text/plain'}); res.end(fs.readFileSync(f)) }).listen(0);
const browser = await puppeteer.launch({executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--no-sandbox']});
let fails = 0; const T = (n, ok, extra = '') => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok && !extra ? '' : ' => ' + extra)) };
const SITE = 'https://newbeginningsoutreachctrcogic.org';
for (const [pg, sel, label] of [['connect.html', 'a[data-church-site]', 'Public website'], ['admin.html', 'a[data-church-site]', 'View website'], ['website-editor.html', 'a[data-church-site]', 'Public website']]) {
  const tab = await browser.newPage(); await tab.goto(`http://localhost:${server.address().port}/${pg}`, {waitUntil: 'load'}); await new Promise(r => setTimeout(r, 1000));
  const a = await tab.evaluate(s => { const e = document.querySelector(s); return e && {href: e.href, target: e.target, rel: e.rel, text: e.textContent.trim()} }, sel);
  T(`${pg}: "${label}" opens the church website in a new tab`, a && a.href === SITE + '/' && a.target === '_blank' && /noopener/.test(a.rel) && a.text.startsWith(label), JSON.stringify(a)); await tab.close();
}
for (const pg of ['connect.html', 'admin.html', 'reset-password.html']) { const h = fs.readFileSync(path.join(root, pg), 'utf8'); T(`${pg}: the app's name/logo goes to the member area, not the app's public page`, /<a class="brand" href="connect\.html">/.test(h)) }
const cfg = fs.readFileSync(path.join(root, 'config.js'), 'utf8'); T('the website address is a plain https address in config.js', /existingWebsiteUrl: 'https:\/\/newbeginningsoutreachctrcogic\.org'/.test(cfg));
{ // a non-https value is ignored (links stay as they are)
  const tab = await browser.newPage(); await tab.setRequestInterception(true);
  tab.on('request', r => r.url().endsWith('/config.js') ? r.respond({status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(root, 'config.js'), 'utf8').replace(SITE, 'javascript:alert(1)')}) : r.continue());
  await tab.goto(`http://localhost:${server.address().port}/connect.html`, {waitUntil: 'load'}); await new Promise(r => setTimeout(r, 800));
  T('an unsafe (non-https) setting is ignored', await tab.evaluate(() => !/javascript:/.test(document.querySelector('a[data-church-site]').href)));
  await tab.close() }
await browser.close(); server.close(); console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
