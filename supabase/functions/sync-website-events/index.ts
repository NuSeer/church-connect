// Supabase Edge Function: copy events from a church's existing website into Church Connect (read-only on the website).
// Deploy with "Verify JWT" OFF: this function checks the caller itself.
//   * An administrator's browser calls it with their login -> syncs only THEIR church.
//   * A schedule calls it with the x-cc-webhook-secret header -> syncs every church that has a feed address.
import { createClient } from 'npm:@supabase/supabase-js@2';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const secret = Deno.env.get('CC_PUSH_WEBHOOK_SECRET');
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-cc-webhook-secret', 'access-control-allow-methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

const stripTags = (s: unknown) => String(s ?? '').replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const links = (s: unknown) => [...String(s ?? '').matchAll(/href\s*=\s*["'](https:\/\/[^"'\s]+)["']/gi)].map(m => m[1]);

// Only plain public https addresses may be fetched (stops the feed setting being used to probe internal services).
export function safeFeedUrl(u: string): URL | null {
  try {
    const url = new URL(u); const h = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || !h.includes('.') || /^[0-9.]+$/.test(h) || h.includes(':') || h === 'localhost' || /\.(local|internal|localhost)$/.test(h)) return null;
    return url;
  } catch { return null }
}

// "2026-02-02" + "7:00 PM" in a time zone -> the matching UTC instant.
export function zonedToUtc(date: string, time: string, tz: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date); if (!d) return null;
  let hh = 0, mm = 0; const t = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time || '');
  if (t) { hh = Number(t[1]) % 12 + (t[3].toUpperCase() === 'PM' ? 12 : 0); mm = Number(t[2]) }
  const guess = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), hh, mm);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(guess));
  const get = (k: string) => Number(parts.find(p => p.type === k)!.value);
  const asLocal = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  const result = new Date(guess - (asLocal - guess));
  return isNaN(result.getTime()) ? null : result.toISOString();
}

export function mapEvent(e: any, tz: string) {
  const title = stripTags(e?.title).slice(0, 180); const id = e?.id;
  const date = String(e?.date ?? ''); const time = String(e?.time ?? '').trim();
  if (!title || id === undefined || id === null || String(id).length > 100) return null;
  const startsAt = zonedToUtc(date, time, tz); if (!startsAt) return null;
  const extra: string[] = [];
  if (!time) extra.push('All day.');
  if (e?.endTime) extra.push(`Ends ${stripTags(e.endTime).slice(0, 20)}.`);
  const body = stripTags(e?.desc); if (body) extra.push(body);
  const urls = [...new Set([...links(e?.loc), ...links(e?.desc), ...(typeof e?.zoom === 'string' && e.zoom.startsWith('https://') ? [e.zoom] : [])])].slice(0, 3);
  if (urls.length) extra.push('Link: ' + urls.join(' '));
  const location = stripTags(e?.loc).slice(0, 200);
  return { source: 'website', external_id: String(id), title, description: extra.join(' ').slice(0, 2000) || null, location: location || null, starts_at: startsAt, recurrence: 'none', published: true };
}

// ---- Reading a feed: the church website's own JSON list, or a standard calendar (.ics) feed ----
type Fetched = { text: string } | { error: string };
async function readFeed(url: URL, ms = 15000): Promise<Fetched> {
  try {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), ms);
    const res = await fetch(url.href, { signal: ctl.signal, headers: { accept: 'application/json, text/calendar;q=0.9, text/html;q=0.5, */*;q=0.3' } }); clearTimeout(timer);
    if (!res.ok) return { error: `The website answered with an error (${res.status})` };
    const host = new URL(res.url).hostname.replace(/^www\./, ''); if (host !== url.hostname.replace(/^www\./, '')) return { error: 'The website redirected somewhere else, so it was not used' };
    const text = await res.text(); if (text.length > 3_000_000) return { error: 'The events list is too large' };
    return { text };
  } catch (err) { return { error: 'Could not read the events list: ' + String((err as Error)?.message || err).slice(0, 120) } }
}

