const config=window.CHURCH_CONFIG||{};
const modules=config.modules||{messaging:true,membership:true,ministries:true,website:false,giving:false};
document.getElementById('churchName').textContent=(config.name||'Your church')+', connected.';
const website=String(config.existingWebsiteUrl||'').trim();
if(/^https:\/\//i.test(website)){const a=document.getElementById('churchWebsite');a.href=website;a.hidden=false;}
const cards=[
 {key:'messaging',title:'Messages & Notifications',desc:'Conversations, ministry groups, and church announcements.',url:'connect.html#messages'},
 {key:'membership',title:'Member Directory',desc:'Manage your profile, find approved members, and control your privacy.',url:'connect.html#directory'},
 {key:'ministries',title:'Ministries',desc:'See your approved ministries, schedules, and activities.',url:'connect.html#ministries'},
 {key:'website',title:'Church Website',desc:'Visit your church’s Church Connect public website.',url:'index.html'},
 {key:'giving',title:'Giving',desc:'Access your church’s giving providers.',url:'index.html#giving'}
];
const root=document.getElementById('moduleCards');
for(const c of cards){if(!modules[c.key])continue;const card=document.createElement('article');card.className='portal-card';const h=document.createElement('h2');h.textContent=c.title;const p=document.createElement('p');p.className='portal-muted';p.textContent=c.desc;const a=document.createElement('a');a.className='btn';a.href=c.url;a.textContent='Open '+c.title+' →';card.append(h,p,a);root.append(card);}
if(!root.children.length){const p=document.createElement('p');p.textContent='No modules are enabled for this installation. Contact your church administrator.';root.append(p)}
