/* Light touch feedback with honest progressive enhancement.
 * iOS native switch haptics come from actual direct taps on visible
 * <input type="checkbox" switch> controls, NOT synthetic clicks.
 * Android supports navigator.vibrate() during user events.
 * On unsupported platforms, the app stays quiet. */
(()=>{
 'use strict';
 const KEY='my-streaks-touch-enabled';
 let enabled=true;
 try{enabled=localStorage.getItem(KEY)!=='false';}catch(_){}
 const supportsVibration=typeof navigator.vibrate==='function';
 let lastFeedback=0;
 function setEnabled(next,fromServer=false){
  enabled=next!==false;
  try{localStorage.setItem(KEY,String(enabled));}catch(_){}
  const control=document.getElementById('touchFeedbackSetting');
  if(control)control.checked=enabled;
  if(!fromServer)document.dispatchEvent(new CustomEvent('my-streaks-touch-change',{detail:{enabled}}));
 }
 function tap(){
  if(!enabled||!supportsVibration)return false;
  const time=Date.now();
  if(time-lastFeedback<120)return false;
  lastFeedback=time;
  try{return navigator.vibrate(9)===true;}catch(_){return false;}
 }
 function init(){
  const control=document.getElementById('touchFeedbackSetting');
  if(control){
    control.checked=enabled;
    control.addEventListener('change',()=>setEnabled(control.checked));
  }
  // Only deliberate, meaningful interactions — not text entry or scrolling.
  document.addEventListener('click',event=>{
   const target=event.target.closest(
     '.habit-card,[data-focus="done"],[data-focus="toggle"],'+
     '[data-focus="expand"],[data-focus="finish"],'+
     '[data-achievement-index],.achievement-celebration-card button'
   );
   if(target&&!target.disabled)tap();
  });
 }
 window.MyStreaksTouch={setEnabled,isEnabled:()=>enabled,tap};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
 else init();
})();