export function classifyFeed(text: string): 'ics' | 'json' | null {
  const t = String(text || '').trimStart();
  if (/^BEGIN:VCALENDAR/i.test(t)) return /BEGIN:VEVENT/i.test(t) ? 'ics' : null;
  try { const j = JSON.parse(t); const l = Array.isArray(j) ? j : j?.events; if (Array.isArray(l) && l.some((e: any) => e && typeof e === 'object' && e.title && e.date)) return 'json' } catch { /* not JSON */ }
  return null;
}

const pad = (n: number) => String(n).padStart(2, '0');
const to12 = (h: number, m: number) => `${h % 12 || 12}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`;
const dayStr = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const validZone = (z: string | undefined, fallback: string) => { if (!z) return fallback; try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return z } catch { return fallback } };
function localParts(utcIso: string, tz: string) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(utcIso));
  const g = (k: string) => Number(p.find(x => x.type === k)!.value);
  return { date: `${g('year')}-${pad(g('month'))}-${pad(g('day'))}`, time: to12(g('hour'), g('minute')) };
}
// "20261101T100000Z" / "20261101T100000" (with TZID) / "20261101" (all day) -> the church-local date and time.
function icsLocal(value: string, params: string, tz: string): { date: string; time: string } | null {
  const v = value.trim(); let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: '' };
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)$/i.exec(v); if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (m[7]) return localParts(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])).toISOString(), tz);
  const zone = validZone(/TZID=([^;:]+)/i.exec(params)?.[1], tz); const time = to12(+m[4], +m[5]);
  if (zone === tz) return { date, time };
  const utc = zonedToUtc(date, time, zone); return utc ? localParts(utc, tz) : { date, time };
}
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
// Repeating events: daily, weekly (with chosen days) and monthly (same date, or "1st Sunday") for the next 12 months. Anything fancier shows once.
function expand(start: string, rule: string | undefined, exdates: Set<string>, today: string, horizon: string): string[] {
  if (!rule) return start >= today ? [start] : [];
  const r: Record<string, string> = {}; for (const part of rule.split(';')) { const [k, v] = part.split('='); if (k && v) r[k.toUpperCase()] = v }
  const interval = Math.max(1, Number(r.INTERVAL) || 1), count = Number(r.COUNT) || Infinity, until = r.UNTIL ? `${r.UNTIL.slice(0, 4)}-${r.UNTIL.slice(4, 6)}-${r.UNTIL.slice(6, 8)}` : '9999-12-31';
  const out: string[] = []; let made = 0; const startMs = dayMs(start), endStr = until < horizon ? until : horizon;
  const push = (d: string) => { if (d < start || made >= count || d > until) return false; made++; if (d >= today && d <= horizon && !exdates.has(d)) out.push(d); return true };
  const freq = (r.FREQ || '').toUpperCase(), byday = (r.BYDAY || '').split(',').filter(Boolean);
  if (freq === 'DAILY') { for (let i = 0; dayStr(startMs + i * 86400000 * interval) <= endStr && i < 800; i++) if (!push(dayStr(startMs + i * 86400000 * interval))) break }
  else if (freq === 'WEEKLY') {
    if (byday.length) { const set = new Set(byday.map(x => x.slice(-2))); for (let i = 0; i < 800; i++) { const ms = startMs + i * 86400000, d = dayStr(ms); if (d > endStr) break; if (Math.floor(i / 7) % interval === 0 && set.has(DAYS[new Date(ms).getUTCDay()]) && !push(d)) break } }
    else for (let i = 0; i < 400; i++) { const d = dayStr(startMs + i * 7 * interval * 86400000); if (d > endStr || !push(d)) break }
  } else if (freq === 'MONTHLY') {
    const s = new Date(startMs); const nth = /^(-?\d)(SU|MO|TU|WE|TH|FR|SA)$/.exec(byday[0] || '');
    for (let i = 0; i < 60; i++) {
      const first = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + i * interval, 1)); let ms: number;
      if (nth) { const wd = DAYS.indexOf(nth[2]), n = Number(nth[1]); const len = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate(); const days = []; for (let d = 1; d <= len; d++) if (new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), d)).getUTCDay() === wd) days.push(d); const pick = n > 0 ? days[n - 1] : days[days.length + n]; if (!pick) continue; ms = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), pick) }
      else { const len = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate(); if (s.getUTCDate() > len) continue; ms = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), s.getUTCDate()) }
      const d = dayStr(ms); if (d > endStr || !push(d)) break;
    }
  } else return [start];
  return out;
}
export function icsToEvents(text: string, tz: string, now = new Date()): any[] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const today = dayStr(now.getTime() - 86400000), horizon = dayStr(now.getTime() + 366 * 86400000);
  const unescape = (s: string) => s.replace(/\\[nN]/g, ' ').replace(/\\([,;\\])/g, '$1').trim();
  const out: any[] = []; let cur: Record<string, { params: string; value: string }[]> | null = null;
  for (const line of lines) {
    if (/^BEGIN:VEVENT/i.test(line)) { cur = {}; continue }
    if (/^END:VEVENT/i.test(line)) {
      const ev = cur; cur = null; if (!ev) continue; const one = (k: string) => ev[k]?.[0];
      const title = unescape(one('SUMMARY')?.value || ''), ds = one('DTSTART'), uid = one('UID')?.value || title; if (!title || !ds || /CANCELLED/i.test(one('STATUS')?.value || '')) continue;
      const st = icsLocal(ds.value, ds.params, tz); if (!st) continue;
      const de = one('DTEND'); const en = de ? icsLocal(de.value, de.params, tz) : null;
      const ex = new Set<string>((ev.EXDATE || []).flatMap(x => x.value.split(',')).map(x => `${x.slice(0, 4)}-${x.slice(4, 6)}-${x.slice(6, 8)}`));
      const rule = one('RRULE')?.value; const dates = expand(st.date, rule, ex, today, horizon).slice(0, 80);
      for (const d of dates) out.push({ id: (rule ? `${uid}@${d}` : uid).slice(0, 100), title, date: d, time: st.time, endTime: en && en.date === st.date && en.time ? en.time : undefined, loc: unescape(one('LOCATION')?.value || ''), desc: unescape(one('DESCRIPTION')?.value || '') });
      if (out.length > 1500) break; continue;
    }
    if (!cur) continue; const m = /^([A-Za-z0-9-]+)((?:;[^:]*)?):(.*)$/.exec(line); if (!m) continue;
    (cur[m[1].toUpperCase()] ??= []).push({ params: m[2], value: m[3] });
  }
  return out;
}

