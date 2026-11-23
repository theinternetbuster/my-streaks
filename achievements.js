/* Achievement celebrations for My Streaks. Existing awards stay unlocked. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const awards=[{id:'first',name:'First Spark',at:1,field:'total'},{id:'week',name:'One Week Strong',at:7,field:'best'},{id:'rhythm',name:'Two-Week Rhythm',at:14,field:'best'},{id:'month',name:'Thirty-Day Flame',at:30,field:'best'},{id:'century',name:'Century Club',at:100,field:'best'},{id:'fifty',name:'Every Day Counts',at:50,field:'total'},{id:'freeze',name:'Room for Life',at:1,field:'freezes'},{id:'many',name:'Many Paths',at:3,field:'breadth'}];
function start({db,doc,onSnapshot,setDoc,getHabits,evaluateHabit,longestFor,weeklyProtectedFor}){
 const sheet=$('achievementCelebration'),dot=$('achievementUnreadDot');
 if(!sheet||!dot)return {setUser(){},onHabitsChange(){},markRead(){},dispose(){}};
 let user=null,unsub=null,ready=false,habitsReady=false,pendingInitial=false,ledger=null,queue=[],showing=false,timer=null,saveQueue=Promise.resolve();
 const clone=x=>JSON.parse(JSON.stringify(x));
 function measures(){
   const habits=getHabits();
   const total=habits.reduce((n,h)=>n+(h.completions||[]).length,0);
   const breadth=habits.filter(h=>(h.completions||[]).length>0).length;
   const freezes=habits.reduce((n,h)=>n+(h.cadence==='weekly'?(weeklyProtectedFor?.(h)||0):(h.freezeDates||[]).length),0);
   // Each habit owns its streak; no summed streak across unrelated habits.
   const streaks=Object.fromEntries(habits.map(h=>[h.id,evaluateHabit(h).streak||0]));
   const best=Math.max(0,...habits.map(h=>longestFor?longestFor(h):(streaks[h.id]||0)));
   return {total,breadth,freezes,best,streaks};
 }
 function refreshDot(){
  dot.hidden=!ledger||!ledger.unread;
 }
 function commit(){
  if(!user||!ledger)return;
  const uid=user.uid,data=clone(ledger);
  saveQueue=saveQueue.catch(()=>{}).then(()=>setDoc(doc(db,'users',uid,'settings','achievementCelebrations'),data,{merge:false})).catch(e=>console.error('Achievement sync error',e));
 }
 function markRead(){if(!ledger||!ledger.unread)return;ledger.unread=false;refreshDot();commit();}
 function close(){clearTimeout(timer);sheet.hidden=true;showing=false;setTimeout(showNext,180);}
 sheet.addEventListener('click',e=>{if(e.target.closest('[data-celebration-close]')||e.target===sheet)close();});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!sheet.hidden)close();});
 function showNext(){
  if(showing||!queue.length||!user)return;
  showing=true;
  const x=queue.shift(),large=x.kind==='unlock';
  $('achievementCelebrationKicker').textContent=large?'ACHIEVEMENT UNLOCKED':'MILESTONE REACHED AGAIN';
  $('achievementCelebrationName').textContent=x.name;
  $('achievementCelebrationText').textContent=large?'A milestone worth remembering. Your effort adds up.':'You found your rhythm again. Keep moving at your own pace.';
  sheet.classList.toggle('small-celebration',!large);
  sheet.hidden=false;
  if(navigator.vibrate&&large)navigator.vibrate(25);
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){sheet.classList.add('reduce-celebration');}else sheet.classList.remove('reduce-celebration');
  timer=setTimeout(close,large?3600:2300);
 }
 function initializeExisting(){
  if(!user||!habitsReady||!pendingInitial||ready)return;
  // Bootstrap only after the habit snapshot arrives, never from an empty loading state.
  const m=measures(),unlocked={};
  for(const a of awards)if((m[a.field]||0)>=a.at)unlocked[a.id]=true;
  ledger={unlocked,unread:false,rearmed:{},last:m};
  pendingInitial=false;ready=true;refreshDot();commit();
 }
 function onHabitsChange(){
  habitsReady=true;
  initializeExisting();
  if(!user||!ready||!ledger)return;
  const scores=measures();
  const old=ledger.last||{total:0,breadth:0,freezes:0,best:0,streaks:{}};
  const newEvents=[];
  for(const a of awards){
   const value=scores[a.field]||0;
   if(value>=a.at&&!ledger.unlocked[a.id]){
    ledger.unlocked[a.id]=true;
    newEvents.push({name:a.name,kind:'unlock'});
   }
  }
  // A repeat 14-completion streak is recognized once per genuinely new run,
  // only after the counter fell below 14 in a previously observed snapshot.
  for(const [id,count] of Object.entries(scores.streaks)){
   const prev=Number(old.streaks?.[id])||0;
   const armed=ledger.rearmed?.[id]??false;
   if(count<14&&prev>=14){ledger.rearmed[id]=true;}
   if(count>=14&&prev<14&&armed&&ledger.unlocked.rhythm){
    newEvents.push({name:'Two-Week Rhythm',kind:'repeat'});
    ledger.rearmed[id]=false;
   }
  }
  ledger.last=scores;
  if(newEvents.length){
   ledger.unread=true;
   queue.push(newEvents.find(e=>e.kind==='unlock')||newEvents[0]);
   if(newEvents.length>1)queue[queue.length-1].name=newEvents.length+' achievements earned';
   refreshDot();commit();showNext();
  }else if(JSON.stringify(old)!==JSON.stringify(scores))commit();
 }
 function setUser(next){
  clearTimeout(timer);sheet.hidden=true;queue=[];showing=false;
  if(unsub)unsub();unsub=null;user=next;ledger=null;ready=false;habitsReady=false;pendingInitial=false;refreshDot();
  if(!user)return;
  const uid=user.uid;
  unsub=onSnapshot(doc(db,'users',uid,'settings','achievementCelebrations'),snap=>{
   if(user?.uid!==uid)return;
   if(!ready){
    if(snap.exists()){
     const r=snap.data();
     ledger={unlocked:r.unlocked||{},unread:!!r.unread,rearmed:r.rearmed||{},last:r.last||measures()};
    }else{
     pendingInitial=true;
     initializeExisting();
     return;
    }
    ready=true;refreshDot();return;
   }
   if(snap.metadata?.hasPendingWrites)return;
   const r=snap.data();
   if(!r||!ledger)return;
   ledger.unread=!!r.unread;
   refreshDot();
  },e=>console.error('Achievement sync',e));
 }
 function dispose(){if(unsub)unsub();clearTimeout(timer);}
 return {setUser,onHabitsChange,markRead,dispose};
}
window.MyStreaksAchievements={start};
})();