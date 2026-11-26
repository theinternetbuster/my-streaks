/* Configuration import, with authenticated add-only atomic writes. */
(function(){
'use strict';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fail(m){throw new Error(m);}
function str(v,label,max=60){if(typeof v!=='string'||!v.trim()||v.trim().length>max)fail(label+' must be 1–'+max+' characters.');return v.trim();}
function num(v,label,min,max,whole=false){if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max||(whole&&!Number.isInteger(v)))fail(label+' must be '+min+'–'+max+'.');return v;}
function arr(v,label,max){if(v==null)return [];if(!Array.isArray(v)||v.length>max)fail(label+' must be an array of at most '+max+' items.');return v;}
function obj(v,label){if(!v||typeof v!=='object'||Array.isArray(v))fail(label+' must be an object.');return v;}
function color(v,def='#a78bfa'){if(v==null)return def;if(typeof v!=='string'||!/^#[0-9a-f]{6}$/i.test(v))fail('Use a six-digit hex color.');return v.toLowerCase();}
function icon(v,def='list'){if(v==null)return def;if(!window.MyStreaksIcons.valid(v))fail('Unknown icon: '+v);return v;}
function choice(v,values,label){if(!values.includes(v))fail('Invalid '+label+'.');return v;}
function date(v){if(!v)return '';if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))fail('Use YYYY-MM-DD for dates.');const d=new Date(v+'T12:00:00Z');if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==v)fail('Invalid date.');return v;}
function validate(raw){
 const r=obj(raw,'Configuration');
 if(r.app!=='my-streaks-config'||r.version!==1)fail('Expected app "my-streaks-config", version 1.');
 const allowed=['app','version','plans','goals','checklists','habits','achievements'];
 for(const k of Object.keys(r))if(!allowed.includes(k))fail('Unknown configuration field: '+k);
 const plans=arr(r.plans,'Plans',12).map(x=>{
  obj(x,'Plan');const activities=arr(x.activities,'Activities',12).map((a,j)=>{obj(a,'Activity');return {name:str(a.name,'Activity name',55),minutes:num(a.minutes,'Minutes',1,240,true),color:color(a.color,['#397cf2','#9159e8','#109b8d','#e2a039','#e57546','#75849b'][j%6])};});
  if(!activities.length)fail('Every plan needs at least one activity.');
  return {name:str(x.name,'Plan name',55),color:color(x.color),icon:icon(x.icon,'book'),activities};
 });
 const habits=arr(r.habits,'Habits',20).map(x=>{obj(x,'Habit');const cadence=choice(x.cadence??'daily',['daily','weekly'],'habit cadence');return {name:str(x.name,'Habit name'),cadence,weeklyTarget:cadence==='weekly'?num(x.weeklyTarget??2,'Weekly target',1,7,true):2};});
 const checklists=arr(r.checklists,'Checklists',12).map(x=>{
  obj(x,'Checklist');const tasks=arr(x.tasks,'Tasks',100).map(t=>{if(typeof t==='string')return {text:str(t,'Task',500),urgent:false};obj(t,'Task');return {text:str(t.text,'Task',500),urgent:t.urgent===true};});
  return {name:str(x.name,'Checklist name',40),icon:icon(x.icon),color:color(x.color,'#60a5fa'),tasks};
 });
 const goals=arr(r.goals,'Goals',30).map(x=>{
  obj(x,'Goal');const type=choice(x.type??'manual',['study','habit','manual','milestones'],'goal type');
  const steps=type==='milestones'?arr(x.steps,'Milestones',50).map(s=>str(s,'Milestone',120)):[];
  if(type==='milestones'&&!steps.length)fail('Milestone goals need steps.');
  const start=date(x.start),due=date(x.due);if(start&&due&&due<start)fail('Target date precedes start date.');
  return {name:str(x.name,'Goal name'),type,target:type==='milestones'?steps.length:num(x.target,'Goal target',0.01,1000000),unit:x.unit?str(x.unit,'Unit',25):'items',plan:type==='study'?str(x.plan??'German Practice','Plan reference',55):'',habit:type==='habit'?str(x.habit,'Habit reference'):'',start,due,color:choice(color(x.color),['#a78bfa','#60a5fa','#34d399','#f59e0b','#f472b6'],'goal color'),steps};
 });
 const achievements=arr(r.achievements,'Achievements',30).map(x=>{
  obj(x,'Achievement');const type=choice(x.type??'study',['study','habit'],'achievement type');
  return {name:str(x.name,'Achievement name'),description:x.description?str(x.description,'Description',160):'',type,target:num(x.target,'Achievement target',1,1000000,true),plan:type==='study'?str(x.plan??'German Practice','Plan reference',55):'',habit:type==='habit'?str(x.habit,'Habit reference'):'',icon:icon(x.icon,'trophy'),color:color(x.color)};
 });
 for(const group of [plans,habits,checklists,goals,achievements]){const names=group.map(x=>x.name.toLowerCase());if(new Set(names).size!==names.length)fail('Duplicate names in a category.');}
 if(![plans,habits,checklists,goals,achievements].some(x=>x.length))fail('Configuration is empty.');
 return {plans,habits,checklists,goals,achievements};
}
const id=p=>p+crypto.randomUUID().replace(/-/g,'').slice(0,24);
function named(ref,items,label){const matches=items.filter(x=>x.id===ref||String(x.name).toLowerCase()===ref.toLowerCase());if(matches.length!==1)fail('Cannot uniquely find '+label+' "'+ref+'".');return matches[0].id;}
async function apply(deps,c){
 const {db,doc,runTransaction,uid,getUser,getHabits,today,yesterday}=deps;
 const bytes=new TextEncoder().encode(JSON.stringify(c));
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const receiptKey='configImport-'+hash,keys=['focusPlanCatalog','goals','checklistLists','personalAchievements',receiptKey];
 const refs=Object.fromEntries(keys.map(k=>[k,doc(db,'users',uid,'settings',k)]));
 const pids=c.plans.map(()=>id('p')),hids=c.habits.map(()=>id('h')),lids=c.checklists.map(()=>id('b')),gids=c.goals.map(()=>id('g')),aids=c.achievements.map(()=>id('a'));
 const prefs=pids.map(k=>doc(db,'users',uid,'settings','focusPlan-'+k)),lrefs=lids.map(k=>doc(db,'users',uid,'settings','checklist-'+k)),hrefs=hids.map(k=>doc(db,'users',uid,'habits',k));
 const existingHabits=getHabits().map(h=>({id:h.id,name:h.name}));
 return runTransaction(db,async tx=>{
  if(getUser()?.uid!==uid)fail('Account changed. Reopen importer.');
  const snapshots=await Promise.all(keys.map(k=>tx.get(refs[k])));
  const data=Object.fromEntries(keys.map((k,i)=>[k,snapshots[i].data()||{}]));
  if(data[receiptKey].applied)return {duplicate:true};
  const taken=await Promise.all([...prefs,...lrefs,...hrefs].map(ref=>tx.get(ref)));
  if(taken.some(s=>s.exists()))fail('Import ID collision. Try again.');
  const existingPlans=Object.entries({german:{name:'German Practice'},...(data.focusPlanCatalog.plans||{})}).filter(([,m])=>!m.deleted).map(([id,m])=>({id,name:m.name}));
  function ensureNew(incoming,existing,label){for(const x of incoming)if(existing.some(y=>String(y.name).toLowerCase()===x.name.toLowerCase()))fail(label+' "'+x.name+'" already exists. Remove it from this configuration; existing items are never overwritten.');}
  ensureNew(c.plans,existingPlans,'Plan');ensureNew(c.habits,existingHabits,'Habit');
  ensureNew(c.checklists,Object.values({school:{name:'School'},...(data.checklistLists.lists||{})}).filter(x=>!x.deleted),'Checklist');
  ensureNew(c.goals,Object.values(data.goals.goals||{}).filter(g=>!g.deleted),'Goal');ensureNew(c.achievements,Object.values(data.personalAchievements.awards||{}),'Achievement');
  const planMap=[...existingPlans,...c.plans.map((p,i)=>({id:pids[i],name:p.name}))];
  const habitMap=[...existingHabits,...c.habits.map((p,i)=>({id:hids[i],name:p.name}))],now=Date.now();
  const links=x=>({planId:x.type==='study'?named(x.plan,planMap,'plan'):'german',habit:x.type==='habit'?named(x.habit,habitMap,'habit'):''});
  const goals=Object.fromEntries(c.goals.map((g,i)=>[gids[i],{name:g.name,type:g.type,...links(g),target:g.target,unit:g.unit,value:0,start:g.start,due:g.due,color:g.color,steps:g.steps.map(name=>({name,done:false})),createdAt:now,deleted:false}]));
  const awards=Object.fromEntries(c.achievements.map((a,i)=>[aids[i],{name:a.name,description:a.description,type:a.type,...links(a),target:a.target,icon:a.icon,color:a.color,createdAt:now}]));
  const plans=Object.fromEntries(c.plans.map((p,i)=>[pids[i],{name:p.name,color:p.color,icon:p.icon}]));
  const lists=Object.fromEntries(c.checklists.map((p,i)=>[lids[i],{name:p.name,color:p.color,icon:p.icon}]));
  c.plans.forEach((p,i)=>tx.set(prefs[i],{blocks:p.activities.map((a,j)=>({...a,id:'a'+j})),days:{}}));
  c.checklists.forEach((p,i)=>tx.set(lrefs[i],{blocks:p.tasks.map((t,j)=>({id:'b'+j,type:'todo',text:t.text,checked:false,blockBackground:t.urgent?'red':'default',order:j,createdAt:now}))}));
  c.habits.forEach((h,i)=>tx.set(hrefs[i],{...h,createdDate:today(),createdAt:now,completions:[],freezeDates:[],freezeProcessedThrough:yesterday(),goalPeriodStart:today(),goalBaseline:0,goalHistory:[],goalHistoricalBest:0}));
  for(const [ref,field,value] of [[refs.focusPlanCatalog,'plans',plans],[refs.checklistLists,'lists',lists],[refs.goals,'goals',goals],[refs.personalAchievements,'awards',awards]]){if(Object.keys(value).length)tx.set(ref,{[field]:value},{merge:true});}
  tx.set(refs[receiptKey],{applied:true,createdAt:now});
  return {duplicate:false};
 });
}
function start(deps){
 const trigger=document.getElementById('accountConfigImport');if(!trigger)return;
 const dialog=document.createElement('dialog');dialog.className='ms-list-dialog ms-config-dialog';dialog.setAttribute('aria-label','Import ChatGPT configuration');document.body.append(dialog);
 let config=null,uid=null,busy=false;
 const q=s=>dialog.querySelector(s);
 function status(s){q('[data-config-status]').textContent=s;}
 function reset(){config=null;q('[data-config-preview]').innerHTML='';q('[data-config-apply]').disabled=true;}
 function preview(){
  if(busy)return;reset();
  try{
   const input=q('textarea').value;if(input.length>200000)fail('Configuration is too large.');
   config=validate(JSON.parse(input));
   const groups=[
    ['Focus plans',config.plans,p=>p.activities.map(a=>a.name+' · '+a.minutes+'m').join(' | ')],
    ['Goals',config.goals,g=>g.target+' '+(g.type==='study'?'hours':g.type==='habit'?'check-ins':g.type==='milestones'?'milestones':g.unit)+(g.plan?' · '+g.plan:g.habit?' · '+g.habit:'')],
    ['Checklists',config.checklists,p=>p.tasks.map(t=>(t.urgent?'Urgent: ':'')+t.text).join(' | ')||'Empty checklist'],
    ['Habits',config.habits,p=>p.cadence==='weekly'?p.weeklyTarget+' per week':'Daily'],
    ['Personal achievements',config.achievements,a=>a.target+' '+(a.type==='study'?'hours · '+a.plan:'check-ins · '+a.habit)]
   ];
   q('[data-config-preview]').innerHTML=groups.filter(g=>g[1].length).map(([label,items,detail])=>'<section><h4>'+label+'</h4>'+items.map(p=>'<div><strong>'+esc(p.name)+'</strong><small>'+esc(detail(p))+'</small></div>').join('')+'</section>').join('');
   q('[data-config-apply]').disabled=false;status('Ready to import. Existing records will not be replaced.');
  }catch(e){status(e.message||'Invalid configuration.');}
 }
 trigger.addEventListener('click',()=>{
  if(!deps.getUser())return;uid=deps.getUser().uid;busy=false;config=null;
  dialog.innerHTML='<div class="ms-feature-card"><div class="ms-config-heading"><h3>Import from ChatGPT</h3><button type="button" data-config-close aria-label="Close">×</button></div><p>Paste a My Streaks configuration or choose its JSON file. Review the additions before saving.</p><textarea aria-label="Configuration JSON" rows="5" placeholder="Paste configuration JSON here"></textarea><div class="ms-config-controls"><label class="ms-config-file">Choose JSON file<input type="file" accept=".json,application/json" hidden></label><button type="button" data-config-preview-btn>Preview</button></div><div data-config-preview class="ms-config-preview"></div><p data-config-status role="status"></p><div class="ms-goal-actions"><button type="button" data-config-close>Cancel</button><button type="button" class="ms-primary" data-config-apply disabled>Import additions</button></div></div>';
  dialog.showModal();
 });
 dialog.addEventListener('input',e=>{if(e.target.matches('textarea')&&!busy){reset();status('');}});
 dialog.addEventListener('change',async e=>{if(e.target.type!=='file'||busy)return;const f=e.target.files[0];if(!f)return;if(f.size>200000){status('Configuration is too large.');return;}try{q('textarea').value=await f.text();preview();}catch{status('Could not read file.');}});
 dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
 dialog.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b||busy)return;
  if(b.hasAttribute('data-config-close')){dialog.close();return;}
  if(b.hasAttribute('data-config-preview-btn')){preview();return;}
  if(!b.hasAttribute('data-config-apply')||!config)return;
  if(deps.getUser()?.uid!==uid){status('Account changed. Reopen this dialog.');return;}
  busy=true;dialog.querySelectorAll('button,input,textarea').forEach(x=>x.disabled=true);status('Saving additions…');
  try{const result=await apply({...deps,uid},config);status(result.duplicate?'Already imported. No changes made.':'Imported successfully. Your existing records are unchanged.');config=null;q('[data-config-preview]').innerHTML='';}
  catch(e){console.error('Configuration import',e);status(e.code==='permission-denied'?'Firebase denied the import. No additions were saved.':e.message||'Import failed.');}
  finally{busy=false;dialog.querySelectorAll('button,input,textarea').forEach(x=>x.disabled=false);q('[data-config-apply]').disabled=!config;}
 });
}
window.MyStreaksConfig={start,validate,apply};
})();