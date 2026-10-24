const ccModules=window.CHURCH_CONFIG?.modules;
if(ccModules && !ccModules.messaging && !ccModules.membership && !ccModules.ministries){
  document.body.innerHTML='<main class="admin-wrap"><h1>Member services are not enabled</h1><p>Please contact your church administrator.</p><a href="church-portal.html">Return to portal</a></main>';
  throw new Error('Member modules disabled in this deployment');
}
import {db,escapeHTML as e,fmt} from './data.js';
import {avatarEl,signedUrls,uploadPhoto,removePhotoFile} from './avatar.js';
import {createMessenger} from './messenger.js';
const $=id=>document.getElementById(id);const show=(id,on)=>$(id).classList.toggle('hidden',!on);
let me=null,profile=null,activeConversation=null,conversations=[],ministries=[],directory=[];let allMinistries=[];let approvedMinistryIds=new Set();let channel=null;let unreadCounts=new Map();
let rules=new Map(),acks=new Set(),youthChats=[],safetyReady=true;
document.querySelectorAll('[data-church]').forEach(el=>el.textContent=window.CHURCH_CONFIG.name||'Your Church');
function notice(s){$('notice').textContent=s}function fail(error){notice(error?.message||String(error));return false}
function item(text){const d=document.createElement('div');d.className='list-item';d.textContent=text;return d}
function btn(text,handler){const b=document.createElement('button');b.className='btn secondary';b.textContent=text;b.onclick=handler;return b}
async function init(){if(!db){notice('Setup required: configure Supabase in config.js and run schema-phase3.sql.');show('signin',false);return}const {data:{user}}=await db.auth.getUser();me=user;show('signin',!me);show('portal',false);show('profileSetup',false);show('pending',false);if(!me)return;const r=await db.from('member_profiles').select('*').eq('user_id',me.id).maybeSingle();if(r.error)return fail(r.error);profile=r.data;if(!profile){show('profileSetup',true);return}if(!profile.approved){show('pending',true);return}show('portal',true);await load();await setupBroadcast();await setupAdminTab();await setupPlatform();openViewFromUrl();await loadSmsPreferences();await setupPushUI();subscribe();await openNotificationTarget()}
let registrationMode=false;
function setRegistrationMode(on){registrationMode=on;show('confirmPasswordGroup',on);$('confirmPassword').disabled=!on;$('confirmPassword').required=on;$('password').autocomplete=on?'new-password':'current-password';$('authSubmit').textContent=on?'Create account':'Sign in';$('register').textContent=on?'Back to sign in':'Create account';$('password').value='';$('confirmPassword').value='';notice('');updatePasswordMatch()}
function updatePasswordMatch(){const status=$('passwordMatch');if(!registrationMode)return;const first=$('password').value,second=$('confirmPassword').value;status.textContent=!second?'Enter the same password twice.':first===second?'Passwords match.':'Passwords do not match.';status.classList.toggle('password-error',!!second&&first!==second)}
document.querySelectorAll('[data-toggle-password]').forEach(button=>button.addEventListener('click',()=>{const input=$(button.dataset.togglePassword);const reveal=input.type==='password';input.type=reveal?'text':'password';button.textContent=reveal?'Hide':'Show';button.setAttribute('aria-label',reveal?'Hide password':'Show password');button.setAttribute('aria-pressed',String(reveal))}));
$('password').addEventListener('input',updatePasswordMatch);$('confirmPassword').addEventListener('input',updatePasswordMatch);
$('register').onclick=()=>setRegistrationMode(!registrationMode);
$('signForm').onsubmit=async ev=>{ev.preventDefault();if(!db)return;const email=$('email').value.trim(),password=$('password').value;if(registrationMode){if(password.length<8)return notice('Use a password of at least 8 characters.');if(password!==$('confirmPassword').value)return notice('Passwords do not match. Please enter them again.');const {error}=await db.auth.signUp({email,password});$('password').value='';$('confirmPassword').value='';if(error)return fail(error);setRegistrationMode(false);notice('Account requested. Verify your email if prompted, then sign in to complete your profile.');return}const {error}=await db.auth.signInWithPassword({email,password});$('password').value='';if(error)fail(error);else await init()};
// Phone numbers: members type them the way they say them; we store the international form the text-message links need.
// 7575550123 -> 757-555-0123 as the person types (a number starting with + is left alone for international numbers)
function showPhone(v){const raw=String(v||'');if(raw.trim().startsWith('+1')&&raw.replace(/\D/g,'').length===11)return showPhone(raw.replace(/\D/g,'').slice(1));if(raw.trim().startsWith('+'))return raw;const d=raw.replace(/\D/g,'').slice(0,10);return d.length>6?d.slice(0,3)+'-'+d.slice(3,6)+'-'+d.slice(6):d.length>3?d.slice(0,3)+'-'+d.slice(3):d}
function normalizePhone(v){const raw=String(v||'').trim();if(!raw)return '';const d=raw.replace(/\D/g,'');if(raw.startsWith('+'))return /^[1-9]\d{7,14}$/.test(d)?'+'+d:null;if(d.length===10)return '+1'+d;if(d.length===11&&d[0]==='1')return '+'+d;return null}
$('setupForm').onsubmit=async ev=>{ev.preventDefault();const phone=normalizePhone($('setupPhone').value);if(phone===null)return fail({message:'Please enter your phone number like (757) 555-0123, or leave it blank.'});if($('setupSmsConsent').checked&&!phone)return fail({message:'Add a phone number, or untick the text-message box.'});const {error}=await db.rpc('create_my_profile',{n:$('setupName').value.trim(),...(window.CHURCH_CONFIG?.churchId?{p_church:window.CHURCH_CONFIG.churchId}:{})});if(error)fail(error);else{if(phone){const sp=await db.from('member_sms_preferences').upsert({user_id:(await db.auth.getUser()).data.user.id,phone,opted_in:$('setupSmsConsent').checked,has_app:true,updated_at:new Date().toISOString()},{onConflict:'user_id'});if(sp.error)console.warn('Phone not saved:',sp.error.message)}await init()}};
$('pendingRefresh').onclick=init;$('logout').onclick=async()=>{if(channel)await db.removeChannel(channel);messenger?.clear();await db.auth.signOut();me=null;await init()};$('profileForm').addEventListener('input',e=>{if(!['photoFile','photoTake','photoVisible','gender'].includes(e.target.id))profileDirty=true});
$('refresh').onclick=async()=>{profileDirty=false;const b=$('refresh'),was=b.textContent;b.disabled=true;b.textContent='Refreshing…';try{if(await load()===false)throw new Error('refresh failed');await loadChats().catch(()=>{});document.dispatchEvent(new Event('cc:refresh'));b.textContent='Updated just now ✓'}catch(err){console.error(err);b.textContent='Could not refresh. Try again'}finally{b.disabled=false;setTimeout(()=>{b.textContent=was},2500)}};
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.view').forEach(x=>x.classList.toggle('hidden',x.id!==b.dataset.view))});

