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

async function syncChurch(church: any) {
  const url = safeFeedUrl(String(church.events_feed_url || ''));
  const fail = async (msg: string) => { await db.from('churches').update({ events_sync_status: msg.slice(0, 200), events_synced_at: new Date().toISOString() }).eq('id', church.id); return { church: church.id, ok: false, error: msg } };
  if (!url) return fail('The events address is not a valid public https address');
  let payload: any;
  try {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 15000);
    const res = await fetch(url.href, { signal: ctl.signal, headers: { accept: 'application/json' } }); clearTimeout(timer);
    if (!res.ok) return fail(`The website answered with an error (${res.status})`);
    const host = new URL(res.url).hostname.replace(/^www\./, ''); if (host !== url.hostname.replace(/^www\./, '')) return fail('The website redirected somewhere else, so it was not used');
    const text = await res.text(); if (text.length > 3_000_000) return fail('The events list is too large');
    payload = JSON.parse(text);
  } catch (err) { return fail('Could not read the events list: ' + String((err as Error)?.message || err).slice(0, 120)) }
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
    if (!church.events_feed_url) return json({ error: 'No events address is set yet' }, 400);
    if (church.events_synced_at && Date.now() - new Date(church.events_synced_at).getTime() < 30000) return json({ error: 'Synced moments ago. Please wait a little before trying again.' }, 429);
    return json(await syncChurch(church));
  } catch (err) { console.error(err); return json({ error: 'Sync error' }, 500) }
});
