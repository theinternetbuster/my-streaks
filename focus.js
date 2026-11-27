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
function start({db,doc,onSnapshot,setDoc,onStudyChange}){
 const root=$('focusPlansRoot'),toggle=$('checklistViewToggle');
 if(!root||!toggle)return {setUser(){},dispose(){}};
 let user=null,unsub=null,plan={blocks:cleanBlocks(defaults),days:{}},ready=false,dirty=false,editing=false,adjusting=null,expanded=null,weekExpanded=false,selectedWeekDay=null,active=null,activeSince=0,overtime=false,saveQueue=Promise.resolve(),saveTimer=null,tickTimer=null,lastSnapshot='';
 const icons=window.MyStreaksIcons;
 let planDetail=false,planId='german',catalog={german:{name:'German Practice',color:'#9159E8'}},models={},loaded=new Set(),listeners=[],generation=0;
 const planPath=id=>id==='german'?'focusPlans':'focusPlan-'+id;
 let pausedId=null;
 const mini=document.createElement('aside');mini.className='ms-mini-timer';mini.hidden=true;document.body.append(mini);
 function paintMini(){const id=active||pausedId,b=plan.blocks.find(x=>x.id===id),running=!!active;mini.hidden=!id||!b||immersive.open;if(mini.hidden)return;const label=catalog[planId]?.name||'Focus',state=planId+':'+id+':'+running;if(mini.dataset.activity!==state){mini.dataset.activity=state;mini.dataset.paused=String(!running);mini.innerHTML='<div><small>'+escape(label)+(running?'':' · Paused')+'</small><strong>'+escape(b.name)+'</strong></div><span data-mini-time></span><button data-mini="toggle" aria-label="'+(running?'Pause':'Resume')+' timer">'+focusIcon(running?'pause':'play')+'</button><button data-mini="expand" aria-label="Expand timer">'+focusIcon('expand')+'</button>'+(!running?'<button data-mini="dismiss" aria-label="Dismiss paused timer">'+focusIcon('close')+'</button>':'');}mini.querySelector('[data-mini-time]').textContent=clock(entry(id).seconds);}
 mini.addEventListener('click',e=>{const button=e.target.closest('[data-mini]'),id=active||pausedId,b=plan.blocks.find(x=>x.id===id);if(!button||!b)return;if(button.dataset.mini==='toggle')runActivityAction('toggle',b);else if(button.dataset.mini==='dismiss'){pausedId=null;paintMini();}else openImmersive(b);});
 let switching=false;
 async function switchPlan(id){if(switching||!loaded.has(id)||catalog[id]?.deleted)return;if(id===planId){planDetail=true;render();window.scrollTo(0,0);return;}switching=true;const epoch=generation;stop();if(dirty)scheduleSave(true);clearTimeout(saveTimer);await saveQueue;if(epoch!==generation){switching=false;return;}if(dirty){switching=false;return;}models[planId]=plan;planId=id;plan=models[id];dirty=false;editing=false;adjusting=null;expanded=null;weekExpanded=false;selectedWeekDay=null;lastSnapshot='';mini.dataset.activity='';switching=false;planDetail=true;render();window.scrollTo(0,0);}
 function listenPlan(id,uid,epoch){if(listeners.some(x=>x.id===id))return;const off=onSnapshot(doc(db,'users',uid,'settings',planPath(id)),snap=>{if(epoch!==generation)return;const data=snap.exists()?snap.data():null;if(id===planId&&loaded.has(id)&&(dirty||active||snap.metadata?.hasPendingWrites))return;const next=normalize(data||(id==='german'?null:{blocks:[{id:'first',name:'Reading',minutes:20,color:'#397CF2'}]}));models[id]=next;loaded.add(id);if(id===planId){plan=next;ready=true;render();}else if(ready&&!editing&&!adjusting)render();onStudyChange?.({timerRunning:!!active});},err=>{console.error('Focus plan sync',err);$('focusSyncLabel').textContent='Sync unavailable';});listeners.push({id,off});}
 function planSelector(){return '<div class="ms-library"><div class="ms-library-heading"><h2>Focus plans</h2><button class="ms-library-new" data-focus="newplan" type="button" aria-label="New focus plan">＋ New plan</button></div><div class="ms-library-items">'+Object.entries(catalog).filter(([,m])=>!m.deleted).map(([id,m])=>{const p=models[id],seconds=Object.values(p?.days[day()]||{}).reduce((n,x)=>n+x.seconds,0);return '<button class="ms-library-row" type="button" data-focus="selectplan" data-id="'+escape(id)+'" '+(!loaded.has(id)?'disabled':'')+' style="--list-color:'+m.color+'"><span class="ms-library-icon">'+icons.svg(icons.valid(m.icon)?m.icon:id==='german'?'language':/stock|invest|finance/i.test(m.name)?'chart':'list')+'</span><span class="ms-library-copy"><strong>'+escape(m.name)+'</strong><small>'+(loaded.has(id)?(p.blocks.length+(p.blocks.length===1?' activity · ':' activities · ')+format(seconds)+' today'):'Loading…')+'</small></span>'+focusIcon('chevron')+'</button>';}).join('')+'</div></div>';}

 const planDialog=document.createElement('dialog');planDialog.className='ms-list-dialog';document.body.append(planDialog);
 function openPlanEditor(id=null){const m=catalog[id];planDialog.innerHTML='<form class="ms-feature-card ms-goal-form"><h3 tabindex="-1" autofocus class="ms-editor-title">'+(m?'Edit plan details':'New Focus Plan')+'</h3><label>Name<input name="name" autocomplete="off" maxlength="55" required value="'+escape(m?.name||'')+'"></label>'+icons.markup(icons.valid(m?.icon)?m.icon:id==='german'?'language':/stock|invest|finance/i.test(m?.name||'')?'chart':'list',m?.color||palette[Object.keys(catalog).length%palette.length])+'<div class="ms-goal-actions ms-editor-actions">'+(m?'<button type="button" class="ms-delete-action" data-plan-delete>Delete</button>':'')+'<button type="button" data-plan-cancel>Cancel</button><button class="ms-primary" type="submit">Save plan</button></div><p data-plan-error role="status"></p></form>';planDialog.dataset.id=id||'';icons.mount(planDialog.querySelector('form'));planDialog.showModal();planDialog.querySelector('.ms-editor-title').focus({preventScroll:true});}
 let deletingPlan=false;
 async function removePlan(id){
  const m=catalog[id];if(!user||!m||m.deleted||switching||deletingPlan)return;
  if(!confirm('Delete "'+m.name+'"? It will be removed from your Focus Plans library. Recorded time will remain in Reports and linked goals and achievements.'))return;
  const uid=user.uid,epoch=generation;deletingPlan=true;switching=true;
  const form=planDialog.open?planDialog.querySelector('form'):null;form?.querySelectorAll('button,input').forEach(x=>x.disabled=true);
  try{
   if(id===planId){stop();if(dirty)scheduleSave(true);clearTimeout(saveTimer);await saveQueue;if(epoch!==generation)return;if(dirty)throw Error('Save pending');}
   await setDoc(doc(db,'users',uid,'settings','focusPlanCatalog'),{plans:{[id]:{name:m.name,color:m.color,icon:icons.valid(m.icon)?m.icon:id==='german'?'language':'list',deleted:true}}},{merge:true});
   if(epoch!==generation)return;catalog[id]={...m,deleted:true};if(id===planId){planDetail=false;editing=false;adjusting=null;pausedId=null;if(immersive.open)immersive.close();}if(planDialog.open)planDialog.close();paintMini();render();onStudyChange?.({timerRunning:!!active});window.scrollTo(0,0);
  }catch(error){console.error('Plan removal failed',error);if(form)form.querySelector('[data-plan-error]').textContent='Could not delete plan. Try again.';else alert('Could not delete plan. Try again.');}
  finally{deletingPlan=false;if(epoch===generation){switching=false;form?.querySelectorAll('button,input').forEach(x=>x.disabled=false);}}
 }
 planDialog.addEventListener('cancel',e=>{if(deletingPlan)e.preventDefault();});
 planDialog.addEventListener('click',e=>{if(deletingPlan)return;if(e.target.closest('[data-plan-cancel]'))planDialog.close();else if(e.target.closest('[data-plan-delete]'))removePlan(planDialog.dataset.id);});
 planDialog.addEventListener('submit',async e=>{e.preventDefault();if(!user||deletingPlan||switching)return;const form=e.target,name=form.elements.name.value.trim();if(!name)return;const id=planDialog.dataset.id||'p'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),uid=user.uid,epoch=generation,button=form.querySelector('[type="submit"]');button.disabled=true;try{await setDoc(doc(db,'users',uid,'settings','focusPlanCatalog'),{plans:{[id]:{name,deleted:false,icon:icons.valid(form.elements.icon.value)?form.elements.icon.value:'list',color:icons.color(form.elements.color.value)}}},{merge:true});if(epoch!==generation)return;planDialog.close();}catch(error){form.querySelector('[data-plan-error]').textContent='Could not save plan.';button.disabled=false;}});
 let immersiveId=null,immersiveTheme='aurora';
 const immersive=document.createElement('dialog');immersive.className='ms-focus-dialog';immersive.setAttribute('aria-label','Immersive focus timer');document.body.append(immersive);
 const themes=['aurora','space','forest','embers'];
 const focusIcons={close:'<path d="m6 6 12 12M18 6 6 18"/>',language:'<path d="M3 5h12M9 3v2m4 0c-1 6-5 10-10 13m2-9c2 4 5 7 9 9m0 2 4-10 4 10m-7-3h6"/>',chevron:'<path d="m9 6 6 6-6 6"/>',back:'<path d="m15 6-6 6 6 6"/>',plan:'<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/>',min:'<path d="M9 3v6H3m12 12v-6h6M9 9 3 3m12 12 6 6"/>',play:'<path d="m8 5 12 7-12 7z"/>',pause:'<path d="M9 5v14M15 5v14"/>',check:'<path d="m5 12 4 4L19 6"/>',undo:'<path d="M3 10h12a5 5 0 0 1 0 10M3 10l5-5m-5 5 5 5"/>',expand:'<path d="M14 3h7v7M21 3l-7 7M10 21H3v-7m0 7 7-7"/>'};
 const focusIcon=n=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+focusIcons[n]+'</svg>';
 function paintImmersive(){
  if(!immersive.open||!immersiveId)return;
  const b=plan.blocks.find(x=>x.id===immersiveId);if(!b){immersive.close();return;}
  const seconds=Math.floor(entry(b.id).seconds||0),target=b.minutes*60,running=active===b.id;
  const time=immersive.querySelector('[data-immersive-time]'),ring=immersive.querySelector('[data-immersive-ring]'),label=immersive.querySelector('[data-immersive-status]'),toggle=immersive.querySelector('[data-immersive-toggle]'),done=immersive.querySelector('[data-immersive-done]');
  if(time)time.textContent=clock(seconds);if(ring)ring.style.setProperty('--ms-ring',Math.min(100,seconds/target*100)+'%');if(label)label.textContent=(running?'Recording · ': 'Paused · ')+format(target)+' target';if(toggle){const state=running?'pause':seconds?'continue':'start';if(toggle.dataset.state!==state){toggle.dataset.state=state;toggle.innerHTML=focusIcon(running?'pause':'play')+'<span>'+(running?'Pause':seconds?'Continue':'Start')+'</span>';}}if(done){const state=entry(b.id).done?'yes':'no';if(done.dataset.state!==state){done.dataset.state=state;done.innerHTML=focusIcon(state==='yes'?'undo':'check')+'<span>'+(state==='yes'?'Mark unfinished':'Mark done')+'</span>';}}
 }
 function openImmersive(b){
  immersiveId=b.id;immersive.dataset.environment=immersiveTheme;
  immersive.innerHTML='<div class="ms-focus-inner"><div class="ms-focus-stars" aria-hidden="true">'+Array.from({length:36},(_,i)=>'<i style="--x:'+((i*73+13)%100)+'%;--y:'+((i*47+7)%100)+'%;--delay:'+(-(i%9))+'s"></i>').join('')+'</div><div class="ms-focus-top"><button type="button" data-immersive-close aria-label="Minimize focus view">'+focusIcon('min')+'<span>Minimize</span></button><span>'+escape(catalog[planId]?.name||'Focus')+' · FOCUS</span></div><div class="ms-focus-ring" data-immersive-ring><div><small>'+escape(b.name)+'</small><strong data-immersive-time>00:00</strong><span data-immersive-status></span></div></div><div class="ms-focus-controls"><button type="button" data-immersive-toggle></button><button type="button" data-immersive-done></button></div><div class="ms-focus-themes" role="group" aria-label="Focus environment">'+themes.map(t=>'<button type="button" data-immersive-theme="'+t+'" aria-pressed="'+(t===immersiveTheme)+'">'+t[0].toUpperCase()+t.slice(1)+'</button>').join('')+'</div></div>';
  if(!immersive.open)immersive.showModal();paintImmersive();paintMini();
 }
 immersive.addEventListener('click',e=>{const button=e.target.closest('button');if(!button||!user)return;if(button.hasAttribute('data-immersive-close')){immersive.close();return;}if(button.dataset.immersiveTheme){immersiveTheme=button.dataset.immersiveTheme;immersive.dataset.environment=immersiveTheme;immersive.querySelectorAll('[data-immersive-theme]').forEach(x=>x.setAttribute('aria-pressed',String(x===button)));return;}const action=button.hasAttribute('data-immersive-toggle')?'toggle':button.hasAttribute('data-immersive-done')?'done':'';if(!action)return;const id=immersiveId,b=plan.blocks.find(x=>x.id===id);if(!b)return;runActivityAction(action,b);paintImmersive();});
 immersive.addEventListener('close',()=>{immersiveId=null;paintMini();});
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
 function stop(save=true,retain=false){if(!active){if(!retain)pausedId=null;paintMini();return;}flushActive();pausedId=retain?active:null;active=null;overtime=false;if(save)scheduleSave(true);paintImmersive();paintMini();}
 function scheduleSave(immediate=false){
  if(!user||!ready)return;
  dirty=true;clearTimeout(saveTimer);
  onStudyChange?.({timerRunning:!!active});
  const write=()=>{
   if(!user)return;
   const uid=user.uid,id=planId,epoch=generation,payload=JSON.parse(JSON.stringify(plan));models[id]=plan;
   lastSnapshot=JSON.stringify(payload);
   saveQueue=saveQueue.catch(()=>{}).then(()=>setDoc(doc(db,'users',uid,'settings',planPath(id)),payload,{merge:false})).then(()=>{
    if(user?.uid===uid&&generation===epoch&&planId===id){$('focusSyncLabel').textContent='';if(JSON.stringify(plan)===JSON.stringify(payload))dirty=false;}
   }).catch(e=>{$('focusSyncLabel').textContent='Save failed';console.error('Focus plan save error',e);});
   $('focusSyncLabel').textContent='Saving…';
  };
  if(immediate)write();else saveTimer=setTimeout(write,500);
 }
 function render(){
  if(!user||!ready)return;
  if(active)flushActive();paintMini();if(!planDetail){root.innerHTML=planSelector();return;}
  const today=record(),blocks=plan.blocks;
  const planned=blocks.reduce((a,b)=>a+b.minutes*60,0);
  const actual=Object.values(today).reduce((a,r)=>a+(r.seconds||0),0);
  const finished=blocks.filter(b=>today[b.id]?.done).length;
  const mondayDate=monday(),week=Array.from({length:7},(_,i)=>{const d=dayAt(mondayDate,i);return {date:d,seconds:Object.values(plan.days[d]||{}).reduce((a,r)=>a+(r.seconds||0),0)};});
  const weekly=week.reduce((a,x)=>a+x.seconds,0);
  const lifetime=Object.values(plan.days).reduce((sum,entries)=>sum+Object.values(entries).reduce((n,r)=>n+(r.seconds||0),0),0);
  if(expanded&&!blocks.some(b=>b.id===expanded))expanded=null;
  const progress=blocks.map(b=>{
    const seconds=Math.max(0,today[b.id]?.seconds||0),portion=Math.min(100,seconds/(b.minutes*60)*100);
    return '<span class="focus-segment" data-focus-segment="'+b.id+'" style="flex:'+b.minutes+';--segment:'+b.color+'" title="'+escape(b.name)+' · '+format(seconds)+' recorded"><span class="focus-segment-fill" style="width:'+portion+'%"></span></span>';
  }).join('');
  const message=finished===blocks.length?'All sections checked off for today.':active?'Your study time is being recorded. Keep your attention on the activity, not the clock.':actual>0?'Every bit of practice counts. Come back whenever you are ready.':'Start with any section. Your study time saves as you go.';
  paintMini();root.innerHTML='<button class="ms-library-back" type="button" data-focus="backplans">'+focusIcon('back')+' All plans</button><div class="focus-topline ms-plan-detail-heading"><div><h2>'+escape(catalog[planId]?.name||'Focus plan')+(planId==='german'?' <span class="focus-language-code" aria-label="German language">DE</span>':'')+'</h2></div><div class="ms-plan-actions"><button type="button" class="focus-edit-trigger" data-focus="edit">Edit</button></div></div>'+
    '<div class="focus-stats ms-three-stats"><div><small>Planned today</small><strong>'+format(planned)+'</strong></div><div><small>Studied today</small><strong data-focus-live="today">'+format(actual)+'</strong></div><div><small>This week</small><strong data-focus-live="week-total">'+format(weekly)+'</strong></div></div>'+
    '<div class="focus-timeline">'+progress+'</div><div class="focus-summary"><span>'+finished+' / '+blocks.length+' sections complete</span><span data-focus-live="recorded">'+format(actual)+' recorded</span></div>'+
    '<div class="focus-activities">'+blocks.map(b=>row(b,today[b.id]||{seconds:0,done:false})).join('')+'</div>'+
    
    '<section class="focus-week'+(weekExpanded?' is-expanded':'')+'"><button type="button" class="focus-week-heading" data-focus="week" aria-expanded="'+weekExpanded+'"><span class="focus-week-title"><strong>This week</strong><small>'+format(weekly)+' focused</small></span><span class="focus-chevron" aria-hidden="true">⌄</span></button>'+(weekExpanded?'<div class="focus-week-body"><div class="focus-week-bars">'+week.map((w,i)=>'<button type="button" class="focus-week-day'+(selectedWeekDay===w.date?' is-selected':'')+'" data-focus="week-day" '+''+' data-date="'+w.date+'" data-focus-weekday="'+w.date+'" aria-pressed="'+(selectedWeekDay===w.date)+'" aria-label="'+new Date(w.date+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'})+': '+format(w.seconds)+' studied" title="'+format(w.seconds)+' · '+w.date+'"><span class="focus-bar-track"'+(w.date>day()?' style="visibility:hidden"':'')+'><span class="focus-bar-fill" style="height:'+Math.max(0,Math.min(100,(w.date>day()?0:w.seconds)/(Math.max(3600,...week.map(v=>v.seconds)))*100))+'%"></span></span><span>'+['M','T','W','T','F','S','S'][i]+'</span></button>').join('')+'</div>'+(selectedWeekDay&&week.some(w=>w.date===selectedWeekDay)?'<div class="focus-week-selected" data-focus-week-selected><strong>'+new Date(selectedWeekDay+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'})+'</strong><span>'+format(week.find(w=>w.date===selectedWeekDay).seconds)+' studied</span></div>':'')+'</div>':'')+'</section>'+
    '<div class="ms-plan-lifetime"><span>Total recorded</span><strong data-focus-live="lifetime">'+format(lifetime)+'</strong></div>'+ (editing?editUI():'')+(adjusting?adjustUI():'');
 }
 /* Running timers update text and widths in place. Rebuilding the full
    Focus view every second used to restart the card entrance animation and
    move the entire expanded box while someone was trying to study. */
 function updateLiveTimer(){
  if(!active||!ready)return;
  paintMini();paintImmersive();
  const b=plan.blocks.find(item=>item.id===active);
  if(!b)return;
  const today=record(),seconds=Math.floor(today[b.id]?.seconds||0);
  const target=b.minutes*60,remaining=Math.max(0,target-seconds);
  const actual=Object.values(today).reduce((sum,item)=>sum+(item.seconds||0),0);
  const mondayDate=monday(),weekly=Array.from({length:7},(_,i)=>
   Object.values(plan.days[dayAt(mondayDate,i)]||{}).reduce((sum,item)=>sum+(item.seconds||0),0)
  ).reduce((sum,value)=>sum+value,0);
  const put=(selector,value)=>{const element=root.querySelector(selector);if(element)element.textContent=value;};
  put('[data-focus-live="today"]',format(actual));
  put('[data-focus-live="week-total"]',format(weekly));
  put('[data-focus-live="lifetime"]',format(Object.values(plan.days).reduce((sum,entries)=>sum+Object.values(entries).reduce((n,r)=>n+(r.seconds||0),0),0)));
  put('[data-focus-live="recorded"]',format(actual)+' recorded');
  put('[data-focus-row-time="'+b.id+'"]',
   format(seconds)+' / '+b.minutes+'m'+(seconds>target?' · +'+format(seconds-target)+' extra':'')+' · timer running');
  put('[data-focus-countdown="'+b.id+'"]',remaining?clock(remaining)+' left':'Plan time reached');
  const width=Math.min(100,seconds/target*100)+'%';
  for(const selector of ['[data-focus-mini="'+b.id+'"] span','[data-focus-bar="'+b.id+'"] span',
                         '[data-focus-segment="'+b.id+'"] .focus-segment-fill']){
   const element=root.querySelector(selector);if(element)element.style.width=width;
  }
  const segment=root.querySelector('[data-focus-segment="'+b.id+'"]');
  if(segment)segment.title=b.name+' · '+format(seconds)+' recorded';
  const weekLabel=root.querySelector('.focus-week-title small');
  if(weekLabel)weekLabel.textContent=format(weekly)+' focused';
  const todayBar=root.querySelector('[data-focus-weekday="'+day()+'"]');
  if(todayBar){const total=Object.values(record()).reduce((n,r)=>n+(r.seconds||0),0);const max=Math.max(3600,...Array.from({length:7},(_,i)=>Object.values(plan.days[dayAt(mondayDate,i)]||{}).reduce((n,r)=>n+(r.seconds||0),0)));const fill=todayBar.querySelector('.focus-bar-fill');if(fill)fill.style.height=Math.max(2,Math.min(100,total/max*100))+'%';todayBar.title=format(total)+' · '+day();todayBar.setAttribute('aria-label','Today: '+format(total)+' studied');}
  if(selectedWeekDay===day())put('[data-focus-week-selected] span',format(Object.values(record()).reduce((n,r)=>n+(r.seconds||0),0))+' studied');
 }
 function row(b,r){
  const running=active===b.id,seconds=Math.floor(r.seconds||0),target=b.minutes*60,remaining=Math.max(0,target-seconds);
  const percent=Math.min(100,seconds/target*100),open=expanded===b.id;
  const extra=seconds>target?' · +'+format(seconds-target)+' extra':'';
  const status=r.done?'✓':running?'Ⅱ':'○';
  return '<article class="focus-activity'+(r.done?' is-done':'')+(running?' is-running':'')+(open?' is-expanded':'')+'" style="--activity-color:'+b.color+'">'+
   '<div class="focus-activity-row"><button type="button" class="focus-activity-expand" data-focus="expand" data-id="'+b.id+'" aria-expanded="'+open+'" aria-controls="focus-detail-'+b.id+'">'+
   '<span class="focus-activity-stripe" aria-hidden="true"></span><span class="focus-activity-name"><strong>'+escape(b.name)+'</strong><small data-focus-row-time="'+b.id+'">'+format(seconds)+' / '+b.minutes+'m'+extra+(running?' · timer running':'')+'</small></span>'+
   '<span class="focus-mini-progress" data-focus-mini="'+b.id+'" aria-hidden="true"><span style="width:'+percent+'%"></span></span>'+
   '<span class="focus-row-chevron" aria-hidden="true">⌄</span></button>'+
   '<button type="button" class="focus-done" data-focus="done" data-id="'+b.id+'" aria-label="'+(r.done?'Mark '+escape(b.name)+' unfinished':'Mark '+escape(b.name)+' complete')+'">'+status+'</button></div>'+
   '<div id="focus-detail-'+b.id+'" class="focus-activity-detail"'+(open?'':' hidden')+'>'+
   '<div class="focus-activity-bar" data-focus-bar="'+b.id+'"><span style="width:'+percent+'%"></span></div>'+
   '<div class="focus-activity-controls"><span class="focus-time" data-focus-countdown="'+b.id+'">'+(remaining?clock(remaining)+' left':'Plan time reached')+'</span>'+
   '<button type="button" data-focus="toggle" data-id="'+b.id+'">'+(running?'Ⅱ Pause':'▶ '+(seconds?'Continue':'Start'))+'</button>'+
   '<button type="button" data-focus="manual" data-id="'+b.id+'" title="Correct or reset recorded study minutes">Edit time</button><button type="button" data-focus="immersive" data-id="'+b.id+'" aria-label="Expand focus timer">'+focusIcon('expand')+'<span>Focus view</span></button></div></div></article>';
 }
 function editUI(){
  return '<div class="focus-edit-shade"><div class="focus-edit-dialog" role="dialog" aria-modal="true" aria-label="Edit focus plan"><div class="focus-edit-head"><h3>Edit study plan</h3><button data-focus="close">✕</button></div><p>Choose activities, minutes and colors. Changes apply to future study; already recorded time stays saved.</p>'+
  plan.blocks.map(b=>'<div class="focus-edit-row"><input type="text" maxlength="55" value="'+escape(b.name)+'" data-field="name" data-id="'+b.id+'" aria-label="Activity name"><input type="number" min="1" max="240" value="'+b.minutes+'" data-field="minutes" data-id="'+b.id+'" aria-label="Planned minutes"><input type="color" value="'+b.color+'" data-field="color" data-id="'+b.id+'" aria-label="Activity color"><button data-focus="remove" data-id="'+b.id+'" aria-label="Remove activity">×</button></div>').join('')+
  '<div class="focus-edit-actions"><button type="button" class="ms-delete-action" data-focus="deleteplan">Delete plan</button><button data-focus="planmeta">Plan details</button><button data-focus="add">+ Add section</button><button data-focus="saveedit">Save plan</button></div></div></div>';
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
 function runActivityAction(action,b){if(switching||catalog[planId]?.deleted)return;const id=b.id;
  if(action==='toggle'){
   if(active===id){stop(true,true);}else{stop();pausedId=null;active=id;expanded=id;activeSince=Date.now();overtime=entry(id).seconds>=b.minutes*60;}
   scheduleSave();render();return;
  }
  if(action==='done'){
   if(active===id||pausedId===id)stop();
   entry(id).done=!entry(id).done;scheduleSave();render();return;
  }
 }
 root.addEventListener('click',e=>{
  const button=e.target.closest('button[data-focus]');if(!button||!user||!ready||switching)return;
  const action=button.dataset.focus,id=button.dataset.id,b=plan.blocks.find(x=>x.id===id);
  if(action==='backplans'){planDetail=false;editing=false;adjusting=null;render();window.scrollTo(0,0);return;}
  if(action==='selectplan'){switchPlan(id);return;}
  if(action==='newplan'){openPlanEditor();return;}
  if(action==='planmeta'){editSave();openPlanEditor(planId);return;}
  if(action==='deleteplan'){removePlan(planId);return;}
  if(action==='expand'){expanded=expanded===id?null:id;render();return;}
  if(action==='week'){weekExpanded=!weekExpanded;if(!weekExpanded)selectedWeekDay=null;render();return;}
  if(action==='week-day'){selectedWeekDay=selectedWeekDay===button.dataset.date?null:button.dataset.date;render();return;}
  if(action==='edit'){stop();adjusting=null;editing=true;render();return;}
  if(action==='close'){editing=false;render();return;}
  if(action==='saveedit'){editSave();return;}
  if(action==='add'){editSave();if(plan.blocks.length>=12)return;plan.blocks.push({id:'x'+Date.now().toString(36),name:'New activity',minutes:20,color:palette[plan.blocks.length%palette.length]});editing=true;render();return;}
  if(action==='remove'){if(plan.blocks.length===1)return;plan.blocks=plan.blocks.filter(x=>x.id!==id);if(expanded===id)expanded=null;scheduleSave();render();return;}
  if(action==='canceladjust'){adjusting=null;render();return;}
  if(action==='lessfive'||action==='morefive'){const field=$('focusAdjustMinutes');if(field)field.value=String(Math.max(0,Number(field.value||0)+(action==='morefive'?5:-5)));return;}
  if(action==='saveadjust'){const value=Number($('focusAdjustMinutes')?.value);if(!Number.isFinite(value)||value<0||value>1440){alert('Enter a valid number of minutes from 0 to 1440.');return;}entry(adjusting).seconds=Math.round(value*60);adjusting=null;scheduleSave(true);render();return;}
  if(action==='resetadjust'){if(!confirm('Reset this activity’s recorded time for today to zero? This will not change any other dates.'))return;entry(adjusting).seconds=0;entry(adjusting).done=false;adjusting=null;scheduleSave(true);render();return;}
  if(!b)return;
  if(action==='immersive'){openImmersive(b);return;}
  if(action==='toggle'||action==='done'){runActivityAction(action,b);return;}
  if(action==='manual'){
   stop();adjusting=id;render();

  }
 });
 toggle.addEventListener('click',e=>{
  const b=e.target.closest('button[data-checklist-view]');if(!b)return;
  if(b.dataset.checklistView==='focus')render();
  toggle.dataset.current=b.dataset.checklistView;
  toggle.dataset.selected=b.dataset.checklistView==='focus'?'achievements':'overview';
  for(const button of toggle.querySelectorAll('button')){button.setAttribute('aria-selected',String(button===b));button.classList.toggle('active',button===b);}
  $('checklistOriginal').hidden=b.dataset.checklistView!=='notes';
  root.hidden=b.dataset.checklistView!=='focus';
 });
 const onHidden=()=>{if(document.visibilityState==='hidden'){stop(true,true);}else if(!root.hidden)render();};
 document.addEventListener('visibilitychange',onHidden);
 window.addEventListener('pagehide',()=>stop(true,true));
 tickTimer=setInterval(()=>{if(active){flushActive();updateLiveTimer();if(!overtime&&entry(active).seconds>=plan.blocks.find(b=>b.id===active).minutes*60){stop(true,true);render();}else if(entry(active).seconds%10===0)scheduleSave();}},1000);
 function setUser(next){
  stop(false);switching=false;generation++;for(const l of listeners)l.off();listeners=[];loaded=new Set();models={};catalog={german:{name:'German Practice',color:'#9159E8'}};planId='german';planDetail=false;pausedId=null;mini.hidden=true;if(immersive.open)immersive.close();if(planDialog.open)planDialog.close();clearTimeout(saveTimer);if(unsub)unsub();unsub=null;user=next;ready=false;dirty=false;active=null;editing=false;adjusting=null;
  plan={blocks:cleanBlocks(defaults),days:{}};expanded=null;weekExpanded=false;selectedWeekDay=null;
  if(!user){root.innerHTML='';return;}
  const uid=user.uid,epoch=generation;
  listenPlan('german',uid,epoch);
  unsub=onSnapshot(doc(db,'users',uid,'settings','focusPlanCatalog'),snap=>{if(epoch!==generation)return;const incoming=snap.data()?.plans||{};for(const [id,m] of Object.entries(incoming)){if((id!=='german'&&!/^p[a-z0-9]{1,30}$/.test(id))||!m?.name)continue;catalog[id]={name:String(m.name).slice(0,55),icon:icons.valid(m.icon)?m.icon:undefined,color:/^#[0-9a-f]{6}$/i.test(m.color)?m.color:palette[0],deleted:m.deleted===true};listenPlan(id,uid,epoch);}if(catalog[planId]?.deleted){stop();planDetail=false;editing=false;adjusting=null;if(immersive.open)immersive.close();if(planDialog.open&&!deletingPlan&&planDialog.dataset.id===planId)planDialog.close();}if(ready&&!editing&&!adjusting)render();onStudyChange?.({timerRunning:!!active});},err=>console.error('Plan catalog sync',err));
 }
 function getPlans(){return Object.entries(catalog).map(([id,m])=>({id,...m}));}
 function getPlanHistory(id='german'){if(!user||!loaded.has(id))return null;const p=models[id];return Object.fromEntries(Object.entries(p.days).map(([d,items])=>[d,Object.entries(items).filter(([,r])=>r.seconds>0).map(([key,r])=>({id:key,name:p.blocks.find(b=>b.id===key)?.name||key,seconds:r.seconds,color:p.blocks.find(b=>b.id===key)?.color||catalog[id].color}))]));}
 function getAllHistory(){if(!user||Object.keys(catalog).some(id=>!loaded.has(id)))return null;const result={};for(const {id,name,color} of getPlans())for(const [d,items] of Object.entries(getPlanHistory(id))){const seconds=items.reduce((n,x)=>n+x.seconds,0);if(seconds)(result[d]??=[]).push({id,name,color,seconds});}return result;}

 function getPlanDay(id,date){if(!user||!loaded.has(id))return null;const p=models[id],items=p.days[date]||{},activities=Object.entries(items).filter(([,r])=>r.seconds>0).map(([key,r])=>({id:key,name:p.blocks.find(b=>b.id===key)?.name||key,seconds:r.seconds,color:p.blocks.find(b=>b.id===key)?.color||catalog[id].color}));return {total:activities.reduce((n,x)=>n+x.seconds,0),activities};}
 function getDay(date){return getPlanDay('german',date);}
 function getHistory(){return getPlanHistory();}
 function getStudyHours(){const h=getHistory();return h===null?null:Math.floor(Object.values(h).flat().reduce((n,x)=>n+x.seconds,0)/3600);}
 function pause(){stop();if(!root.hidden)render();}
 function dispose(){stop();mini.remove();planDialog.remove();for(const l of listeners)l.off();immersive.remove();clearTimeout(saveTimer);clearInterval(tickTimer);if(unsub)unsub();document.removeEventListener('visibilitychange',onHidden);}
 return {setUser,dispose,render,pause,getDay,getStudyHours,getHistory,getPlans,getPlanHistory,getAllHistory,getPlanDay};
}
window.MyStreaksFocus={start};
})();