// ---- Church-wide broadcast (administrators and pastors only; the server enforces who may send) ----
async function setupBroadcast(){
 const {data}=await db.rpc('cc_can_broadcast');
 $('broadcastTab').classList.toggle('hidden',data!==true);show('broadcastPlus',data===true);if(data===true)await loadAckSummary();
}
$('broadcastText').onchange=()=>show('broadcastTextOptions',$('broadcastText').checked);
$('broadcastForm').onsubmit=async ev=>{
 ev.preventDefault();const title=$('broadcastTitle').value.trim(),body=$('broadcastBody').value.trim();
 if(!title||!body)return;
 if(!confirm('Send this to every approved member of your church?'))return;
 $('broadcastSend').disabled=true;$('broadcastStatus').textContent='Sending…';$('broadcastSms').replaceChildren();
 let {error}=await db.rpc('cc_send_broadcast',{p_title:title,p_body:body,p_pinned:$('broadcastPinned').checked,p_expires_at:broadcastExpiry()});if(error&&/schema cache|Could not find/i.test(error.message))({error}=await db.rpc('cc_send_broadcast',{p_title:title,p_body:body}));
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


// ---- My photo (private; shown to other members only if you turn sharing on) ----
let photoUrls=new Map();
function myAvatarNow(gender){return avatarEl({gender:gender||null,photo_path:profile.photo_path},photoUrls,96,true)}
function renderMyPhoto(){
 $('myAvatar').replaceChildren(myAvatarNow(profile.gender));
 $('gender').value=profile.gender||'';
 $('photoVisible').checked=!!profile.photo_visible&&!!profile.photo_path;$('photoVisible').disabled=!profile.photo_path;
 $('photoRemove').classList.toggle('hidden',!profile.photo_path);
}
$('gender').onchange=async()=>{const g=$('gender').value||null;$('myAvatar').replaceChildren(myAvatarNow(g));const st=$('photoStatus');st.textContent='Saving…';
 const {data:gd,error}=await db.from('member_profiles').update({gender:g}).eq('user_id',me.id).select('user_id');
 if(error||!gd?.length){st.textContent='Could not save: '+(error?.message||'the database did not accept the change');return}
 profile.gender=g;st.textContent='Saved.'};
const onPhoto=async ev=>{
 const file=ev.target.files[0];ev.target.value='';if(!file)return;const st=$('photoStatus');st.textContent='Preparing your photo…';
 try{
  const path=`${profile.church_id}/${me.id}.jpg`;await uploadPhoto(db,path,file);
  const {data:ph,error}=await db.from('member_profiles').update({photo_path:path}).eq('user_id',me.id).select('user_id');if(error)throw error;if(!ph?.length)throw new Error('The photo uploaded but could not be attached to your profile. Please tell your church administrator.');
  profile.photo_path=path;for(const [k,v] of await signedUrls(db,[path]))photoUrls.set(k,v);
  renderMyPhoto();st.textContent='Photo saved. It is private until you tick "Show my photo to other church members".';
 }catch(err){st.textContent=err.message||'Could not save the photo.'}
};
$('photoFile').onchange=onPhoto;$('photoTake').onchange=onPhoto;
// "Take a photo" opens the camera on phones and tablets; a computer only has the file picker, so it is shown just on touch devices.
if(window.matchMedia&&matchMedia('(pointer:coarse)').matches)$('photoTakeBtn').classList.remove('hidden');
$('photoRemove').onclick=async()=>{
 if(!confirm('Remove your photo?'))return;
 try{await removePhotoFile(db,profile.photo_path).catch(()=>{});const {error}=await db.from('member_profiles').update({photo_path:null,photo_visible:false}).eq('user_id',me.id);if(error)throw error;
  profile.photo_path=null;profile.photo_visible=false;renderMyPhoto();$('photoStatus').textContent='Your photo was removed.'}catch(err){$('photoStatus').textContent=err.message||'Could not remove the photo.'}
};
$('photoVisible').onchange=async()=>{
 const v=$('photoVisible').checked;const {error}=await db.from('member_profiles').update({photo_visible:v}).eq('user_id',me.id);
 if(error){$('photoVisible').checked=!v;return $('photoStatus').textContent=error.message}
 profile.photo_visible=v;$('photoStatus').textContent=v?'Other church members can now see your photo.':'Your photo is hidden from other members.';
};

// ---- Install as an app (so members open Church Connect straight to sign in) ----
function setupInstall(){
 const box=$('installHint');if(!box)return;
 try{if(localStorage.getItem('cc_install_later')>String(Date.now()-30*864e5))return}catch(e){}
 if(matchMedia('(display-mode: standalone)').matches||navigator.standalone)return;
 const text=$('installText'),btn=$('installBtn');let deferred=null;
 const ios=/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 if(ios){text.textContent='Add Church Connect to this phone: tap the Share button (the square with an arrow), then "Add to Home Screen". It will open straight to sign in.';btn.classList.add('hidden');show('installHint',true)}
 window.addEventListener('beforeinstallprompt',ev=>{ev.preventDefault();deferred=ev;text.textContent='Install Church Connect on this phone so you can open it like any other app.';btn.classList.remove('hidden');show('installHint',true)});
 btn.onclick=async()=>{if(!deferred)return;deferred.prompt();try{await deferred.userChoice}catch(e){}deferred=null;show('installHint',false)};
 $('installLater').onclick=()=>{show('installHint',false);try{localStorage.setItem('cc_install_later',String(Date.now()))}catch(e){}};
 window.addEventListener('appinstalled',()=>show('installHint',false));
}
setupInstall();

// ---- Admin tab: administrators and pastors get links to the admin pages (the pages still check who you are) ----
// ---- Platform tab (platform owner only; the database enforces it) ----
async function loadPlatform(){
 const box=$('platformChurches');const r=await db.rpc('cc_platform_overview');
 if(r.error){box.replaceChildren(item('Platform tools need the latest database update (platform-migration.sql).'));return}
 const rows=r.data||[];const home=rows.find(x=>x.is_home),cur=rows.find(x=>x.is_current);
 const out=[];
 if(home&&cur&&home.id!==cur.id){const b=btn('Back to my church ('+home.name+')',()=>openChurch(home.id));b.classList.remove('secondary');out.push(b)}
 for(const c of rows){
  const row=document.createElement('div');row.className='list-item';const d=document.createElement('div');const s=document.createElement('strong');s.textContent=c.name+(c.is_current?'  ·  you are here':'');
  const p=document.createElement('div');p.className='small muted';p.textContent=[c.slug,c.status||'no subscription',c.plan,c.members+' members',c.administrators+' admins',c.status==='trialing'&&c.trial_ends_at?'trial ends '+fmt(c.trial_ends_at):''].filter(Boolean).join(' · ');
  d.append(s,p);
  const act=document.createElement('div');act.className='actions';
  const sel=document.createElement('select');sel.setAttribute('aria-label','Subscription status for '+c.name);for(const v of ['trialing','active','past_due','canceled']){const o=document.createElement('option');o.value=v;o.textContent=({trialing:'Trial',active:'Active',past_due:'Past due',canceled:'Canceled'})[v];sel.append(o)}sel.value=c.status||'trialing';
  act.append(sel,btn('Save status',async()=>{const {error}=await db.rpc('cc_platform_set_subscription',{p_church:c.id,p_plan:c.plan||'trial',p_status:sel.value});$('pfStatus').textContent=error?error.message:'Status saved for '+c.name+'.';if(!error)await loadPlatform()}));
  if(!c.is_current)act.append(btn('Open as administrator',()=>openChurch(c.id)));
  row.append(d,act);out.push(row)}
 box.replaceChildren(...(out.length?out:[item('No churches yet.')]));
}
async function openChurch(id){const {error}=await db.rpc('cc_platform_switch_church',{p_church:id});if(error)return $('pfStatus').textContent=error.message;location.href='connect.html?view=admin'}
let slugEdited=false;
$('pfSlug').oninput=()=>{slugEdited=true};
$('pfName').oninput=()=>{if(!slugEdited)$('pfSlug').value=$('pfName').value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,50)};
$('platformForm').onsubmit=async ev=>{
 ev.preventDefault();const st=$('pfStatus');st.textContent='Creating…';
 const {data,error}=await db.rpc('cc_platform_create_church_for',{p_name:$('pfName').value.trim(),p_slug:$('pfSlug').value.trim(),p_admin_email:$('pfEmail').value.trim()});
 if(error)return st.textContent=error.message;
 st.textContent=data&&data.admin==='linked'?'Church created. That person is now its administrator.':'Church created. When '+$('pfEmail').value.trim()+' signs up with that email they become its administrator.';
 $('platformForm').reset();slugEdited=false;await loadPlatform();
};
$('pfDemo').onclick=async()=>{
 $('pfStatus').textContent='Creating the demo church…';const {error}=await db.rpc('cc_platform_create_demo_church');
 $('pfStatus').textContent=error?error.message:'Demo church created. Use "Open as administrator" to look around.';if(!error)await loadPlatform();
};
async function setupPlatform(){
 const {data}=await db.rpc('cc_is_platform_admin');
 $('platformTab').classList.toggle('hidden',data!==true);
 if(data===true)await loadPlatform();
}
async function setupAdminTab(){
 const {data}=await db.rpc('cc_is_admin');
 $('adminTab').classList.toggle('hidden',data!==true);
}
let profileDirty=false,dirPhones=new Map();
async function load(){notice('');const keep=profileDirty;{const pr=await db.from('member_profiles').select('*').eq('user_id',me.id).maybeSingle();if(pr.error)return fail(pr.error);if(pr.data)profile=pr.data}const [dir,mm,up]=await Promise.all([db.from('member_profiles').select('user_id,display_name,bio,directory_visible,directory_contact_visible,contact_email,gender,photo_path,photo_visible').eq('directory_visible',true).eq('approved',true),db.from('ministry_members').select('ministry_id,is_leader,ministries(id,name,description)').eq('user_id',me.id),db.from('member_updates').select('*').order('created_at',{ascending:false}).limit(50)]);for(const x of [dir,mm,up])if(x.error)return fail(x.error);directory=dir.data;{const ph=await db.rpc('cc_directory_phones');dirPhones=new Map((ph.data||[]).map(x=>[x.user_id,x.phone]))}photoUrls=await signedUrls(db,[profile?.photo_path,...directory.filter(x=>x.photo_visible).map(x=>x.photo_path)]);ministries=mm.data;approvedMinistryIds=new Set(ministries.map(m=>String(m.ministry_id)));if(!keep)await loadProfileExtras();await loadRules();renderDirectory();renderMinistries();await renderUpdates(up.data);if(!keep){$('displayName').value=profile.display_name;$('bio').value=profile.bio||'';$('directoryVisible').checked=profile.directory_visible;$('contactVisible').checked=profile.directory_contact_visible;$('contactEmail').value=profile.contact_email||'';await loadSmsPreferences()}renderMyPhoto();await loadSafety();await loadChats();await loadYouthChats();renderComposeMinistries();await loadGiving();return true}
function renderDirectory(){const q=$('directorySearch').value.trim().toLowerCase();const list=q.length>=2?directory.filter(x=>x.display_name.toLowerCase().includes(q)&&!rules.get(x.user_id)?.hidden):[];$('directoryList').replaceChildren(...(list.length?list.map(x=>{const row=document.createElement('div');row.className='list-item';const info=document.createElement('div');const strong=document.createElement('strong');strong.textContent=x.display_name;info.append(strong);if(x.bio){const d=document.createElement('p');d.textContent=x.bio;info.append(d)}if(x.directory_contact_visible&&x.contact_email){const d=document.createElement('p');d.textContent=x.contact_email;info.append(d)}if(dirPhones.has(x.user_id)){const d=document.createElement('p'),a=document.createElement('a');a.href='tel:'+dirPhones.get(x.user_id);a.textContent=showPhone(dirPhones.get(x.user_id));d.append(a);info.append(d)}const left=document.createElement('div');left.className='person';left.append(avatarEl(x,photoUrls,48,x.photo_visible),info);row.append(left);if(x.user_id!==me.id){const rl=rules.get(x.user_id);if(rl&&!rl.can_message)row.append(Object.assign(document.createElement('span'),{className:'small muted',textContent:rl.blocked_by_me?'Blocked by you':'Not taking new messages'}));else row.append(btn('Message',()=>startChat(x.user_id,x.display_name)))}return row}):[item(q.length<2?'Enter at least two letters to search.':'No matching opt-in members.')]))}
$('directorySearch').oninput=renderDirectory;
$('profileForm').onsubmit=async ev=>{ev.preventDefault();const say=t=>{for(const id of ['profileSaveMsg','profileSaveMsg2']){const m=$(id);if(m)m.textContent=t}};say('Saving…');
 const payload={display_name:$('displayName').value.trim(),bio:$('bio').value.trim(),directory_visible:$('directoryVisible').checked,directory_contact_visible:$('contactVisible').checked,contact_email:$('contactEmail').value.trim()||null,gender:$('gender').value||null};
 try{
  const {data,error}=await db.from('member_profiles').update(payload).eq('user_id',me.id).select('user_id');if(error)throw error;
  if(!data||!data.length)throw new Error('The database did not accept the change. Please tell your church administrator.');
  profile={...profile,...payload};await saveProfileExtras();
  const phone=await saveSms(true);if(phone)throw new Error(phone);
  notice('');profileDirty=false;say('Saved.');await load();
 }catch(err){say('Not saved: '+(err?.message||err))}};
