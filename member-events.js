// The Events tab of the member area: a month calendar of the church's published events (from the church website's feed or entered by an admin),
// with the next few events listed and "Add to calendar". Works the same for a church with its own website and one without.
import {db, readPublic, occurrences, escapeHTML as e, fmt} from './data.js';
const $ = id => document.getElementById(id);
let month = new Date(), all = [];
month.setDate(1);

function ics(x) {
  const dt = d => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const safe = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const start = new Date(x.occurs_at), end = new Date(start.getTime() + 3600000);
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Church Connect//EN', 'BEGIN:VEVENT', 'UID:' + x.id + '-' + start.getTime() + '@church-connect', 'DTSTAMP:' + dt(new Date()), 'DTSTART:' + dt(start), 'DTEND:' + dt(end), 'SUMMARY:' + safe(x.title), 'DESCRIPTION:' + safe(x.description), 'LOCATION:' + safe(x.location), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], {type: 'text/calendar'})); a.download = 'church-event.ics'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const sameDay = (x, y, m, d) => { const t = new Date(x.occurs_at); return t.getFullYear() === y && t.getMonth() === m && t.getDate() === d };
function details(items, heading) {
  const box = $('evDetails'); box.replaceChildren();
  const h = document.createElement('h3'); h.textContent = heading; box.append(h);
  if (!items.length) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'No events scheduled for this period.'; box.append(p); return }
  for (const x of items) {
    const row = document.createElement('div'); row.className = 'list-item';
    const d = document.createElement('div'); const s = document.createElement('strong'); s.textContent = x.title;
    const m = document.createElement('div'); m.className = 'small muted'; m.textContent = fmt(x.occurs_at) + ' · ' + (x.location || 'Location TBA'); d.append(s, m);
    if (x.description) { const p = document.createElement('p'); p.className = 'small'; p.textContent = x.description; d.append(p) }
    const b = document.createElement('button'); b.className = 'btn secondary'; b.textContent = 'Add to calendar'; b.onclick = () => ics(x);
    row.append(d, b); box.append(row);
  }
}
function render() {
  const y = month.getFullYear(), m = month.getMonth();
  $('evMonth').textContent = month.toLocaleDateString(undefined, {month: 'long', year: 'numeric'});
  const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
  let html = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(x => `<div class="weekday">${x}</div>`).join('');
  for (let i = 0; i < first; i++) html += '<div class="day empty"></div>';
  for (let day = 1; day <= days; day++) {
    const hits = all.filter(x => sameDay(x, y, m, day));
    html += `<button class="day" data-day="${day}" aria-label="${day}, ${hits.length} events"><b>${day}</b>${hits.slice(0, 2).map(x => `<span class="event-chip">${e(x.title)}</span>`).join('')}${hits.length > 2 ? `<small>+${hits.length - 2} more</small>` : ''}</button>`;
  }
  $('evGrid').innerHTML = html;
  details(all.filter(x => { const t = new Date(x.occurs_at); return t.getFullYear() === y && t.getMonth() === m }), 'Scheduled gatherings');
}
async function load() {
  try { all = occurrences((await readPublic()).events, 12) } catch (err) { all = []; $('evDetails').textContent = 'Unable to load events right now.'; console.error(err); return }
  render();
}
$('evPrev').onclick = () => { month.setMonth(month.getMonth() - 1); render() };
$('evNext').onclick = () => { month.setMonth(month.getMonth() + 1); render() };
$('evGrid').onclick = ev => {
  const b = ev.target.closest('[data-day]'); if (!b) return;
  const day = Number(b.dataset.day); details(all.filter(x => sameDay(x, month.getFullYear(), month.getMonth(), day)), month.toLocaleDateString(undefined, {month: 'long'}) + ' ' + day);
};
document.querySelector('[data-view="events"]').addEventListener('click', load);
if (db) db.channel('member-events').on('postgres_changes', {event: '*', schema: 'public', table: 'church_events'}, () => { if (!$('events').classList.contains('hidden')) load() }).subscribe();
if (new URLSearchParams(location.search).get('view') === 'events') load();
