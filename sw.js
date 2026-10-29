const CACHE='yatzy-v25';
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['./','./index.html','./icon.png'])).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
// network first, bypassing the browser's HTTP cache for the app's own files; the cache is only for offline use
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url),own=url.origin===self.location.origin;
  // only the app, its fonts and the Firebase SDK are cached; the database's own traffic goes straight to the network
  if(!own&&!['https://fonts.googleapis.com','https://fonts.gstatic.com','https://www.gstatic.com'].includes(url.origin))return;
  e.respondWith(fetch(e.request,own?{cache:'no-store'}:{}).then(r=>{if(r.ok||r.type==='opaque'){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy))}return r}).catch(()=>caches.match(e.request,{ignoreSearch:true})));
});