async function startChat(userId,name){const {data,error}=await db.rpc('start_direct_chat',{recipient:userId});if(error)return fail(error);document.querySelector('[data-view="messages"]').click();await loadChats();await openChat(data,name)}
function ministryColor(id){const saved=ministries.find(x=>String(x.ministry_id)===String(id))?.ministries?.color;if(saved)return saved;const colors=['#8956ce','#178f85','#d98625','#286ac1','#c45378'];let n=0;for(const c of String(id||''))n=(n*31+c.charCodeAt(0))>>>0;return colors[n%colors.length]}
function renderMinistries(){const box=$('ministryList');box.replaceChildren(...(ministries.length?ministries.map(m=>{const row=document.createElement('div');row.className='list-item';const t=document.createElement('div');t.textContent=m.ministries?.name+(m.is_leader?' · Leader':'');row.append(t,btn('Open workspace',()=>openMinistry(m)));return row}):[item('You have not been assigned to a ministry yet.')]))}
let messenger;
async function loadChats(){
 if(!messenger){const unread=async()=>refreshUnread();unread.counts=unreadCounts;messenger=createMessenger({db,user:()=>me,notice,openTab:()=>document.querySelector('[data-view="messages"]').click(),unread,sms:preparePhoneSms});messenger.unread=unread;}
 conversations=await messenger.load();await refreshUnread();
}
function renderConversationList(){if(messenger){messenger.unread.counts=unreadCounts;messenger.renderChats()}}
async function refreshUnread(){const r=await db.rpc('my_conversation_unread_counts');if(r.error)return;unreadCounts=new Map((r.data||[]).map(x=>[String(x.conversation_id),Number(x.unread_count)]));renderConversationList();const total=[...unreadCounts.values()].reduce((a,b)=>a+b,0);$('unreadBadge').textContent=total?total+' unread':'';document.title=(total?'('+total+') ':'')+'Church Connect | Member Portal'}
async function openChat(id,title){activeConversation=id;await messenger.open(id)}
function subscribe(){if(channel)db.removeChannel(channel);channel=db.channel('member-updates-'+me.id).on('postgres_changes',{event:'*',schema:'public',table:'messages'},async ev=>{try{await messenger.changed(ev);await refreshUnread()}catch(e){notice(e.message)}}).on('postgres_changes',{event:'*',schema:'public',table:'member_updates'},()=>load()).on('postgres_changes',{event:'*',schema:'public',table:'ministry_activities'},()=>load()).subscribe()}
async function openMinistry(m){const box=$('ministryWorkspace');box.replaceChildren();const h=document.createElement('h3');h.textContent=m.ministries.name;box.append(h);const r=await db.from('ministry_activities').select('*').eq('ministry_id',m.ministry_id).order('starts_at');if(r.error)return fail(r.error);for(const a of r.data)box.append(item(`${fmt(a.starts_at)} · ${a.title} — ${a.details}`));if(!r.data.length)box.append(item('No activities scheduled.'));const c=conversations.find(x=>x.ministry_id===m.ministry_id);if(c)box.append(btn('Open ministry group chat',()=>{document.querySelector('[data-view="messages"]').click();openChat(c.id,m.ministries.name)}));if(m.is_leader){const form=document.createElement('form');form.innerHTML='<h4>Add ministry activity</h4><label>Title<input name="title" required maxlength="180"></label><label>Start date and time<input name="start" type="datetime-local" required></label><label>Details<textarea name="details"></textarea></label><button class="btn">Publish activity and update</button>';form.onsubmit=async ev=>{ev.preventDefault();const fd=new FormData(form);const title=String(fd.get('title')).trim(),details=String(fd.get('details')).trim(),starts_at=new Date(fd.get('start')).toISOString();const a=await db.from('ministry_activities').insert({ministry_id:m.ministry_id,title,details,starts_at});if(a.error)return fail(a.error);const u=await db.from('member_updates').insert({ministry_id:m.ministry_id,title:'Ministry schedule updated: '+title,body:details,created_by:me.id});if(u.error)fail(u.error);await openMinistry(m);await load()};box.append(form)}}
async function loadGiving(){const setting=await db.from('church_settings').select('donation_history_enabled').eq('id',true).maybeSingle();if(setting.error||!setting.data?.donation_history_enabled){$('givingList').textContent='Donation history is not enabled for this church.';return}const r=await db.from('donation_records').select('amount,currency,provider,donated_at').eq('donor_id',me.id).order('donated_at',{ascending:false});if(r.error)return fail(r.error);$('givingList').replaceChildren(...(r.data.length?r.data.map(x=>item(`${fmt(x.donated_at)} · ${x.amount} ${x.currency} · ${x.provider}`)):[item('No contribution records available.')]))}

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
  for(const m of allMinistries){const existing=requests.data.find(x=>String(x.ministry_id)===String(m.id));const approved=approvedMinistryIds.has(String(m.id));const row=document.createElement('div');row.className='ministry-choice';const text=document.createElement('span');text.textContent=m.name+' · '+(approved?'Approved':existing?.status==='rejected'?'Not approved this time. You can ask again.':existing?.status==='pending'?'Waiting for approval':'Not requested');const button=btn(approved?'Joined':existing?.status==='pending'?'Pending':existing?.status==='rejected'?'Ask again':'Request to join',async()=>{const {error}=await db.rpc('cc_request_ministry',{p_ministry_id:m.id});if(error)return fail(error);notice('Membership request submitted for review.');await loadProfileExtras()});button.disabled=approved||existing?.status==='pending';row.append(text,button);box.append(row)}
}
async function saveProfileExtras(){const payload={user_id:me.id,titles:titleState.mode==='title'?titleState.selected:[],primary_title:titleState.mode==='title'?titleState.primary:null,title_mode:titleState.mode,courtesy_title:titleState.courtesy};const {data:existing}=await db.from('member_church_titles').select('user_id').eq('user_id',me.id).maybeSingle();const {user_id,...editable}=payload;const {error}=existing?await db.from('member_church_titles').update(editable).eq('user_id',me.id):await db.from('member_church_titles').insert(payload);if(error)throw error}
$('newMessage').onclick=()=>show('composePanel',$('composePanel').classList.contains('hidden'));
$('composeType').onchange=()=>{show('directCompose',$('composeType').value==='direct');show('ministryCompose',$('composeType').value==='ministry');renderComposeMinistries()};
function renderComposeMinistries(){const sel=$('composeMinistry');const old=sel.value;sel.replaceChildren(...ministries.map(m=>new Option(m.ministries?.name||'Ministry',m.ministry_id)));if([...sel.options].some(x=>x.value===old))sel.value=old;}
$('composeAudience').onchange=()=>show('ministryPerson',$('composeAudience').value==='one');
function searchRecipient(inputId,resultsId,source){const q=$(inputId).value.trim().toLowerCase();const list=q.length>=2?source.filter(x=>x.display_name?.toLowerCase().includes(q)&&x.user_id!==me.id&&!rules.get(x.user_id)?.hidden&&rules.get(x.user_id)?.can_message!==false).slice(0,15):[];$(resultsId).replaceChildren(...list.map(x=>btn(x.display_name,()=>startChat(x.user_id,x.display_name))));if(q.length>=2&&!list.length)$(resultsId).append(item('No matching eligible members.'))}
$('recipientSearch').oninput=()=>searchRecipient('recipientSearch','recipientResults',directory);
$('ministrySearch').oninput=async()=>{const ministryId=$('composeMinistry').value;if(!ministryId)return;const {data,error}=await db.from('ministry_members').select('user_id,member_profiles!inner(user_id,display_name)').eq('ministry_id',ministryId);if(error){$('ministryResults').textContent='Ministry member search requires an authorized directory policy.';return}const source=(data||[]).map(x=>x.member_profiles).filter(Boolean);searchRecipient('ministrySearch','ministryResults',source)};
$('composeMinistry').onchange=()=>{$('ministrySearch').value='';$('ministryResults').replaceChildren()};
$('openMinistryChat').onclick=async()=>{if($('composeAudience').value==='one'){notice('Search and select a ministry member for a private conversation.');return}const m=ministries.find(x=>String(x.ministry_id)===$('composeMinistry').value);if(!m)return notice('Select one of your approved ministries.');const c=conversations.find(x=>String(x.ministry_id)===String(m.ministry_id));if(!c)return notice('A ministry leader must create or enable the ministry conversation first.');show('composePanel',false);await openChat(c.id,m.ministries?.name||'Ministry')};

