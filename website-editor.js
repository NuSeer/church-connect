import {db} from './data.js';
const $=id=>document.getElementById(id);
const fields=['churchName','tagline','pastorName','pastorTitle','pastorMessage','pastorPhoto','heroTitle','aboutTitle','aboutBody','serviceInfo','contactEmail','address','template','primaryColor','accentColor','heroImage','givingTitle','logoUrl','logoPosition','logoWidth','heroLogoPosition','heroPosition','heroFocal','heroOverlay','brandPalette','fontStyle'];
const providers=['Givelify','Tithe.ly','Cash App','PayPal','Other Provider'];
const providerId=name=>name.toLowerCase().replace(/[^a-z]/g,'');
for(const name of providers){const id=providerId(name);const wrap=document.createElement('div');wrap.className='giving-edit';const label=document.createElement('label');const check=document.createElement('input');check.type='checkbox';check.id='givingOn_'+id;label.append(check,document.createTextNode(' '+name));const url=document.createElement('input');url.type='url';url.id='givingUrl_'+id;url.placeholder='https:// verified payment link';url.setAttribute('aria-label',name+' payment link');wrap.append(label,url);document.getElementById('givingFields').append(wrap);}

const PALETTES=[
['Royal Purple','#52216d','#d7b45b'],['Midnight Gold','#17253c','#cba34b'],['Emerald Ivory','#125947','#f2dfad'],['Navy Coral','#18365b','#ed876d'],
['Burgundy Cream','#702e42','#efdfc3'],['Ocean Teal','#075b68','#f2bd77'],['Forest Copper','#2c4a3a','#c88a5b'],['Plum Rose','#56304f','#e2a4b6'],
['Charcoal Lime','#2d3436','#c0d869'],['Cobalt Silver','#2345a1','#d6dce7'],['Terracotta Sage','#a45139','#bdc5a5'],['Slate Sky','#344b63','#a4d6e9'],
['Amethyst Pearl','#694a93','#ece5f4'],['Deep Red Gold','#7b1e32','#e3bd65'],['Indigo Lavender','#2f3477','#b9a8e6'],['Sunset Amber','#b14e36','#f1c978'],
['Pine Mint','#1b5246','#a7d7bc'],['Black Champagne','#202024','#ddc9a0'],['Aubergine Peach','#482c47','#f4b8a1'],['Bluebird White','#187da2','#dbeff4'],
['Olive Sand','#57643c','#e8d8a8'],['Raspberry Blush','#923d62','#f4ced8'],['Steel Gold','#405266','#d9ad57'],['Turquoise Violet','#087d86','#9b74b7']];
const paletteSelect=$('brandPalette');
for(const [name] of PALETTES){const o=document.createElement('option');o.value=name;o.textContent=name;paletteSelect.append(o)}
function updateSwatches(){const wrap=$('paletteSwatches');wrap.replaceChildren();for(const id of ['primaryColor','accentColor']){const chip=document.createElement('span');chip.className='palette-chip';chip.style.backgroundColor=$(id).value;chip.title=id==='primaryColor'?'Primary':'Accent';wrap.append(chip)}$('overlayValue').textContent=$('heroOverlay').value+'%'}
paletteSelect.addEventListener('change',()=>{const selected=PALETTES.find(x=>x[0]===paletteSelect.value);if(selected){$('primaryColor').value=selected[1];$('accentColor').value=selected[2]}updateSwatches();render()});
for(const id of ['primaryColor','accentColor'])$(id).addEventListener('input',()=>{const found=PALETTES.find(x=>x[1].toLowerCase()===$('primaryColor').value.toLowerCase()&&x[2].toLowerCase()===$('accentColor').value.toLowerCase());paletteSelect.value=found?found[0]:'custom';updateSwatches()});
$('heroOverlay').addEventListener('input',updateSwatches);

