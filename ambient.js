/* My Streaks atmospheric effects. Presentation only: never edits habit records. */
(function(){
 'use strict';
 const $=id=>document.getElementById(id);
 const KEY='my-streaks-ambient-v1';
 const defaults={mode:'subtle',stars:true,glow:true};
 const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
 const valid=v=>({mode:['off','subtle','enhanced'].includes(v?.mode)?v.mode:'subtle',stars:v?.stars!==false,glow:v?.glow!==false});
 let settings=defaults,preview=false,previewTimeout=null,night=false;
 try{settings=valid({...defaults,...JSON.parse(localStorage.getItem(KEY)||'{}')});}catch(_){}
 function persist(){
  try{localStorage.setItem(KEY,JSON.stringify(settings));}catch(_){}
 }
 function localNight(){
  const hour=new Date().getHours();
  return hour>=20||hour<6;
 }
 function fieldHTML(previewScene=false){
  const embers=Array.from({length:10},(_,i)=>{
   const x=[8,24,42,61,76,94,16,52,84,37][i],delay=[-5,-12,-19,-4,-27,-9,-16,-31,-2,-21][i],dur=[22,30,26,33,24,28,35,25,31,29][i];
   return '<span class="ambient-ember ambient-ember-'+i+'" style="--ember-x:'+x+'%;--ember-delay:'+delay+'s;--ember-duration:'+dur+'s"></span>';
  }).join('');
  const stars=Array.from({length:3},(_,i)=>
   '<span class="ambient-star ambient-star-'+i+'" style="--star-delay:'+[-8,-23,-40][i]+'s"></span>').join('');
  return embers+stars;
 }
 function initializeScene(){
  const field=$('ambientField'),previewField=$('ambientPreviewField');
  if(field)field.innerHTML=fieldHTML();
  if(previewField)previewField.innerHTML=fieldHTML(true);
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
  const previewButton=$('ambientPreviewBtn');
  if(previewButton)previewButton.disabled=settings.mode==='off'||reduced.matches;
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
  setInterval(()=>{const next=localNight();if(next!==night)apply();},60000);
  apply();
 }
 window.MyStreaksAmbient={setSettings,getSettings:()=>({...settings}),apply,openPreview,closePreview};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire,{once:true});else wire();
})();