/* My Streaks service worker: always request the newest HTML at launch.
   Deliberately does not cache JavaScript, CSS, Firebase data, or user content. */
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.mode!=='navigate'||req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin||!url.pathname.startsWith('/my-streaks/'))return;
  event.respondWith(fetch(req,{cache:'no-store'}).catch(()=>fetch(req)));
});
