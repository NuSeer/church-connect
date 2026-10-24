// Administration Center: young members and guardians. An administrator records a date of birth and links a parent or guardian.
// Members under 18 cannot start private chats with adults. A linked guardian can read (not reply in) their conversations.
import {db} from './data.js';

const host = document.getElementById('youthSafety');

function el(tag, props = {}, ...kids) { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n }

async function render() {
  if (!host || !db) return;
  const {data: {session}} = await db.auth.getSession();
  if (!session) return;
  if ((await db.rpc('cc_is_admin')).data !== true) { host.classList.add('hidden'); return }
  const probe = await db.from('cc_guardians').select('youth_id').limit(1);
  if (probe.error) { host.classList.add('hidden'); return }  // the safety update has not been run on this project yet
  host.classList.remove('hidden'); host.replaceChildren();
  host.append(el('h2', {textContent: 'Young members and guardians'}),
    el('p', {className: 'muted small', textContent: 'Members under 18 cannot start private chats with adults. They can use approved ministry groups. A linked guardian can read (not reply in) their conversations. A member with no date of birth saved is treated as an adult.'}));
  const [people, safety, guards] = await Promise.all([
    db.from('member_profiles').select('user_id,display_name').eq('approved', true).order('display_name'),
    db.from('cc_member_safety').select('user_id,birth_date'),
    db.from('cc_guardians').select('youth_id,guardian_id')]);
  if (people.error) { host.append(el('p', {className: 'small muted', textContent: people.error.message})); return }
  const list = people.data || [], name = id => list.find(x => x.user_id === id)?.display_name || 'A member';
  const birth = new Map((safety.data || []).map(x => [x.user_id, x.birth_date]));
  const say = el('p', {className: 'small muted'}); say.setAttribute('aria-live', 'polite');
  const member = el('select', {id: 'youthMember'}, new Option('Choose a member', ''), ...list.map(x => new Option(x.display_name, x.user_id)));
  const dob = el('input', {type: 'date', id: 'youthDob'});
  member.onchange = () => { dob.value = birth.get(member.value) || '' };
  const saveDob = el('button', {className: 'btn secondary', type: 'button', textContent: 'Save date of birth', onclick: async () => {
    if (!member.value) return say.textContent = 'Choose a member first.';
    const {error} = await db.rpc('cc_admin_set_birth_date', {p_user: member.value, p_date: dob.value || null});
    say.textContent = error ? 'Not saved: ' + error.message : 'Saved.'; if (!error) await render();
  }});
  const guardian = el('select', {id: 'youthGuardian'}, new Option('Choose the parent or guardian', ''), ...list.map(x => new Option(x.display_name, x.user_id)));
  const link = el('button', {className: 'btn secondary', type: 'button', textContent: 'Link guardian', onclick: async () => {
    if (!member.value || !guardian.value) return say.textContent = 'Choose the young member and the guardian.';
    const {error} = await db.rpc('cc_set_guardian', {p_youth: member.value, p_guardian: guardian.value, p_on: true});
    say.textContent = error ? 'Not saved: ' + error.message : 'Linked.'; if (!error) await render();
  }});
  host.append(el('div', {className: 'cc-youth'}, el('label', {}, 'Member', member), el('label', {}, 'Date of birth', dob), saveDob, el('label', {}, 'Parent or guardian', guardian), link), say);
  const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 18);
  const youths = list.filter(x => birth.get(x.user_id) && new Date(birth.get(x.user_id)) > cutoff);
  host.append(el('h3', {textContent: 'Members under 18'}));
  if (!youths.length) host.append(el('p', {className: 'small muted', textContent: 'No members under 18 are recorded.'}));
  for (const y of youths) {
    const links = (guards.data || []).filter(g => g.youth_id === y.user_id);
    const row = el('div', {className: 'list-item'}, el('span', {textContent: `${y.display_name} · born ${birth.get(y.user_id)} · guardian: ${links.length ? links.map(g => name(g.guardian_id)).join(', ') : 'none linked'}`}));
    for (const g of links) row.append(el('button', {className: 'btn secondary', type: 'button', textContent: 'Unlink ' + name(g.guardian_id), onclick: async () => {
      const {error} = await db.rpc('cc_set_guardian', {p_youth: y.user_id, p_guardian: g.guardian_id, p_on: false});
      if (error) { say.textContent = error.message; return } await render();
    }}));
    host.append(row);
  }
}

render();
db?.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_IN') render() });
