import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, collection, doc, onSnapshot, addDoc, runTransaction, deleteDoc, writeBatch, setDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

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
let user = null, unsubscribe = null, habits = [], selectedId = null, shownMonth = null, modalEditingId = null;
let editMode = false, layoutMode = 'cards', themeMode = 'system', profileName = '', unsubscribePrefs = null;
let sortableInstance = null, holdTimer = null, touchStart = null, suppressClickUntil = 0;
let busy = false;
const deviceScheme=window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme(){const resolved=themeMode==='system'?(deviceScheme.matches?'dark':'light'):themeMode;document.documentElement.dataset.theme=resolved;document.documentElement.style.colorScheme=resolved;}
applyTheme();
deviceScheme.addEventListener?.('change',()=>{if(themeMode==='system')applyTheme();});
function preferencesDoc(){return doc(db,'users',user.uid,'settings','preferences');}
function showProfile(){const name=(profileName||user?.displayName||user?.email?.split('@')[0]||'there').trim();const first=name.split(/\s+/)[0];el('userGreeting').textContent='Hi, '+first;el('accountGreeting').textContent=name.toLowerCase();if(document.activeElement!==el('profileName'))el('profileName').value=name;el('settingsEmail').textContent=user?.email||'';}
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
}
function escapeHTML(str){ return String(str).replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function normalise(raw){ return {id:raw.id,name:String(raw.name||'Habit'),createdDate:raw.createdDate||todayKey(),createdAt:Number(raw.createdAt)||0,order:Number.isFinite(raw.order)?raw.order:null,completions:Array.isArray(raw.completions)?[...new Set(raw.completions.filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)))].sort():[]}; }

/**
 * Two weekly freezes belong to each habit. Count a missed day only while its
 * streak is active. A restart within the same week never replenishes spent
 * freezes; only the next Monday does. Frozen days do not increase the count.
 * The current day is never marked missed until it has ended.
 * Days before the first completion are inactive, not freezes.
 */