// ---- Finding a church website's events list by itself ----
const WELL_KNOWN = ['/api/events', '/events.json', '/api/events.json', '/events.ics', '/calendar.ics', '/calendar/ical', '/events/?ical=1', '/?ical=1', '/feed/events'];
export function candidateUrls(html: string, site: URL): string[] {
  const out: string[] = []; const add = (h: string) => { try { out.push(new URL(h.trim().replace(/^webcal:/i, 'https:'), site).href) } catch { /* ignore */ } };
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) if (/text\/calendar/i.test(m[0])) { const h = /href\s*=\s*["']([^"']+)["']/i.exec(m[0]); if (h) add(h[1]) }
  for (const m of html.matchAll(/href\s*=\s*["']((?:webcal:|https?:)?[^"']*\.ics(?:\?[^"']*)?)["']/gi)) add(m[1]);
  for (const m of html.matchAll(/href\s*=\s*["'](webcal:[^"']+)["']/gi)) add(m[1]);
  for (const p of WELL_KNOWN) add(p);
  return [...new Set(out)].filter(h => safeFeedUrl(h)).slice(0, 14);
}
export async function detectFeed(site: URL): Promise<{ url: string; type: 'ics' | 'json' } | null> {
  const page = await readFeed(site, 8000); const html = 'text' in page ? page.text.slice(0, 500_000) : '';
  const urls = candidateUrls(html, site);
  const checks = await Promise.all(urls.map(async u => { const got = await readFeed(safeFeedUrl(u)!, 8000); const type = 'text' in got ? classifyFeed(got.text) : null; return type ? { url: u, type } : null }));
  return checks.find(Boolean) as { url: string; type: 'ics' | 'json' } | null || null;
}