// ---- Announcements: pinned first, expired ones hidden, and "I've seen this" ----
async function renderUpdates(rows){
 const a=await db.from('cc_update_acks').select('update_id').eq('user_id',me.id);const canAck=!a.error;acks=new Set(canAck?(a.data||[]).map(x=>x.update_id):[]);
 const now=Date.now(),list=(rows||[]).filter(x=>!x.expires_at||new Date(x.expires_at).getTime()>now).sort((x,y)=>(y.pinned?1:0)-(x.pinned?1:0)||new Date(y.created_at)-new Date(x.created_at));
 $('updateList').replaceChildren(...(list.length?list.map(x=>{const d=item(`${x.pinned?'📌 ':''}${x.title} — ${x.body} · ${fmt(x.created_at)}`);if(canAck&&x.id){d.append(' ');if(acks.has(x.id)){const s=document.createElement('span');s.className='small muted';s.textContent='You have seen this ✓';d.append(s)}else{const b=btn("I've seen this",async()=>{b.disabled=true;const {error}=await db.rpc('cc_ack_update',{p_update_id:x.id});if(error){b.disabled=false;return fail(error)}acks.add(x.id);b.replaceWith(Object.assign(document.createElement('span'),{className:'small muted',textContent:'You have seen this ✓'}))});d.append(b)}}return d}):[item('No updates yet.')]))}
