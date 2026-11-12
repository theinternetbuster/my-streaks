import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, collection, doc, onSnapshot, getDocs, addDoc, runTransaction, deleteDoc, writeBatch, setDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBuTBTsa-kimaBMbppZcWSQ8P_bpG9DyRQ',
  authDomain: 'my-streaks-24376.firebaseapp.com',
  projectId: 'my-streaks-24376',
  storageBucket: 'my-streaks-24376.firebasestorage.app',
  messagingSenderId: '575509107839',
  appId: '1:575509107839:web:3ac65faa25c3660b145b4a'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });
const el = id => document.getElementById(id);
/* Keep overlays at the document root; iOS otherwise clips them to the dashboard. */
document.body.appendChild(el('detail'));
document.body.appendChild(el('accountMenu'));
document.body.appendChild(el('modalBackdrop'));
document.body.appendChild(el('calendarEditor'));

let user = null, unsubscribe = null, habits = [], selectedId = null, shownMonth = null, modalEditingId = null;
let initialLoadTimer=null,initialLoadEpoch=0;
function startupError(error){
 console.error('My Streaks startup error',error);
 setSync('Connection issue');
 const loading=el('loadingPanel');
 if(loading && !loading.hidden){
   let message=el('streakStartupError');
   if(!message){
     message=document.createElement('div');
     message.id='streakStartupError';
     message.className='startup-error';
     loading.appendChild(message);
   }
   message.textContent='Your habits could not be loaded. They are still stored in Firebase. Please reload to try again.';
 }
}
function applyHabitSnapshot(snapshot){
 habits=snapshot.docs.map(s=>normalise({id:s.id,...s.data()})).sort((a,b)=>(a.order??(1000000+a.createdAt))-(b.order??(1000000+b.createdAt))||a.name.localeCompare(b.name));
 for(const [id,key] of pendingCheckins){if(habits.find(h=>h.id===id)?.completions.includes(key))pendingCheckins.delete(id);}
 for(const [previewKey,desired] of editorPreview){
   const divider=previewKey.lastIndexOf(':'),id=previewKey.slice(0,divider),date=previewKey.slice(divider+1);
   const matched=habits.find(h=>h.id===id);
   if(matched && matched.completions.includes(date)===desired && !editorInflight.has(previewKey) && !editorSaveTimers.has(previewKey)){
     editorPreview.delete(previewKey);
   }
 }
 if(editorHabitId)renderCalendarEditor();
 if(selectedId&&habits.some(h=>h.id===selectedId)){renderDetail();display('detail');}
 else {selectedId=null;renderDashboard();display('dashboard');}
 // Background tasks should never prevent the user's dashboard from opening.
 for(const record of snapshot.docs){
   const raw=record.data();
   if(!Array.isArray(raw.freezeDates) || (raw.freezeProcessedThrough && raw.freezeProcessedThrough<yesterdayKey())){
     Promise.resolve().then(()=>reconcileFreezeLedger(record.id)).catch(e=>console.warn('Freeze reconciliation',e));
   }
 }
 setSync(snapshot.metadata.hasPendingWrites?'Saving…':'Synced',!snapshot.metadata.hasPendingWrites);
}

let editMode = false, layoutMode = 'cards', themeMode = 'system', profileName = '', unsubscribePrefs = null;
let sortableInstance = null, holdTimer = null, touchStart = null, suppressClickUntil = 0;
let busy = false;
const deviceScheme=window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme(){
 const resolved=themeMode==='system'?(deviceScheme.matches?'dark':'light'):themeMode;
 document.documentElement.dataset.theme=resolved;
 document.documentElement.style.colorScheme=resolved;
 const description=el('appearanceDescription');
 if(description)description.textContent=themeMode==='light'?'Always use the light appearance.':themeMode==='dark'?'Always use the dark appearance.':'Automatically match your device appearance.';
}
applyTheme();
deviceScheme.addEventListener?.('change',()=>{if(themeMode==='system')applyTheme();});
function preferencesDoc(){return doc(db,'users',user.uid,'settings','preferences');}
function showProfile(){const name=(profileName||user?.displayName||user?.email?.split('@')[0]||'there').trim();const first=name.split(/\s+/)[0];el('userGreeting').textContent='Hi, '+first;el('accountGreeting').textContent=name.toLowerCase();el('settingsEmail').textContent=user?.email||'';}
async function savePreference(values){if(!user) return;try{await setDoc(preferencesDoc(),values,{merge:true});showToast('Settings saved');}catch(error){showToast(errorMessage(error));}}
const dateKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const todayKey = () => dateKey(new Date());
const parseKey = key => { const [y,m,d] = key.split('-').map(Number); return new Date(y,m-1,d,12); };
const addDays = (key, n) => { const d = parseKey(key); d.setDate(d.getDate()+n); return dateKey(d); };
const weekStart = key => { const d=parseKey(key); const dow=(d.getDay()+6)%7; return addDays(key,-dow); };
function showToast(message){ const t=el('toast');t.textContent=message;t.classList.add('shown');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>t.classList.remove('shown'),3400); }
function setSync(message, online=false){ el('syncState').textContent=message; el('syncState').classList.toggle('online',online); }
function display(view){
 ['loginPanel','loadingPanel','dashboard'].forEach(id=>el(id).hidden=(id!==view && !(view==='detail' && id==='dashboard')));
 el('detail').hidden=view!=='detail';
 document.body.classList.toggle('detail-mode',view==='detail');
 document.body.classList.toggle('detail-open',view==='detail');
 if(user && view==='dashboard') syncDesktopRoute();
}
function escapeHTML(str){ return String(str).replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function normalise(raw){ return {id:raw.id,name:String(raw.name||'Habit'),createdDate:raw.createdDate||todayKey(),createdAt:Number(raw.createdAt)||0,order:Number.isFinite(raw.order)?raw.order:null,completions:Array.isArray(raw.completions)?[...new Set(raw.completions.filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)))].sort():[],freezeDates:Array.isArray(raw.freezeDates)?[...new Set(raw.freezeDates.filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)))].sort():[],freezeProcessedThrough:raw.freezeProcessedThrough||null}; }

