const ccModules=window.CHURCH_CONFIG?.modules;
if(ccModules && !ccModules.messaging && !ccModules.membership && !ccModules.ministries){
  document.body.innerHTML='<main class="admin-wrap"><h1>Member services are not enabled</h1><p>Please contact your church administrator.</p><a href="church-portal.html">Return to portal</a></main>';
  throw new Error('Member modules disabled in this deployment');
}
import {db,escapeHTML as e,fmt} from './data.js';
const $=id=>document.getElementById(id);const show=(id,on)=>$(id).classList.toggle('hidden',!on);
let me=null,profile=null,activeConversation=null,conversations=[],ministries=[],directory=[];let allMinistries=[];let approvedMinistryIds=new Set();let channel=null;let unreadCounts=new Map();
document.querySelectorAll('[data-church]').forEach(el=>el.textContent=window.CHURCH_CONFIG.name||'Your Church');
function notice(s){$('notice').textContent=s}function fail(error){notice(error?.message||String(error))}
function item(text){const d=document.createElement('div');d.className='list-item';d.textContent=text;return d}
function btn(text,handler){const b=document.createElement('button');b.className='btn secondary';b.textContent=text;b.onclick=handler;return b}
async function init(){if(!db){notice('Setup required: configure Supabase in config.js and run schema-phase3.sql.');show('signin',false);return}const {data:{user}}=await db.auth.getUser();me=user;show('signin',!me);show('portal',false);show('profileSetup',false);show('pending',false);if(!me)return;const r=await db.from('member_profiles').select('*').eq('user_id',me.id).maybeSingle();if(r.error)return fail(r.error);profile=r.data;if(!profile){show('profileSetup',true);return}if(!profile.approved){show('pending',true);return}show('portal',true);await load();await setupBroadcast();openViewFromUrl();await loadSmsPreferences();await setupPushUI();subscribe()}
let registrationMode=false;
function setRegistrationMode(on){registrationMode=on;show('confirmPasswordGroup',on);$('confirmPassword').disabled=!on;$('confirmPassword').required=on;$('password').autocomplete=on?'new-password':'current-password';$('authSubmit').textContent=on?'Create account':'Sign in';$('register').textContent=on?'Back to sign in':'Create account';$('password').value='';$('confirmPassword').value='';notice('');updatePasswordMatch()}
function updatePasswordMatch(){const status=$('passwordMatch');if(!registrationMode)return;const first=$('password').value,second=$('confirmPassword').value;status.textContent=!second?'Enter the same password twice.':first===second?'Passwords match.':'Passwords do not match.';status.classList.toggle('password-error',!!second&&first!==second)}
document.querySelectorAll('[data-toggle-password]').forEach(button=>button.addEventListener('click',()=>{const input=$(button.dataset.togglePassword);const reveal=input.type==='password';input.type=reveal?'text':'password';button.textContent=reveal?'Hide':'Show';button.setAttribute('aria-label',reveal?'Hide password':'Show password');button.setAttribute('aria-pressed',String(reveal))}));
$('password').addEventListener('input',updatePasswordMatch);$('confirmPassword').addEventListener('input',updatePasswordMatch);
$('register').onclick=()=>setRegistrationMode(!registrationMode);
$('signForm').onsubmit=async ev=>{ev.preventDefault();if(!db)return;const email=$('email').value.trim(),password=$('password').value;if(registrationMode){if(password.length<8)return notice('Use a password of at least 8 characters.');if(password!==$('confirmPassword').value)return notice('Passwords do not match. Please enter them again.');const {error}=await db.auth.signUp({email,password});$('password').value='';$('confirmPassword').value='';if(error)return fail(error);setRegistrationMode(false);notice('Account requested. Verify your email if prompted, then sign in to complete your profile.');return}const {error}=await db.auth.signInWithPassword({email,password});$('password').value='';if(error)fail(error);else await init()};
$('setupForm').onsubmit=async ev=>{ev.preventDefault();const {error}=await db.rpc('create_my_profile',{n:$('setupName').value.trim(),...(window.CHURCH_CONFIG?.churchId?{p_church:window.CHURCH_CONFIG.churchId}:{})});if(error)fail(error);else await init()};
$('pendingRefresh').onclick=init;$('logout').onclick=async()=>{if(channel)await db.removeChannel(channel);await db.auth.signOut();me=null;await init()};$('refresh').onclick=load;
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.view').forEach(x=>x.classList.toggle('hidden',x.id!==b.dataset.view))});

