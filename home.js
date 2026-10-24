// Home: the few things a member needs first. An important notice, the next event, conversations with new messages,
// and reminders from the member's ministries. Each card opens the right place.
import {db, readPublic, occurrences, fmt} from './data.js';

const host = document.getElementById('homeCards');
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n };
const card = (title, ...kids) => el('section', {className: 'home-card'}, el('h3', {textContent: title}), ...kids);
const go = view => document.querySelector(`.tabs [data-view="${view}"]`)?.click();
let busy = false;

async function render() {
  if (!host || !db || busy) return;
  const {data: {session}} = await db.auth.getSession();
  if (!session) return;
  busy = true;
  try {
    const now = new Date();
    const [updates, pub, chats, unread, acts] = await Promise.all([
      db.from('member_updates').select('*').order('created_at', {ascending: false}).limit(20),
      readPublic().catch(() => ({events: []})),
      db.rpc('cc_chat_list'),
      db.rpc('my_conversation_unread_counts'),
      db.from('ministry_activities').select('id,title,starts_at,ministry_id,ministries(name)').gte('starts_at', new Date(now - 3600000).toISOString()).order('starts_at').limit(4)]);
    host.replaceChildren();

    // 1. the important notice: a pinned announcement, otherwise the newest one that has not expired
    const live = (updates.data || []).filter(x => !x.expires_at || new Date(x.expires_at) > now);
    const notice = live.find(x => x.pinned) || live[0];
    if (notice) host.append(card(notice.pinned ? 'Important notice' : 'Latest announcement', el('strong', {textContent: notice.title}), el('p', {textContent: notice.body}), el('div', {className: 'small muted', textContent: fmt(notice.created_at)})));

    // 2. the next event
    const next = occurrences(pub.events || [], 3).sort((a, b) => new Date(a.occurs_at) - new Date(b.occurs_at))[0];
    host.append(card('Next event', next
      ? el('div', {}, el('strong', {textContent: next.title}), el('div', {className: 'small muted', textContent: fmt(next.occurs_at) + (next.location ? ' · ' + next.location : '')}), el('button', {className: 'btn secondary', type: 'button', textContent: 'See all events', onclick: () => go('events')}))
      : el('p', {className: 'muted', textContent: 'No events are coming up.'})));

    // 3. conversations with something new
    const counts = new Map((unread.data || []).map(x => [x.conversation_id, Number(x.unread_count)]));
    const waiting = (Array.isArray(chats.data) ? chats.data : []).filter(c => counts.get(c.id) > 0 && !c.archived).slice(0, 3);
    host.append(card('Messages', waiting.length
      ? el('div', {}, ...waiting.map(c => el('button', {className: 'btn secondary home-chat', type: 'button', textContent: `${c.label} · ${counts.get(c.id)} new`, onclick: () => document.dispatchEvent(new CustomEvent('cc:open-chat', {detail: {id: c.id}}))})))
      : el('p', {className: 'muted', textContent: 'You are all caught up.'}), el('button', {className: 'btn secondary', type: 'button', textContent: 'Open Messages', onclick: () => go('messages')})));

    // 4. reminders from my ministries
    if ((acts.data || []).length) host.append(card('From your ministries', ...(acts.data || []).map(a => el('div', {className: 'list-item'},
      el('div', {}, el('strong', {textContent: a.title}), el('div', {className: 'small muted', textContent: `${a.ministries?.name || 'Ministry'} · ${fmt(a.starts_at)}`})),
      el('button', {className: 'btn secondary', type: 'button', textContent: 'Open', onclick: () => document.dispatchEvent(new CustomEvent('cc:open-ministry', {detail: {id: a.ministry_id}}))})))));
  } catch (e) { console.warn('Home unavailable', e) } finally { busy = false }
}
document.addEventListener('cc:home-refresh', render);
document.addEventListener('cc:refresh', render);
render();
db?.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_IN') render() });