/**
 * Two weekly freezes belong to each habit. Count a missed day only while its
 * streak is active. A restart within the same week never replenishes spent
 * freezes; only the next Monday does. Frozen days do not increase the count.
 * The current day is never marked missed until it has ended.
 * Days before the first completion are inactive, not freezes.
 */
/* Persisted freeze dates never change when earlier completions are edited.
   Existing habits are migrated once using the legacy freeze calculation. */
function legacyEvaluateHabit(habit, asOf=todayKey()){
 const completed=new Set(habit.completions.filter(k=>k<=asOf));
 const first=[...completed].sort()[0],states=new Map();
 if(!first)return {states};
 let active=false,streak=0,used=0,prevWeek=null;
 const start=first<habit.createdDate?first:habit.createdDate;
 let iterations=0;
 for(let d=parseKey(start);dateKey(d)<=asOf&&iterations++<36525;d.setDate(d.getDate()+1)){
  const key=dateKey(d),wk=weekStart(key);
  if(wk!==prevWeek){used=0;prevWeek=wk;}
  if(completed.has(key)){streak=active?streak+1:1;active=true;states.set(key,'done');}
  else if(key===asOf){states.set(key,'today');}
  else if(active&&used<2){used++;states.set(key,'freeze');}
  else {active=false;streak=0;states.set(key,'missed');}
 }
 return {states};
}
function evaluateHabit(habit,asOf=todayKey()){
 const completed=new Set(habit.completions.filter(k=>k<=asOf));
 const frozen=new Set((habit.freezeDates||[]).filter(k=>k<=asOf));
 const dates=[...completed,...frozen].sort(),first=dates[0];
 const states=new Map();
 if(!first)return {streak:0,freezes:2,active:false,states,lastCompleted:null,doneToday:false};
 let active=false,streak=0,spent=0,prevWeek=null,lastCompleted=null,iterations=0;
 const start=first<habit.createdDate?first:habit.createdDate;
 for(let d=parseKey(start);dateKey(d)<=asOf&&iterations++<36525;d.setDate(d.getDate()+1)){
   const key=dateKey(d),week=weekStart(key);
   if(week!==prevWeek){spent=0;prevWeek=week;}
   if(frozen.has(key)){
     spent++;states.set(key,'freeze');
   }else if(completed.has(key)){
     streak=active?streak+1:1;active=true;lastCompleted=key;states.set(key,'done');
   }else if(key===asOf && asOf===todayKey()){
     states.set(key,'today');
   }else{
     active=false;streak=0;states.set(key,'missed');
   }
 }
 return {streak,freezes:Math.max(0,2-spent),active,states,lastCompleted,doneToday:completed.has(asOf)&&!frozen.has(asOf)};
}
function yesterdayKey(){return addDays(todayKey(),-1);}
const freezeReconciling=new Set();
async function reconcileFreezeLedger(id){
 if(!user||freezeReconciling.has(id))return;
 freezeReconciling.add(id);
 try{
  await runTransaction(db,async tx=>{
   const ref=habitDoc(id),snap=await tx.get(ref);if(!snap.exists())return;
   const raw=snap.data(),habit=normalise({id,...raw}),yesterday=yesterdayKey();
   if(!Array.isArray(raw.freezeDates)){
     const oldStates=legacyEvaluateHabit(habit,todayKey()).states;
     const locked=[...oldStates].filter(([key,state])=>state==='freeze'&&key<=yesterday).map(([key])=>key);
     tx.update(ref,{freezeDates:locked,freezeProcessedThrough:yesterday});
     return;
   }
   const previous=typeof raw.freezeProcessedThrough==='string'?raw.freezeProcessedThrough:yesterday;
   if(previous>=yesterday)return;
   const locks=new Set(habit.freezeDates);
   const allCompleted=new Set(habit.completions);
   let day=addDays(previous,1),guard=0;
   while(day<=yesterday&&guard++<36525){
     if(!allCompleted.has(day)&&!locks.has(day)){
       const prevInfo=evaluateHabit({...habit,freezeDates:[...locks]},addDays(day,-1));
       const weeklyLocked=[...locks].filter(k=>weekStart(k)===weekStart(day)).length;
       if(prevInfo.active&&weeklyLocked<2)locks.add(day);
     }
     day=addDays(day,1);
   }
   tx.update(ref,{freezeDates:[...locks].sort(),freezeProcessedThrough:yesterday});
  });
 }catch(error){console.error('Freeze synchronization',error);}
 finally{freezeReconciling.delete(id);}
}
function habitCollection(){ return collection(db,'users',user.uid,'habits'); }
function habitDoc(id){ return doc(db,'users',user.uid,'habits',id); }
function selectedHabit(){ return habits.find(h=>h.id===selectedId); }

