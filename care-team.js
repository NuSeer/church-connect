// Administration Center: who receives pastoral care messages. With nobody chosen, they go to the church's pastors (or its administrators).
import {db} from './data.js';

const host = document.getElementById('careTeam');
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n };

async function render() {
  if (!host || !db) return;
  const {data: {session}} = await db.auth.getSession();
  if (!session) return;
  if ((await db.rpc('cc_is_admin')).data !== true) { host.classList.add('hidden'); return }
  const team = await db.rpc('cc_care_team_list');
  if (team.error) { host.classList.add('hidden'); return }   // the update has not been run on this project yet
  host.classList.remove('hidden'); host.replaceChildren();
  host.append(el('h2', {textContent: 'Pastoral care team'}),
    el('p', {className: 'muted small', textContent: 'Members send a confidential "pastoral care" message from the Messages tab. It is seen only by the sender and the people listed here. If no one is listed, it goes to the church\'s pastors, or to the administrators if there are no pastors. Members always see the names before they send.'}));
  const say = el('p', {className: 'small muted'}); say.setAttribute('aria-live', 'polite');
  for (const t of team.data || []) host.append(el('div', {className: 'list-item'}, el('span', {textContent: t.display_name}),
    el('button', {className: 'btn secondary', type: 'button', textContent: 'Remove', onclick: async () => { const {error} = await db.rpc('cc_set_care_member', {p_user: t.user_id, p_on: false}); if (error) { say.textContent = error.message; return } await render() }})));
  if (!(team.data || []).length) host.append(el('p', {className: 'small muted', textContent: 'No team chosen. Messages go to the pastors.'}));
  const people = await db.from('member_profiles').select('user_id,display_name').eq('approved', true).order('display_name');
  const pick = el('select', {id: 'careMember'}, new Option('Choose a member', ''), ...(people.data || []).filter(p => !(team.data || []).some(t => t.user_id === p.user_id)).map(p => new Option(p.display_name, p.user_id)));
  host.append(el('label', {}, 'Add a member to the team', pick), el('button', {className: 'btn secondary', type: 'button', textContent: 'Add to team', onclick: async () => {
    if (!pick.value) { say.textContent = 'Choose a member first.'; return }
    const {error} = await db.rpc('cc_set_care_member', {p_user: pick.value, p_on: true}); if (error) { say.textContent = error.message; return } await render();
  }}), say);
}
render();
db?.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_IN') render() });
