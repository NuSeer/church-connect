// "Message to the webmaster": an administrator says what needs changing on the church website, the webmaster sees it in an inbox and marks it done.
import {db, fmt} from './data.js';

const KINDS = [
  ['event', 'A new event to list on the website'],
  ['event_change', 'Change or remove an event on the website'],
  ['photo', 'Upload a photo'],
  ['other', 'Something else']
];
const LABEL = Object.fromEntries(KINDS);
const host = document.getElementById('webmasterRequests');

function el(tag, props = {}, ...kids) {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
}

async function eventsList() {
  const r = await db.from('church_events').select('id,title,starts_at').order('starts_at', {ascending: false}).limit(150);
  return r.error ? [] : r.data;
}

async function render() {
  host.replaceChildren();
  const {data: {session}} = await db.auth.getSession();
  if (!session) return;
  const isWebmaster = (await db.rpc('cc_is_webmaster')).data === true;
  const events = await eventsList();

  const kind = el('select', {id: 'wmKind'}, ...KINDS.map(([v, t]) => new Option(t, v)));
  const eventPick = el('select', {id: 'wmEvent'}, new Option('Choose the event', ''), ...events.map(e => new Option(e.title + ' · ' + fmt(e.starts_at), e.id)));
  const eventRow = el('label', {id: 'wmEventRow'}, 'Which event?', eventPick);
  const message = el('textarea', {id: 'wmMessage', maxLength: 1500, placeholder: 'Tell the webmaster what you need. For a photo, say which page it belongs on and where the file is.'});
  const status = el('p', {className: 'small muted', id: 'wmStatus'});
  status.setAttribute('aria-live', 'polite');
  const send = el('button', {className: 'btn', type: 'submit'}, 'Send to webmaster');
  const form = el('form', {id: 'wmForm'}, el('label', {}, 'What is this about?', kind), eventRow, el('label', {}, 'Message', message), el('div', {className: 'actions'}, send), status);
  const sync = () => {
    const needsEvent = kind.value === 'event_change';
    eventRow.classList.toggle('hidden', !needsEvent);
    message.required = kind.value === 'photo' || kind.value === 'other';
  };
  kind.onchange = sync; sync();
  form.onsubmit = async ev => {
    ev.preventDefault(); send.disabled = true; status.textContent = 'Sending…';
    const {error} = await db.rpc('cc_send_webmaster_request', {p_kind: kind.value, p_event_id: kind.value === 'event_change' ? (eventPick.value || null) : null, p_message: message.value});
    send.disabled = false;
    if (error) { status.textContent = error.message; return }
    await render();
    document.getElementById('wmStatus').textContent = 'Sent. You can see it below until the webmaster marks it done.';
  };

  const r = await db.from('cc_webmaster_requests').select('id,kind,event_id,message,status,created_at,requested_by').order('created_at', {ascending: false}).limit(40);
  const list = el('div', {id: 'wmList'});
  if (r.error) list.append(el('p', {className: 'small muted'}, 'Requests are not set up yet. Run webmaster-requests-migration.sql in Supabase.'));
  else if (!r.data.length) list.append(el('p', {className: 'small muted'}, 'No requests yet.'));
  else {
    const titleOf = new Map(events.map(e => [e.id, e.title]));
    for (const x of r.data) {
      const what = LABEL[x.kind] + (x.event_id && titleOf.get(x.event_id) ? ': ' + titleOf.get(x.event_id) : '');
      const row = el('div', {className: 'list-item'}, el('div', {}, el('strong', {}, what), el('div', {className: 'small muted'}, (x.status === 'done' ? 'Done' : 'Waiting') + ' · ' + fmt(x.created_at)), x.message ? el('p', {}, x.message) : ''));
      if (isWebmaster && x.status === 'open') {
        const b = el('button', {className: 'btn secondary', type: 'button'}, 'Mark done');
        b.onclick = async () => { b.disabled = true; const {error} = await db.rpc('cc_finish_webmaster_request', {p_id: x.id}); if (error) { b.disabled = false; document.getElementById('wmStatus').textContent = error.message; return } await render() };
        row.append(b);
      }
      list.append(row);
    }
  }
  const open = r.error ? 0 : r.data.filter(x => x.status === 'open').length;
  host.append(el('h2', {}, 'Message to the webmaster'), el('p', {className: 'muted'}, 'The church website is kept by your webmaster. Tell them here what needs to change: a new event, a change, a photo, or anything else.'), form, el('h3', {}, isWebmaster ? 'Requests (' + open + ' waiting)' : 'Your requests'), list);
  document.dispatchEvent(new CustomEvent('cc:webmaster-count', {detail: open}));
}

if (db && host) {
  const draw = () => render().catch(err => { host.textContent = 'Could not load webmaster requests: ' + (err.message || err) });
  draw();
  document.addEventListener('cc:webmaster-refresh', draw);
  db.auth.onAuthStateChange(event => { if (event === 'SIGNED_IN') setTimeout(draw, 0) });
}
