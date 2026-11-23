/* My Streaks Focus Plans — independent of habits and checklist. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const defaults=[
 {id:'babbel',name:'Babbel + Grammar',minutes:30,color:'#397CF2'},
 {id:'anki',name:'Anki + Vocabulary',minutes:20,color:'#9159E8'},
 {id:'listening',name:'Listening',minutes:30,color:'#109B8D'},
 {id:'reading',name:'Reading',minutes:15,color:'#E2A039'},
 {id:'speaking',name:'Speaking',minutes:20,color:'#E57546'},
 {id:'writing',name:'Writing + Recall',minutes:10,color:'#75849B'}
];
const palette=['#397CF2','#9159E8','#109B8D','#E2A039','#E57546','#75849B','#D16B9C','#6C9F53'];
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
const monday=()=>{const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()-(d.getDay()+6)%7);return d;};
const dayAt=(d,n)=>{const c=new Date(d);c.setDate(c.getDate()+n);return [c.getFullYear(),String(c.getMonth()+1).padStart(2,'0'),String(c.getDate()).padStart(2,'0')].join('-');};
const format=s=>{const m=Math.floor(Math.max(0,s)/60);return m>=60?Math.floor(m/60)+'h '+String(m%60).padStart(2,'0')+'m':m+'m';};
const clock=s=>{s=Math.max(0,Math.floor(s));return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');};
const cleanBlocks=raw=>Array.isArray(raw)&&raw.length?raw.slice(0,12).map((b,i)=>({id:/^[a-z0-9_-]{1,32}$/i.test(b.id||'')?b.id:'block'+i,name:String(b.name||'Activity').slice(0,55),minutes:Math.max(1,Math.min(240,Number(b.minutes)||20)),color:/^#[0-9a-f]{6}$/i.test(b.color||'')?b.color:palette[i%palette.length]})):defaults.map(x=>({...x}));
function start({db,doc,onSnapshot,setDoc}){
 const root=$('focusPlansRoot'),toggle=$('checklistViewToggle');
 if(!root||!toggle)return {setUser(){},dispose(){}};
 let user=null,unsub=null,plan={blocks:cleanBlocks(defaults),days:{}},ready=false,dirty=false,editing=false,adjusting=null,active=null,activeSince=0,overtime=false,saveQueue=Promise.resolve(),saveTimer=null,tickTimer=null,lastSnapshot='';
 const record=()=>{const d=day();if(!plan.days[d])plan.days[d]={};return plan.days[d];};
 const entry=(id)=>{const r=record();if(!r[id])r[id]={seconds:0,done:false};return r[id];};
 const normalize=raw=>{
  const days={};
  if(raw&&raw.days&&typeof raw.days==='object')for(const [date,entries] of Object.entries(raw.days)){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!entries||typeof entries!=='object')continue;
   days[date]={};
   for(const [id,value] of Object.entries(entries)){
    if(!/^[a-z0-9_-]{1,32}$/i.test(id)||!value||typeof value!=='object')continue;
    days[date][id]={seconds:Math.max(0,Math.min(86400,Number(value.seconds)||0)),done:!!value.done};
   }
  }
  return {blocks:cleanBlocks(raw?.blocks),days};
 };
 function flushActive(){
  if(!active)return;
  const now=Date.now(),elapsed=Math.max(0,Math.floor((now-activeSince)/1000));
  if(elapsed>0){entry(active).seconds+=elapsed;activeSince+=elapsed*1000;dirty=true;}
 }
 function stop(save=true){if(!active)return;flushActive();active=null;overtime=false;if(save)scheduleSave(true);}
 function scheduleSave(immediate=false){
  if(!user||!ready)return;
  dirty=true;clearTimeout(saveTimer);
  const write=()=>{
   if(!user)return;
   const uid=user.uid,payload=JSON.parse(JSON.stringify(plan));
   lastSnapshot=JSON.stringify(payload);
   saveQueue=saveQueue.catch(()=>{}).then(()=>setDoc(doc(db,'users',uid,'settings','focusPlans'),payload,{merge:false})).then(()=>{
    if(user?.uid===uid){$('focusSyncLabel').textContent='Saved';dirty=false;}
   }).catch(e=>{$('focusSyncLabel').textContent='Save failed';console.error('Focus plan save error',e);});
   $('focusSyncLabel').textContent='Saving…';
  };
  if(immediate)write();else saveTimer=setTimeout(write,500);
 }
 function render(){
  if(!user||!ready)return;
  if(active)flushActive();
  const today=record(),blocks=plan.blocks;
  const planned=blocks.reduce((a,b)=>a+b.minutes*60,0);
  const actual=Object.values(today).reduce((a,r)=>a+(r.seconds||0),0);
  const finished=blocks.filter(b=>today[b.id]?.done).length;
  const mondayDate=monday(),week=Array.from({length:7},(_,i)=>{const d=dayAt(mondayDate,i);return {date:d,seconds:Object.values(plan.days[d]||{}).reduce((a,r)=>a+(r.seconds||0),0)};});
  const weekly=week.reduce((a,x)=>a+x.seconds,0);
  const completedPercent=blocks.length?Math.round(100*finished/blocks.length):0;
  const progress=blocks.map(b=>{
    const seconds=Math.max(0,today[b.id]?.seconds||0),portion=today[b.id]?.done?100:Math.min(100,seconds/(b.minutes*60)*100);
    return '<span class="focus-segment" style="flex:'+b.minutes+';--segment:'+b.color+'" title="'+escape(b.name)+' · '+format(seconds)+' recorded"><span class="focus-segment-fill" style="width:'+portion+'%"></span></span>';
  }).join('');
  const message=finished===blocks.length?'Gut gemacht! Your plan is complete for today.':actual>0?'You have already made progress. Keep going, or finish for now.':'Start anywhere. You can pause and return whenever you need.';
  root.innerHTML='<div class="focus-topline"><div><span class="focus-eyebrow">YOUR STUDY SPACE</span><h2>German Practice <span aria-hidden="true">🇩🇪</span></h2><p>One section at a time, at your pace.</p></div><button type="button" class="focus-edit-trigger" data-focus="edit">Edit plan</button></div>'+
    '<div class="focus-stats"><div><small>Planned today</small><strong>'+format(planned)+'</strong></div><div><small>Studied today</small><strong>'+format(actual)+'</strong></div><div><small>This week</small><strong>'+format(weekly)+'</strong></div></div>'+
    '<div class="focus-timeline">'+progress+'</div><div class="focus-summary"><span>'+finished+' / '+blocks.length+' sections complete</span><span>'+format(actual)+' recorded</span></div>'+
    '<div class="focus-activities">'+blocks.map(b=>row(b,today[b.id]||{seconds:0,done:false})).join('')+'</div>'+
    '<div class="focus-encouragement"><span>✦</span><p>'+escape(message)+'</p><button type="button" data-focus="finish">Finish for now</button></div>'+
    '<section class="focus-week"><div class="focus-week-heading"><h3>This week</h3><strong>'+format(weekly)+' focused</strong></div><div class="focus-week-bars">'+week.map((w,i)=>'<div class="focus-week-day"><div class="focus-bar-track"><div class="focus-bar-fill" style="height:'+Math.max(2,Math.min(100,w.seconds/(Math.max(3600,...week.map(v=>v.seconds)))*100))+'%"></div></div><span>'+['M','T','W','T','F','S','S'][i]+'</span></div>').join('')+'</div><p>Recorded timer time only. Untimed check-offs add no minutes.</p></section>'+
    (editing?editUI():'')+(adjusting?adjustUI():'');
 }
 function row(b,r){
  const running=active===b.id,seconds=Math.floor(r.seconds||0),target=b.minutes*60,remaining=Math.max(0,target-seconds);
  const percent=Math.min(100,seconds/target*100);
  return '<article class="focus-activity'+(r.done?' is-done':'')+'" style="--activity-color:'+b.color+'"><div class="focus-activity-heading"><span class="focus-activity-stripe"></span><div class="focus-activity-name"><strong>'+escape(b.name)+'</strong><small>'+b.minutes+'m planned · '+format(seconds)+' studied'+(seconds>target?' · extra time':'')+'</small></div><button type="button" class="focus-done" data-focus="done" data-id="'+b.id+'" aria-label="'+(r.done?'Mark unfinished':'Mark complete')+'">'+(r.done?'✓':'○')+'</button></div><div class="focus-activity-bar"><span style="width:'+percent+'%"></span></div><div class="focus-activity-controls"><span class="focus-time">'+(remaining?clock(remaining)+' left': 'Plan time reached')+'</span><button type="button" data-focus="toggle" data-id="'+b.id+'">'+(running?'Pause':'▶ '+(seconds?'Continue':'Start'))+'</button><button type="button" data-focus="manual" data-id="'+b.id+'" title="Add, correct, or reset recorded study minutes">Edit time</button></div></article>';
 }
 function editUI(){
  return '<div class="focus-edit-shade"><div class="focus-edit-dialog" role="dialog" aria-modal="true" aria-label="Edit German plan"><div class="focus-edit-head"><h3>Edit study plan</h3><button data-focus="close">✕</button></div><p>Choose activities, minutes and colors. Changes apply to future study; already recorded time stays saved.</p>'+
  plan.blocks.map(b=>'<div class="focus-edit-row"><input type="text" maxlength="55" value="'+escape(b.name)+'" data-field="name" data-id="'+b.id+'" aria-label="Activity name"><input type="number" min="1" max="240" value="'+b.minutes+'" data-field="minutes" data-id="'+b.id+'" aria-label="Planned minutes"><input type="color" value="'+b.color+'" data-field="color" data-id="'+b.id+'" aria-label="Activity color"><button data-focus="remove" data-id="'+b.id+'" aria-label="Remove activity">×</button></div>').join('')+
  '<div class="focus-edit-actions"><button data-focus="add">+ Add section</button><button data-focus="saveedit">Save plan</button></div></div></div>';
 }

 function adjustUI(){
  const b=plan.blocks.find(x=>x.id===adjusting);
  if(!b)return '';
  const mins=Math.round((entry(b.id).seconds||0)/60*10)/10;
  return '<div class="focus-time-adjust" role="presentation"><div class="focus-time-adjust-card" role="dialog" aria-modal="true" aria-label="Adjust study time"><h3>Edit study time</h3><p>'+escape(b.name)+' · Today only. Set your actual minutes, add more, or reset a test session.</p><div class="focus-time-adjust-input"><input id="focusAdjustMinutes" aria-label="Actual minutes studied" type="number" min="0" max="1440" step="0.1" value="'+mins+'"><span>min</span></div><div class="focus-time-adjust-quick"><button type="button" data-focus="lessfive">− 5 min</button><button type="button" data-focus="morefive">+ 5 min</button></div><div class="focus-time-adjust-actions"><button type="button" data-focus="canceladjust">Cancel</button><button type="button" data-focus="resetadjust">Reset today</button><button type="button" data-focus="saveadjust">Save</button></div></div></div>';
 }
 function editSave(){
  const blocks=plan.blocks.map(b=>({...b}));
  for(const input of root.querySelectorAll('[data-field]')){
   const b=blocks.find(x=>x.id===input.dataset.id);if(!b)continue;
   if(input.dataset.field==='name')b.name=(input.value.trim()||b.name).slice(0,55);
   if(input.dataset.field==='minutes')b.minutes=Math.max(1,Math.min(240,Number(input.value)||b.minutes));
   if(input.dataset.field==='color')b.color=input.value;
  }
  plan.blocks=blocks;editing=false;scheduleSave();render();
 }
 root.addEventListener('click',e=>{
  const button=e.target.closest('button[data-focus]');if(!button||!user||!ready)return;
  const action=button.dataset.focus,id=button.dataset.id,b=plan.blocks.find(x=>x.id===id);
  if(action==='edit'){stop();adjusting=null;editing=true;render();return;}
  if(action==='close'){editing=false;render();return;}
  if(action==='saveedit'){editSave();return;}
  if(action==='add'){editSave();if(plan.blocks.length>=12)return;plan.blocks.push({id:'x'+Date.now().toString(36),name:'New activity',minutes:20,color:palette[plan.blocks.length%palette.length]});editing=true;render();return;}
  if(action==='remove'){if(plan.blocks.length===1)return;plan.blocks=plan.blocks.filter(x=>x.id!==id);scheduleSave();render();return;}
  if(action==='finish'){stop();render();return;}
  if(action==='canceladjust'){adjusting=null;render();return;}
  if(action==='lessfive'||action==='morefive'){const field=$('focusAdjustMinutes');if(field)field.value=String(Math.max(0,Number(field.value||0)+(action==='morefive'?5:-5)));return;}
  if(action==='saveadjust'){const value=Number($('focusAdjustMinutes')?.value);if(!Number.isFinite(value)||value<0||value>1440){alert('Enter a valid number of minutes from 0 to 1440.');return;}entry(adjusting).seconds=Math.round(value*60);adjusting=null;scheduleSave(true);render();return;}
  if(action==='resetadjust'){if(!confirm('Reset this activity’s recorded time for today to zero? This will not change any other dates.'))return;entry(adjusting).seconds=0;entry(adjusting).done=false;adjusting=null;scheduleSave(true);render();return;}
  if(!b)return;
  if(action==='toggle'){
   if(active===id){stop();}else{stop();active=id;activeSince=Date.now();overtime=entry(id).seconds>=b.minutes*60;}
   scheduleSave();render();return;
  }
  if(action==='done'){
   if(active===id)stop();
   entry(id).done=!entry(id).done;scheduleSave();render();return;
  }
  if(action==='manual'){
   stop();adjusting=id;render();

  }
 });
 toggle.addEventListener('click',e=>{
  const b=e.target.closest('button[data-checklist-view]');if(!b)return;
  if(b.dataset.checklistView==='notes'){stop();}else render();
  toggle.dataset.current=b.dataset.checklistView;
  for(const button of toggle.querySelectorAll('button'))button.setAttribute('aria-selected',String(button===b));
  $('checklistOriginal').hidden=b.dataset.checklistView!=='notes';
  root.hidden=b.dataset.checklistView!=='focus';
 });
 const onHidden=()=>{if(document.visibilityState==='hidden'){stop();}else if(!root.hidden)render();};
 document.addEventListener('visibilitychange',onHidden);
 window.addEventListener('pagehide',()=>stop());
 tickTimer=setInterval(()=>{if(active&&!root.hidden){flushActive();render();if(!overtime&&entry(active).seconds>=plan.blocks.find(b=>b.id===active).minutes*60){stop();render();}else if(entry(active).seconds%10===0)scheduleSave();}},1000);
 function setUser(next){
  stop(false);clearTimeout(saveTimer);if(unsub)unsub();unsub=null;user=next;ready=false;dirty=false;active=null;editing=false;adjusting=null;
  plan={blocks:cleanBlocks(defaults),days:{}};
  if(!user){root.innerHTML='';return;}
  const uid=user.uid;
  unsub=onSnapshot(doc(db,'users',uid,'settings','focusPlans'),snap=>{
   if(user?.uid!==uid)return;
   const data=snap.exists()?snap.data():null;
   if(!ready){plan=normalize(data);ready=true;render();return;}
   // Ignore our own pending writes to avoid rolling back a running stopwatch.
   if(dirty||snap.metadata?.hasPendingWrites)return;
   const incoming=normalize(data);
   if(JSON.stringify(incoming)!==JSON.stringify(plan)){plan=incoming;if(!root.hidden)render();}
  },err=>{console.error('Focus Plan sync',err);$('focusSyncLabel').textContent='Sync unavailable';if(!ready){ready=true;render();}});
 }
 function pause(){stop();if(!root.hidden)render();}
 function dispose(){stop();clearTimeout(saveTimer);clearInterval(tickTimer);if(unsub)unsub();document.removeEventListener('visibilitychange',onHidden);}
 return {setUser,dispose,render,pause};
}
window.MyStreaksFocus={start};
})();