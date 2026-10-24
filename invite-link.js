// Administration Center: a link to share so people can join Church Connect. It costs nothing (it is just the app's address).
// New members still sign up and wait for approval, so sharing it widely is safe.
const host = document.getElementById('inviteLink');
if (host) {
  const link = new URL('connect.html', location.href).href;
  const church = document.querySelector('[data-church]')?.textContent || 'our church';
  const text = `Join ${church} on Church Connect: ${link}  Tap "Create account", then wait for approval. Church Connect is where we message, share events and pray together.`;
  const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n };
  const say = el('p', {className: 'small muted'}); say.setAttribute('aria-live', 'polite');
  const field = el('input', {readOnly: true, value: link, id: 'inviteUrl'}); field.setAttribute('aria-label', 'Invite link');
  const copy = async (value, done) => { try { await navigator.clipboard.writeText(value); say.textContent = done } catch { field.select(); say.textContent = 'Select the text and copy it.' } };
  host.append(el('h2', {textContent: 'Invite members'}),
    el('p', {className: 'muted small', textContent: 'Share this link by text, email or in a group. People tap it, create an account, and an administrator approves them. Using the link costs nothing.'}),
    field,
    el('div', {className: 'actions'},
      el('button', {className: 'btn', type: 'button', textContent: 'Copy link', onclick: () => copy(link, 'Link copied.')}),
      el('button', {className: 'btn secondary', type: 'button', textContent: 'Copy a ready-made message', onclick: () => copy(text, 'Message copied. Paste it into a text or email.')}),
      navigator.share ? el('button', {className: 'btn secondary', type: 'button', textContent: 'Share…', onclick: () => navigator.share({title: church, text, url: link}).catch(() => {})}) : ''),
    say);
}
