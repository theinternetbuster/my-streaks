/* My Streaks silent PWA updates: no notices, no forced mid-session reloads. */
(()=>{
 'use strict';
 // The version identifies the exact HTML release whose assets are currently loaded.
 const current=document.querySelector('script[src*="app.js?v="]')?.getAttribute('src')?.match(/[?&]v=([^&#]+)/)?.[1]||'';
 const INTERVAL=30*60*1000;
 const FLAG='my-streaks-pending-version';
 let inFlight=false,lastCheck=0;
 const findVersion=html=>html.match(/<script\b[^>]*\bsrc=["'][^"']*app\.js\?v=([^"'& ]+)[^"']*["'][^>]*>/i)?.[1]||'';
 function markPending(version){
   if(!version||version===current)return;
   try{localStorage.setItem(FLAG,version);}catch(_){}
 }
 async function check(force=false){
   if(inFlight||document.hidden||!navigator.onLine)return;
   if(!force&&Date.now()-lastCheck<INTERVAL)return;
   lastCheck=Date.now();inFlight=true;
   try{
     const url=new URL('./',document.baseURI);
     url.searchParams.set('_version_check',Date.now().toString());
     const response=await fetch(url,{cache:'no-store',credentials:'same-origin'});
     if(!response.ok||!(response.headers.get('content-type')||'').includes('text/html'))return;
     const version=findVersion(await response.text());
     if(version&&version!==current)markPending(version);
     else if(version===current){
       try{localStorage.removeItem(FLAG);}catch(_){}
     }
   }catch(_){/* Offline and GitHub deployment delays never block the app. */}
   finally{inFlight=false;}
 }
 function begin(){
   // The service worker gives future launches network-first HTML, while this
   // check notices a deployment even if the user leaves the app open for days.
   if('serviceWorker'in navigator){
     navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'})
       .then(registration=>registration.update().catch(()=>{}))
       .catch(()=>{});
   }
   const run=()=>check(true);
   if('requestIdleCallback'in window)requestIdleCallback(run,{timeout:4000});
   else setTimeout(run,2000);
   document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});
   window.addEventListener('online',()=>check(true));
   window.addEventListener('pageshow',event=>{if(event.persisted)check(true);});
   setInterval(()=>check(),INTERVAL);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',begin,{once:true});
 else begin();
})();