function smallCalendar(h,info){
 const now=new Date(),year=now.getFullYear(),month=now.getMonth();
 const first=(new Date(year,month,1).getDay()+6)%7;
 const num=new Date(year,month+1,0).getDate();
 let days='<div class="mini-weekdays">M</div><div class="mini-weekdays">T</div><div class="mini-weekdays">W</div><div class="mini-weekdays">T</div><div class="mini-weekdays">F</div><div class="mini-weekdays">S</div><div class="mini-weekdays">S</div>';
 for(let i=0;i<first;i++)days+='<span class="mini-day blank"></span>';
 for(let n=1;n<=num;n++){
   const key=dateKey(new Date(year,month,n,12)),status=info.states.get(key);
   const cls=status==='done'?'done':status==='freeze'?'freeze':'';
   const flame=status==='done'||status==='freeze'?'<svg viewBox="0 0 24 24" class="mini-flame" aria-hidden="true"><use href="#flame-'+(status==='done'?'solid':'outline')+'"></use></svg>':'';
   days+='<span class="mini-day '+cls+'" title="'+key+'"><small>'+n+'</small>'+flame+'</span>';
 }
 return '<div class="mini-calendar"><div class="mini-month">'+now.toLocaleDateString('en-US',{month:'long',year:'numeric'})+'</div><div class="mini-calendar-grid">'+days+'</div></div>';
}
let holdCheckinTimer=null, activeHold=null, suppressCardClicksUntil=0;
let reorderSortable=null, stagedOrder=[];
let editorHabitId=null, editorMonth=null, editorBusy=false, editorCloseTimer=null;
const editorPreview=new Map(), editorSaveTimers=new Map(),editorInflight=new Set();
function renderDashboard(){
 const grid=el('habitGrid');
 grid.classList.toggle('calendar-layout',layoutMode==='calendar');
 el('layoutToggleBtn').setAttribute('aria-label',layoutMode==='calendar'?'Switch to compact cards':'Switch to calendar cards');
 el('layoutToggleBtn').title=layoutMode==='calendar'?'Compact cards':'Calendar cards';
 el('layoutToggleBtn').setAttribute('aria-pressed',String(layoutMode==='calendar'));
 grid.innerHTML=habits.map(h=>{
   const shown=pendingCheckins.has(h.id)?{...h,completions:[...new Set([...h.completions,todayKey()])]}:h;
   const info=evaluateHabit(shown);
   return '<div class="habit-card'+(info.doneToday?' completed-today':'')+'" data-id="'+escapeHTML(h.id)+'" data-done="'+info.doneToday+'" role="button" tabindex="0" aria-label="'+escapeHTML(h.name)+(layoutMode==='calendar'?' — tap to edit calendar':info.doneToday?' — hold to edit calendar':' — hold to check in')+'">'+
     '<span class="hold-progress" aria-hidden="true"></span>'+
     '<div class="habit-card-head"><h3>'+escapeHTML(h.name)+'</h3>'+
     (layoutMode==='calendar'?'<span class="mini-streak"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#flame-solid"></use></svg>'+info.streak+'</span>':'')+'</div>'+
     (layoutMode==='calendar'?smallCalendar(h,info):
     '<div class="card-bottom"><span class="card-streak"><svg class="card-flame" viewBox="0 0 24 24" aria-hidden="true"><use href="#flame-solid"></use></svg> '+info.streak+'</span><span class="card-arrow">↗</span></div>')+
     '</div>';
 }).join('');
 el('emptyState').hidden=habits.length!==0;

}

