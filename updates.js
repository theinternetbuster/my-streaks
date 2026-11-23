/* My Streaks: non-blocking PWA update detection for iPhone/iPad Home Screen and desktop.
   Checks the published HTML with a one-use cache-busting URL, not Firebase or user data.
   No service-worker asset cache is introduced. */
(()=>{
 'use strict';
 const CURRENT=document.querySelector('script[src*="app.js?v="]')?.getAttribute('src')?.match(/[?&]v=([^&#]+)/)?.[1]||'';
 const CHECK_EVERY=20*60*1000;
 const WAIT_AFTER_OPEN=1800;
 let lastCheck=0,inFlight=false,notice=null,latest='',dismissed='';
 const extractVersion=html=>{
   const match=html.match(/<script\b[^>]*\bsrc=["'][^"']*app\.js\?v=([^"'& ]+)[^"']*["'][^>]*>/i);
   return match?match[1]:'';
 };
 function clearNotice(){notice?.remove();notice=null;}
 function showNotice(version){
   if(notice||dismissed===version||!version)return;
   latest=version;
   const el=document.createElement('aside');
   el.className='streaks-update-notice';
   el.setAttribute('role','status');
   el.setAttribute('aria-label','My Streaks update available');
   el.innerHTML='<span class="streaks-update-symbol" aria-hidden="true">✦</span>'+
     '<span class="streaks-update-copy"><strong>My Streaks has an update</strong><small>Get the latest improvements without reinstalling.</small></span>'+
     '<button type="button" class="streaks-update-apply">Update</button>'+
     '<button type="button" class="streaks-update-later" aria-label="Not now">×</button>';
   const later=el.querySelector('.streaks-update-later');
   later.addEventListener('click',()=>{dismissed=version;clearNotice();});
   el.querySelector('.streaks-update-apply').addEventListener('click',()=>{
     // Explicit action avoids disrupting an active focus timer, unsaved form,
     // or a Checklist note. A unique query forces a fresh HTML request.
     const url=new URL(window.location.href);
     url.searchParams.set('_app_version',version);
     url.searchParams.set('_reload',String(Date.now()));
     window.location.replace(url.toString());
   });
   document.body.appendChild(el);notice=el;
 }
 async function check(force=false){
   if(inFlight||document.hidden||!navigator.onLine)return;
   if(!force&&Date.now()-lastCheck<CHECK_EVERY)return;
   inFlight=true;lastCheck=Date.now();
   try{
     const url=new URL('./',document.baseURI);
     url.searchParams.set('_check_update',String(Date.now()));
     const response=await fetch(url.toString(),{cache:'no-store',credentials:'same-origin'});
     if(!response.ok)return;
     const type=response.headers.get('content-type')||'';
     if(!type.includes('text/html'))return;
     const version=extractVersion(await response.text());
     if(version&&CURRENT&&version!==CURRENT){
       showNotice(version);
     }else if(version===CURRENT){
       clearNotice();
     }
   }catch(error){
     // Network loss, captive Wi-Fi, or GitHub Pages deployment delays should
     // never block opening or using the app.
     console.debug('My Streaks update check skipped',error);
   }finally{inFlight=false;}
 }
 function begin(){
   if(!CURRENT)return;
   const start=()=>check(true);
   if('requestIdleCallback'in window)requestIdleCallback(start,{timeout:3500});
   else setTimeout(start,WAIT_AFTER_OPEN);
   window.addEventListener('pageshow',event=>{if(event.persisted)check(true);});
   document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});
   window.addEventListener('online',()=>check(true));
   setInterval(()=>check(),CHECK_EVERY);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',begin,{once:true});
 else begin();
})();