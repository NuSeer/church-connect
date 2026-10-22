// First-time tips: each section's introduction shows once with a "Got it" button, then stays hidden.
// The Help tab lists them all again, and only the ones for the sections this person can actually see (Broadcast and Admin are role-based).
const KEY = 'cc-intro-seen';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] } };
const write = list => { try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* private window: tips just show again next time */ } };
const GATE = {broadcast: 'broadcastTab', admin: 'adminTab'};
const tips = [...document.querySelectorAll('.view .cc-intro')].map(node => ({id: node.closest('.view').id, html: node.innerHTML, node}));

function dismiss(id) { const seen = read(); if (!seen.includes(id)) write([...seen, id]) }
for (const tip of tips) {
  if (tip.id === 'help') continue;
  if (read().includes(tip.id)) { tip.node.classList.add('hidden'); continue }
  const b = document.createElement('button'); b.type = 'button'; b.className = 'btn secondary cc-gotit'; b.textContent = 'Got it';
  b.onclick = () => { dismiss(tip.id); tip.node.classList.add('hidden') };
  tip.node.append(' ', b);
}

function renderHelp() {
  const box = document.getElementById('helpList'); box.replaceChildren();
  for (const tip of tips) {
    const gate = GATE[tip.id];
    if (gate && document.getElementById(gate)?.classList.contains('hidden')) continue;
    const item = document.createElement('p'); item.className = 'cc-intro cc-help-item'; item.innerHTML = tip.html; box.append(item);
  }
}
document.querySelector('[data-view="help"]').addEventListener('click', renderHelp);
document.getElementById('helpReset').onclick = () => {
  write([]); for (const tip of tips) { if (tip.id !== 'help') tip.node.classList.remove('hidden') }
  document.getElementById('helpStatus').textContent = 'Done. Each section will show its tip again.';
};
