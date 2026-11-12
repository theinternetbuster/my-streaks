/* My Streaks Workspace: navigation, read-only insights, and private checklist.
   Standalone so an optional workspace failure never stops the habit app. */
(function(){
  const $=id=>document.getElementById(id);
  const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const types=[
    {id:'h1',title:'Heading 1',subtitle:'Large section heading',symbol:'H1'},
    {id:'h2',title:'Heading 2',subtitle:'Smaller heading',symbol:'H2'},
    {id:'todo',title:'To-do list',subtitle:'A task to check off',symbol:'☐'},
    {id:'toggle',title:'Toggle',subtitle:'Collapsible notes',symbol:'▸'},
    {id:'bullet',title:'Bulleted list',subtitle:'Simple list item',symbol:'•'},
    {id:'text',title:'Text',subtitle:'Regular notes',symbol:'T'}
  ];
  function start({db,doc,onSnapshot,setDoc,getHabits,evaluateHabit,onTabChange}){
    const root=$('checklistBlocks');
    if(!root)return null;
    let tab='home',user=null,unsub=null,blocks=[],dirty=false,saveTimer=null,selectedHabit=null,
        slashFor=null,slashMatches=types,slashSelected=0,sortable=null,saveSerial=0,listenerEpoch=0;
    let pendingWrite=Promise.resolve();
    const key=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
    const parse=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d,12)};
    const shift=(d,n)=>{const r=new Date(d);r.setDate(r.getDate()+n);return r};
    const weekStart=d=>shift(d,-((d.getDay()+6)%7));
    const uniqueId=()=>('b'+Date.now().toString(36)+Math.random().toString(36).slice(2,10));
    function updateNav(){
      const authed=!!user;
      $('workspaceTopNav').hidden=!authed;
      $('workspaceBottomNav').hidden=!authed;
      document.body.classList.toggle('workspace-signed-in',authed);
      document.querySelectorAll('[data-workspace]').forEach(button=>{
        const active=button.dataset.workspace===tab;
        button.classList.toggle('active',active);
        if(active)button.setAttribute('aria-current','page');
        else button.removeAttribute('aria-current');
      });
      document.querySelector('.workspace-bottom-pill')?.setAttribute('data-current',tab);
    }
    function selectTab(next,{history:true,silent:false}={}){
      if(!['home','insights','checklist'].includes(next)||!user)return;
      tab=next;updateNav();closeSlash();
      if(history){
        const url='/my-streaks/'+(tab==='home'?'':'?view='+tab);
        if(location.pathname+location.search!==url)window.history.pushState({workspace:tab},'',url);
      }
      if(!silent)onTabChange(tab);
      if(tab==='insights')renderInsights();
      if(tab==='checklist')renderChecklist();
      window.scrollTo({top:0,behavior:'instant'});
    }
    document.querySelectorAll('[data-workspace]').forEach(b=>b.addEventListener('click',()=>selectTab(b.dataset.workspace)));
    window.addEventListener('popstate',()=>{
      if(!user||location.pathname.includes('/settings/'))return;
      selectTab(new URLSearchParams(location.search).get('view')||'home',{history:false});
    });
    function setUser(next){
      if(unsub){unsub();unsub=null;}
      clearTimeout(saveTimer);
      user=next;blocks=[];dirty=false;saveSerial++;selectedHabit=null;
      tab=['insights','checklist'].includes(new URLSearchParams(location.search).get('view'))?
        new URLSearchParams(location.search).get('view'):'home';
      updateNav();
      if(!user){renderChecklist();return;}
      const epoch=++listenerEpoch;
      $('checklistSyncStatus').textContent='Syncing…';
      try{
        unsub=onSnapshot(doc(db,'users',user.uid,'settings','checklist'),snapshot=>{
          if(epoch!==listenerEpoch||!user)return;
          if(!dirty){
            const incoming=snapshot.exists()?snapshot.data().blocks:[];
            blocks=Array.isArray(incoming)?incoming.filter(b=>b&&typeof b.text==='string').slice(0,500).map(normalizeBlock):[];
            renderChecklist();
          }
          if(!snapshot.metadata?.hasPendingWrites)$('checklistSyncStatus').textContent='Saved';
        },error=>{
          console.error('Checklist read failed',error);
          $('checklistSyncStatus').textContent='Could not sync';
        });
      }catch(error){console.error('Checklist could not initialize',error);$('checklistSyncStatus').textContent='Sync unavailable';}
      if(tab==='insights')renderInsights();
    }
    function normalizedType(t){return types.some(x=>x.id===t)?t:'text';}
    function normalizeBlock(b,i){
      return {id:String(b.id||uniqueId()),type:normalizedType(b.type),text:String(b.text||'').slice(0,5000),checked:!!b.checked,collapsed:!!b.collapsed,order:Number.isFinite(b.order)?b.order:i,createdAt:Number(b.createdAt)||Date.now()};
    }
    function scheduleSave(soon=false){
      if(!user)return;
      dirty=true;clearTimeout(saveTimer);
      $('checklistSyncStatus').textContent='Saving…';
      saveTimer=setTimeout(saveChecklist,soon?100:700);
    }
    async function saveChecklist(){
      if(!user)return;
      const thisUser=user.uid;
      const payload=blocks.map((b,i)=>({...b,order:i}));
      const serial=++saveSerial;
      // Serialize writes so a slower earlier save cannot overwrite a newer edit.
      const run=async()=>{
        if(!user||user.uid!==thisUser)return;
        try{
          await setDoc(doc(db,'users',thisUser,'settings','checklist'),{
            blocks:payload,updatedAt:Date.now()
          },{merge:true});
          if(serial===saveSerial&&user&&user.uid===thisUser){
            dirty=false;$('checklistSyncStatus').textContent='Saved';
          }
        }catch(err){
          console.error('Checklist save failed',err);
          if(serial===saveSerial)$('checklistSyncStatus').textContent='Save failed — retrying';
          dirty=true;
        }
      };
      pendingWrite=pendingWrite.then(run,run);
      await pendingWrite;
    }
    function addBlock(afterId=null,type='todo',text=''){
      const b={id:uniqueId(),type,text,checked:false,collapsed:false,order:blocks.length,createdAt:Date.now()};
      const index=afterId?blocks.findIndex(x=>x.id===afterId):-1;
      if(index>=0)blocks.splice(index+1,0,b);else blocks.push(b);
      renderChecklist();scheduleSave(true);
      requestAnimationFrame(()=>focusBlock(b.id));
      return b;
    }
    function focusBlock(id,atEnd=true){
      const field=[...root.querySelectorAll('textarea[data-block-id]')].find(x=>x.dataset.blockId===id);
      if(field){field.focus();if(atEnd)field.setSelectionRange(field.value.length,field.value.length);}
    }
    function closeSlash(){
      slashFor=null;$('checklistSlashMenu').hidden=true;
    }
    function openSlash(id,query=''){
      slashFor=id;
      slashMatches=types.filter(x=>x.id.includes(query.toLowerCase())||x.title.toLowerCase().includes(query.toLowerCase()));
      slashSelected=0;
      const menu=$('checklistSlashMenu');
      if(!slashMatches.length){menu.hidden=true;return;}
      menu.innerHTML='<div class="checklist-slash-label">TURN INTO</div>'+slashMatches.map((t,i)=>
        '<button type="button" role="menuitem" data-command="'+t.id+'" class="'+(!i?'selected':'')+'"><span class="checklist-cmd-icon">'+safe(t.symbol)+'</span><span><strong>'+safe(t.title)+'</strong><small>'+safe(t.subtitle)+'</small></span><kbd>/'+t.id+'</kbd></button>'
      ).join('');
      const field=[...root.querySelectorAll('textarea')].find(x=>x.dataset.blockId===id);
      if(field){const rect=field.getBoundingClientRect();menu.style.left=Math.min(Math.max(12,rect.left),Math.max(12,window.innerWidth-325))+'px';menu.style.top=Math.min(window.innerHeight-280,Math.max(12,rect.bottom+8))+'px';}
      menu.hidden=false;
    }
    function applyCommand(type){
      const id=slashFor;
      if(!id)return;
      const b=blocks.find(x=>x.id===id);
      if(!b){closeSlash();return;}
      b.type=normalizedType(type);
      b.text=b.text.replace(/^\/[a-z0-9 -]*/i,'');
      b.checked=false;
      closeSlash();renderChecklist();scheduleSave(true);
      requestAnimationFrame(()=>focusBlock(id));
    }
    $('checklistSlashMenu').addEventListener('pointerdown',e=>e.preventDefault());
    $('checklistSlashMenu').addEventListener('click',e=>{
      const item=e.target.closest('[data-command]');if(item)applyCommand(item.dataset.command);
    });
    document.addEventListener('pointerdown',e=>{
      if(slashFor&&!e.target.closest('#checklistSlashMenu')&&!e.target.closest('#checklistBlocks'))closeSlash();
    });
    window.addEventListener('scroll',()=>{if(slashFor)closeSlash();},{passive:true});
    function renderChecklist(){
      if(!root)return;
      const focus=document.activeElement?.dataset?.blockId;
      if(focus&&root.contains(document.activeElement)&&dirty)return;
      root.innerHTML=blocks.map((b,i)=>{
        const isTask=b.type==='todo',isToggle=b.type==='toggle',isBullet=b.type==='bullet';
        const icon=isTask?'<input class="checklist-check" type="checkbox" data-toggle-check="'+safe(b.id)+'" '+(b.checked?'checked':'')+' aria-label="Complete task"/>':
          isToggle?'<button type="button" class="checklist-toggle-icon" data-collapse="'+safe(b.id)+'" aria-label="'+(b.collapsed?'Expand':'Collapse')+' notes">'+(b.collapsed?'▸':'▾')+'</button>':
          isBullet?'<span class="checklist-bullet">•</span>':'';
        return '<div class="checklist-line checklist-type-'+b.type+(b.checked?' is-done':'')+(b.collapsed?' is-collapsed':'')+'" data-id="'+safe(b.id)+'">'+
          '<button type="button" class="checklist-handle" aria-label="Drag to rearrange">⠿</button>'+
          '<div class="checklist-line-inner">'+icon+'<textarea data-block-id="'+safe(b.id)+'" rows="1" maxlength="5000" spellcheck="true" placeholder="'+(b.type==='h1'?'Heading':b.type==='h2'?'Subheading':b.type==='todo'?'To-do':b.type==='toggle'?'Toggle title':b.type==='bullet'?'List item':"Type '/' for commands")+'" '+(b.collapsed&&b.type==='toggle'?'aria-expanded="false"':'')+'>'+safe(b.text)+'</textarea></div>'+
          '<button type="button" class="checklist-delete" data-delete="'+safe(b.id)+'" aria-label="Delete block">×</button></div>';
      }).join('');
      $('checklistEmpty').hidden=blocks.length>0;
      root.querySelectorAll('textarea').forEach(resizeField);
      setupSortable();
    }
    function resizeField(field){
      field.style.height='auto';field.style.height=Math.max(26,field.scrollHeight)+'px';
    }
    function setupSortable(){
      if(sortable){sortable.destroy();sortable=null;}
      if(!window.Sortable||blocks.length<2)return;
      sortable=window.Sortable.create(root,{
        animation:200,handle:'.checklist-handle',draggable:'.checklist-line',
        ghostClass:'checklist-ghost',chosenClass:'checklist-chosen',
        forceFallback:true,fallbackOnBody:true,delay:170,delayOnTouchOnly:true,
        onEnd:()=>{
          const ids=[...root.querySelectorAll('.checklist-line')].map(x=>x.dataset.id);
          blocks.sort((a,b)=>ids.indexOf(a.id)-ids.indexOf(b.id));
          scheduleSave(true);
        }
      });
    }
    root.addEventListener('input',e=>{
      const field=e.target.closest('textarea[data-block-id]');if(!field)return;
      const b=blocks.find(b=>b.id===field.dataset.blockId);if(!b)return;
      b.text=field.value;resizeField(field);scheduleSave();
      const match=field.value.match(/^\/([a-z0-9 -]*)$/i);
      if(match)openSlash(b.id,match[1].trim());else if(slashFor===b.id)closeSlash();
    });
    root.addEventListener('keydown',e=>{
      const field=e.target.closest('textarea[data-block-id]');if(!field)return;
      const id=field.dataset.blockId,b=blocks.find(x=>x.id===id);
      if(!b)return;
      if(slashFor===id&&!$('checklistSlashMenu').hidden){
        if(e.key==='ArrowDown'||e.key==='ArrowUp'){
          e.preventDefault();slashSelected=(slashSelected+(e.key==='ArrowDown'?1:-1)+slashMatches.length)%slashMatches.length;
          $('checklistSlashMenu').querySelectorAll('[data-command]').forEach((el,i)=>el.classList.toggle('selected',i===slashSelected));return;
        }
        if(e.key==='Enter'){
          e.preventDefault();if(slashMatches[slashSelected])applyCommand(slashMatches[slashSelected].id);return;
        }
        if(e.key==='Escape'){e.preventDefault();closeSlash();return;}
      }
      if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){
        e.preventDefault();closeSlash();addBlock(id,b.type==='todo'?'todo':b.type==='bullet'?'bullet':'text');return;
      }
      if(e.key==='Backspace'&&!field.value&&blocks.length>1){
        e.preventDefault();const index=blocks.findIndex(x=>x.id===id);blocks.splice(index,1);
        renderChecklist();scheduleSave(true);requestAnimationFrame(()=>focusBlock(blocks[Math.max(0,index-1)].id));return;
      }
    });
    root.addEventListener('change',e=>{
      const input=e.target.closest('[data-toggle-check]');if(!input)return;
      const b=blocks.find(x=>x.id===input.dataset.toggleCheck);if(!b)return;
      b.checked=input.checked;input.closest('.checklist-line').classList.toggle('is-done',b.checked);scheduleSave(true);
    });
    root.addEventListener('click',e=>{
      const deleteBtn=e.target.closest('[data-delete]');
      const collapse=e.target.closest('[data-collapse]');
      if(deleteBtn){
        blocks=blocks.filter(b=>b.id!==deleteBtn.dataset.delete);renderChecklist();scheduleSave(true);
      }else if(collapse){
        const b=blocks.find(x=>x.id===collapse.dataset.collapse);
        if(b){b.collapsed=!b.collapsed;renderChecklist();scheduleSave(true);}
      }
    });
    $('checklistAdd').addEventListener('click',()=>addBlock(blocks.at(-1)?.id||null,'todo'));
    $('checklistAddBottom').addEventListener('click',()=>addBlock(blocks.at(-1)?.id||null,'text'));
    function longestFor(h){
      const done=new Set(h.completions||[]),freeze=new Set(h.freezeDates||[]);
      const all=[...done,...freeze].sort();if(!all.length)return 0;
      const start=parse(all[0]),end=new Date();end.setHours(12,0,0,0);
      let active=false,current=0,max=0,n=0;
      for(let day=start;day<=end&&n++<37000;day=shift(day,1)){
        const k=key(day);
        if(done.has(k)){current=active?current+1:1;active=true;max=Math.max(max,current);}
        else if(!freeze.has(k)){active=false;current=0;}
      }
      return max;
    }
    function weeklyChart(h){
      const completed=new Set(h.completions||[]),start=weekStart(new Date());
      let bars='';
      for(let w=7;w>=0;w--){
        const monday=shift(start,-w*7);
        let count=0;
        for(let d=0;d<7;d++)if(completed.has(key(shift(monday,d))))count++;
        const height=count?Math.max(8,count/7*100):0;
        bars+='<div class="insight-week"><div class="insight-week-vertical"><span class="insight-week-bar" style="height:'+height+'%" title="'+count+' completed days"></span></div><span class="insight-week-label">'+monday.toLocaleDateString('en-US',{month:'short',day:'numeric'})+'</span></div>';
      }
      return bars;
    }
    function calendarMonths(h){
      const done=new Set(h.completions||[]),freeze=new Set(h.freezeDates||[]);
      let html='';
      for(let back=2;back>=0;back--){
        const start=new Date();start.setDate(1);start.setMonth(start.getMonth()-back);
        const first=(start.getDay()+6)%7,last=new Date(start.getFullYear(),start.getMonth()+1,0).getDate();
        let cells='';
        for(let i=0;i<first;i++)cells+='<span class="insight-date outside"></span>';
        for(let day=1;day<=last;day++){
          const k=key(new Date(start.getFullYear(),start.getMonth(),day,12));
          const state=done.has(k)?'done':freeze.has(k)?'freeze':'';
          cells+='<span class="insight-date '+state+'" title="'+k+(state?' · '+state:'')+'">'+day+'</span>';
        }
        html+='<div class="insight-month"><h3>'+start.toLocaleDateString('en-US',{month:'long',year:'numeric'})+'</h3><div class="insight-month-grid">'+['M','T','W','T','F','S','S'].map(x=>'<span class="insight-day-label">'+x+'</span>').join('')+cells+'</div></div>';
      }
      return html;
    }
    function renderInsights(){
      const habits=getHabits();
      const empty=$('insightEmpty'),content=$('insightsContent'),picker=$('insightHabitSelect');
      empty.hidden=habits.length>0;content.hidden=habits.length===0;
      if(!habits.length){selectedHabit=null;picker.innerHTML='';return;}
      if(!selectedHabit||!habits.some(x=>x.id===selectedHabit))selectedHabit=habits[0].id;
      picker.innerHTML=habits.map(x=>'<option value="'+safe(x.id)+'" '+(x.id===selectedHabit?'selected':'')+'>'+safe(x.name)+'</option>').join('');
      const h=habits.find(x=>x.id===selectedHabit)||habits[0],info=evaluateHabit(h);
      const total=h.completions.length,longest=longestFor(h);
      const used=(h.freezeDates||[]).length;
      const cards=[
        {label:'Current streak',number:info.streak,icon:'🔥',hint:'Your ongoing run'},
        {label:'Longest streak',number:longest,icon:'✦',hint:'Your personal best'},
        {label:'Days completed',number:total,icon:'✓',hint:'Every check-in counts'},
        {label:'Freeze days',number:used,icon:'❄',hint:'Days your streak was protected'}
      ];
      $('insightStatGrid').innerHTML=cards.map((x,i)=>'<div class="insight-stat-card"><span class="insight-stat-kicker">'+safe(x.label)+'</span><div class="insight-stat-main"><strong>'+x.number+'</strong><span class="insight-stat-icon '+(i===3?'icy':'')+'">'+x.icon+'</span></div><small>'+safe(x.hint)+'</small></div>').join('');
      $('insightActivityChart').innerHTML=weeklyChart(h);
      $('insightHeatmap').innerHTML=calendarMonths(h);
      const thresholds=[1,7,14,30,60,100,365];
      $('insightMilestones').innerHTML=thresholds.map(target=>{
        const unlocked=longest>=target;
        const names={1:'First flame',7:'One week',14:'Two weeks',30:'A whole month',60:'Two months',100:'Triple digits',365:'A full year'};
        return '<div class="insight-milestone '+(unlocked?'unlocked':'')+'"><span class="milestone-symbol">'+(unlocked?'✦':'◇')+'</span><strong>'+safe(names[target])+'</strong><small>'+target+'-day streak</small></div>';
      }).join('');
    }
    $('insightHabitSelect').addEventListener('change',e=>{selectedHabit=e.target.value;renderInsights();});
    function onHabitsChange(){if(tab==='insights')renderInsights();}
    function dispose(){if(unsub)unsub();clearTimeout(saveTimer);if(sortable)sortable.destroy();}
    // Deep links should initialize consistently once the account loads.
    updateNav();
    return {setUser,selectTab,onHabitsChange,renderInsights,renderChecklist,tab:()=>tab,dispose};
  }
  window.MyStreaksWorkspace={start};
})();