// ---- Church-wide broadcast (administrators and pastors only; the server enforces who may send) ----
async function setupBroadcast(){
 const {data}=await db.rpc('cc_can_broadcast');
 $('broadcastTab').classList.toggle('hidden',data!==true);
}
$('broadcastText').onchange=()=>show('broadcastTextOptions',$('broadcastText').checked);
$('broadcastForm').onsubmit=async ev=>{
 ev.preventDefault();const title=$('broadcastTitle').value.trim(),body=$('broadcastBody').value.trim();
 if(!title||!body)return;
 if(!confirm('Send this to every approved member of your church?'))return;
 $('broadcastSend').disabled=true;$('broadcastStatus').textContent='Sending…';$('broadcastSms').replaceChildren();
 const {error}=await db.rpc('cc_send_broadcast',{p_title:title,p_body:body});
 $('broadcastSend').disabled=false;
 if(error)return $('broadcastStatus').textContent='Not sent: '+error.message;
 $('broadcastStatus').textContent='Sent. Members will see it under Updates.';
 if($('broadcastText').checked)await broadcastSmsButtons(title,body);
 $('broadcastTitle').value='';$('broadcastBody').value='';await load();
};
async function broadcastSmsButtons(title,body){
 const {data,error}=await db.rpc('cc_broadcast_sms_recipients',{p_without_app:$('broadcastOnlyNoApp').checked});
 if(error)return $('broadcastStatus').textContent+' Text step unavailable: '+error.message;
 const phones=[...new Set((data||[]).map(x=>x.phone).filter(Boolean))];
 if(!phones.length){$('broadcastStatus').textContent+=' No members have agreed to receive texts yet.';return}
 const text=(title+': '+body).slice(0,300);const uri=p=>'sms:'+p+'?body='+encodeURIComponent(text);
 const link=(href,label)=>{const a=document.createElement('a');a.href=href;a.textContent=label;a.className='btn secondary';a.style.cssText='display:inline-block;margin:4px 6px 4px 0';return a};
 const box=$('broadcastSms');
 if($('broadcastSmsMode').value==='single')phones.forEach((p,i)=>box.append(link(uri(p),'Text recipient '+(i+1)+' of '+phones.length+' (ends '+p.slice(-4)+')')));
 else box.append(link(uri(phones.join(',')),'Open messaging app for '+phones.length+' recipient(s)'));
 $('broadcastStatus').textContent+=' Tap the text button(s) below to send from your phone.';
}
// Open a tab named in the address (used by notification taps, e.g. connect.html?view=updates).
function openViewFromUrl(){const v=new URLSearchParams(location.search).get('view');if(v)document.querySelector(`[data-view="${CSS.escape(v)}"]:not(.hidden)`)?.click()}
async function load(){notice('');const [dir,mm,up]=await Promise.all([db.from('member_profiles').select('user_id,display_name,bio,directory_visible,directory_contact_visible,contact_email').eq('directory_visible',true).eq('approved',true),db.from('ministry_members').select('ministry_id,is_leader,ministries(id,name,description)').eq('user_id',me.id),db.from('member_updates').select('title,body,created_at,ministry_id').order('created_at',{ascending:false}).limit(50)]);for(const x of [dir,mm,up])if(x.error)return fail(x.error);directory=dir.data;ministries=mm.data;approvedMinistryIds=new Set(ministries.map(m=>String(m.ministry_id)));await loadProfileExtras();renderDirectory();renderMinistries();$('updateList').replaceChildren(...(up.data.length?up.data.map(x=>item(`${x.title} — ${x.body} · ${fmt(x.created_at)}`)):[item('No updates yet.')]));$('displayName').value=profile.display_name;$('bio').value=profile.bio||'';$('directoryVisible').checked=profile.directory_visible;$('contactVisible').checked=profile.directory_contact_visible;$('contactEmail').value=profile.contact_email||'';await loadChats();renderComposeMinistries();await loadGiving()}
function renderDirectory(){const q=$('directorySearch').value.trim().toLowerCase();const list=q.length>=2?directory.filter(x=>x.display_name.toLowerCase().includes(q)):[];$('directoryList').replaceChildren(...(list.length?list.map(x=>{const row=document.createElement('div');row.className='list-item';const info=document.createElement('div');const strong=document.createElement('strong');strong.textContent=x.display_name;info.append(strong);if(x.bio){const d=document.createElement('p');d.textContent=x.bio;info.append(d)}if(x.directory_contact_visible&&x.contact_email){const d=document.createElement('p');d.textContent=x.contact_email;info.append(d)}row.append(info);if(x.user_id!==me.id)row.append(btn('Message',()=>startChat(x.user_id,x.display_name)));return row}):[item(q.length<2?'Enter at least two letters to search.':'No matching opt-in members.')]))}
$('directorySearch').oninput=renderDirectory;
$('profileForm').onsubmit=async ev=>{ev.preventDefault();const payload={display_name:$('displayName').value.trim(),bio:$('bio').value.trim(),directory_visible:$('directoryVisible').checked,directory_contact_visible:$('contactVisible').checked,contact_email:$('contactEmail').value.trim()||null};const {error}=await db.from('member_profiles').update(payload).eq('user_id',me.id);if(error)return fail(error);profile={...profile,...payload};try{await saveProfileExtras()}catch(err){return fail(err)}notice('Profile and privacy settings saved.');await load()};
async function startChat(userId,name){const {data,error}=await db.rpc('start_direct_chat',{recipient:userId});if(error)return fail(error);document.querySelector('[data-view="messages"]').click();await loadChats();await openChat(data,name)}
async function loadChats(){const r=await db.from('conversation_members').select('conversation_id').eq('user_id',me.id);if(r.error)return fail(r.error);const ids=r.data.map(x=>x.conversation_id);const mIds=ministries.map(x=>x.ministry_id);const [direct,groups]=await Promise.all([ids.length?db.from('conversations').select('id,kind,ministry_id').in('id',ids):{data:[]},mIds.length?db.from('conversations').select('id,kind,ministry_id').eq('kind','ministry').in('ministry_id',mIds):{data:[]}]);if(direct.error||groups.error)return fail(direct.error||groups.error);conversations=[...new Map([...direct.data,...groups.data].map(x=>[x.id,x])).values()];renderConversationList();await refreshUnread()}
function ministryColor(id){const saved=ministries.find(x=>String(x.ministry_id)===String(id))?.ministries?.color;if(saved)return saved;const colors=['#8956ce','#178f85','#d98625','#286ac1','#c45378'];let n=0;for(const c of String(id||''))n=(n*31+c.charCodeAt(0))>>>0;return colors[n%colors.length]}
function renderConversationList(){const box=$('conversationList');box.replaceChildren();for(const c of conversations){const m=ministries.find(x=>String(x.ministry_id)===String(c.ministry_id));const label=c.kind==='ministry'?(m?.ministries?.name||'Ministry'):'Private conversation';const count=unreadCounts.get(String(c.id))||0;const b=btn(label+(count?' · '+count+' unread':''),()=>openChat(c.id,label));b.classList.add('conversation-choice');if(c.kind==='ministry'){b.classList.add('ministry-conversation');b.style.setProperty('--ministry-color',ministryColor(c.ministry_id))}if(c.id===activeConversation)b.setAttribute('aria-current','true');box.append(b)}if(!conversations.length)box.append(item('No conversations yet. Select New message to begin.'))}
async function refreshUnread(){const r=await db.rpc('my_conversation_unread_counts');if(r.error){console.warn('Unread count setup required:',r.error.message);return}unreadCounts=new Map((r.data||[]).map(x=>[String(x.conversation_id),Number(x.unread_count)]));renderConversationList();const total=[...unreadCounts.values()].reduce((a,b)=>a+b,0);$('unreadBadge').textContent=total?total+' unread':'';document.title=(total?'('+total+') ':'')+'Church Connect | Member Portal'}
async function markRead(id){const r=await db.from('conversation_read_states').upsert({conversation_id:id,user_id:me.id,last_read_at:new Date().toISOString()},{onConflict:'conversation_id,user_id'});if(r.error)console.warn(r.error.message);await refreshUnread()}
async function openChat(id,title){activeConversation=id;$('conversationTitle').textContent=title;show('messageForm',true);show('composePanel',false);document.querySelector('[data-view="messages"]').click();await loadMessages();await markRead(id)}
async function loadMessages(){if(!activeConversation)return;const r=await db.from('messages').select('body,created_at,sender_id').eq('conversation_id',activeConversation).order('created_at',{ascending:true}).limit(200);if(r.error)return fail(r.error);$('messageList').replaceChildren(...r.data.map(x=>{const d=item(`${x.sender_id===me.id?'You':'Member'} · ${fmt(x.created_at)}: ${x.body}`);if(x.sender_id===me.id)d.classList.add('my-message');return d}));$('messageList').scrollTop=$('messageList').scrollHeight}
$('messageForm').onsubmit=async ev=>{ev.preventDefault();const body=$('messageBody').value.trim();if(!body||!activeConversation)return;const {error}=await db.from('messages').insert({conversation_id:activeConversation,sender_id:me.id,body});if(error)return fail(error);$('messageBody').value='';await loadMessages();await markRead(activeConversation);if($('alsoText').checked)await preparePhoneSms(body,activeConversation)};
function renderMinistries(){const box=$('ministryList');box.replaceChildren(...(ministries.length?ministries.map(m=>{const row=document.createElement('div');row.className='list-item';const t=document.createElement('div');t.textContent=m.ministries?.name+(m.is_leader?' · Leader':'');row.append(t,btn('Open workspace',()=>openMinistry(m)));return row}):[item('You have not been assigned to a ministry yet.')]))}
async function openMinistry(m){const box=$('ministryWorkspace');box.replaceChildren();const h=document.createElement('h3');h.textContent=m.ministries.name;box.append(h);const r=await db.from('ministry_activities').select('*').eq('ministry_id',m.ministry_id).order('starts_at');if(r.error)return fail(r.error);for(const a of r.data)box.append(item(`${fmt(a.starts_at)} · ${a.title} — ${a.details}`));if(!r.data.length)box.append(item('No activities scheduled.'));const c=conversations.find(x=>x.ministry_id===m.ministry_id);if(c)box.append(btn('Open ministry group chat',()=>{document.querySelector('[data-view="messages"]').click();openChat(c.id,m.ministries.name)}));if(m.is_leader){const form=document.createElement('form');form.innerHTML='<h4>Add ministry activity</h4><label>Title<input name="title" required maxlength="180"></label><label>Start date and time<input name="start" type="datetime-local" required></label><label>Details<textarea name="details"></textarea></label><button class="btn">Publish activity and update</button>';form.onsubmit=async ev=>{ev.preventDefault();const fd=new FormData(form);const title=String(fd.get('title')).trim(),details=String(fd.get('details')).trim(),starts_at=new Date(fd.get('start')).toISOString();const a=await db.from('ministry_activities').insert({ministry_id:m.ministry_id,title,details,starts_at});if(a.error)return fail(a.error);const u=await db.from('member_updates').insert({ministry_id:m.ministry_id,title:'Ministry schedule updated: '+title,body:details,created_by:me.id});if(u.error)fail(u.error);await openMinistry(m);await load()};box.append(form)}}
async function loadGiving(){const setting=await db.from('church_settings').select('donation_history_enabled').eq('id',true).maybeSingle();if(setting.error||!setting.data?.donation_history_enabled){$('givingList').textContent='Donation history is not enabled for this church.';return}const r=await db.from('donation_records').select('amount,currency,provider,donated_at').eq('donor_id',me.id).order('donated_at',{ascending:false});if(r.error)return fail(r.error);$('givingList').replaceChildren(...(r.data.length?r.data.map(x=>item(`${fmt(x.donated_at)} · ${x.amount} ${x.currency} · ${x.provider}`)):[item('No contribution records available.')]))}
function subscribe(){if(channel)db.removeChannel(channel);channel=db.channel('member-updates-'+me.id).on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},async()=>{if(activeConversation){await loadMessages();await markRead(activeConversation)}else await refreshUnread()}).on('postgres_changes',{event:'*',schema:'public',table:'member_updates'},()=>load()).on('postgres_changes',{event:'*',schema:'public',table:'ministry_activities'},()=>load()).subscribe()}