async function loadAckSummary(){const box=$('ackSummary');if(!box)return;const r=await db.rpc('cc_update_ack_summary');box.replaceChildren();if(r.error||!(r.data||[]).length){box.classList.add('hidden');return}box.classList.remove('hidden');box.append(Object.assign(document.createElement('h3'),{textContent:'Who has seen recent announcements'}));for(const x of r.data)box.append(item(`${x.title}: ${x.acked} of ${x.total} members tapped "I've seen this"`))}
function broadcastExpiry(){const d=Number($('broadcastExpires').value);return d?new Date(Date.now()+d*86400000).toISOString():null}
// ---- Directory rules: who is hidden from me, who I can start a chat with, who I blocked ----
async function loadRules(){rules=new Map();const r=await db.rpc('cc_directory_rules');safetyReady=!r.error;if(!r.error)for(const x of r.data||[])rules.set(x.user_id,x)}
// ---- Messages and safety (My Profile): who may start a private chat, date of birth (private), blocked members ----
async function loadSafety(){
 const sec=$('safetySection');if(!sec)return;sec.classList.toggle('hidden',!safetyReady);if(!safetyReady)return;
 const [s,b]=await Promise.all([db.from('cc_messaging_settings').select('allow_direct,request_first').eq('user_id',me.id).maybeSingle(),db.from('cc_member_safety').select('birth_date').eq('user_id',me.id).maybeSingle()]);
 $('safetyChatMode').value=s.data?.allow_direct===false?'off':s.data?.request_first?'ask':'open';
 const bd=b.data?.birth_date||'';$('birthDate').value=bd;$('birthDate').disabled=!!bd;$('birthDateSave').classList.toggle('hidden',!!bd);
 $('birthDateNote').textContent=bd?'Saved privately. Only a church administrator can change it.':'Private. It is used to keep young members safe in messaging, and is never shown to other members.';
 const bl=await db.from('cc_message_blocks').select('blocked_id').eq('user_id',me.id);const box=$('blockedList');box.replaceChildren();
 const ids=(bl.data||[]).map(x=>x.blocked_id);
 if(!ids.length){box.append(Object.assign(document.createElement('p'),{className:'small muted',textContent:'You have not blocked anyone.'}));return}
 const names=await db.from('member_profiles').select('user_id,display_name').in('user_id',ids);
 for(const id of ids){const row=document.createElement('div');row.className='list-item';const who=document.createElement('span');who.textContent=(names.data||[]).find(x=>x.user_id===id)?.display_name||'A member';row.append(who,btn('Unblock',async()=>{const {error}=await db.rpc('cc_chat_action',{c:null,a:'block',p:{user_id:id,enabled:false}});if(error)return fail(error);await loadRules();await loadSafety();renderDirectory()}));box.append(row)}}
