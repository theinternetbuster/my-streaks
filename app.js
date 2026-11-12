import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, collection, doc, onSnapshot, addDoc, runTransaction, deleteDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

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
let busy = false;
const dateKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const todayKey = () => dateKey(new Date());
const parseKey = key => { const [y,m,d] = key.split('-').map(Number); return new Date(y,m-1,d,12); };
const addDays = (key, n) => { const d = parseKey(key); d.setDate(d.getDate()+n); return dateKey(d); };
const weekStart = key => { const d=parseKey(key); const dow=(d.getDay()+6)%7; return addDays(key,-dow); };
function showToast(message){ const t=el('toast');t.textContent=message;t.classList.add('shown');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>t.classList.remove('shown'),3400); }
function setSync(message, online=false){ el('syncState').textContent=message; el('syncState').classList.toggle('online',online); }
function display(view){ ['loginPanel','loadingPanel','dashboard','detail'].forEach(id=>el(id).hidden=id!==view); document.body.classList.toggle('detail-mode',view==='detail'); }
function escapeHTML(str){ return String(str).replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function normalise(raw){ return {id:raw.id,name:String(raw.name||'Habit'),createdDate:raw.createdDate||todayKey(),completions:Array.isArray(raw.completions)?[...new Set(raw.completions.filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)))].sort():[]}; }

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
function renderDashboard(){
  const grid=el('habitGrid');
  grid.innerHTML=habits.map(h=>{const info=evaluateHabit(h);return `<button class="habit-card" data-id="${escapeHTML(h.id)}"><h3>${escapeHTML(h.name)}</h3><div class="card-bottom"><span class="card-streak"><span class="emoji">🔥</span> ${info.streak}</span><span class="card-arrow">↗</span></div></button>`;}).join('');
  grid.querySelectorAll('.habit-card').forEach(btn=>btn.addEventListener('click',()=>openHabit(btn.dataset.id)));
  el('emptyState').hidden=habits.length!==0;
}
function openHabit(id){selectedId=id;shownMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);renderDetail();display('detail');window.scrollTo(0,0);}
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
 else{await addDoc(habitCollection(),{name,createdDate:todayKey(),completions:[],createdAt:Date.now()});showToast('Habit created!');}
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
 el('userBtn').hidden=!u;el('accountMenu').hidden=true;
 if(!u){setSync('Not signed in');display('loginPanel');return;}
 el('accountEmail').textContent=u.email||'Signed in';setSync('Syncing…');display('loadingPanel');
 unsubscribe=onSnapshot(habitCollection(),snapshot=>{
   habits=snapshot.docs.map(s=>normalise({id:s.id,...s.data()})).sort((a,b)=>a.name.localeCompare(b.name));
   setSync(snapshot.metadata.hasPendingWrites?'Saving…':'Synced',!snapshot.metadata.hasPendingWrites);
   if(selectedId&&habits.some(h=>h.id===selectedId)){renderDetail();display('detail');}
   else{selectedId=null;renderDashboard();display('dashboard');}
 },err=>{console.error(err);setSync('Sync issue');display('dashboard');showToast(errorMessage(err));});
});
el('googleLogin').addEventListener('click',signIn);
el('userBtn').addEventListener('click',()=>el('accountMenu').hidden=!el('accountMenu').hidden);
el('signOutBtn').addEventListener('click',()=>signOut(auth).catch(err=>showToast(errorMessage(err))));
el('addHabitBtn').addEventListener('click',()=>showModal());el('emptyAdd').addEventListener('click',()=>showModal());
el('backBtn').addEventListener('click',()=>{selectedId=null;renderDashboard();display('dashboard');});
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
