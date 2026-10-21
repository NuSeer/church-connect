const CACHE='church-app-phase2-v1',FILES=['./','./index.html','./app.css','./manifest.json','./icon-192.png','./icon-512.png'];self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)));self.skipWaiting()});self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;e.respondWith(fetch(e.request).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html'))))});
// Background Web Push runs even if all Church Connect tabs are closed.
self.addEventListener('push',event=>{
 let data={};try{data=event.data?.json()||{}}catch{data={title:'Church Connect',body:'You have a new message.'}}
 const title=String(data.title||'Church Connect');
 const target=new URL(data.page==='membership'?'./membership.html':'./connect.html',self.registration.scope);
 if(data.conversationId&&/^[0-9a-f-]{36}$/i.test(data.conversationId))target.searchParams.set('conversation',data.conversationId);
 else if(data.view==='updates')target.searchParams.set('view','updates');
 event.waitUntil(self.registration.showNotification(title,{body:String(data.body||'You have a new message.').slice(0,160),icon:'./icon-192.png',badge:'./icon-192.png',tag:'cc-message-'+(data.messageId||Date.now()),data:{url:target.href}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();const url=event.notification.data?.url||new URL('./connect.html',self.registration.scope).href;
 event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
  const match=clients.find(c=>c.url.startsWith(new URL('./connect.html',self.registration.scope).href));
  if(match){await match.focus();await match.navigate(url);return}return self.clients.openWindow(url)
 }));
});