function evaluateHabit(habit, asOf=todayKey()) {
  const completed = new Set(habit.completions.filter(k=>k<=asOf));
  const first = [...completed].sort()[0];
  const states = new Map();
  let active = false, streak = 0, freezesSpent = 0, prevWeek = null, lastCompleted = null;
  if(!first){ return {streak:0,freezes:2,active:false,states,lastCompleted:null,doneToday:false}; }
  const today = asOf;
  const firstKey = first < habit.createdDate ? first : habit.createdDate;
  const end = parseKey(today);
  const start = parseKey(firstKey);
  const maxDays = 36525;
  let iterations = 0;
  for(let d=new Date(start); d<=end && iterations<maxDays; d.setDate(d.getDate()+1),iterations++){
    const key = dateKey(d); const week=weekStart(key);
    if(week!==prevWeek){ freezesSpent=0; prevWeek=week; }
    if(completed.has(key)){
      streak = active ? streak+1 : 1;
      active=true; lastCompleted=key; states.set(key,'done');
    } else if(key===today){
      states.set(key,'today');
    } else if(active){
      if(freezesSpent<2){freezesSpent++;states.set(key,'freeze');}
      else {active=false;streak=0;states.set(key,'missed');}
    } else {states.set(key,'missed');}
  }
  return {streak,freezes:2-freezesSpent,active,states,lastCompleted,doneToday:completed.has(today)};
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
function setEditMode(enabled){
 editMode=enabled;
 const grid=el('habitGrid');
 grid.classList.toggle('editing',editMode);
 el('habitEditToolbar').hidden=!editMode;
 el('toolbarHint').hidden=editMode;
}
function renderDashboard(){
 const grid=el('habitGrid');
 grid.classList.toggle('calendar-layout',layoutMode==='calendar');
 el('layoutToggleBtn').setAttribute('aria-label',layoutMode==='calendar'?'Switch to compact cards':'Switch to calendar cards');
 el('layoutToggleBtn').title=layoutMode==='calendar'?'Compact cards':'Calendar cards';
 el('layoutToggleBtn').setAttribute('aria-pressed',String(layoutMode==='calendar'));
 grid.innerHTML=habits.map(h=>{
   const info=evaluateHabit(h);
   return '<div class="habit-card" data-id="'+escapeHTML(h.id)+'" role="button" tabindex="0" aria-label="Open '+escapeHTML(h.name)+' streak">'+
     '<button class="card-delete" type="button" aria-label="Delete '+escapeHTML(h.name)+'" data-delete="'+escapeHTML(h.id)+'">×</button>'+
     '<div class="habit-card-head"><h3>'+escapeHTML(h.name)+'</h3>'+
     (layoutMode==='calendar'?'<span class="mini-streak"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#flame-solid"></use></svg>'+info.streak+'</span>':'')+'</div>'+
     (layoutMode==='calendar'?smallCalendar(h,info):
     '<div class="card-bottom"><span class="card-streak"><svg class="card-flame" viewBox="0 0 24 24" aria-hidden="true"><use href="#flame-solid"></use></svg> '+info.streak+'</span><span class="card-arrow">↗</span></div>')+
     '</div>';
 }).join('');
 setEditMode(editMode);
 el('emptyState').hidden=habits.length!==0;
 if(!sortableInstance && window.Sortable){
   sortableInstance=window.Sortable.create(grid,{
      animation:250, easing:'cubic-bezier(.2,.8,.2,1)',
      delay:280, delayOnTouchOnly:true, touchStartThreshold:4,
      fallbackTolerance:1, forceFallback:true, fallbackOnBody:true,
      fallbackClass:'drag-following',
      chosenClass:'sortable-selected', ghostClass:'sortable-ghost',
      dragClass:'sortable-dragging',
      swapThreshold:0.66, invertSwap:false,
      scroll:true, scrollSensitivity:60, scrollSpeed:12,
      onChoose:()=>{clearTimeout(holdTimer);},
      onStart:()=>{clearTimeout(holdTimer);setEditMode(true);},
      onEnd:async()=>{
        suppressClickUntil=Date.now()+650;
        const ids=[...grid.querySelectorAll('.habit-card')].map(c=>c.dataset.id);
        if(ids.length!==habits.length||ids.every((id,i)=>id===habits[i].id))return;
        if(busy)return;
        await withBusy(async()=>{
           const batch=writeBatch(db);
           ids.forEach((id,i)=>batch.update(habitDoc(id),{order:i}));
           await batch.commit();
           showToast('Habit order saved');
        });
      }
   });
 }
}
async function quickDeleteHabit(id){
  const h=habits.find(x=>x.id===id);if(!h)return;
  if(!confirm(`Delete “${h.name}” and its streak history? This cannot be undone.`))return;
  await withBusy(async()=>{await deleteDoc(habitDoc(id));showToast('Habit deleted');});
}
function openHabit(id){selectedId=id;shownMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);renderDetail();display('detail');el('detail').scrollTop=0;}
function renderDetail(){
  const h=selectedHabit();if(!h){selectedId=null;display('dashboard');return;}
  const data=evaluateHabit(h);
  el('detailHabitName').textContent=h.name;
  el('detailStreak').innerHTML=`<em>${data.streak}-day</em> streak`;
  el('detailSubtitle').textContent=`Complete ${h.name} to keep your streak going.`;
  el('freezeTitle').textContent=`${data.freezes} Streak Freeze${data.freezes===1?'':'s'} left`;
  el('checkInBtn').textContent=data.doneToday?'✓ Completed today':'✓ Done today';
  el('checkInBtn').disabled=data.doneToday || busy;
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
async function checkIn(){const h=selectedHabit();if(!h)return;await withBusy(async()=>{
  const ref=habitDoc(h.id);const key=todayKey();
  await runTransaction(db,async tx=>{const snap=await tx.get(ref);if(!snap.exists())throw Error('Habit not found');const current=snap.data();const dates=Array.isArray(current.completions)?current.completions:[];if(!dates.includes(key))tx.update(ref,{completions:[...dates,key].sort()});});
  showToast('🔥 Today completed!');
});}
function showModal(edit=false){
 modalEditingId=edit?selectedId:null;
 el('modalTitle').textContent=edit?'Edit habit':'New habit';el('saveHabit').textContent=edit?'Save changes':'Create habit';
 el('habitName').value=edit?(selectedHabit()?.name||''):'';
 el('editOnly').hidden=!edit;el('modalBackdrop').hidden=false;el('habitName').focus();
}
function hideModal(){el('modalBackdrop').hidden=true;modalEditingId=null;}
async function saveHabit(event){event.preventDefault();const name=el('habitName').value.trim();if(!name)return;const editing=modalEditingId;hideModal();await withBusy(async()=>{
 if(editing){await runTransaction(db,async tx=>{const ref=habitDoc(editing);if(!(await tx.get(ref)).exists())throw Error('Habit not found');tx.update(ref,{name});});showToast('Habit renamed');}
 else{await addDoc(habitCollection(),{name,createdDate:todayKey(),completions:[],createdAt:Date.now(),order:habits.length?Math.max(...habits.map((h,i)=>h.order??i))+1:0});showToast('Habit created!');}
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
 user=u;habits=[];selectedId=null;
 editMode=false;
 if(unsubscribePrefs){unsubscribePrefs();unsubscribePrefs=null;}
 el('userBtn').hidden=!u;el('accountMenu').hidden=true;document.body.classList.remove('account-open');el('userBtn').setAttribute('aria-expanded','false');
 if(!u){setSync('Not signed in');display('loginPanel');return;}
 profileName=u.displayName||u.email?.split('@')[0]||'there';showProfile();
 el('accountEmail').textContent=u.email||'Signed in';setSync('Syncing…');display('loadingPanel');
 unsubscribePrefs=onSnapshot(preferencesDoc(),snapshot=>{
    const prefs=snapshot.exists()?snapshot.data():{};
    profileName=prefs.displayName||u.displayName||u.email?.split('@')[0]||'there';
    themeMode=['light','dark','system'].includes(prefs.appearance)?prefs.appearance:'system';
    layoutMode=prefs.layout==='calendar'?'calendar':'cards';
    document.querySelectorAll('input[name="appearanceMode"]').forEach(input=>input.checked=input.value===themeMode);
    applyTheme();showProfile();if(!el('dashboard').hidden)renderDashboard();
 },err=>console.error('Settings sync issue',err));
 unsubscribe=onSnapshot(habitCollection(),snapshot=>{
   habits=snapshot.docs.map(s=>normalise({id:s.id,...s.data()})).sort((a,b)=>(a.order??(1000000+a.createdAt))-(b.order??(1000000+b.createdAt))||a.name.localeCompare(b.name));
   setSync(snapshot.metadata.hasPendingWrites?'Saving…':'Synced',!snapshot.metadata.hasPendingWrites);
   if(selectedId&&habits.some(h=>h.id===selectedId)){renderDetail();display('detail');}
   else{selectedId=null;renderDashboard();display('dashboard');}
 },err=>{console.error(err);setSync('Sync issue');display('dashboard');showToast(errorMessage(err));});
});
el('googleLogin').addEventListener('click',signIn);
const accountSections=[
 ['accountSettingsBtn','accountSettingsDetail','Account & settings'],
 ['accountAppearanceBtn','accountAppearanceDetail','Appearance'],
 ['accountBackupBtn','accountBackupDetail','Backup & restore']
];
const desktopSettings=window.matchMedia('(min-width:800px)');
function showAccountSection(which){
 const selected=accountSections.find(x=>x[0]===which)||accountSections[0];
 for(const [buttonId,detailId] of accountSections){
   const active=buttonId===selected[0];
   el(detailId).hidden=!active;
   el(buttonId).setAttribute('aria-expanded',String(active));
   el(buttonId).classList.toggle('selected',active);
 }
 el('accountSubTitle').textContent=selected[2];
 el('accountMenu').querySelector('.account-sheet').classList.add('section-open');
 el('accountSubpage').setAttribute('aria-hidden','false');
 el('accountSubpage').scrollTop=0;
 if(!desktopSettings.matches)el('accountSubBack').focus({preventScroll:true});
}
function backToAccountHome(){
 if(desktopSettings.matches)return;
 el('accountMenu').querySelector('.account-sheet').classList.remove('section-open');
 el('accountSubpage').setAttribute('aria-hidden','true');
 for(const [btn,detail] of accountSections){el(btn).setAttribute('aria-expanded','false');el(detail).hidden=true;}
 el('accountSettingsBtn').focus({preventScroll:true});
}
function setAccountMenu(open){
 el('accountMenu').hidden=!open;
 document.body.classList.toggle('account-open',open);
 el('userBtn').setAttribute('aria-expanded',String(open));
 if(open){
   if(desktopSettings.matches)showAccountSection('accountSettingsBtn');
   else{
     el('accountMenu').querySelector('.account-sheet').classList.remove('section-open');
     el('accountSubpage').setAttribute('aria-hidden','true');
     for(const [btn,detail] of accountSections){el(btn).setAttribute('aria-expanded','false');el(detail).hidden=true;}
   }
   el('closeAccountMenu').focus({preventScroll:true});
 }else if(user&&!el('userBtn').hidden){el('userBtn').focus({preventScroll:true});}
}
el('userBtn').addEventListener('click',()=>setAccountMenu(el('accountMenu').hidden));
el('closeAccountMenu').addEventListener('click',()=>setAccountMenu(false));
el('accountScrim').addEventListener('click',()=>setAccountMenu(false));
el('accountSubBack').addEventListener('click',backToAccountHome);
desktopSettings.addEventListener?.('change',()=>{if(!el('accountMenu').hidden){if(desktopSettings.matches)showAccountSection('accountSettingsBtn');else backToAccountHome();}});
el('profileForm').addEventListener('submit',event=>{event.preventDefault();const value=el('profileName').value.trim();if(!value)return;profileName=value;showProfile();savePreference({displayName:value});});
document.querySelectorAll('input[name="appearanceMode"]').forEach(input=>input.addEventListener('change',()=>{if(!input.checked)return;themeMode=input.value;applyTheme();savePreference({appearance:themeMode});}));
for(const [buttonId] of accountSections)el(buttonId).addEventListener('click',()=>showAccountSection(buttonId));
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'){
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
el('finishEditingBtn').addEventListener('click',()=>setEditMode(false));
const grid=el('habitGrid');
grid.addEventListener('click',event=>{
 const deleteButton=event.target.closest('[data-delete]');
 if(deleteButton){event.stopPropagation();quickDeleteHabit(deleteButton.dataset.delete);return;}
 const card=event.target.closest('.habit-card');
 if(!card||editMode||Date.now()<suppressClickUntil)return;
 openHabit(card.dataset.id);
});
grid.addEventListener('keydown',event=>{
 if(event.key==='Escape'&&editMode){setEditMode(false);return;}
 if((event.key==='Enter'||event.key===' ')&&event.target.classList.contains('habit-card')){
   event.preventDefault();if(!editMode)openHabit(event.target.dataset.id);
 }
});
grid.addEventListener('pointerdown',event=>{
 if(event.target.closest('.card-delete'))return;
 const card=event.target.closest('.habit-card');if(!card||event.pointerType==='mouse')return;
 clearTimeout(holdTimer);touchStart={x:event.clientX,y:event.clientY};
 holdTimer=setTimeout(()=>{setEditMode(true);suppressClickUntil=Date.now()+500;},530);
});
grid.addEventListener('pointermove',event=>{
 if(touchStart&&(Math.abs(event.clientX-touchStart.x)>9||Math.abs(event.clientY-touchStart.y)>9))clearTimeout(holdTimer);
});
for(const type of ['pointerup','pointercancel','pointerleave'])grid.addEventListener(type,()=>{clearTimeout(holdTimer);touchStart=null;});
el('signOutBtn').addEventListener('click',()=>{setAccountMenu(false);signOut(auth).catch(err=>showToast(errorMessage(err)));});
el('addHabitBtn').addEventListener('click',()=>showModal());el('emptyAdd').addEventListener('click',()=>showModal());
function closeHabit(){selectedId=null;renderDashboard();display('dashboard');}
el('backBtn').addEventListener('click',closeHabit);
el('detailScrim').addEventListener('click',closeHabit);
el('checkInBtn').addEventListener('click',checkIn);
el('editHabitBtn').addEventListener('click',()=>showModal(true));
el('habitForm').addEventListener('submit',saveHabit);
el('closeModal').addEventListener('click',hideModal);el('cancelModal').addEventListener('click',hideModal);
el('modalBackdrop').addEventListener('click',e=>{if(e.target===el('modalBackdrop'))hideModal();});
el('deleteHabit').addEventListener('click',removeHabit);
el('prevMonth').addEventListener('click',()=>{shownMonth=new Date(shownMonth.getFullYear(),shownMonth.getMonth()-1,1);renderDetail();});
el('nextMonth').addEventListener('click',()=>{shownMonth=new Date(shownMonth.getFullYear(),shownMonth.getMonth()+1,1);renderDetail();});
el('exportBtn').addEventListener('click',exportBackup);el('accountExport').addEventListener('click',exportBackup);
el('importFile').addEventListener('change',e=>{importBackup(e.target.files[0]);e.target.value='';});
el('historyBtn').addEventListener('click',()=>{el('historyPanel').hidden=!el('historyPanel').hidden;el('historyDate').value=todayKey();});
el('historyDate').addEventListener('change',()=>{const h=selectedHabit();const k=el('historyDate').value;el('historyHint').textContent=h?.completions.includes(k)?'Currently completed':'Currently not completed';});
el('toggleHistoryBtn').addEventListener('click',()=>withBusy(async()=>{
 const h=selectedHabit(),key=el('historyDate').value;if(!h||!key||key>todayKey())throw Error('Choose today or a past date');
 await runTransaction(db,async tx=>{const ref=habitDoc(h.id);const snap=await tx.get(ref);if(!snap.exists())throw Error('Habit no longer exists');const current=snap.data();let dates=Array.isArray(current.completions)?current.completions:[];dates=dates.includes(key)?dates.filter(x=>x!==key):[...dates,key];tx.update(ref,{completions:[...new Set(dates)].sort()});});showToast('History updated');
}));
