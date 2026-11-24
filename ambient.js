/* My Streaks atmospheric effects. Presentation only: never edits habit records. */
(function(){
 'use strict';
 const $=id=>document.getElementById(id);
 const KEY='my-streaks-ambient-v1';
 const defaults={mode:'subtle',stars:true,glow:true,nightSchedule:'standard',nightStart:'20:00',nightEnd:'06:00'};
 const GEO_KEY='my-streaks-solar-location-v1';
 const standard={start:'20:00',end:'06:00'};
 const validTime=t=>typeof t==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(t);
 const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
 const valid=v=>({
  mode:['off','subtle','enhanced'].includes(v?.mode)?v.mode:'subtle',
  stars:v?.stars!==false,glow:v?.glow!==false,
  nightSchedule:['standard','sunset','custom'].includes(v?.nightSchedule)?v.nightSchedule:'standard',
  nightStart:validTime(v?.nightStart)?v.nightStart:standard.start,
  nightEnd:validTime(v?.nightEnd)?v.nightEnd:standard.end
 });
 let settings=defaults,preview=false,previewTimeout=null,night=false,geoBusy=false,geoStatus='';
 let solarLocation=null,solarCache={key:'',value:null};
 try{
  const raw=JSON.parse(localStorage.getItem(GEO_KEY)||'null');
  if(raw&&Number.isFinite(raw.lat)&&Number.isFinite(raw.lon)&&Math.abs(raw.lat)<=90&&Math.abs(raw.lon)<=180)
    solarLocation={lat:raw.lat,lon:raw.lon};
 }catch(_){} 
 try{settings=valid({...defaults,...JSON.parse(localStorage.getItem(KEY)||'{}')});}catch(_){}
 function persist(){
  try{localStorage.setItem(KEY,JSON.stringify(settings));}catch(_){}
 }
 /* Approximate civil sunrise/sunset calculated locally using solar geometry.
    The location (rounded to ~1 km) stays on this device; no weather service
    or remote request is necessary. Dates use the device's local time zone. */
 const RAD=Math.PI/180,DAY_MS=86400000,J1970=2440588,J2000=2451545;
 const solarTimes=(date,lat,lon)=>{
  const localNoon=new Date(date.getFullYear(),date.getMonth(),date.getDate(),12);
  const d=localNoon.getTime()/DAY_MS-0.5+J1970-J2000;
  const lw=-lon*RAD,phi=lat*RAD,n=Math.round(d-0.0009-lw/(2*Math.PI));
  const transit=(h,N)=>0.0009+(h+lw)/(2*Math.PI)+N;
  const ds=transit(0,n);
  const M=RAD*(357.5291+0.98560028*ds);
  const L=M+RAD*(1.9148*Math.sin(M)+0.02*Math.sin(2*M)+0.0003*Math.sin(3*M))
    +RAD*102.9372+Math.PI;
  const dec=Math.asin(Math.sin(L)*Math.sin(23.4397*RAD));
  const solarJ=(t)=>J2000+t+0.0053*Math.sin(M)-0.0069*Math.sin(2*L);
  const cosH=(Math.sin(-0.833*RAD)-Math.sin(phi)*Math.sin(dec))/(Math.cos(phi)*Math.cos(dec));
  if(!Number.isFinite(cosH)||Math.abs(cosH)>1)return null; // Polar day/night fallback.
  const Jnoon=solarJ(ds),Jset=solarJ(transit(Math.acos(cosH),n)),Jrise=Jnoon-(Jset-Jnoon);
  const fromJulian=j=>new Date((j+0.5-J1970)*DAY_MS);
  return {sunrise:fromJulian(Jrise),sunset:fromJulian(Jset)};
 };
 const pad=n=>String(n).padStart(2,'0');
 const formatClock=d=>d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
 const mins=s=>Number(s.slice(0,2))*60+Number(s.slice(3,5));
 function timeWindow(now,start,end){
  const time=now.getHours()*60+now.getMinutes(),a=mins(start),b=mins(end);
  if(a===b)return false;
  return a>b?(time>=a||time<b):(time>=a&&time<b);
 }
 function getSolar(now=new Date()){
  if(!solarLocation)return null;
  const key=[now.getFullYear(),now.getMonth(),now.getDate(),solarLocation.lat,solarLocation.lon].join(':');
  if(solarCache.key!==key){
   solarCache={key,value:solarTimes(now,solarLocation.lat,solarLocation.lon)};
  }
  return solarCache.value;
 }
 function localNight(now=new Date()){
  if(settings.nightSchedule==='sunset'){
   const times=getSolar(now);
   if(times)return now<times.sunrise||now>=times.sunset;
  }
  const {start,end}=settings.nightSchedule==='custom'
    ?{start:settings.nightStart,end:settings.nightEnd}:standard;
  return timeWindow(now,start,end);
 }
 function scheduleDescription(){
  if(settings.nightSchedule==='standard')return 'Night effects: 8:00 PM–6:00 AM';
  if(settings.nightSchedule==='custom'){
   const format=t=>new Date(2000,0,1,Number(t.slice(0,2)),Number(t.slice(3,5)))
     .toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
   return 'Night effects: '+format(settings.nightStart)+'–'+format(settings.nightEnd);
  }
  const times=getSolar();
  return times?'Today: sunset '+formatClock(times.sunset)+' · sunrise '+formatClock(times.sunrise):
    'Using 8 PM–6 AM until location is enabled';
 }
 function requestSolarLocation(){
  if(geoBusy)return;
  if(!navigator.geolocation){geoStatus='Location access is not supported on this device.';apply();return;}
  geoBusy=true;geoStatus='Checking approximate location…';apply();
  navigator.geolocation.getCurrentPosition(position=>{
   geoBusy=false;
   // One-hundredth degree is enough for solar times. No precise coordinate is stored.
   solarLocation={lat:Math.round(position.coords.latitude*100)/100,
     lon:Math.round(position.coords.longitude*100)/100};
   solarCache.key='';
   try{localStorage.setItem(GEO_KEY,JSON.stringify(solarLocation));}catch(_){}
   geoStatus='Automatic sunset and sunrise are ready on this device.';
   apply();
  },error=>{
   geoBusy=false;
   geoStatus=error.code===1?'Location permission denied. Using standard hours until enabled.':
     'Location unavailable. Using standard hours until it can be refreshed.';
   apply();
  },{enableHighAccuracy:false,timeout:10000,maximumAge:86400000});
 }
 function fieldHTML(){
  // Fixed positions avoid expensive JS animation or random layout changes on render.
  const x=[6,23,42,62,81,94,13,54,87,34,72,17,49,91,28,65,4,80,38,57,96,11];
  const y=[16,35,57,24,71,47,82,12,63,90,39,76,8,51,20,88,48,95,69,31,6,58];
  const embers=x.map((position,i)=>{
   const duration=21+(i*7%15),delay=-(i*11%37);
   return '<span class="ambient-ember ambient-ember-'+i+'" style="--ember-x:'+position+'%;--ember-y:'+y[i]+'%;--ember-delay:'+delay+'s;--ember-duration:'+duration+'s"></span>';
  }).join('');
  const stars=Array.from({length:3},(_,i)=>
   '<span class="ambient-star ambient-star-'+i+'" style="--star-delay:'+[-8,-23,-40][i]+'s"></span>').join('');
  return embers+stars;
 }
 function initializeScene(){
  for(const id of ['ambientField','ambientPreviewField','ambientSettingsField','ambientSettingsNavField']){
   const field=$(id);if(field)field.innerHTML=fieldHTML();
  }
 }
 function effectiveEnabled(){return settings.mode!=='off'&&!reduced.matches;}
 function apply(){
  const html=document.documentElement;
  night=localNight();
  const allow=effectiveEnabled();
  html.dataset.ambient=allow?settings.mode:'off';
  html.dataset.ambientNight=allow&&night&&html.dataset.theme==='dark'?'true':'false';
  html.dataset.ambientGlow=allow&&settings.glow?'true':'false';
  html.dataset.ambientStars=allow&&settings.stars?'true':'false';
  html.dataset.ambientPreview=preview?'true':'false';
  // The preview uses its own dark environment, even in daytime or light mode.
  const modal=$('ambientPreviewModal');
  if(modal){
   modal.hidden=!preview;
   modal.dataset.previewLevel=allow?settings.mode:'off';
   modal.dataset.previewStars=String(allow&&settings.stars);
   modal.dataset.previewGlow=String(allow&&settings.glow);
  }
  syncControls();
 }
 function syncControls(){
  document.querySelectorAll('input[name="ambientMode"]').forEach(el=>{el.checked=el.value===settings.mode;});
  const stars=$('ambientStarsSetting'),glow=$('ambientGlowSetting');
  if(stars){stars.checked=settings.stars;stars.disabled=settings.mode==='off';}
  if(glow){glow.checked=settings.glow;glow.disabled=settings.mode==='off';}
  document.querySelectorAll('input[name="ambientNightSchedule"]').forEach(el=>{
   el.checked=el.value===settings.nightSchedule;
  });
  const custom=$('ambientCustomHours'),solar=$('ambientSunsetInfo');
  if(custom)custom.hidden=settings.nightSchedule!=='custom';
  if(solar)solar.hidden=settings.nightSchedule!=='sunset';
  const startInput=$('ambientNightStart'),endInput=$('ambientNightEnd');
  if(startInput)startInput.value=settings.nightStart;
  if(endInput)endInput.value=settings.nightEnd;
  const state=$('ambientNightStatus');
  if(state)state.textContent=scheduleDescription()+(night?' · Active now':' · Daytime');
  const geoText=$('ambientLocationStatus');
  if(geoText)geoText.textContent=geoStatus||
    (solarLocation?'Location saved on this device; refresh after traveling.':
    'Enable location to calculate local sunrise and sunset. Otherwise, standard hours are used.');
  const geoButton=$('ambientEnableLocation');
  if(geoButton){geoButton.disabled=geoBusy;geoButton.textContent=geoBusy?'Checking…':
    solarLocation?'Refresh location':'Enable automatic times';}
  const previewButton=$('ambientPreviewBtn');
  if(previewButton)previewButton.disabled=settings.mode==='off'||reduced.matches;
  // The sample cards are always visible; their motion respects Reduce Motion.
  const status=$('ambientPreviewDescription');
  if(status)status.textContent=settings.mode==='off'
    ?'Turn on Subtle or Enhanced to see the decorative effects.'
    :reduced.matches?'Reduce Motion is enabled. Decorative movement is paused.'
    :settings.mode==='enhanced'?'Enhanced preview · More visible atmosphere.':'Subtle preview · A quiet, warm atmosphere.';
 }
 function setSettings(next,remote=false){
  settings=valid({...settings,...next});
  persist();apply();
  if(!remote)document.dispatchEvent(new CustomEvent('my-streaks-ambient-change',{detail:{...settings}}));
 }
 function openPreview(){
  if(settings.mode==='off')return;
  preview=true;clearTimeout(previewTimeout);apply();
  // Deliberately temporary: no impact on the user's actual appearance preference.
  previewTimeout=setTimeout(closePreview,90000);
 }
 function closePreview(){
  preview=false;clearTimeout(previewTimeout);apply();
 }
 function wire(){
  initializeScene();
  document.querySelectorAll('input[name="ambientMode"]').forEach(el=>el.addEventListener('change',()=>{
   if(el.checked)setSettings({mode:el.value});
  }));
  const stars=$('ambientStarsSetting'),glow=$('ambientGlowSetting');
  document.querySelectorAll('input[name="ambientNightSchedule"]').forEach(el=>el.addEventListener('change',()=>{
   if(!el.checked)return;
   setSettings({nightSchedule:el.value});
   if(el.value==='sunset'&&!solarLocation)requestSolarLocation();
  }));
  for(const [id,key] of [['ambientNightStart','nightStart'],['ambientNightEnd','nightEnd']]){
   $(id)?.addEventListener('change',event=>{
    const t=event.target.value;
    if(!validTime(t))return;
    const other=key==='nightStart'?settings.nightEnd:settings.nightStart;
    if(t===other){
     geoStatus='Start and end must be different times.';
     syncControls();return;
    }
    geoStatus='';setSettings({[key]:t});
   });
  }
  $('ambientEnableLocation')?.addEventListener('click',requestSolarLocation);
  stars?.addEventListener('change',()=>setSettings({stars:stars.checked}));
  glow?.addEventListener('change',()=>setSettings({glow:glow.checked}));
  $('ambientPreviewBtn')?.addEventListener('click',openPreview);
  $('ambientPreviewClose')?.addEventListener('click',closePreview);
  $('ambientPreviewModal')?.addEventListener('click',e=>{if(e.target.id==='ambientPreviewModal')closePreview();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&preview){e.stopPropagation();closePreview();}},true);
  document.addEventListener('visibilitychange',()=>{
   document.documentElement.classList.toggle('ambient-paused',document.hidden);
   if(document.hidden)closePreview();
  });
  reduced.addEventListener?.('change',apply);
  // Observe theme changes from Firebase settings, or the device's appearance.
  const observer=new MutationObserver(muts=>{if(muts.some(m=>m.attributeName==='data-theme'))apply();});
  observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  setInterval(()=>{if(!document.hidden)apply();},60000);
  apply();
 }
 window.MyStreaksAmbient={setSettings,getSettings:()=>({...settings}),apply,openPreview,closePreview};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire,{once:true});else wire();
})();