// "Send to pastoral care": a confidential message that goes ONLY to the people named on the screen before it is sent.
// Needs church-groups-migration.sql.
import {db} from './data.js';

const button = document.getElementById('pastoralCare');
const dialog = document.getElementById('careDialog');
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n };
const TOPICS = ['Prayer request', 'Counseling or advice', 'Hospital or home visit', 'Something else'];

async function openCare() {
  dialog.replaceChildren(el('h2', {textContent: 'Send to pastoral care'}));
  const r = await db.rpc('cc_care_recipients');
  if (r.error) { dialog.append(el('p', {textContent: 'Pastoral care messages need the latest database update.'}), el('button', {className: 'btn secondary', type: 'button', textContent: 'Close', onclick: () => dialog.close()})); dialog.showModal(); return }
  const names = (r.data || []).map(x => x.display_name);
  if (!names.length) { dialog.append(el('p', {textContent: 'No one is set up to receive pastoral care messages yet. Please contact the church office.'}), el('button', {className: 'btn secondary', type: 'button', textContent: 'Close', onclick: () => dialog.close()})); dialog.showModal(); return }
  const topic = el('select', {id: 'careTopic'}, ...TOPICS.map(t => new Option(t, t)));
  const body = el('textarea', {id: 'careBody', rows: 5, maxLength: 4000, required: true, placeholder: 'Write what you would like them to know or pray about.'});
  const note = el('p', {className: 'small muted', textContent: 'No one else can see this: not other members, and not other staff. It is a private conversation between you and the people above, and they will answer you here in Messages.'});
  const status = el('p', {className: 'small', ariaLive: 'polite'}); status.setAttribute('aria-live', 'polite');
  const form = el('form', {}, el('p', {id: 'careWho'}, el('strong', {textContent: 'This goes only to: '}), names.join(', ') + '.'),
    el('label', {}, 'What is it about?', topic), el('label', {}, 'Your message', body), note,
    el('div', {className: 'actions'}, el('button', {className: 'btn', type: 'submit', textContent: 'Send privately'}), el('button', {className: 'btn secondary', type: 'button', textContent: 'Cancel', onclick: () => dialog.close()})), status);
  form.onsubmit = async ev => {
    ev.preventDefault(); status.textContent = 'Sending…';
    const {data, error} = await db.rpc('cc_send_pastoral_care', {p_topic: topic.value, p_body: body.value.trim()});
    if (error) { status.textContent = 'Not sent: ' + error.message; return }
    dialog.close();
    document.dispatchEvent(new CustomEvent('cc:open-chat', {detail: {id: data, reload: true}}));
  };
  dialog.append(form); dialog.showModal();
}
if (button && dialog && db) button.onclick = () => openCare().catch(e => { document.getElementById('notice').textContent = e.message });