const starterNavigation=[
 {label:'About',href:'#about',visible:true},
 {label:'Announcements',href:'#announcements',visible:true},
 {label:'Events',href:'#events',visible:true},
 {label:'Calendar',href:'#calendar',visible:true},
 {label:'Give',href:'#giving',visible:true},
 {label:'News & Events',href:'#announcements',visible:true},
 {label:'Sign In',href:'connect.html',visible:true}
];
let navigation=starterNavigation.map(x=>({...x}));
function validNavUrl(url){return /^#[a-zA-Z][\w-]*$/.test(url)||/^(?:[a-z0-9-]+\.html)(?:#[\w-]+)?$/i.test(url)||/^https:\/\/[^\s<>"']+$/.test(url)}
function renderNavigationEditor(){
 const host=$('navigationEditor');host.replaceChildren();
 navigation.forEach((item,index)=>{
  const card=document.createElement('div');card.className='section-edit-card';
  const title=document.createElement('label');title.textContent='Menu label';const label=document.createElement('input');label.value=item.label;label.maxLength=60;label.oninput=()=>{item.label=label.value;render()};title.append(label);
  const dest=document.createElement('label');dest.textContent='Destination (e.g. #about, connect.html, https://...)';const href=document.createElement('input');href.value=item.href;href.oninput=()=>{item.href=href.value;render()};dest.append(href);
  const show=document.createElement('label');show.className='checkline';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=item.visible!==false;checkbox.onchange=()=>{item.visible=checkbox.checked;render()};show.append(checkbox,document.createTextNode(' Show in menu'));
  const actions=document.createElement('div');actions.className='actions';
  for(const [name,action] of [['↑',()=>moveNavigation(index,-1)],['↓',()=>moveNavigation(index,1)],['Delete',()=>{navigation.splice(index,1);renderNavigationEditor();render()}]]){const b=document.createElement('button');b.type='button';b.className='btn secondary';b.textContent=name;b.onclick=action;actions.append(b)}
  card.append(title,dest,show,actions);host.append(card);
 });
}
function moveNavigation(i,delta){const n=i+delta;if(n<0||n>=navigation.length)return;[navigation[i],navigation[n]]=[navigation[n],navigation[i]];renderNavigationEditor();render()}
$('addNavigation').onclick=()=>{if(navigation.length>=30)return status('Maximum 30 menu links.');navigation.push({label:'New page',href:'#about',visible:true});renderNavigationEditor();render()};
let pageSections=[];
const allInputs=()=>[...fields,...providers.flatMap(n=>['givingOn_'+providerId(n),'givingUrl_'+providerId(n)])];
const defaults={churchName:window.CHURCH_CONFIG?.name||'Your Church',tagline:window.CHURCH_CONFIG?.tagline||'',pastorName:'',pastorTitle:'Senior Pastor',pastorMessage:'',pastorPhoto:'',heroTitle:"There's a place for you here.",aboutTitle:'More than a place to worship.',aboutBody:'Welcome to our church family.',serviceInfo:'',contactEmail:'',address:'',template:'kingdom',primaryColor:'#53216d',accentColor:'#d5b56b',heroImage:'',givingTitle:'Support the ministry',logoUrl:'',logoPosition:'left',logoWidth:'160',heroLogoPosition:'none',heroPosition:'full',heroFocal:'center',heroOverlay:'35',brandPalette:'custom',fontStyle:'modern'};
const status=s=>$('status').textContent=s;
const show=(id,v)=>$(id).classList.toggle('hidden',!v);
let isEnabled=true;
function values(){const v=Object.fromEntries(fields.map(id=>[id,$(id).value.trim()]));v.giving=providers.map((name,order)=>({name,order,enabled:$('givingOn_'+providerId(name)).checked,url:$('givingUrl_'+providerId(name)).value.trim()}));v.sections=pageSections.map(x=>({...x}));v.navigation=navigation.map(x=>({...x}));return v}
function populate(o){navigation=Array.isArray(o?.navigation)?o.navigation.slice(0,30).filter(x=>x&&typeof x==='object').map(x=>({label:String(x.label||'').slice(0,60),href:String(x.href||''),visible:x.visible!==false})):starterNavigation.map(x=>({...x}));renderNavigationEditor();pageSections=Array.isArray(o?.sections)?o.sections.filter(x=>x&&typeof x==='object').slice(0,40).map(x=>({id:String(x.id||crypto.randomUUID()),type:['text','image','split','cta'].includes(x.type)?x.type:'text',title:String(x.title||''),body:String(x.body||''),image:String(x.image||''),link:String(x.link||'')})):[];renderSectionEditor();for(const id of fields)$(id).value=typeof o?.[id]==='string'?o[id]:defaults[id];for(const name of providers){const saved=(o?.giving||[]).find(x=>x.name===name);$('givingOn_'+providerId(name)).checked=!!saved?.enabled;$('givingUrl_'+providerId(name)).value=saved?.url||''}updateSwatches();render()}
function text(tag,value,klass){const e=document.createElement(tag);e.textContent=value||'';if(klass)e.className=klass;return e}
function render(){const v=values(),p=$('preview');p.replaceChildren();p.className='studio-preview-inner cc-template-'+v.template+' cc-photo-'+v.heroPosition;p.style.setProperty('--cc-primary',v.primaryColor);p.style.setProperty('--cc-accent',v.accentColor);p.dataset.fontStyle=v.fontStyle;const header=document.createElement('div');header.className='cc-preview-header cc-logo-'+v.logoPosition;const logoWidth=Math.max(40,Math.min(600,Number(v.logoWidth)||160));if(/^https:\/\//i.test(v.logoUrl)){const img=document.createElement('img');img.src=v.logoUrl;img.alt=v.churchName+' logo';img.style.width=logoWidth+'px';img.loading='lazy';header.append(img)}else header.append(text('strong',v.churchName));p.append(header);const menu=document.createElement('nav');menu.className='cc-preview-menu';for(const item of v.navigation.filter(x=>x.visible&&x.label.trim()&&validNavUrl(x.href))){const a=document.createElement('a');a.textContent=item.label;a.href=item.href;menu.append(a)}p.append(menu);const hero=document.createElement('div');hero.className='studio-hero cc-hero';const overlay=Math.max(0,Math.min(80,Number(v.heroOverlay)||0))/100;const photo=/^https:\/\//i.test(v.heroImage)?v.heroImage:'';hero.style.setProperty('--cc-overlay',String(overlay));hero.style.backgroundPosition=v.heroFocal;if(photo){hero.style.backgroundImage='linear-gradient(rgba(10,8,22,'+overlay+'),rgba(10,8,22,'+overlay+')),url("'+photo.replace(/["\\]/g,'')+'")'}if(/^https:\/\//i.test(v.logoUrl)&&v.heroLogoPosition!=='none'){const heroLogo=document.createElement('img');heroLogo.src=v.logoUrl;heroLogo.alt=v.churchName+' logo';heroLogo.className='cc-hero-logo cc-hero-logo-'+v.heroLogoPosition;heroLogo.style.width=logoWidth+'px';hero.append(heroLogo)}hero.append(text('div',v.churchName,'studio-name'),text('h2',v.heroTitle),text('p',v.tagline));p.append(hero);const about=document.createElement('div');about.className='studio-section cc-welcome';about.append(text('h3',v.aboutTitle),text('p',v.aboutBody));p.append(about);if(v.pastorName){const pastor=document.createElement('div');pastor.className='studio-section cc-pastor';pastor.append(text('h3',v.pastorTitle||'Pastor'),text('h4',v.pastorName),text('p',v.pastorMessage));if(/^https:\/\//i.test(v.pastorPhoto)){const portrait=document.createElement('img');portrait.src=v.pastorPhoto;portrait.alt=v.pastorName;portrait.style.maxWidth='180px';pastor.prepend(portrait)}p.append(pastor)}const info=document.createElement('div');info.className='studio-section';info.append(text('h3','Join us'),text('p',v.serviceInfo),text('p',v.address),text('p',v.contactEmail,'studio-muted'));p.append(info);const giving=document.createElement('div');giving.className='studio-section cc-giving';giving.append(text('h3',v.givingTitle||'Giving Center'));const links=document.createElement('div');links.className='cc-giving-links';for(const provider of v.giving.filter(x=>x.enabled&&/^https:\/\//i.test(x.url))){const a=document.createElement('a');a.href=provider.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=provider.name;links.append(a)}giving.append(links);p.append(giving);renderSections(p,v.sections)}

function renderSections(parent,sections){for(const section of sections){const wrap=document.createElement('section');wrap.className='studio-section cc-custom-section cc-section-'+section.type;wrap.append(text('h3',section.title));if(section.image&&/^https:\/\//i.test(section.image)){const img=document.createElement('img');img.src=section.image;img.alt=section.title||'Church image';img.loading='lazy';img.style.maxWidth='100%';wrap.append(img)}if(section.body)wrap.append(text('p',section.body));if(section.type==='cta'&&/^https:\/\//i.test(section.link)){const a=document.createElement('a');a.href=section.link;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Learn more';wrap.append(a)}parent.append(wrap)}}
function renderSectionEditor(){const host=$('sectionEditor');host.replaceChildren();pageSections.forEach((section,index)=>{const card=document.createElement('div');card.className='section-edit-card';const heading=text('strong',(index+1)+'. '+section.type.toUpperCase());card.append(heading);for(const [key,label] of [['title','Section heading'],['body','Section content'],['image','Image URL (https)'],['link','Button URL (https)']]){if(key==='link'&&section.type!=='cta'||key==='image'&&section.type==='text')continue;const wrap=document.createElement('label');wrap.textContent=label;const field=key==='body'?document.createElement('textarea'):document.createElement('input');if(key==='image'||key==='link')field.type='url';field.value=section[key]||'';field.addEventListener('input',()=>{section[key]=field.value;render()});wrap.append(field);card.append(wrap)}const actions=document.createElement('div');actions.className='actions';for(const [label,action] of [['↑',()=>move(index,-1)],['↓',()=>move(index,1)],['Duplicate',()=>{pageSections.splice(index+1,0,{...section,id:crypto.randomUUID()});renderSectionEditor();render()}],['Remove',()=>{pageSections.splice(index,1);renderSectionEditor();render()}]]){const b=document.createElement('button');b.type='button';b.className='btn secondary';b.textContent=label;b.addEventListener('click',action);actions.append(b)}card.append(actions);host.append(card)})}
function move(index,offset){const next=index+offset;if(next<0||next>=pageSections.length)return;[pageSections[index],pageSections[next]]=[pageSections[next],pageSections[index]];renderSectionEditor();render()}
$('addSection').addEventListener('click',()=>{pageSections.push({id:crypto.randomUUID(),type:$('newSectionType').value,title:'New section',body:'',image:'',link:''});renderSectionEditor();render()});
async function uploadImage(inputId,targetId){const file=$(inputId).files?.[0];if(!file)return status('Choose an image first.');if(file.size>8*1024*1024)return status('Images must be under 8 MB.');if(!['image/png','image/jpeg','image/webp','image/svg+xml'].includes(file.type))return status('Use PNG, JPG, WebP, or SVG.');if(file.type==='image/svg+xml')return status('For security, upload PNG, JPG, or WebP instead of SVG.');status('Uploading '+file.name+'…');const session=await db.auth.getUser();if(!session.data?.user)return status('Sign in before uploading.');const ext=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'})[file.type];const key=session.data.user.id+'/'+crypto.randomUUID()+'.'+ext;const result=await db.storage.from('church-media').upload(key,file,{contentType:file.type,upsert:false});if(result.error)return status('Upload failed: '+result.error.message);const {data}=db.storage.from('church-media').getPublicUrl(key);$(targetId).value=data.publicUrl;render();status('Uploaded. Save your draft to keep this image on the website.')}
$('uploadLogoBtn').onclick=()=>uploadImage('uploadLogo','logoUrl');
$('uploadHeroBtn').onclick=()=>uploadImage('uploadHero','heroImage');

for(const id of allInputs())$(id).addEventListener('input',render);
async function init(){if(!db)return status('Supabase is not configured.');const {data:{session},error}=await db.auth.getSession();if(error)return status(error.message);if(!session?.user){show('auth',true);show('editor',false);return status('Sign in to this preview domain.')}const a=await db.from('church_admins').select('user_id').eq('user_id',session.user.id).maybeSingle();if(a.error||!a.data){show('auth',false);show('editor',false);return status(a.error?'Administrator check failed: '+a.error.message:'Church administrator access required.')}const r=await db.from('cc_website_content').select('enabled,draft,published').eq('id',1).maybeSingle();if(r.error)return status('Run phase5-website-migration.sql first: '+r.error.message);show('auth',false);show('editor',true);isEnabled=r.data?.enabled??true;$('enabled').checked=isEnabled;populate(Object.keys(r.data?.draft||{}).length?r.data.draft:r.data?.published);status('Draft ready. Changes are not public until you publish.')}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();const {error}=await db.auth.signInWithPassword({email:$('email').value,password:$('password').value});$('password').value='';if(error)return status(error.message);await init()});
function validGiving(){return values().giving.every(x=>!x.enabled||(/^https:\/\//i.test(x.url)&&!/[\s<>]/.test(x.url)))}
$('saveDraft').onclick=async()=>{if(!validGiving())return status('Each enabled giving provider needs a valid https:// link.');status('Saving draft…');const {error}=await db.rpc('cc_save_website_draft',{p_content:values()});status(error?'Save failed: '+error.message:'Draft saved. Public website unchanged.')};
$('publish').onclick=async()=>{
 const button=$('publish');if(button.disabled)return;
 if(!validGiving())return status('Each enabled giving provider needs a valid https:// link.');
 button.disabled=true;const old=button.textContent;button.textContent='Publishing…';
 try{
  status('Saving changes…');
  const expected=values();
  const saved=await db.rpc('cc_save_website_draft',{p_content:expected});
  if(saved.error)throw new Error('Saving failed: '+saved.error.message);
  // A website that is disabled cannot be viewed publicly even if content is published.
  if(!$('enabled').checked){
    status('Your website is disabled. Turn on “Public website enabled” before publishing.');
    return;
  }
  status('Publishing saved changes…');
  const published=await db.rpc('cc_publish_website');
  if(published.error)throw new Error('Publishing failed: '+published.error.message);
  const mineId=(await db.rpc('cc_my_church_id')).data;const check=await db.rpc('cc_public_website',mineId?{p_church:mineId}:{});
  if(check.error)throw new Error('Verification failed: '+check.error.message);
  if(!check.data||check.data.enabled===false)throw new Error('Website is disabled or no public content was returned.');
  if(check.data.pastorName!==expected.pastorName||check.data.heroTitle!==expected.heroTitle||check.data.churchName!==expected.churchName)throw new Error('Published data does not match the editor. Please retry.');
  const url=new URL('index.html',window.location.href);
  url.searchParams.set('published',Date.now().toString());
  $('publishedWebsiteLink').href=url.href;
  $('viewLiveSite').href=url.href;
  status('Published and verified. Click “Open published website” to see your changes on this deployment.');
 }catch(e){status('Publish error: '+(e?.message||String(e)));}
 finally{button.disabled=false;button.textContent=old;}
};
$('enabled').onchange=async()=>{const wanted=$('enabled').checked;const {error}=await db.rpc('cc_toggle_website',{p_enabled:wanted});if(error){$('enabled').checked=!wanted;return status('Unable to update website visibility: '+error.message)}isEnabled=wanted;status(wanted?'Public website enabled.':'Public website disabled; member portal remains available.')};
try { await Promise.race([init(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Access check timed out. Check your connection and Supabase configuration, then reload.')),12000))]); } catch (error) { status('Unable to check access: '+(error?.message||String(error))); show('auth',true); show('editor',false); }

// Sanctuary Studio navigation and responsive preview controls.
for (const tab of document.querySelectorAll('[data-jump]')) {
  tab.addEventListener('click', () => {
    const target = document.getElementById(tab.dataset.jump);
    target?.scrollIntoView({behavior:'smooth',block:'start'});
    document.querySelectorAll('[data-jump]').forEach(b=>b.setAttribute('aria-current',String(b===tab)));
  });
}
for (const [id,mobile] of [['previewDesktop',false],['previewMobile',true]]) {
  document.getElementById(id)?.addEventListener('click', () => {
    document.querySelector('.studio-preview')?.classList.toggle('sanctuary-mobile-preview',mobile);
    document.getElementById('previewDesktop')?.setAttribute('aria-pressed',String(!mobile));
    document.getElementById('previewMobile')?.setAttribute('aria-pressed',String(mobile));
    document.querySelector('.studio-preview')?.scrollIntoView({behavior:'smooth',block:'start'});
  });
}
document.getElementById('uploadPastorBtn')?.addEventListener('click',()=>uploadImage('uploadPastor','pastorPhoto').catch(e=>status('Upload failed: '+e.message)));
