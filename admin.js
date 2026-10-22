import {db,configured,escapeHTML as e,fmt} from './data.js';
const $=id=>document.getElementById(id);let events=[],announcements=[];
function status(message,error=false){$('status').innerHTML=`<div class="notice" style="${error?'background:#fff0ed;border-color:#e7b2a8':''}">${e(message)}</div>`}
function localDate(iso){const d=new Date(iso),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`}
async function verify(){if(!db){$('login').classList.add('hidden');status('Setup required: add Supabase project URL and anon key to config.js, then run schema.sql. No insecure local password fallback is enabled.',true);return}const {data:{user}}=await db.auth.getUser();if(!user){$('login').classList.remove('hidden');$('workspace').classList.add('hidden');$('logout').classList.add('hidden');return}const {data,error}=await db.from('church_admins').select('user_id').eq('user_id',user.id).maybeSingle();if(error||!data){await db.auth.signOut();status('This account does not have administrator access.',true);return}$('login').classList.add('hidden');$('workspace').classList.remove('hidden');$('logout').classList.remove('hidden');await load()}
document.querySelectorAll('[data-toggle-password]').forEach(button=>button.addEventListener('click',()=>{const input=$(button.dataset.togglePassword);const reveal=input.type==='password';input.type=reveal?'text':'password';button.textContent=reveal?'Hide':'Show';button.setAttribute('aria-label',reveal?'Hide password':'Show password');button.setAttribute('aria-pressed',String(reveal))}));
$('loginForm').onsubmit=async ev=>{ev.preventDefault();const {error}=await db.auth.signInWithPassword({email:$('email').value,password:$('password').value});$('password').value='';if(error)status(error.message,true);else{status('Signed in.');await verify()}};
$('logout').onclick=async()=>{await db.auth.signOut();status('Signed out.');await verify()};
async function load(){const [a,b]=await Promise.all([db.from('church_events').select('*').order('starts_at'),db.from('church_announcements').select('*').order('created_at',{ascending:false})]);if(a.error||b.error){status((a.error||b.error).message,true);return}events=a.data;announcements=b.data;render();await loadFeed()}
function render(){ fillEventPick();$('announcementList').innerHTML=announcements.length?announcements.map(x=>`<div class="list-item"><div><h3>${e(x.title)}</h3><div class="small muted">${x.pinned?'Featured · ':''}${x.published?'Published':'Draft'} · ${fmt(x.created_at)}</div></div><div class="actions"><button class="btn secondary" data-type="announcement" data-edit="${x.id}">Edit</button><button class="btn danger" data-type="announcement" data-delete="${x.id}">Delete</button></div></div>`).join(''):'<p class="muted">No announcements yet.</p>'}
function pickState(){const item=events.find(x=>x.id===$('eventPick').value),site=!!item&&item.source==='website';$('eventEdit').disabled=$('eventDelete').disabled=!item||site;$('eventAsk').hidden=!site}
function fillEventPick(){const sel=$('eventPick'),prev=sel.value;sel.replaceChildren(new Option('Choose an event',''));events.forEach(x=>sel.add(new Option(x.title+' · '+fmt(x.starts_at)+(x.source==='website'?' (from website)':''),x.id)));if(events.some(x=>x.id===prev))sel.value=prev;pickState()}
$('eventPick').onchange=pickState;
$('eventAsk').onclick=()=>{const id=$('eventPick').value,k=document.getElementById('wmKind'),e=document.getElementById('wmEvent');if(!k||!e)return;k.value='event_change';k.dispatchEvent(new Event('change'));e.value=id;document.getElementById('webmasterRequests').scrollIntoView({behavior:'smooth'});document.getElementById('wmMessage')?.focus()};
$('eventEdit').onclick=()=>{const item=events.find(x=>x.id===$('eventPick').value);if(!item)return;$('eventId').value=item.id;$('eventTitle').value=item.title;$('eventDescription').value=item.description||'';$('eventStart').value=localDate(item.starts_at);$('eventLocation').value=item.location||'';$('eventRepeat').value=item.recurrence;$('eventPublished').value=String(item.published);$('eventHeading').textContent='Edit event';$('eventForm').scrollIntoView({behavior:'smooth'})};
$('eventDelete').onclick=async()=>{const item=events.find(x=>x.id===$('eventPick').value);if(!item||!confirm('Permanently delete "'+item.title+'"?'))return;const {error}=await db.from('church_events').delete().eq('id',item.id);if(error)return status(error.message,true);status('Deleted.');await load()};
function clear(type){$(type+'Form').reset();$(type+'Id').value='';$(type+'Heading').textContent='Create an '+type}
$('resetEvent').onclick=()=>clear('event');$('resetAnnouncement').onclick=()=>clear('announcement');
$('eventForm').onsubmit=async ev=>{ev.preventDefault();const id=$('eventId').value;const value={title:$('eventTitle').value.trim(),description:$('eventDescription').value.trim(),starts_at:new Date($('eventStart').value).toISOString(),location:$('eventLocation').value.trim(),recurrence:$('eventRepeat').value,published:$('eventPublished').value==='true'};const q=id?db.from('church_events').update(value).eq('id',id):db.from('church_events').insert(value).select('id').single();const {data:saved,error}=await q;if(error)return status(error.message,true);clear('event');let note='';if(!id&&saved?.id){const r=await db.rpc('cc_send_webmaster_request',{p_kind:'event',p_event_id:saved.id,p_message:'New event: '+value.title+'. Please list it on the church website.'});note=r.error?' The webmaster could not be told: '+r.error.message:' The webmaster has been asked to list it on the church website.'}status('Event saved successfully.'+note);await load();document.dispatchEvent(new Event('cc:webmaster-refresh'))};
$('announcementForm').onsubmit=async ev=>{ev.preventDefault();const id=$('announcementId').value;const value={title:$('announcementTitle').value.trim(),body:$('announcementBody').value.trim(),pinned:$('announcementPinned').value==='true',published:$('announcementPublished').value==='true'};const q=id?db.from('church_announcements').update(value).eq('id',id):db.from('church_announcements').insert(value);const {error}=await q;if(error)return status(error.message,true);clear('announcement');status('Announcement saved successfully.');await load()};
document.addEventListener('click',async ev=>{const b=ev.target.closest('[data-edit],[data-delete]');if(!b)return;const type=b.dataset.type,items=type==='event'?events:announcements,table=type==='event'?'church_events':'church_announcements',id=b.dataset.edit||b.dataset.delete,item=items.find(x=>x.id===id);if(!item)return;if(b.dataset.delete){if(!confirm('Permanently delete this '+type+'?'))return;const {error}=await db.from(table).delete().eq('id',id);if(error)status(error.message,true);else{status('Deleted.');await load()}return}if(type==='event'){$('eventId').value=item.id;$('eventTitle').value=item.title;$('eventDescription').value=item.description;$('eventStart').value=localDate(item.starts_at);$('eventLocation').value=item.location;$('eventRepeat').value=item.recurrence;$('eventPublished').value=String(item.published)}else{$('announcementId').value=item.id;$('announcementTitle').value=item.title;$('announcementBody').value=item.body;$('announcementPinned').value=String(item.pinned);$('announcementPublished').value=String(item.published)}$(''+type+'Heading').textContent='Edit '+type;document.querySelector(`[data-tab="${type==='event'?'events':'announcements'}"]`).click();$(type+'Form').scrollIntoView({behavior:'smooth'})});
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===b));$('eventsPanel').classList.toggle('hidden',b.dataset.tab!=='events');$('announcementsPanel').classList.toggle('hidden',b.dataset.tab!=='announcements')});
await verify();

// ---- Events from the church website (feed address + Sync now) ----
function feedMessage(text,bad=false){$('feedStatus').textContent=text;$('feedStatus').style.color=bad?'#b91c1c':''}
async function loadFeed(){
 const id=(await db.rpc('cc_my_church_id')).data;if(!id)return;
 const {data}=await db.from('churches').select('events_feed_url,events_timezone,events_synced_at,events_sync_status').eq('id',id).maybeSingle();if(!data)return;
 $('feedUrl').value=data.events_feed_url||'';if(data.events_timezone)$('feedZone').value=data.events_timezone;
 $('feedSync').disabled=!data.events_feed_url;
 feedMessage(data.events_feed_url?`${data.events_sync_status||'Not synced yet'}${data.events_synced_at?' · last checked '+fmt(data.events_synced_at):''}`:'No website address set yet.');
}
$('feedForm').onsubmit=async ev=>{
 ev.preventDefault();const url=$('feedUrl').value.trim();
 const {error}=await db.rpc('cc_set_events_feed',{p_url:url,p_timezone:$('feedZone').value});
 if(error)return feedMessage(error.message,true);
 await loadFeed();feedMessage(url?'Address saved. Press Sync now to copy your events.':'Address removed. Events already copied stay until you delete them.');
};
$('feedDetect').onclick=async()=>{
 $('feedDetect').disabled=true;feedMessage('Looking for your events list…');
 const {data,error}=await db.functions.invoke('sync-website-events',{body:{detect:true}});
 let msg=null;if(error){msg=error.message;try{msg=(await error.context.json()).error||msg}catch{}}else if(data&&data.found===false)msg=data.error||'No events list found.';
 $('feedDetect').disabled=false;await loadFeed();await load();
 if(msg)return feedMessage(msg,true);
 feedMessage('Found it and copied '+data.synced+' events from '+data.feed);
};
$('feedSync').onclick=async()=>{
 $('feedSync').disabled=true;feedMessage('Reading your website…');
 const {data,error}=await db.functions.invoke('sync-website-events',{body:{}});
 let msg=null;if(error){msg=error.message;try{msg=(await error.context.json()).error||msg}catch{}}else if(data&&data.ok===false)msg=data.error;
 await load();if(msg)feedMessage(msg,true);
};