$('safetyChatMode').onchange=async()=>{const say=t=>$('safetyStatus').textContent=t;say('Saving…');const {error}=await db.rpc('cc_set_chat_mode',{p_mode:$('safetyChatMode').value});say(error?'Not saved: '+error.message:'Saved.')};
$('birthDateSave').onclick=async()=>{const say=t=>$('safetyStatus').textContent=t;if(!$('birthDate').value)return say('Choose your date of birth first.');if(!confirm('Save this date of birth? You cannot change it yourself afterwards.'))return;const {error}=await db.rpc('cc_set_my_birth_date',{p_date:$('birthDate').value});say(error?'Not saved: '+error.message:'Saved.');if(!error){await loadSafety();await loadRules();renderDirectory()}};
// ---- Guardians: read (never write in) the conversations of the young member they look after ----
async function loadYouthChats(){youthChats=[];const r=await db.rpc('cc_my_youth_conversations');if(!r.error)youthChats=r.data||[];renderGuardianChats()}
function renderGuardianChats(){const box=$('guardianChats');if(!box)return;box.replaceChildren();box.classList.toggle('hidden',!youthChats.length);if(!youthChats.length)return;box.append(Object.assign(document.createElement('h3'),{textContent:'Conversations of my young member'}),Object.assign(document.createElement('p'),{className:'small muted',textContent:'You can read these. You cannot reply in them.'}));for(const y of youthChats)box.append(btn(`${y.youth_name} · ${y.label}`,()=>readYouthChat(y)));const view=document.createElement('div');view.id='guardianView';box.append(view)}
async function readYouthChat(y){const view=$('guardianView');view.replaceChildren(Object.assign(document.createElement('h4'),{textContent:`${y.youth_name} · ${y.label}`}));const [m,p]=await Promise.all([db.from('messages').select('id,body,created_at,sender_id,deleted_at').eq('conversation_id',y.conversation_id).order('created_at',{ascending:false}).limit(50),db.rpc('cc_guardian_people',{p_conversation:y.conversation_id})]);if(m.error)return fail(m.error);const name=id=>(p.data||[]).find(x=>x.user_id===id)?.display_name||'A member';for(const x of [...m.data].reverse())view.append(item(`${name(x.sender_id)} · ${fmt(x.created_at)}: ${x.body}`));if(!m.data.length)view.append(item('No messages yet.'))}
// ---- Larger text for easier reading (kept on this device) ----
(function(){const box=$('largeText');if(!box)return;try{box.checked=localStorage.getItem('cc-large-text')==='1'}catch(e){}box.onchange=()=>{document.documentElement.classList.toggle('cc-large',box.checked);try{box.checked?localStorage.setItem('cc-large-text','1'):localStorage.removeItem('cc-large-text')}catch(e){}}})();
window.addEventListener('hashchange',openNotificationTarget);
async function openNotificationTarget(){if(!me||!profile?.approved)return;const target=new URLSearchParams(location.search).get('conversation')||location.hash.match(/^#conversation=([0-9a-f-]{36})$/i)?.[1];if(!target)return;const c=conversations.find(x=>x.id===target);if(!c)return notice('Conversation unavailable or access revoked.');const m=ministries.find(x=>String(x.ministry_id)===String(c.ministry_id));await openChat(c.id,c.kind==='ministry'?(m?.ministries?.name||'Ministry'):'Private conversation')}
await init();

// Phase 10: consent-aware phone SMS handoff. This is not an SMS gateway.
$('alsoText').onchange=()=>{show('smsModeWrap',$('alsoText').checked);show('smsTargetWrap',$('alsoText').checked)};
async function loadSmsPreferences(){if(!db||!me)return;let {data,error}=await db.from('member_sms_preferences').select('phone,opted_in,has_app,directory_phone_visible').eq('user_id',me.id).maybeSingle();if(error)({data,error}=await db.from('member_sms_preferences').select('phone,opted_in,has_app').eq('user_id',me.id).maybeSingle());if(error){$('smsPreferencesStatus').textContent='Text preferences unavailable: run phase10-sms-migration.sql';return}if(data){$('smsPhone').value=showPhone(data.phone||'');$('smsDirectory').checked=!!data.directory_phone_visible;$('smsConsent').checked=!!data.opted_in;$('smsHasApp').checked=!!data.has_app}}
async function saveSms(quiet){const phone=normalizePhone($('smsPhone').value),consent=$('smsConsent').checked;if(phone===null)return 'Enter your phone number like (757) 555-0123.';if(consent&&!phone)return 'Add a phone number before opting in.';if($('smsDirectory').checked&&!phone)return 'Add a phone number before sharing it in the directory.';if(quiet&&!phone&&!consent&&!$('smsDirectory').checked)return '';const {error}=await db.from('member_sms_preferences').upsert({user_id:me.id,phone:phone||null,opted_in:consent,has_app:$('smsHasApp').checked,directory_phone_visible:$('smsDirectory').checked,updated_at:new Date().toISOString()},{onConflict:'user_id'});return error?'Save failed: '+error.message:''}
$('smsPhone').addEventListener('input',()=>{const el=$('smsPhone'),f=showPhone(el.value);if(f!==el.value)el.value=f});
$('saveSmsPreferences').onclick=async()=>{$('smsPreferencesStatus').textContent=(await saveSms())||'Text preferences saved.'};
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
 const sub=await reg.pushManager.getSubscription();const stale=!!sub&&!sameKey(sub);status.textContent=stale?'Notifications need to be turned on again on this device. Tap Enable notifications.':sub?'Background notifications enabled on this device.':'Enable notifications to receive messages when Church Connect is closed.';
 button.disabled=false;off.disabled=!sub;
}
// A device subscribed with an older notification key must be re-subscribed with the current one.
function sameKey(sub){const k=sub&&sub.options&&sub.options.applicationServerKey;if(!k)return true;const a=new Uint8Array(k),b=b64ToBytes(window.CHURCH_CONFIG.vapidPublicKey);return a.length===b.length&&a.every((x,i)=>x===b[i])}
function b64ToBytes(value){const s=atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4));return Uint8Array.from(s,c=>c.charCodeAt(0))}
$('enablePush').onclick=async()=>{const status=$('pushStatus');try{
 if(!me||!profile?.approved)throw Error('Sign in with an approved membership first.');
 const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('Notification permission was not granted.');
 const reg=await navigator.serviceWorker.ready;
 const old=await reg.pushManager.getSubscription();if(old&&!sameKey(old)){await db.from('member_push_subscriptions').delete().eq('user_id',me.id).eq('endpoint',old.endpoint);await old.unsubscribe()}
 const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64ToBytes(window.CHURCH_CONFIG.vapidPublicKey)});
 const json=sub.toJSON();const {error}=await db.from('member_push_subscriptions').upsert({user_id:me.id,endpoint:sub.endpoint,p256dh:json.keys.p256dh,auth:json.keys.auth,user_agent:navigator.userAgent},{onConflict:'endpoint'});
 if(error)throw error;status.textContent='Background notifications enabled on this device.';$('disablePush').disabled=false;
 }catch(err){status.textContent='Cannot enable notifications: '+err.message}
};
$('disablePush').onclick=async()=>{const status=$('pushStatus');try{const reg=await navigator.serviceWorker.ready;const sub=await reg.pushManager.getSubscription();if(sub){const {error}=await db.from('member_push_subscriptions').delete().eq('user_id',me.id).eq('endpoint',sub.endpoint);if(error)throw error;await sub.unsubscribe()}status.textContent='Notifications disabled on this device.';$('disablePush').disabled=true}catch(err){status.textContent=err.message}};