// Church Connect phase 4: searchable messaging and verified ministry membership requests.
const CHURCH_TITLES=['Pastor','First Lady','Minister','Elder','Missionary','Mother','Evangelist','Deacon','Deaconess'];
const titleState={selected:[],primary:'',mode:'title',courtesy:'Sis.'};
function updateTitleUI(){const official=titleState.mode==='title';show('titleOptions',official);show('courtesyOptions',!official);const primary=$('primaryTitle');primary.replaceChildren(new Option('Choose primary title',''));for(const t of titleState.selected)primary.add(new Option(t,t));primary.value=titleState.selected.includes(titleState.primary)?titleState.primary:'';}
function renderTitleChoices(){const box=$('titleChecks');box.replaceChildren();for(const t of CHURCH_TITLES){const label=document.createElement('label');label.className='checkline';const check=document.createElement('input');check.type='checkbox';check.checked=titleState.selected.includes(t);check.onchange=()=>{titleState.selected=check.checked?[...titleState.selected,t]:titleState.selected.filter(x=>x!==t);if(!titleState.selected.includes(titleState.primary))titleState.primary='';updateTitleUI()};label.append(check,document.createTextNode(' '+t));box.append(label)}updateTitleUI()}
document.querySelectorAll('[name="titleMode"]').forEach(x=>x.onchange=()=>{titleState.mode=x.value;updateTitleUI()});
$('primaryTitle').onchange=()=>titleState.primary=$('primaryTitle').value;
$('courtesyTitle').onchange=()=>titleState.courtesy=$('courtesyTitle').value;
async function loadProfileExtras(){
  const {data:extras,error}=await db.from('member_church_titles').select('titles,primary_title,title_mode,courtesy_title,verified_titles').eq('user_id',me.id).maybeSingle();
  if(error){$('titleChecks').textContent='Church titles require the phase 4 database migration.';return}
  titleState.selected=extras?.titles||[];titleState.primary=extras?.primary_title||'';titleState.mode=extras?.title_mode||'none';titleState.courtesy=extras?.courtesy_title||'Sis.';
  document.querySelectorAll('[name="titleMode"]').forEach(x=>x.checked=x.value===titleState.mode);$('courtesyTitle').value=titleState.courtesy;renderTitleChoices();
  const [all,requests]=await Promise.all([db.from('ministries').select('id,name').order('name'),db.from('ministry_join_requests').select('ministry_id,status').eq('user_id',me.id)]);
  if(all.error||requests.error){$('ministryRequests').textContent='Ministry requests require the phase 4 database migration.';return}
  allMinistries=all.data;const box=$('ministryRequests');box.replaceChildren();
  for(const m of allMinistries){const existing=requests.data.find(x=>String(x.ministry_id)===String(m.id));const approved=approvedMinistryIds.has(String(m.id));const row=document.createElement('div');row.className='ministry-choice';const text=document.createElement('span');text.textContent=m.name+' · '+(approved?'Approved':existing?.status||'Not requested');const button=btn(approved?'Joined':existing?.status==='pending'?'Pending':'Request to join',async()=>{const {error}=await db.from('ministry_join_requests').insert({user_id:me.id,ministry_id:m.id,status:'pending'});if(error)return fail(error);notice('Membership request submitted for review.');await loadProfileExtras()});button.disabled=approved||existing?.status==='pending';row.append(text,button);box.append(row)}
}
async function saveProfileExtras(){const payload={user_id:me.id,titles:titleState.mode==='title'?titleState.selected:[],primary_title:titleState.mode==='title'?titleState.primary:null,title_mode:titleState.mode,courtesy_title:titleState.courtesy};const {data:existing}=await db.from('member_church_titles').select('user_id').eq('user_id',me.id).maybeSingle();const {user_id,...editable}=payload;const {error}=existing?await db.from('member_church_titles').update(editable).eq('user_id',me.id):await db.from('member_church_titles').insert(payload);if(error)throw error}
$('newMessage').onclick=()=>show('composePanel',$('composePanel').classList.contains('hidden'));
$('composeType').onchange=()=>{show('directCompose',$('composeType').value==='direct');show('ministryCompose',$('composeType').value==='ministry');renderComposeMinistries()};
function renderComposeMinistries(){const sel=$('composeMinistry');const old=sel.value;sel.replaceChildren(...ministries.map(m=>new Option(m.ministries?.name||'Ministry',m.ministry_id)));if([...sel.options].some(x=>x.value===old))sel.value=old;}
$('composeAudience').onchange=()=>show('ministryPerson',$('composeAudience').value==='one');
function searchRecipient(inputId,resultsId,source){const q=$(inputId).value.trim().toLowerCase();const list=q.length>=2?source.filter(x=>x.display_name?.toLowerCase().includes(q)&&x.user_id!==me.id).slice(0,15):[];$(resultsId).replaceChildren(...list.map(x=>btn(x.display_name,()=>startChat(x.user_id,x.display_name))));if(q.length>=2&&!list.length)$(resultsId).append(item('No matching eligible members.'))}
$('recipientSearch').oninput=()=>searchRecipient('recipientSearch','recipientResults',directory);
$('ministrySearch').oninput=async()=>{const ministryId=$('composeMinistry').value;if(!ministryId)return;const {data,error}=await db.from('ministry_members').select('user_id,member_profiles!inner(user_id,display_name)').eq('ministry_id',ministryId);if(error){$('ministryResults').textContent='Ministry member search requires an authorized directory policy.';return}const source=(data||[]).map(x=>x.member_profiles).filter(Boolean);searchRecipient('ministrySearch','ministryResults',source)};
$('composeMinistry').onchange=()=>{$('ministrySearch').value='';$('ministryResults').replaceChildren()};
$('openMinistryChat').onclick=async()=>{if($('composeAudience').value==='one'){notice('Search and select a ministry member for a private conversation.');return}const m=ministries.find(x=>String(x.ministry_id)===$('composeMinistry').value);if(!m)return notice('Select one of your approved ministries.');const c=conversations.find(x=>String(x.ministry_id)===String(m.ministry_id));if(!c)return notice('A ministry leader must create or enable the ministry conversation first.');show('composePanel',false);await openChat(c.id,m.ministries?.name||'Ministry')};

