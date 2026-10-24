// A ministry's home: Schedule (activity cards with RSVP, files and a discussion), Chat, Files and Members.
// Needs church-groups-migration.sql. Leaders (and administrators) can change the schedule and add files; everyone in the ministry can answer and read.
import {fmt} from './data.js';

const BUCKET = 'ministry-files';
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n };
const btn = (text, onclick, cls = 'btn secondary') => el('button', {type: 'button', className: cls, textContent: text, onclick});
const localInput = iso => { const d = new Date(iso), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}` };
const safeName = name => String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);

export async function renderMinistryHome({db, me, member, box, openChat, openDiscussion}) {
  const ministryId = member.ministry_id, name = member.ministries?.name || 'Ministry';
  const leader = !!member.is_leader;           // administrators are also treated as leaders by the database
  let tab = 'schedule', editing = null, status = el('p', {className: 'small muted'});
  status.setAttribute('aria-live', 'polite');
  const say = t => { status.textContent = t || '' };

  async function load() {
    const [acts, files, over, roster] = await Promise.all([
      db.from('ministry_activities').select('*').eq('ministry_id', ministryId).order('starts_at'),
      db.from('cc_activity_files').select('*').eq('ministry_id', ministryId).order('created_at', {ascending: false}),
      db.rpc('cc_activity_overview', {p_ministry: ministryId}),
      db.rpc('cc_ministry_roster', {p_ministry: ministryId})]);
    return {acts: acts.data || [], files: files.error ? [] : files.data || [], over: new Map((over.data || []).map(x => [x.activity_id, x])), roster: roster.data || [], upgraded: !files.error && !over.error};
  }

  async function open(path) {
    const r = await db.storage.from(BUCKET).createSignedUrl(path, 600);
    if (r.error) return say(r.error.message);
    window.open(r.data.signedUrl, '_blank', 'noopener');
  }
  async function upload(file, activityId) {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) return say('Files can be up to 15 MB.');
    say('Uploading…');
    const path = `${ministryId}/${activityId || 'general'}/${crypto.randomUUID()}-${safeName(file.name)}`;
    const up = await db.storage.from(BUCKET).upload(path, file, {contentType: file.type || undefined});
    if (up.error) return say('Not uploaded: ' + up.error.message);
    const {error} = await db.rpc('cc_add_activity_file', {p_ministry: ministryId, p_activity: activityId || null, p_path: path, p_name: file.name, p_mime: file.type || null, p_size: file.size});
    if (error) { await db.storage.from(BUCKET).remove([path]); return say('Not saved: ' + error.message) }
    say('File added.'); await draw();
  }
  async function removeFile(f) {
    if (!confirm('Remove "' + f.name + '" for everyone?')) return;
    const {data, error} = await db.rpc('cc_remove_activity_file', {p_id: f.id});
    if (error) return say(error.message);
    await db.storage.from(BUCKET).remove([data]); say('File removed.'); await draw();
  }
  function fileRow(f, canRemove) {
    const row = el('div', {className: 'list-item'}, el('span', {textContent: f.name + ' · ' + fmt(f.created_at)}));
    const actions = el('div', {className: 'actions'}, btn('Open', () => open(f.path)));
    if (canRemove) actions.append(btn('Remove', () => removeFile(f)));
    row.append(actions); return row;
  }

  function scheduleForm(data) {
    const f = el('form', {className: 'cc-activity-form'});
    const title = el('input', {required: true, maxLength: 180, value: editing?.title || '', placeholder: 'Choir rehearsal'});
    const when = el('input', {type: 'datetime-local', required: true, value: editing ? localInput(editing.starts_at) : ''});
    const details = el('textarea', {rows: 2, value: editing?.details || '', placeholder: 'Where, what to bring, what to practice'});
    const notify = el('input', {type: 'checkbox', checked: true});
    f.append(el('h4', {textContent: editing ? 'Change this activity' : 'Add to the schedule'}),
      el('label', {}, 'What', title), el('label', {}, 'Date and time', when), el('label', {}, 'Details', details),
      el('label', {className: 'checkline'}, notify, ' Tell the group (a message in the discussion and a phone alert)'),
      el('div', {className: 'actions'}, el('button', {className: 'btn', type: 'submit', textContent: editing ? 'Save changes' : 'Add activity'}), editing ? btn('Cancel', () => { editing = null; draw() }) : ''));
    f.onsubmit = async ev => {
      ev.preventDefault(); say('Saving…');
      const {error} = await db.rpc('cc_save_ministry_activity', {p_id: editing?.id || null, p_ministry: ministryId, p_title: title.value.trim(), p_details: details.value.trim(), p_starts_at: new Date(when.value).toISOString(), p_notify: notify.checked});
      if (error) return say('Not saved: ' + error.message);
      editing = null; say('Saved.'); await draw();
    };
    return f;
  }

  function activityCard(a, data) {
    const card = el('div', {className: 'cc-activity-card'});
    const o = data.over.get(a.id) || {going: 0, maybe: 0, unable: 0, mine: null};
    card.append(el('h4', {textContent: a.title}), el('div', {className: 'small muted', textContent: fmt(a.starts_at)}));
    if (a.details) card.append(el('p', {textContent: a.details}));
    const count = el('span', {className: 'small muted', textContent: `${o.going} going${o.maybe ? ', ' + o.maybe + ' maybe' : ''}${o.unable ? ', ' + o.unable + " can't go" : ''}`});
    const rsvp = el('div', {className: 'rsvp'}, count, el('br'));
    for (const [v, text] of [['going', 'Going'], ['maybe', 'Maybe'], ['unable', "Can't go"]]) {
      const b = btn(text, async () => {
        const {error} = await db.rpc('cc_activity_rsvp', {p_activity: a.id, p_response: o.mine === v ? null : v});
        if (error) return say(error.message); await draw();
      }, 'btn secondary rsvp-btn' + (o.mine === v ? ' chosen' : ''));
      b.setAttribute('aria-pressed', String(o.mine === v)); rsvp.append(b);
    }
    if (leader) rsvp.append(btn('Who is coming', async ev => {
      const r = await db.rpc('cc_activity_rsvp_names', {p_activity: a.id});
      const p = el('p', {className: 'small', textContent: r.error ? r.error.message : (r.data || []).length ? r.data.map(n => `${n.display_name} (${({going: 'going', maybe: 'maybe', unable: "can't go"})[n.response]})`).join(', ') : 'No answers yet.'});
      ev.target.replaceWith(p);
    }));
    card.append(rsvp);
    const files = data.files.filter(f => f.activity_id === a.id);
    if (files.length || leader) {
      card.append(el('h5', {textContent: 'Files'}));
      for (const f of files) card.append(fileRow(f, leader));
      if (!files.length) card.append(el('p', {className: 'small muted', textContent: 'No files yet.'}));
      if (leader) {
        const input = el('input', {type: 'file', hidden: true, accept: 'image/*,application/pdf,text/plain,audio/*,video/mp4,.doc,.docx'});
        input.onchange = () => upload(input.files[0], a.id);
        card.append(el('label', {className: 'btn secondary file-btn'}, 'Add a file (music, sheet, flyer)', input));
      }
    }
    const row = el('div', {className: 'actions'});
    if (a.conversation_id) row.append(btn('Discussion', () => openDiscussion(a.conversation_id, a.title)));
    else if (leader) row.append(btn('Start a discussion', async () => { const r = await db.rpc('cc_ensure_activity_discussion', {p_activity: a.id}); if (r.error) return say(r.error.message); await draw() }));
    if (leader) row.append(btn('Change', () => { editing = a; draw() }), btn('Delete', async () => {
      if (!confirm('Delete "' + a.title + '"? Its discussion stays in the chat history but is closed.')) return;
      for (const f of files) await db.storage.from(BUCKET).remove([f.path]);
      const {error} = await db.rpc('cc_delete_ministry_activity', {p_id: a.id}); if (error) return say(error.message); await draw();
    }));
    card.append(row); return card;
  }

  async function draw() {
    const data = await load();
    box.replaceChildren();
    const now = Date.now() - 86400000;
    box.append(el('h3', {textContent: name}));
    if (!data.upgraded) box.append(el('p', {className: 'small muted', textContent: 'The new ministry features need the latest database update. The schedule below still works.'}));
    const bar = el('div', {className: 'me-nav', role: 'tablist'});
    for (const [id, label] of [['schedule', 'Schedule'], ['chat', 'Chat'], ['files', 'Files'], ['members', 'Members']]) {
      const b = el('button', {type: 'button', className: 'chip' + (tab === id ? ' active' : ''), textContent: label, onclick: () => { if (id === 'chat') return openChat(); tab = id; draw() }});
      b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(tab === id)); bar.append(b);
    }
    box.append(bar, status);
    if (tab === 'schedule') {
      const upcoming = data.acts.filter(a => new Date(a.starts_at) >= now), past = data.acts.filter(a => new Date(a.starts_at) < now).reverse();
      if (leader) box.append(scheduleForm(data));
      if (!upcoming.length) box.append(el('p', {className: 'muted', textContent: 'Nothing is scheduled yet.'}));
      for (const a of upcoming) box.append(activityCard(a, data));
      if (past.length) { const d = el('details', {}, el('summary', {textContent: `Earlier activities (${past.length})`})); for (const a of past.slice(0, 10)) d.append(activityCard(a, data)); box.append(d) }
    } else if (tab === 'files') {
      const general = data.files.filter(f => !f.activity_id), byActivity = data.files.filter(f => f.activity_id);
      box.append(el('h4', {textContent: 'Ministry files'}));
      if (!general.length) box.append(el('p', {className: 'small muted', textContent: 'No general files yet.'}));
      for (const f of general) box.append(fileRow(f, leader));
      if (leader) { const input = el('input', {type: 'file', hidden: true, accept: 'image/*,application/pdf,text/plain,audio/*,video/mp4,.doc,.docx'}); input.onchange = () => upload(input.files[0], null); box.append(el('label', {className: 'btn secondary file-btn'}, 'Add a file', input)) }
      box.append(el('h4', {textContent: 'Files on the schedule'}));
      if (!byActivity.length) box.append(el('p', {className: 'small muted', textContent: 'No files on activities yet.'}));
      for (const f of byActivity) { const a = data.acts.find(x => x.id === f.activity_id); const r = fileRow(f, leader); r.firstChild.textContent = (a ? a.title + ' · ' : '') + f.name; box.append(r) }
    } else if (tab === 'members') {
      if (!data.roster.length) box.append(el('p', {className: 'muted', textContent: 'No members to show.'}));
      for (const m of data.roster) box.append(el('div', {className: 'list-item'}, el('span', {textContent: m.display_name + (m.is_leader ? ' · Leader' : '')})));
    }
  }
  await draw();
}
