/* Achievement celebrations for My Streaks. Existing awards stay unlocked. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const awards=[{id:'first',name:'First Spark',at:1,field:'total'},{id:'week',name:'One Week Strong',at:7,field:'best'},{id:'rhythm',name:'Two-Week Rhythm',at:14,field:'best'},{id:'month',name:'Thirty-Day Flame',at:30,field:'best'},{id:'century',name:'Century Club',at:100,field:'best'},{id:'fifty',name:'Every Day Counts',at:50,field:'total'},{id:'freeze',name:'Room for Life',at:1,field:'freezes'},{id:'many',name:'Many Paths',at:3,field:'breadth'},
 {id:'german1',name:'First Focused Hour',at:1,field:'studyHours'},
 {id:'german10',name:'Ten Hours of German',at:10,field:'studyHours'},
 {id:'german25',name:'Twenty-Five Hours',at:25,field:'studyHours'},
 {id:'german100',name:'German Century',at:100,field:'studyHours'}];
const awardMessages={
 "first": {
  "earned": "One check-in started something new. Every lasting habit begins with a single day.",
  "locked": "Complete your first habit check-in to light your first spark.",
  "repeat": "Another beginning, another opportunity to build momentum."
 },
 "week": {
  "earned": "Seven days of showing up. You've built a rhythm worth recognizing.",
  "locked": "Reach a seven-day streak with one habit to earn this milestone.",
  "repeat": "A full week again. You've returned to your rhythm."
 },
 "rhythm": {
  "earned": "Fourteen days of effort. Your consistency is becoming a pattern.",
  "locked": "Reach a fourteen-day streak with one habit to unlock this badge.",
  "repeat": "Two weeks again! You've found your rhythm after starting fresh."
 },
 "month": {
  "earned": "Thirty days of commitment. One day at a time has become a month of progress.",
  "locked": "Build a thirty-day streak with one habit to earn this crown.",
  "repeat": "Another month of momentum. That's a milestone worth noticing."
 },
 "century": {
  "earned": "One hundred days. Your small, repeated actions have added up to something remarkable.",
  "locked": "Reach a one-hundred-day streak with one habit to discover this gem.",
  "repeat": "A hundred days again. What an accomplishment."
 },
 "fifty": {
  "earned": "Fifty check-ins, fifty times you chose to follow through. Each one counts.",
  "locked": "Record fifty habit completions across your habits to unlock this achievement.",
  "repeat": "Your efforts continue to add up, one check-in at a time."
 },
 "freeze": {
  "earned": "You kept your progress through an imperfect day. Flexibility is part of consistency.",
  "locked": "Have a streak protected by a freeze to earn this achievement.",
  "repeat": "Another reminder that consistency can include some flexibility."
 },
 "many": {
  "earned": "Progress in three different habits. You're building more than one good routine.",
  "locked": "Record at least one completion in three different habits to earn this badge.",
  "repeat": "Three routines with real check-ins. Your efforts are taking shape."
 },
 "german1": {
  "earned": "Your first hour of German recorded in Focus Plans. A new chapter of your learning history begins.",
  "locked": "Complete one hour of German practice to unlock this achievement.",
  "repeat": "Another hour of recorded German practice."
 },
 "german10": {
  "earned": "Ten hours of German practice recorded here, one session at a time.",
  "locked": "Accumulate ten recorded hours of German practice in Focus Plans.",
  "repeat": "Another ten-hour milestone in your recorded study history."
 },
 "german25": {
  "earned": "Twenty-five recorded hours of listening, speaking, reading, and learning German.",
  "locked": "Reach twenty-five recorded hours of German practice in Focus Plans.",
  "repeat": "Another twenty-five-hour chapter in your German study history."
 },
 "german100": {
  "earned": "One hundred recorded hours of German practice. Every individual session built this total.",
  "locked": "Reach 100 hours of German practice to earn this golden crest.",
  "repeat": "A hundred recorded study hours is a milestone worth recognizing."
 }
};
function start({db,doc,onSnapshot,setDoc,getHabits,evaluateHabit,longestFor,weeklyProtectedFor,getStudyHours,visuals={}}){
 const sheet=$('achievementCelebration'),dot=$('achievementUnreadDot');
 if(!sheet||!dot)return {setUser(){},onHabitsChange(){},markRead(){},openDetail(){},isUnlocked(){return false},dispose(){}};
 const awardIcons={first:'flame',week:'sunrise',rhythm:'star',month:'crown',century:'gem',fifty:'calendar',freeze:'freeze',many:'layers',german1:'studybook',german10:'studyspeech',german25:'studycompass',german100:'studylaurel'};
 let user=null,unsub=null,ready=false,habitsReady=false,pendingInitial=false,ledger=null,queue=[],showing=false,timer=null,saveQueue=Promise.resolve(),lastPreview=null;
 const clone=x=>JSON.parse(JSON.stringify(x));
 function measures(){
   const habits=getHabits();
   const total=habits.reduce((n,h)=>n+(h.completions||[]).length,0);
   const breadth=habits.filter(h=>(h.completions||[]).length>0).length;
   const freezes=habits.reduce((n,h)=>n+(h.cadence==='weekly'?(weeklyProtectedFor?.(h)||0):(h.freezeDates||[]).length),0);
   // Each habit owns its streak; no summed streak across unrelated habits.
   const streaks=Object.fromEntries(habits.map(h=>[h.id,evaluateHabit(h).streak||0]));
   const best=Math.max(0,...habits.map(h=>longestFor?longestFor(h):(streaks[h.id]||0)));
   return {total,breadth,freezes,best,streaks,studyHours:Math.max(0,Number(getStudyHours?.()??0))};
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
 function close(){clearTimeout(timer);sheet.hidden=true;showing=false;lastPreview=null;sheet.classList.remove('preview-celebration');setTimeout(showNext,180);}
 function setAwardVisual(id){
  sheet.dataset.award=id;
  const node=sheet.querySelector('.achievement-celebration-medal');
  if(!node)return;
  const svg=visuals[awardIcons[id]];
  node.innerHTML=svg||'✦';
  // Restart the reveal when an achievement card is opened again.
  node.style.animation='none';void node.offsetWidth;node.style.animation='';
  sheet.classList.remove('award-revealing');void sheet.offsetWidth;sheet.classList.add('award-revealing');
 }
 sheet.addEventListener('click',e=>{if(e.target.closest('[data-celebration-close]')||e.target===sheet)close();});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!sheet.hidden)close();});
 function isUnlocked(id){
  // Many Paths reflects the recorded history, not an irreversible award.
  if(id==='many')return measures().breadth>=3;
  return !!ledger?.unlocked?.[id];
 }
 function openDetail(index){
  const a=awards[Number(index)];if(!a)return;
  clearTimeout(timer);queue=[];showing=true;lastPreview=a.id;
  const unlocked=isUnlocked(a.id)||(a.id!=='many'&&(measures()[a.field]||0)>=a.at);
  setAwardVisual(a.id);
  $('achievementCelebrationKicker').textContent=unlocked?'YOUR ACHIEVEMENT':'MILESTONE TO DISCOVER';
  $('achievementCelebrationName').textContent=a.name;
  $('achievementCelebrationText').textContent=awardMessages[a.id][unlocked?'earned':'locked'];
  sheet.classList.add('preview-celebration');sheet.classList.toggle('small-celebration',!unlocked);
  sheet.hidden=false;
  // A detail view remains open until dismissed, unlike automatic celebrations.
 }
 function showNext(){
  if(showing||!queue.length||!user)return;
  showing=true;sheet.classList.remove('preview-celebration');
  const x=queue.shift(),large=x.kind==='unlock';
  setAwardVisual(x.id||'first');
  $('achievementCelebrationKicker').textContent=large?'ACHIEVEMENT UNLOCKED':'MILESTONE REACHED AGAIN';
  $('achievementCelebrationName').textContent=x.name;
  $('achievementCelebrationText').textContent=awardMessages[x.id]?.[large?'earned':'repeat']||'Every step forward counts.';
  sheet.classList.toggle('small-celebration',!large);
  sheet.hidden=false;
  if(navigator.vibrate&&large)navigator.vibrate(25);
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){sheet.classList.add('reduce-celebration');}else sheet.classList.remove('reduce-celebration');
  timer=setTimeout(close,large?7200:4800);
 }
 function initializeExisting(){
  if(!user||!habitsReady||!pendingInitial||ready)return;
  // Bootstrap only after the habit snapshot arrives, never from an empty loading state.
  const m=measures(),unlocked={};
  for(const a of awards)if((m[a.field]||0)>=a.at)unlocked[a.id]=true;
  const rearmed={};
  if(unlocked.rhythm)for(const [id,count] of Object.entries(m.streaks))if(count<14)rearmed[id]=true;
  ledger={unlocked,celebrated:{...unlocked},unread:false,rearmed,last:m};
  pendingInitial=false;ready=true;refreshDot();commit();
 }
 function onHabitsChange(){
  habitsReady=true;
  initializeExisting();
  if(!user||!ready||!ledger)return;
  const scores=measures();
  const old=ledger.last||{total:0,breadth:0,freezes:0,best:0,streaks:{}};
  const newEvents=[];
  let corrected=false;
  // Correct accidental/unmarked check-ins: Many Paths is valid only while
  // three distinct habits still have recorded completions. Other lifetime
  // milestones remain earned if a genuine streak later ends.
  if(scores.breadth<3&&ledger.unlocked.many){ledger.unlocked.many=false;corrected=true;}
  for(const a of awards){
   const value=scores[a.field]||0;
   if(value>=a.at&&!ledger.unlocked[a.id]){
    ledger.unlocked[a.id]=true;corrected=true;
    // Never replay a first-time unlock just because a test entry was undone
    // and then re-added. The badge itself can always be previewed.
    if(!ledger.celebrated?.[a.id]){
      ledger.celebrated[a.id]=true;
      newEvents.push({id:a.id,name:a.name,kind:'unlock'});
    }
   }
  }
  // A repeat 14-completion streak is recognized once per genuinely new run,
  // only after the counter fell below 14 in a previously observed snapshot.
  for(const [id,count] of Object.entries(scores.streaks)){
   const prev=Number(old.streaks?.[id])||0;
   const armed=ledger.rearmed?.[id]??false;
   if(count<14&&prev>=14){ledger.rearmed[id]=true;}
   if(count>=14&&prev<14&&armed&&ledger.unlocked.rhythm){
    newEvents.push({id:'rhythm',name:'Two-Week Rhythm',kind:'repeat'});
    ledger.rearmed[id]=false;
   }
  }
  ledger.last=scores;
  if(newEvents.length){
   ledger.unread=true;
   queue.push(newEvents.find(e=>e.kind==='unlock')||newEvents[0]);
   if(newEvents.length>1)queue[queue.length-1].name=newEvents.length+' achievements earned';
   refreshDot();commit();showNext();
  }else if(corrected||JSON.stringify(old)!==JSON.stringify(scores))commit();
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
     ledger={unlocked:r.unlocked||{},celebrated:r.celebrated||{...(r.unlocked||{})},unread:!!r.unread,rearmed:r.rearmed||{},last:r.last||measures()};
    }else{
     pendingInitial=true;
     initializeExisting();
     return;
    }
    ready=true;refreshDot();
    // If data changed while the achievement listener was initializing,
    // reconcile against its saved baseline once, after loading.
    onHabitsChange();return;
   }
   if(snap.metadata?.hasPendingWrites)return;
   const r=snap.data();
   if(!r||!ledger)return;
   ledger.unread=!!r.unread;
   refreshDot();
  },e=>console.error('Achievement sync',e));
 }
 function dispose(){if(unsub)unsub();clearTimeout(timer);}
 return {setUser,onHabitsChange,markRead,openDetail,isUnlocked,dispose};
}
window.MyStreaksAchievements={start};
})();