window.addEventListener('hashchange',openNotificationTarget);
async function openNotificationTarget(){if(!me||!profile?.approved)return;const match=location.hash.match(/^#conversation=([0-9a-f-]{36})$/i);if(!match)return;const c=conversations.find(x=>x.id===match[1]);if(!c)return notice('Conversation unavailable or access revoked.');const m=ministries.find(x=>String(x.ministry_id)===String(c.ministry_id));await openChat(c.id,c.kind==='ministry'?(m?.ministries?.name||'Ministry'):'Private conversation')}
await init();if(me&&profile?.approved)await openNotificationTarget();

// Phase 10: consent-aware phone SMS handoff. This is not an SMS gateway.
$('alsoText').onchange=()=>{show('smsModeWrap',$('alsoText').checked);show('smsTargetWrap',$('alsoText').checked)};
async function loadSmsPreferences(){if(!db||!me)return;const {data,error}=await db.from('member_sms_preferences').select('phone,opted_in,has_app').eq('user_id',me.id).maybeSingle();if(error){$('smsPreferencesStatus').textContent='Text preferences unavailable: run phase10-sms-migration.sql';return}if(data){$('smsPhone').value=data.phone||'';$('smsConsent').checked=!!data.opted_in;$('smsHasApp').checked=!!data.has_app}}
$('saveSmsPreferences').onclick=async()=>{const phone=$('smsPhone').value.trim(),consent=$('smsConsent').checked;if(phone&&!/^\+[1-9]\d{7,14}$/.test(phone))return $('smsPreferencesStatus').textContent='Enter an international-format phone number beginning with +.';if(consent&&!phone)return $('smsPreferencesStatus').textContent='Add a phone number before opting in.';const {error}=await db.from('member_sms_preferences').upsert({user_id:me.id,phone:phone||null,opted_in:consent,has_app:$('smsHasApp').checked,updated_at:new Date().toISOString()},{onConflict:'user_id'});$('smsPreferencesStatus').textContent=error?'Save failed: '+error.message:'Text preferences saved.'};
async function preparePhoneSms(body,conversationId){
 const onlyWithoutApp=$('onlyWithoutApp').checked;
 const {data,error}=await db.rpc('cc_phone_sms_recipients',{p_conversation_id:conversationId,p_without_app:onlyWithoutApp});
 if(error)return notice('In-app message sent. Text handoff unavailable: '+error.message);
 // Staff-entered members have no app account. Only administrators and ministry leaders may receive their numbers; for anyone else this call is refused, which is expected.
 const dir=await db.rpc('cc_directory_sms_recipients',{p_conversation_id:conversationId});
 const phones=[...new Set([...(data||[]),...(dir.error?[]:dir.data||[])].map(x=>x.phone).filter(Boolean))];
 if(!phones.length)return notice('In-app message sent. No eligible opted-in SMS recipients for this conversation.');
 const holder=document.createElement('div');holder.id='smsHandoff';holder.style.marginTop='10px';
 const uri=p=>'sms:'+p+'?body='+encodeURIComponent(body);
 const link=(href,text)=>{const a=document.createElement('a');a.href=href;a.textContent=text;a.className='btn secondary';a.style.cssText='display:inline-block;margin:4px 6px 4px 0';return a};
 // One at a time keeps recipients' numbers private from each other. A group text shows everyone's number to everyone.
 if($('smsMode').value==='single')phones.forEach((p,i)=>holder.append(link(uri(p),'Text recipient '+(i+1)+' of '+phones.length+' (ends '+p.slice(-4)+')')));
 else holder.append(link(uri(phones.join(',')),'Open messaging app for '+phones.length+' recipient(s)'));
 // Mobile platforms differ in multi-recipient SMS URI support; one-at-a-time is the reliable fallback.
 document.getElementById('smsHandoff')?.remove();$('smsHelp').after(holder);
 notice('In-app message sent. Tap the text button(s) to send from your phone. Phone replies will NOT appear in Church Connect.');
}
// Preferences are loaded after the member portal becomes available.

// Existing init() is called at module load, so use auth-state event for later sign-ins and a direct load now.
if(me&&profile?.approved)loadSmsPreferences();


// Push: subscribe only after an explicit user gesture. Public VAPID key is not secret.
async function setupPushUI(){
 const status=$('pushStatus'),button=$('enablePush'),off=$('disablePush');
 if(!status)return;
 if(!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window)){status.textContent='Background notifications are unavailable in this browser.';return}
 if(!window.CHURCH_CONFIG?.vapidPublicKey){status.textContent='Push setup pending: add the public VAPID key in config.js.';return}
 const reg=await navigator.serviceWorker.register('./service-worker.js');
 const sub=await reg.pushManager.getSubscription();status.textContent=sub?'Background notifications enabled on this device.':'Enable notifications to receive messages when Church Connect is closed.';
 button.disabled=false;off.disabled=!sub;
}
function b64ToBytes(value){const s=atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4));return Uint8Array.from(s,c=>c.charCodeAt(0))}
$('enablePush').onclick=async()=>{const status=$('pushStatus');try{
 if(!me||!profile?.approved)throw Error('Sign in with an approved membership first.');
 const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('Notification permission was not granted.');
 const reg=await navigator.serviceWorker.ready;
 const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64ToBytes(window.CHURCH_CONFIG.vapidPublicKey)});
 const json=sub.toJSON();const {error}=await db.from('member_push_subscriptions').upsert({user_id:me.id,endpoint:sub.endpoint,p256dh:json.keys.p256dh,auth:json.keys.auth,user_agent:navigator.userAgent},{onConflict:'endpoint'});
 if(error)throw error;status.textContent='Background notifications enabled on this device.';$('disablePush').disabled=false;
 }catch(err){status.textContent='Cannot enable notifications: '+err.message}
};
$('disablePush').onclick=async()=>{const status=$('pushStatus');try{const reg=await navigator.serviceWorker.ready;const sub=await reg.pushManager.getSubscription();if(sub){const {error}=await db.from('member_push_subscriptions').delete().eq('user_id',me.id).eq('endpoint',sub.endpoint);if(error)throw error;await sub.unsubscribe()}status.textContent='Notifications disabled on this device.';$('disablePush').disabled=true}catch(err){status.textContent=err.message}};