async function syncChurch(church: any) {
  const url = safeFeedUrl(String(church.events_feed_url || ''));
  const fail = async (msg: string) => { await db.from('churches').update({ events_sync_status: msg.slice(0, 200), events_synced_at: new Date().toISOString() }).eq('id', church.id); return { church: church.id, ok: false, error: msg } };
  if (!url) return fail('The events address is not a valid public https address');
  const got = await readFeed(url); if ('error' in got) return fail(got.error);
  let payload: any;
  if (/^\s*BEGIN:VCALENDAR/i.test(got.text)) payload = icsToEvents(got.text, church.events_timezone || 'America/New_York');
  else { try { payload = JSON.parse(got.text) } catch (err) { return fail('Could not read the events list: ' + String((err as Error)?.message || err).slice(0, 120)) } }
  const list = Array.isArray(payload) ? payload : payload?.events;
  if (!Array.isArray(list) || list.length > 2000) return fail('The events list was not in the expected format');
  const rows = list.map(e => mapEvent(e, church.events_timezone || 'America/New_York')).filter(Boolean).map(r => ({ ...r, church_id: church.id }));
  const skipped = list.length - rows.length;
  if (rows.length) { const { error } = await db.from('church_events').upsert(rows, { onConflict: 'church_id,source,external_id' }); if (error) return fail('Saving events failed: ' + error.message) }
  // Events removed from the website disappear here too (only rows that came from the website are ever touched).
  const keep = new Set(rows.map(r => r.external_id));
  const { data: existing, error: ee } = await db.from('church_events').select('id,external_id').eq('church_id', church.id).eq('source', 'website');
  if (ee) return fail('Checking old events failed: ' + ee.message);
  const gone = (existing || []).filter((r: any) => !keep.has(r.external_id)).map((r: any) => r.id);
  if (gone.length && rows.length) await db.from('church_events').delete().in('id', gone);
  const status = `Synced ${rows.length} events${skipped ? `, skipped ${skipped} that were incomplete` : ''}${gone.length && rows.length ? `, removed ${gone.length}` : ''}`;
  await db.from('churches').update({ events_sync_status: status, events_synced_at: new Date().toISOString() }).eq('id', church.id);
  return { church: church.id, ok: true, synced: rows.length, skipped, removed: rows.length ? gone.length : 0 };
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    if (secret && request.headers.get('x-cc-webhook-secret') === secret) {
      const { data: churches, error } = await db.from('churches').select('id,events_feed_url,events_timezone,events_synced_at').not('events_feed_url', 'is', null);
      if (error) throw error;
      const results = []; for (const c of churches || []) results.push(await syncChurch(c));
      return json({ results });
    }
    const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = jwt ? await db.auth.getUser(jwt) : { data: { user: null } };
    if (!user) return json({ error: 'Sign in required' }, 401);
    const { data: admin } = await db.from('church_admins').select('church_id').eq('user_id', user.id).maybeSingle();
    if (!admin) return json({ error: 'Administrator access required' }, 403);
    const { data: church, error } = await db.from('churches').select('id,events_feed_url,events_timezone,events_synced_at').eq('id', admin.church_id).single();
    if (error || !church) throw error || Error('Church missing');
    const body = await request.json().catch(() => ({}));
    if (body && body.detect === true) {
      // Look for the church website's events list by itself, remember it, and copy the events.
      if (body.ifEmpty === true && church.events_feed_url) return json({ ok: true, found: false, skipped: 'An events address is already set' });
      const { data: site } = await db.from('churches').select('website_url').eq('id', church.id).maybeSingle();
      const siteUrl = safeFeedUrl(String(site?.website_url || ''));
      if (!siteUrl) return json({ ok: false, found: false, error: 'Add your church website address in Church settings first' }, 400);
      const found = await detectFeed(siteUrl);
      if (!found) return json({ ok: false, found: false, error: 'We could not find an events list on your website. If your website calendar offers a link ending in .ics, paste it as the events address. Otherwise add events by hand.' });
      await db.from('churches').update({ events_feed_url: found.url, events_sync_status: 'Found automatically', events_synced_at: null }).eq('id', church.id);
      return json({ ...(await syncChurch({ ...church, events_feed_url: found.url })), found: true, feed: found.url, type: found.type });
    }
    if (!church.events_feed_url) return json({ error: 'No events address is set yet' }, 400);
    if (church.events_synced_at && Date.now() - new Date(church.events_synced_at).getTime() < 30000) return json({ error: 'Synced moments ago. Please wait a little before trying again.' }, 429);
    return json(await syncChurch(church));
  } catch (err) { console.error(err); return json({ error: 'Sync error' }, 500) }
});