function clearCalendarTextSelection(){
 const selection=window.getSelection?.();
 if(selection && selection.rangeCount)selection.removeAllRanges();
}
function openCalendarEditor(id){
 const h=habits.find(h=>h.id===id);
 if(!h)return;
 if(!h.freezeProcessedThrough){showToast('Synchronizing your frozen days. Try again shortly.');return;}
 clearTimeout(editorCloseTimer);
 editorHabitId=id;editorMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);
 el('calendarEditor').classList.remove('closing');
 el('calendarEditor').hidden=false;
 document.body.classList.add('calendar-editor-open');
 clearCalendarTextSelection();
 renderCalendarEditor();
 // iOS can carry an active long-press selection into the newly opened editor.
 requestAnimationFrame(clearCalendarTextSelection);
}
function closeCalendarEditor(){
 const overlay=el('calendarEditor');if(overlay.hidden)return;
 const finish=()=>{overlay.hidden=true;overlay.classList.remove('closing');document.body.classList.remove('calendar-editor-open');editorHabitId=null;};
 if(window.matchMedia('(max-width:799px) and (prefers-reduced-motion: no-preference)').matches){
  overlay.classList.add('closing');clearTimeout(editorCloseTimer);editorCloseTimer=setTimeout(finish,280);
 }else finish();
}
function renderCalendarEditor(){
 const h=habits.find(h=>h.id===editorHabitId);if(!h){closeCalendarEditor();return;}
 const info=evaluateHabit(h),m=editorMonth||new Date(new Date().getFullYear(),new Date().getMonth(),1);
 el('calendarEditorTitle').textContent=h.name;
 el('editorMonthTitle').textContent=m.toLocaleDateString('en-US',{month:'long',year:'numeric'});
 el('editorNextMonth').disabled=new Date(m.getFullYear(),m.getMonth()+1,1)>new Date(new Date().getFullYear(),new Date().getMonth(),1);
 const first=(m.getDay()+6)%7,n=new Date(m.getFullYear(),m.getMonth()+1,0).getDate();
 let html='';
 for(let i=0;i<Math.ceil((first+n)/7)*7;i++){
  const d=new Date(m.getFullYear(),m.getMonth(),i-first+1,12);
  const inMonth=d.getMonth()===m.getMonth(),key=dateKey(d),state=info.states.get(key);
  const freeze=state==='freeze';
  const previewKey=editorHabitId+':'+key;
  const done=freeze?false:(editorPreview.has(previewKey)?editorPreview.get(previewKey):state==='done');
  const locked=!inMonth||key>todayKey()||freeze;
  const cls=[done?'done':'',freeze?'freeze':'',!inMonth?'outside':''].filter(Boolean).join(' ');
  const flame=(done||freeze)?'<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#flame-'+(done?'solid':'outline')+'"></use></svg>':'';
  html+='<button type="button" class="editor-day '+cls+'" data-date="'+key+'" aria-label="'+key+': '+(freeze?'freeze locked':done?'completed':'not completed')+'" aria-pressed="'+done+'" '+(locked?'disabled':'')+'><span>'+d.getDate()+'</span>'+flame+'</button>';
 }
 el('editorCalendarDays').innerHTML=html;
}
function toggleEditorDate(key){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(key)||key>todayKey())return;
 const id=editorHabitId,habit=habits.find(h=>h.id===id);
 if(!habit||evaluateHabit(habit).states.get(key)==='freeze')return;
 const previewKey=id+':'+key;
 const current=editorPreview.has(previewKey)?editorPreview.get(previewKey):habit.completions.includes(key);
 editorPreview.set(previewKey,!current);
 renderCalendarEditor();
 clearTimeout(editorSaveTimers.get(previewKey));
 editorSaveTimers.set(previewKey,setTimeout(()=>saveEditorDate(id,key),210));
}
async function saveEditorDate(id,key){
 const previewKey=id+':'+key;
 if(!editorPreview.has(previewKey) || editorInflight.has(previewKey))return;
 const desired=editorPreview.get(previewKey);
 editorSaveTimers.delete(previewKey);
 editorInflight.add(previewKey);
 let saved=false;
 try{
  await runTransaction(db,async tx=>{
   const ref=habitDoc(id),snap=await tx.get(ref);
   if(!snap.exists())throw Error('Habit no longer exists');
   if(!Array.isArray(snap.data().freezeDates))throw Error('Freeze history is still synchronizing');
   const record=normalise({id,...snap.data()});
   if(record.freezeDates.includes(key))throw Error('Blue freeze dates are locked');
   const dates=new Set(record.completions);
   if(desired)dates.add(key);else dates.delete(key);
   tx.update(ref,{completions:[...dates].sort()});
  });
  saved=true;
 }catch(error){showToast(errorMessage(error));}
 finally{
  editorInflight.delete(previewKey);
  if(!saved)editorPreview.delete(previewKey);
  else if(editorPreview.get(previewKey)!==desired){
   clearTimeout(editorSaveTimers.get(previewKey));
   editorSaveTimers.set(previewKey,setTimeout(()=>saveEditorDate(id,key),100));
  }else{
   const current=habits.find(h=>h.id===id);
   if(current && current.completions.includes(key)===desired)editorPreview.delete(previewKey);
  }
  if(editorHabitId===id)renderCalendarEditor();
 }
}
function renderReorderList(){
 const list=el('reorderList');
 stagedOrder=habits.map(h=>h.id);
 list.innerHTML=habits.map(h=>{
   const info=evaluateHabit(h);
   return '<div class="reorder-card" data-id="'+escapeHTML(h.id)+'" tabindex="0" aria-label="Rearrange '+escapeHTML(h.name)+'">'+
     '<button type="button" class="reorder-delete" data-delete="'+escapeHTML(h.id)+'" aria-label="Delete '+escapeHTML(h.name)+'">×</button>'+
     '<div class="reorder-card-name">'+escapeHTML(h.name)+'</div>'+
     '<div class="reorder-card-foot"><span class="reorder-card-streak"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#flame-solid"></use></svg>'+info.streak+'</span><span class="reorder-grip" aria-hidden="true">⠿</span></div></div>';
 }).join('');
 if(reorderSortable){reorderSortable.destroy();reorderSortable=null;}
 if(window.Sortable){
   reorderSortable=window.Sortable.create(list,{
     animation:240, easing:'cubic-bezier(.2,.8,.2,1)',
     draggable:'.reorder-card',
     filter:'.reorder-delete',
     preventOnFilter:false,
     forceFallback:true,fallbackOnBody:true,fallbackTolerance:2,
     delay:175,delayOnTouchOnly:true,touchStartThreshold:5,
     chosenClass:'reorder-chosen',ghostClass:'reorder-placeholder',
     fallbackClass:'reorder-floating',
     swapThreshold:.62,scroll:true,scrollSensitivity:60,
     onEnd:()=>{stagedOrder=[...list.querySelectorAll('.reorder-card')].map(row=>row.dataset.id);}
   });
 }
 list.querySelectorAll('.reorder-delete').forEach(button=>button.addEventListener('click',async event=>{
   event.stopPropagation();
   const id=button.dataset.delete;
   const habit=habits.find(h=>h.id===id);
   if(!habit||!confirm('Delete “'+habit.name+'” and all its history? This cannot be undone.'))return;
   await withBusy(async()=>{
     await deleteDoc(habitDoc(id));
     showToast('Habit deleted');
     // Firebase subscription will refresh this grid, excluding the deleted habit.
   });
 }));
 list.querySelectorAll('.reorder-card').forEach(card=>card.addEventListener('keydown',e=>{
   if(e.target!==card||(e.key!=='ArrowUp'&&e.key!=='ArrowDown'&&e.key!=='ArrowLeft'&&e.key!=='ArrowRight'))return;
   e.preventDefault();
   const items=[...list.querySelectorAll('.reorder-card')];
   const index=items.indexOf(card),direction=(e.key==='ArrowUp'||e.key==='ArrowLeft')?-1:1;
   const other=items[index+direction];if(!other)return;
   if(direction<0)list.insertBefore(card,other);else list.insertBefore(other,card);
   stagedOrder=[...list.querySelectorAll('.reorder-card')].map(row=>row.dataset.id);
   card.focus();
 }));
}
async function saveReorderedHabits(){
 const ids=[...el('reorderList').querySelectorAll('.reorder-card')].map(x=>x.dataset.id);
 if(ids.length!==habits.length||new Set(ids).size!==habits.length){showToast('Habit list changed. Open rearrange again.');return;}
 if(ids.every((id,i)=>id===habits[i].id)){showToast('Order already saved');return;}
 await withBusy(async()=>{
   const batch=writeBatch(db);
   ids.forEach((id,i)=>batch.update(habitDoc(id),{order:i}));
   await batch.commit();
   showToast('New habit order saved');
   if(!desktopSettings.matches)backToAccountHome();
 });
}
const pendingCheckins=new Map();
let holdDelayTimer=null;
function stopHold(cancelClick=false){
 clearTimeout(holdDelayTimer);
 clearTimeout(holdCheckinTimer);
 holdDelayTimer=null;holdCheckinTimer=null;
 const held=activeHold;
 if(held?.element)held.element.classList.remove('holding');
 if(held && (cancelClick || held.progressStarted)){
   suppressCardClicksUntil=Date.now()+750;
 }
 activeHold=null;
}
async function checkInHabit(id){
 if(busy||!user||pendingCheckins.has(id))return;
 const habit=habits.find(h=>h.id===id);
 if(!habit||evaluateHabit(habit).doneToday)return;
 const key=todayKey();
 pendingCheckins.set(id,key);
 renderDashboard(); // The completed card and streak number appear at the end of the hold.
 try{
   await runTransaction(db,async tx=>{
     const ref=habitDoc(id),snapshot=await tx.get(ref);
     if(!snapshot.exists())throw Error('Habit no longer exists');
     const dates=Array.isArray(snapshot.data().completions)?snapshot.data().completions:[];
     if(!dates.includes(key))tx.update(ref,{completions:[...dates,key].sort()});
   });
   showToast('Today completed! 🔥');
 }catch(error){
   pendingCheckins.delete(id);
   renderDashboard();
   showToast(errorMessage(error));
 }
}
async function quickDeleteHabit(id){
  const h=habits.find(x=>x.id===id);if(!h)return;
  if(!confirm(`Delete “${h.name}” and its streak history? This cannot be undone.`))return;
  await withBusy(async()=>{await deleteDoc(habitDoc(id));showToast('Habit deleted');});
}
let detailCloseTimer=null;
function openHabit(id){
 clearTimeout(detailCloseTimer);
 el('detail').classList.remove('closing');
 selectedId=id;
 shownMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);
 renderDetail();
 display('detail');
 el('detail').querySelector('.babbel-panel').scrollTop=0;
}
function closeHabit(){
 if(el('detail').hidden)return;
 if(window.matchMedia('(min-width:800px), (prefers-reduced-motion: reduce)').matches){
   selectedId=null;renderDashboard();display('dashboard');return;
 }
 el('detail').classList.add('closing');
 detailCloseTimer=setTimeout(()=>{
   selectedId=null;
   renderDashboard();
   display('dashboard');
   el('detail').classList.remove('closing');
 },300);
}
function renderDetail(){
  const h=selectedHabit();if(!h){selectedId=null;display('dashboard');return;}
  const data=evaluateHabit(h);
  el('detailHabitName').textContent=h.name;
  el('detailStreak').innerHTML=`<em>${data.streak}-day</em> streak`;
  el('detailSubtitle').textContent=`Complete ${h.name} to keep your streak going.`;
  el('freezeTitle').textContent=`${data.freezes} Streak Freeze${data.freezes===1?'':'s'} left`;
  drawCalendar(h,data);
}
function drawCalendar(h,data){
  const month=shownMonth||new Date(new Date().getFullYear(),new Date().getMonth(),1);
  el('monthTitle').textContent=month.toLocaleDateString('en-US',{month:'long',year:'numeric'});
  const firstWeekday=(month.getDay()+6)%7; const numDays=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
  const total=Math.ceil((firstWeekday+numDays)/7)*7;
  const realToday=todayKey();
  let html='';
  for(let i=0;i<total;i++){
    const date=new Date(month.getFullYear(),month.getMonth(),i-firstWeekday+1,12);
    const key=dateKey(date);const outside=date.getMonth()!==month.getMonth();
    const status=data.states.get(key); const future=key>realToday;
    const classes=['calendar-day',outside?'outside':'',status==='done'?'done':'',status==='freeze'?'freeze':'',key===realToday?'today':'',future?'future':''].filter(Boolean).join(' ');
    const icon = status==='done' || status==='freeze' || (key>=h.createdDate && !outside && key<=realToday && !status) ? `<svg class="day-flame" aria-hidden="true" viewBox="0 0 24 24"><use href="#flame-${status==='done'?'solid':'outline'}"></use></svg>` : '';
    const label = status==='done'?'Completed':status==='freeze'?'Streak freeze':future?'Future day':'Not completed';
    html+=`<div class="${classes}" aria-label="${key}: ${label}" title="${escapeHTML(key)} • ${label}"><span class="number">${date.getDate()}</span>${icon}</div>`;
  }
  el('calendarDays').innerHTML=html;
}
async function withBusy(fn){if(busy)return;busy=true;try{await fn();setSync('Synced',true);}catch(err){console.error(err);showToast(errorMessage(err));setSync('Sync issue');}finally{busy=false;if(selectedId)renderDetail();}}
function errorMessage(err){if(err?.code==='permission-denied')return 'Database permission denied. Check Firestore rules.';if(err?.code==='auth/unauthorized-domain')return 'Add this website domain to Firebase authorized domains.';return err?.message||'Something went wrong. Please try again.';}
async function checkIn(){const h=selectedHabit();if(h)await checkInHabit(h.id);}
function showModal(edit=false){
 modalEditingId=edit?selectedId:null;
 el('modalTitle').textContent=edit?'Edit habit':'New habit';el('saveHabit').textContent=edit?'Save changes':'Create habit';
 el('habitName').value=edit?(selectedHabit()?.name||''):'';
 el('editOnly').hidden=!edit;el('modalBackdrop').hidden=false;el('habitName').focus();
}
function hideModal(){el('modalBackdrop').hidden=true;modalEditingId=null;}
async function saveHabit(event){event.preventDefault();const name=el('habitName').value.trim();if(!name)return;const editing=modalEditingId;hideModal();await withBusy(async()=>{
 if(editing){await runTransaction(db,async tx=>{const ref=habitDoc(editing);if(!(await tx.get(ref)).exists())throw Error('Habit not found');tx.update(ref,{name});});showToast('Habit renamed');}
 else{await addDoc(habitCollection(),{name,createdDate:todayKey(),completions:[],freezeDates:[],freezeProcessedThrough:yesterdayKey(),createdAt:Date.now(),order:habits.length?Math.max(...habits.map((h,i)=>h.order??i))+1:0});showToast('Habit created!');}
});}
async function removeHabit(){const h=selectedHabit();if(!h)return;if(!confirm(`Delete “${h.name}” and all its check-in history? This cannot be undone.`))return;hideModal();await withBusy(async()=>{await deleteDoc(habitDoc(h.id));selectedId=null;display('dashboard');showToast('Habit deleted');});}
function exportBackup(){if(!user)return;const data={app:'my-streaks',version:1,exportedAt:new Date().toISOString(),habits:habits.map(({name,createdDate,completions})=>({name,createdDate,completions}))};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`my-streaks-backup-${todayKey()}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);showToast('Backup downloaded');}
async function importBackup(file){if(!file||!user)return;let data;try{data=JSON.parse(await file.text());}catch{showToast('That is not a valid JSON file');return;}
 if(data?.app!=='my-streaks'||!Array.isArray(data.habits)||data.habits.length>500){showToast('Invalid My Streaks backup');return;}
 if(!confirm(`Import ${data.habits.length} habits as new habits? This will not overwrite your current habits.`))return;
 await withBusy(async()=>{
  for(let i=0;i<data.habits.length;i+=300){const batch=writeBatch(db);for(const record of data.habits.slice(i,i+300)){
    if(typeof record.name!=='string'||!record.name.trim()||record.name.length>60||!/^\d{4}-\d{2}-\d{2}$/.test(record.createdDate)||!Array.isArray(record.completions))throw Error('Invalid backup contents');
    const clean=normalise({...record,id:'new'});const ref=doc(habitCollection());batch.set(ref,{name:clean.name,createdDate:clean.createdDate,completions:clean.completions,createdAt:Date.now()});
  }await batch.commit();}showToast('Backup imported');
 });}
function signIn(){signInWithPopup(auth,provider).catch(async err=>{if(['auth/popup-blocked','auth/operation-not-supported-in-this-environment'].includes(err.code)){try{await signInWithRedirect(auth,provider);}catch(e){showToast(errorMessage(e));}}else if(err.code!=='auth/popup-closed-by-user'){showToast(errorMessage(err));}});}
getRedirectResult(auth).catch(err=>showToast(errorMessage(err)));
onAuthStateChanged(auth,u=>{
 if(unsubscribe){unsubscribe();unsubscribe=null;}
 clearTimeout(initialLoadTimer);
 const currentEpoch=++initialLoadEpoch;
 user=u;habits=[];selectedId=null;
 stopHold();
 if(unsubscribePrefs){unsubscribePrefs();unsubscribePrefs=null;}
 el('userBtn').hidden=!u;el('accountMenu').hidden=true;document.body.classList.remove('account-open');el('userBtn').setAttribute('aria-expanded','false');
 if(!u){setSync('Not signed in');document.body.classList.remove('desktop-settings-route');display('loginPanel');return;}
 profileName=u.displayName||u.email?.split('@')[0]||'there';showProfile();
 el('accountEmail').textContent=u.email||'Signed in';setSync('Syncing…');display('loadingPanel');
 const oldError=el('streakStartupError');if(oldError)oldError.remove();
 let firstSnapshotReceived=false;
 initialLoadTimer=setTimeout(async()=>{
   if(currentEpoch!==initialLoadEpoch||firstSnapshotReceived||!user)return;
   try{
     // A one-time fetch recovers from delayed realtime listeners.
     const snapshot=await getDocs(habitCollection());
     if(currentEpoch===initialLoadEpoch&&!firstSnapshotReceived){
       applyHabitSnapshot(snapshot);
       firstSnapshotReceived=true;
     }
   }catch(error){startupError(error);}
 },7500);
 unsubscribePrefs=onSnapshot(preferencesDoc(),snapshot=>{
    const prefs=snapshot.exists()?snapshot.data():{};
    profileName=prefs.displayName||u.displayName||u.email?.split('@')[0]||'there';
    themeMode=['light','dark','system'].includes(prefs.appearance)?prefs.appearance:'system';
    layoutMode=prefs.layout==='calendar'?'calendar':'cards';
    document.querySelectorAll('input[name="appearanceMode"]').forEach(input=>input.checked=input.value===themeMode);
    applyTheme();showProfile();if(!el('dashboard').hidden)renderDashboard();
 },err=>console.error('Settings sync issue',err));
 unsubscribe=onSnapshot(habitCollection(),snapshot=>{
   if(currentEpoch!==initialLoadEpoch)return;
   try{
     applyHabitSnapshot(snapshot);
     firstSnapshotReceived=true;
     clearTimeout(initialLoadTimer);
   }catch(error){startupError(error);}
 },error=>{
   if(currentEpoch!==initialLoadEpoch)return;
   clearTimeout(initialLoadTimer);
   startupError(error);
 });
});
el('googleLogin').addEventListener('click',signIn);
const accountSections=[
 ['accountSettingsBtn','accountSettingsDetail','Settings'],
 ['accountAppearanceBtn','accountAppearanceDetail','Appearance'],
 ['accountBackupBtn','accountBackupDetail','Backup & restore'],
 ['accountReorderBtn','accountReorderDetail','Rearrange habits']
];
const desktopSettings=window.matchMedia('(min-width:800px)');
function showAccountSection(which,navigate=true){
 const selected=accountSections.find(x=>x[0]===which)||accountSections[0];
 for(const [buttonId,detailId] of accountSections){
   const active=buttonId===selected[0];
   el(detailId).hidden=!active;
   el(buttonId).setAttribute('aria-expanded',String(active));
   el(buttonId).classList.toggle('selected',active);
 }
 if(selected[0]==='accountReorderBtn')renderReorderList();
 el('accountSubTitle').textContent=selected[2];
 if(desktopSettings.matches && navigate)navigateSettings(selected[0]);
 el('accountMenu').querySelector('.account-sheet').classList.add('section-open');
 el('accountSubpage').setAttribute('aria-hidden','false');
 el('accountSubpage').scrollTop=0;
 if(!desktopSettings.matches)el('accountSubBack').focus({preventScroll:true});
}
const settingsRoutes={
 accountSettingsBtn:'settings',
 accountAppearanceBtn:'settings/appearance',
 accountReorderBtn:'settings/rearrange',
 accountBackupBtn:'settings/backup'
};
function sectionFromPath(){
 const root='/my-streaks/';
 const p=decodeURIComponent(location.pathname);
 const route=p.startsWith(root)?p.slice(root.length).replace(/\/$/,''):'';
 return Object.keys(settingsRoutes).find(k=>settingsRoutes[k]===route)|| (route.startsWith('settings')?'accountSettingsBtn':null);
}
function navigateSettings(section){
 const target='/my-streaks/'+settingsRoutes[section]+'/';
 // Desktop settings are client-side routed so switching sections never
 // reinitializes Firebase or flashes the startup loading screen.
 if(location.pathname!==target)history.pushState({section},'',target);
 syncDesktopRoute();
 window.scrollTo(0,0);
}
function exitDesktopSettings(){
 if(!desktopSettings.matches)return;
 if(location.pathname!=='/my-streaks/')history.pushState({},'','/my-streaks/');
 syncDesktopRoute();
}
function syncDesktopRoute(){
 const active=desktopSettings.matches && !!user && !!sectionFromPath();
 const account=el('accountMenu');
 document.body.classList.toggle('desktop-settings-route',active);
 if(active){
   account.hidden=false;
   account.setAttribute('aria-modal','false');
   document.body.classList.remove('account-open');
   el('userBtn').setAttribute('aria-expanded','true');
   showAccountSection(sectionFromPath(),false);
 }else if(desktopSettings.matches){
   account.hidden=true;
   account.setAttribute('aria-modal','false');
   el('userBtn').setAttribute('aria-expanded','false');
 }
}
window.addEventListener('popstate',()=>{
 if(desktopSettings.matches)syncDesktopRoute();
 else if(!el('accountMenu').hidden)backToAccountHome();
});
let accountCloseTimer=null, subpageBackTimer=null;
function backToAccountHome(){
 if(desktopSettings.matches)return;
 clearTimeout(subpageBackTimer);
 const sheet=el('accountMenu').querySelector('.account-sheet');
 sheet.classList.remove('section-open');
 el('accountSubpage').setAttribute('aria-hidden','true');
 subpageBackTimer=setTimeout(()=>{
   for(const [btn,detail] of accountSections){el(btn).setAttribute('aria-expanded','false');el(detail).hidden=true;}
 },325);
 el('accountSettingsBtn').focus({preventScroll:true});
}
function setAccountMenu(open){
 if(desktopSettings.matches){
   if(open)navigateSettings('accountSettingsBtn');else exitDesktopSettings();
   return;
 }
 clearTimeout(accountCloseTimer);
 const account=el('accountMenu'),sheet=account.querySelector('.account-sheet');
 if(open){
   account.hidden=false;
   sheet.classList.remove('closing');
   document.body.classList.add('account-open');
   el('userBtn').setAttribute('aria-expanded','true');
   if(desktopSettings.matches)showAccountSection('accountSettingsBtn');
   else{
     sheet.classList.remove('section-open');
     el('accountSubpage').setAttribute('aria-hidden','true');
     for(const [btn,detail] of accountSections){el(btn).setAttribute('aria-expanded','false');el(detail).hidden=true;}
   }
   el('closeAccountMenu').focus({preventScroll:true});
 }else{
   el('userBtn').setAttribute('aria-expanded','false');
   const finish=()=>{
     account.hidden=true;sheet.classList.remove('closing');
     document.body.classList.remove('account-open');
   };
   if(!desktopSettings.matches&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
     sheet.classList.add('closing');accountCloseTimer=setTimeout(finish,290);
   }else finish();
   if(user&&!el('userBtn').hidden)el('userBtn').focus({preventScroll:true});
 }
}
el('userBtn').addEventListener('click',()=>desktopSettings.matches?navigateSettings('accountSettingsBtn'):setAccountMenu(el('accountMenu').hidden));
el('closeAccountMenu').addEventListener('click',()=>setAccountMenu(false));
el('accountScrim').addEventListener('click',()=>setAccountMenu(false));
el('accountSubBack').addEventListener('click',backToAccountHome);
desktopSettings.addEventListener?.('change',()=>{
 if(desktopSettings.matches)syncDesktopRoute();
 else if(document.body.classList.contains('desktop-settings-route')){
   document.body.classList.remove('desktop-settings-route');
   el('accountMenu').hidden=true;
 }
});

document.querySelectorAll('input[name="appearanceMode"]').forEach(input=>input.addEventListener('change',()=>{if(!input.checked)return;themeMode=input.value;applyTheme();savePreference({appearance:themeMode});}));
for(const [buttonId] of accountSections)el(buttonId).addEventListener('click',()=>showAccountSection(buttonId));
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'){
   if(!el('calendarEditor').hidden){closeCalendarEditor();return;}
   if(!el('accountMenu').hidden){
     if(!desktopSettings.matches&&el('accountMenu').querySelector('.account-sheet').classList.contains('section-open'))backToAccountHome();
     else setAccountMenu(false);
   }else if(!el('modalBackdrop').hidden)hideModal();
   else if(!el('detail').hidden)closeHabit();
 }
 if(event.key==='Tab'&&!el('accountMenu').hidden){
   const region=desktopSettings.matches?el('accountMenu'):(el('accountMenu').querySelector('.account-sheet').classList.contains('section-open')?el('accountSubpage'):el('accountMenu').querySelector('.account-navigation'));
   const controls=[...region.querySelectorAll('button:not([disabled]),input:not([disabled]),label[for]')].filter(e=>e.getClientRects().length&&e.closest('[hidden]')===null);
   if(!controls.length)return;
   const first=controls[0],last=controls[controls.length-1];
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
 }
});
el('layoutToggleBtn').addEventListener('click',()=>{layoutMode=layoutMode==='cards'?'calendar':'cards';renderDashboard();savePreference({layout:layoutMode});});
const grid=el('habitGrid');
grid.addEventListener('click',event=>{
 const card=event.target.closest('.habit-card');
 if(!card||!el('calendarEditor').hidden||Date.now()<suppressCardClicksUntil)return;
 if(layoutMode==='calendar')return;
 openHabit(card.dataset.id);
});
grid.addEventListener('keydown',event=>{
 if((event.key==='Enter'||event.key===' ')&&event.target.classList.contains('habit-card')){
   event.preventDefault();
   if(layoutMode==='calendar')openCalendarEditor(event.target.dataset.id);
   else openHabit(event.target.dataset.id);
 }
});
grid.addEventListener('pointerdown',event=>{
 const card=event.target.closest('.habit-card');
 if(!card||event.button>0||busy)return;
 // Mini-calendar layout is hold-only; compact completed cards also hold to edit.
 const miniCalendar=layoutMode==='calendar';
 const done=miniCalendar||card.dataset.done==='true',id=card.dataset.id;
 stopHold();
 activeHold={element:card,id,x:event.clientX,y:event.clientY,
   pointerId:event.pointerId,startedAt:performance.now(),progressStarted:false,
   editorHold:done};
 if(done){
   holdDelayTimer=setTimeout(()=>{
     if(!activeHold||activeHold.id!==id||!activeHold.editorHold)return;
     stopHold(true);
     suppressCardClicksUntil=Date.now()+900;
     openCalendarEditor(id);
   },470);
   return;
 }
 holdDelayTimer=setTimeout(()=>{
   const held=activeHold;
   if(!held||held.element!==card)return;
   held.progressStarted=true;
   card.classList.add('holding');
   holdCheckinTimer=setTimeout(async()=>{
     if(!activeHold||activeHold.element!==card)return;
     const targetId=activeHold.id;
     stopHold(true);
     if(navigator.vibrate)navigator.vibrate(12);
     await checkInHabit(targetId);
   },720);
 },190);
});
grid.addEventListener('pointermove',event=>{
 if(!activeHold||activeHold.pointerId!==event.pointerId)return;
 if(Math.hypot(event.clientX-activeHold.x,event.clientY-activeHold.y)>13)stopHold(true);
});
grid.addEventListener('pointerup',()=>stopHold(false));
for(const type of ['pointercancel','pointerleave'])grid.addEventListener(type,()=>stopHold(true));
grid.addEventListener('contextmenu',event=>{if(event.target.closest('.habit-card'))event.preventDefault();});
grid.addEventListener('selectstart',event=>{if(event.target.closest('.habit-card'))event.preventDefault();});
el('calendarEditor').addEventListener('selectstart',event=>event.preventDefault());
el('calendarEditor').addEventListener('dragstart',event=>event.preventDefault());
document.addEventListener('selectionchange',()=>{
 if(!el('calendarEditor').hidden)clearCalendarTextSelection();
});
grid.addEventListener('dragstart',event=>{if(event.target.closest('.habit-card'))event.preventDefault();});
el('saveReorderBtn').addEventListener('click',saveReorderedHabits);
el('cancelReorderBtn').addEventListener('click',()=>{if(!desktopSettings.matches)backToAccountHome();else showAccountSection('accountSettingsBtn');});
el('signOutBtn').addEventListener('click',()=>{setAccountMenu(false);signOut(auth).catch(err=>showToast(errorMessage(err)));});
el('addHabitBtn').addEventListener('click',()=>showModal());el('emptyAdd').addEventListener('click',()=>showModal());
el('closeCalendarEditor').addEventListener('click',closeCalendarEditor);
el('calendarEditorScrim').addEventListener('click',closeCalendarEditor);
el('editorPrevMonth').addEventListener('click',()=>{editorMonth=new Date(editorMonth.getFullYear(),editorMonth.getMonth()-1,1);renderCalendarEditor();});
el('editorNextMonth').addEventListener('click',()=>{editorMonth=new Date(editorMonth.getFullYear(),editorMonth.getMonth()+1,1);renderCalendarEditor();});
el('editorCalendarDays').addEventListener('click',e=>{const b=e.target.closest('.editor-day:not(:disabled)');if(b)toggleEditorDate(b.dataset.date);});
el('backBtn').addEventListener('click',closeHabit);
el('detailScrim').addEventListener('click',closeHabit);

el('editHabitBtn').addEventListener('click',()=>showModal(true));
el('habitForm').addEventListener('submit',saveHabit);
el('closeModal').addEventListener('click',hideModal);el('cancelModal').addEventListener('click',hideModal);
el('modalBackdrop').addEventListener('click',e=>{if(e.target===el('modalBackdrop'))hideModal();});
el('deleteHabit').addEventListener('click',removeHabit);
el('prevMonth').addEventListener('click',()=>{shownMonth=new Date(shownMonth.getFullYear(),shownMonth.getMonth()-1,1);renderDetail();});
el('nextMonth').addEventListener('click',()=>{shownMonth=new Date(shownMonth.getFullYear(),shownMonth.getMonth()+1,1);renderDetail();});
el('accountExport').addEventListener('click',exportBackup);
el('importFile').addEventListener('change',e=>{importBackup(e.target.files[0]);e.target.value='';});
