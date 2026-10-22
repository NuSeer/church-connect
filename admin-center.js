import {db} from './data.js';
const $=id=>document.getElementById(id),show=(id,on)=>$(id).classList.toggle('hidden',!on);
const permissions=[['membership_view','View membership'],['membership_manage','Manage membership'],['ministry_view','View ministry administration'],['ministry_manage','Manage ministries'],['events_manage','Manage events'],['announcements_manage','Manage announcements'],['trustees_view','View trustees workspace']];
let approved=[],delegations=[];
function status(message){$('status').textContent=message}
async function init(){if(!db)return status('Supabase is not configured.');const {data:{session},error}=await db.auth.getSession();if(error)return status(error.message);if(!session?.user){show('auth',true);show('workspace',false);return status('Sign in on this preview website to continue.')}const admin=await db.from('church_admins').select('user_id').eq('user_id',session.user.id).maybeSingle();if(admin.error||!admin.data){show('auth',false);show('workspace',false);return status('Administrator access required.')}show('auth',false);show('workspace',true);show('signout',true);await load();await loadSettings()}
$('loginForm').onsubmit=async e=>{e.preventDefault();const {error}=await db.auth.signInWithPassword({email:$('email').value,password:$('password').value});$('password').value='';if(error)return status(error.message);await init()};
$('signout').onclick=async()=>{await db.auth.signOut();location.reload()};
async function load(){const r=await Promise.all([db.from('member_profiles').select('user_id,display_name,approved'),db.from('cc_directory_members').select('id'),db.from('ministries').select('id'),db.from('ministry_join_requests').select('status').eq('status','pending'),db.from('cc_staff_delegations').select('user_id,permission')]);for(const x of r)if(x.error)return status('Administration data unavailable: '+x.error.message+' — Check phase3-4-migration.sql.');const members=r[0].data||[];approved=members.filter(x=>x.approved);delegations=r[4].data||[];$('registeredCount').textContent=members.length;$('directoryCount').textContent=r[1].data.length;$('ministryCount').textContent=r[2].data.length;$('pendingCount').textContent=r[3].data.length;const select=$('staffMember');select.replaceChildren(new Option('Select a member',''));for(const m of approved)select.add(new Option(m.display_name||'Unnamed member',m.user_id));renderPermissions();status('Administration overview loaded.')}
function renderPermissions(){const user=$('staffMember').value;const box=$('permissionChoices');box.replaceChildren();for(const [key,label] of permissions){const wrapper=document.createElement('label');wrapper.className='checkline';const input=document.createElement('input');input.type='checkbox';input.value=key;input.disabled=!user;input.checked=delegations.some(x=>x.user_id===user&&x.permission===key);wrapper.append(input,document.createTextNode(label));box.append(wrapper)}}
$('staffMember').onchange=renderPermissions;
$('savePermissions').onclick=async()=>{const user=$('staffMember').value;if(!user)return status('Select an approved registered member.');const selected=new Set([...$('permissionChoices').querySelectorAll('input:checked')].map(x=>x.value));const previous=new Set(delegations.filter(x=>x.user_id===user).map(x=>x.permission));const changed=permissions.filter(([key])=>selected.has(key)!==previous.has(key));for(const [key] of changed){const {error}=await db.rpc('cc_set_staff_delegation',{p_user_id:user,p_permission:key,p_enabled:selected.has(key)});if(error)return status('Could not save '+key+': '+error.message)}await load();$('staffMember').value=user;renderPermissions();status('Staff delegation records saved. Access enforcement is not yet enabled for delegated users.')};
// ---- Church settings: name, website, time zone (the app shows the name everywhere) ----
async function loadSettings(){
 const id=(await db.rpc('cc_my_church_id')).data;if(!id)return;
 const r=await db.from('churches').select('name,website_url,events_timezone').eq('id',id).maybeSingle();
 if(r.error||!r.data){$('settingsStatus').textContent='Church settings need the latest database update (platform-migration.sql).';return}
 $('settingsName').value=r.data.name||'';$('settingsWebsite').value=r.data.website_url||'';if(r.data.events_timezone)$('settingsZone').value=r.data.events_timezone;
}
$('settingsForm').onsubmit=async ev=>{
 ev.preventDefault();
 const {error}=await db.rpc('cc_update_church_settings',{p_name:$('settingsName').value.trim(),p_website_url:$('settingsWebsite').value.trim(),p_timezone:$('settingsZone').value});
 if(error)return $('settingsStatus').textContent=error.message;
 document.querySelectorAll('[data-church]').forEach(el=>el.textContent=$('settingsName').value.trim());
 $('settingsStatus').textContent='Saved. The new name shows across the app.';
 // a church with a website: look for its events list once, unless one is already set
 if($('settingsWebsite').value.trim()){try{const r=await db.functions.invoke('sync-website-events',{body:{detect:true,ifEmpty:true}});if(r.data&&r.data.found)$('settingsStatus').textContent+=' We also found your website events and copied '+r.data.synced+' of them.'}catch{}}
};
// ---- Church colors (applied live as you pick, saved with the button) ----
import {applyColors} from './brand.js';
const STD={p:'#4933a2',a:'#e0ae66'};
async function loadColors(){
 const id=(await db.rpc('cc_my_church_id')).data;if(!id)return;
 const r=await db.from('churches').select('brand_primary,brand_accent').eq('id',id).maybeSingle();
 if(r.error||!r.data){$('colorsStatus').textContent='Colors need the latest database update (colors-migration.sql).';return}
 $('colorPrimary').value=r.data.brand_primary||STD.p;$('colorAccent').value=r.data.brand_accent||STD.a;
}
$('colorPrimary').oninput=$('colorAccent').oninput=()=>applyColors($('colorPrimary').value,$('colorAccent').value);
async function saveColors(p,a,msg){
 const {error}=await db.rpc('cc_update_church_colors',{p_primary:p,p_accent:a});
 $('colorsStatus').textContent=error?error.message:msg;
 return !error;
}
$('colorsForm').onsubmit=async ev=>{ev.preventDefault();await saveColors($('colorPrimary').value,$('colorAccent').value,'Saved. Your church colors now show across the app.')};
$('colorsReset').onclick=async()=>{if(await saveColors('','','Back to the standard colors. Reload the page to see them.')){$('colorPrimary').value=STD.p;$('colorAccent').value=STD.a;applyColors(STD.p,STD.a)}};
await init();await loadColors().catch(()=>{});
if(location.hash==='#churchColors')setTimeout(()=>$('churchColors')?.scrollIntoView({behavior:'smooth'}),300);
