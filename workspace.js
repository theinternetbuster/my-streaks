/* My Streaks Workspace: navigation, read-only insights, and private checklist.
   Standalone so an optional workspace failure never stops the habit app. */
(function(){
  const $=id=>document.getElementById(id);
  const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const types=[
    {id:'h1',title:'Heading 1',subtitle:'Large section heading',symbol:'H1'},
    {id:'h2',title:'Heading 2',subtitle:'Smaller heading',symbol:'H2'},
    {id:'todo',title:'To-do list',subtitle:'A task to check off',symbol:'☐'},
    {id:'todoNote',title:'To-do with notes',subtitle:'Expandable notes beneath a task',symbol:'☷'},
    {id:'todoList',title:'To-do with subtasks',subtitle:'Expandable mini-checklist',symbol:'☰'},
    {id:'toggle',title:'Toggle',subtitle:'Collapsible notes',symbol:'▸'},
    {id:'bullet',title:'Bulleted list',subtitle:'Simple list item',symbol:'•'},
    {id:'text',title:'Text',subtitle:'Regular notes',symbol:'T'}
  ];
  function start({db,doc,onSnapshot,setDoc,getHabits,evaluateHabit,onTabChange}){
    const root=$('checklistBlocks');
    if(!root)return null;
    let tab='home',user=null,unsub=null,insightUnsub=null,blocks=[],dirty=false,saveTimer=null,selectedHabit='all',insightSection='overview',insightSelectionPending=false,
        slashFor=null,slashMatches=types,slashSelected=0,sortable=null,saveSerial=0,listenerEpoch=0;
    let pendingWrite=Promise.resolve(),editRevision=0;
    // Snapshot-based editing history covers both typing and structural changes.
    let historyUndo=[],historyRedo=[],historyPresent='[]',lastHistoryAt=0,lastHistoryField='',restoringHistory=false,allBlocksSelected=false;
    const serializeBlocks=()=>JSON.stringify(blocks.map((b,i)=>({...b,order:i})));
    const resetHistory=()=>{historyUndo=[];historyRedo=[];historyPresent=serializeBlocks();lastHistoryAt=0;lastHistoryField='';allBlocksSelected=false;};
    function trackHistory(){
      if(restoringHistory)return;
      const next=serializeBlocks();
      if(next===historyPresent)return;
      const active=document.activeElement;
      const field=active?.dataset?.blockId||active?.dataset?.noteId||active?.dataset?.subtaskText||'structure';
      const now=Date.now();
      // Coalesce fast typing into one undo step but never merge different fields or structural edits.
      const typed=active?.matches?.('.checklist-editor,.checklist-note-editor,[data-subtask-text]');
      const coalesce=typed&&field===lastHistoryField&&now-lastHistoryAt<650&&historyUndo.length>0;
      if(!coalesce){historyUndo.push(historyPresent);if(historyUndo.length>100)historyUndo.shift();}
      historyRedo=[];
      historyPresent=next;lastHistoryAt=now;lastHistoryField=typed?field:'';
    }
    function restoreHistory(direction){
      const from=direction==='undo'?historyUndo:historyRedo;
      const to=direction==='undo'?historyRedo:historyUndo;
      if(!from.length)return;
      const active=document.activeElement;
      const focusId=active?.dataset?.blockId||null;
      const position=active?.matches?.('.checklist-editor')?editorCaretOffset(active):null;
      const previous=from.pop();
      to.push(serializeBlocks());
      restoringHistory=true;
      blocks=JSON.parse(previous).map(normalizeBlock);
      historyPresent=serializeBlocks();lastHistoryAt=0;lastHistoryField='';
      closeSlash();renderChecklist(true);restoringHistory=false;scheduleSave(true);
      const target=focusId&&blocks.some(b=>b.id===focusId)?focusId:blocks.at(-1)?.id;
      if(target)requestAnimationFrame(()=>focusBlockAt(target,position??blocks.find(b=>b.id===target)?.text.length??0));
    }
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
    function selectTab(next,{history:pushHistory=true,silent=false}={}){
      if(!['home','insights','checklist'].includes(next)||!user)return;
      tab=next;updateNav();closeSlash();
      if(pushHistory){
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
      if(insightUnsub){insightUnsub();insightUnsub=null;}
      clearTimeout(saveTimer);editRevision++;
      user=next;blocks=[];dirty=false;saveSerial++;resetHistory();selectedHabit='all';insightSection='overview';insightSelectionPending=false;
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
            const nextBlocks=Array.isArray(incoming)?incoming.filter(b=>b&&typeof b.text==='string').slice(0,500).map(normalizeBlock):[];
            const nextJson=JSON.stringify(nextBlocks.map((b,i)=>({...b,order:i})));
            if(nextJson!==serializeBlocks()){
              blocks=nextBlocks;resetHistory();renderChecklist();
            }
          }
          if(!snapshot.metadata?.hasPendingWrites)$('checklistSyncStatus').textContent='Saved';
        },error=>{
          console.error('Checklist read failed',error);
          $('checklistSyncStatus').textContent='Could not sync';
        });
      }catch(error){console.error('Checklist could not initialize',error);$('checklistSyncStatus').textContent='Sync unavailable';}
      try{
        insightUnsub=onSnapshot(doc(db,'users',user.uid,'settings','insights'),snapshot=>{
          if(epoch!==listenerEpoch||!user||insightSelectionPending)return;
          const choice=snapshot.exists()?snapshot.data().habitId:null;
          if(typeof choice==='string'&&choice){selectedHabit=choice;if(tab==='insights')renderInsights();}
        },error=>console.warn('Insights preference sync',error));
      }catch(error){console.warn('Insights preference unavailable',error);}
      if(tab==='insights')renderInsights();
    }
    function normalizedType(t){return types.some(x=>x.id===t)?t:'text';}
    function normalizeBlock(b,i){
      return {id:String(b.id||uniqueId()),type:normalizedType(b.type),text:String(b.text||'').slice(0,5000),checked:!!b.checked,collapsed:!!b.collapsed,detailsOpen:b.type==='todo'?false:(typeof b.detailsOpen==='boolean'?b.detailsOpen:(b.type==='todoNote'||b.type==='todoList')&&!b.collapsed),note:String(b.note||'').slice(0,10000),detailsMode:b.type==='todoList'?'tasks':'notes',subtasks:Array.isArray(b.subtasks)?b.subtasks.slice(0,40).filter(t=>t&&typeof t.text==='string').map(t=>({id:String(t.id||uniqueId()),text:String(t.text).slice(0,500),checked:!!t.checked,type:t.type==='bullet'?'bullet':'todo'})):[],dueDate:/^\d{4}-\d{2}-\d{2}$/.test(b.dueDate||'')?b.dueDate:'',order:Number.isFinite(b.order)?b.order:i,createdAt:Number(b.createdAt)||Date.now()};
    }
    function scheduleSave(soon=false){
      if(!user)return;
      trackHistory();
      dirty=true;editRevision++;clearTimeout(saveTimer);
      $('checklistSyncStatus').textContent='Saving…';
      saveTimer=setTimeout(saveChecklist,soon?100:700);
    }
    async function saveChecklist(){
      if(!user)return;
      const thisUser=user.uid;
      const payload=blocks.map((b,i)=>({...b,order:i}));
      const serial=++saveSerial,revision=editRevision;
      // Serialize writes so a slower earlier save cannot overwrite a newer edit.
      const run=async()=>{
        if(!user||user.uid!==thisUser)return;
        try{
          await setDoc(doc(db,'users',thisUser,'settings','checklist'),{
            blocks:payload,updatedAt:Date.now()
          },{merge:true});
          if(serial===saveSerial&&revision===editRevision&&user&&user.uid===thisUser){
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
      const b={id:uniqueId(),type,text,checked:false,collapsed:false,detailsOpen:type==='todoNote'||type==='todoList',note:'',detailsMode:type==='todoList'?'tasks':'notes',subtasks:type==='todoList'?[{id:uniqueId(),text:'',checked:false,type:'todo'}]:[],dueDate:'',order:blocks.length,createdAt:Date.now()};
      const index=afterId?blocks.findIndex(x=>x.id===afterId):-1;
      if(index>=0)blocks.splice(index+1,0,b);else blocks.push(b);
      renderChecklist(true);scheduleSave(true);
      requestAnimationFrame(()=>focusBlock(b.id));
      return b;
    }
    function focusBlock(id,atEnd=true){
      const field=id.startsWith('note:')?
        root.querySelector('.checklist-note-editor[data-note-id="'+id.slice(5)+'"]'):
        [...root.querySelectorAll('[contenteditable="true"][data-block-id]')].find(x=>x.dataset.blockId===id);
      if(field){
        field.focus();
        if(atEnd){
          const range=document.createRange(),sel=window.getSelection();
          range.selectNodeContents(field);range.collapse(false);
          sel.removeAllRanges();sel.addRange(range);
        }
      }
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
      const field=[...root.querySelectorAll('[contenteditable="true"][data-block-id]')].find(x=>x.dataset.blockId===id);
      if(field){const rect=field.getBoundingClientRect();menu.style.left=Math.min(Math.max(12,rect.left),Math.max(12,window.innerWidth-325))+'px';menu.style.top=Math.min(window.innerHeight-280,Math.max(12,rect.bottom+8))+'px';}
      menu.hidden=false;
    }
    function applyCommand(type){
      const id=slashFor;
      if(!id)return;
      const isNote=id.startsWith('note:');
      const b=blocks.find(x=>x.id===(isNote?id.slice(5):id));
      if(!b){closeSlash();return;}
      if(isNote){
        const editor=root.querySelector('.checklist-note-editor[data-note-id="'+b.id+'"]');
        const offset=editor?editorCaretOffset(editor):b.note.length;
        const before=b.note.slice(0,offset);
        const lineStart=before.lastIndexOf('\n')+1;
        const prefixes={bullet:'• ',todo:'☐ ',todoNote:'☐ ',todoList:'☐ ',toggle:'▸ ',h1:'# ',h2:'## ',text:''};
        const prefix=prefixes[type]??'';
        const slash=before.slice(lineStart).startsWith('/');
        b.note=b.note.slice(0,slash?lineStart:offset)+prefix+b.note.slice(offset);
        closeSlash();renderChecklist(true);scheduleSave(true);
        requestAnimationFrame(()=>focusEditableAt(root.querySelector('.checklist-note-editor[data-note-id="'+b.id+'"]'),(slash?lineStart:offset)+prefix.length));
        return;
      }
      b.type=normalizedType(type);
      b.text=b.text.replace(/^\/[a-z0-9 -]*/i,'');
      b.checked=false;
      b.detailsOpen=type==='todoNote'||type==='todoList';
      b.detailsMode=type==='todoList'?'tasks':'notes';
      if(type==='todoList'&&!b.subtasks.length)b.subtasks.push({id:uniqueId(),text:'',checked:false,type:'todo'});
      closeSlash();renderChecklist(true);scheduleSave(true);
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
    function renderChecklist(force=false){
      if(!root)return;
      // A blank document opens with a real editable paragraph, not a button.
      // The initial empty paragraph is local until the user types.
      if(!blocks.length)blocks=[normalizeBlock({id:uniqueId(),type:'text',text:''},0)];
      const focus=document.activeElement?.dataset?.blockId;
      if(!force&&focus&&root.contains(document.activeElement))return;
      root.innerHTML=blocks.map(b=>{
        const isTask=['todo','todoNote','todoList'].includes(b.type);
        const isToggle=b.type==='toggle',isBullet=b.type==='bullet';
        const expanded=(b.type==='todoNote'||b.type==='todoList')&&b.detailsOpen;
        const noteExpanded=isToggle&&!b.collapsed;
        const checkbox=isTask?'<input class="checklist-check" type="checkbox" data-toggle-check="'+safe(b.id)+'" '+(b.checked?'checked':'')+' aria-label="Complete task"/>':'';
        const isOpen=(b.type==='todoNote'||b.type==='todoList')?b.detailsOpen:!b.collapsed;
        const arrow=b.type==='todoNote'||b.type==='todoList'||isToggle?
          '<button type="button" class="checklist-toggle-icon '+(!isOpen?'collapsed':'')+'" data-collapse="'+safe(b.id)+'" aria-label="'+(!isOpen?'Expand details':'Collapse details')+'" aria-expanded="'+String(isOpen)+'">'+(!isOpen?'▸':'▾')+'</button>':'';
        const icon=isTask?checkbox+arrow:isToggle?arrow:isBullet?'<span class="checklist-bullet">•</span>':'';
        const placeholder=(b.type==='h1'?'Heading':b.type==='h2'?'Subheading':isTask?'To-do':isToggle?'Toggle title':isBullet?'List item':"Type here, or press / for commands");
        let details='';
        if(noteExpanded)details='<div class="checklist-note-editor" contenteditable="true" role="textbox" aria-multiline="true" data-note-id="'+safe(b.id)+'" data-placeholder="Type notes or /bullet…" spellcheck="true">'+safe(b.note)+'</div>';
        if(expanded){
          const mode=b.detailsMode==='tasks'?'tasks':'notes';
          const modeSelector='';
          const notes='<div class="checklist-note-editor" contenteditable="true" role="textbox" aria-multiline="true" data-note-id="'+safe(b.id)+'" data-placeholder="Type notes or /bullet…" spellcheck="true">'+safe(b.note)+'</div>';
          const nested='<div class="checklist-subtasks">'+b.subtasks.map(t=>
            '<div class="checklist-subtask '+(t.type==='bullet'?'subtask-bullet':'')+'"><span class="subtask-bullet-dot" aria-hidden="true">•</span><input type="checkbox" data-subtask-check="'+safe(b.id)+'" data-subtask-id="'+safe(t.id)+'" '+(t.checked?'checked':'')+' aria-label="Complete subtask"/><input type="text" maxlength="500" data-subtask-text="'+safe(b.id)+'" data-subtask-id="'+safe(t.id)+'" value="'+safe(t.text)+'" placeholder="'+(t.type==='bullet'?'Bullet point':'Subtask or /bullet')+'" class="'+(t.checked?'completed':'')+'"/><button type="button" data-subtask-kind="'+safe(b.id)+'" data-subtask-id="'+safe(t.id)+'" aria-label="Switch between task and bullet">⋯</button><button type="button" data-subtask-remove="'+safe(b.id)+'" data-subtask-id="'+safe(t.id)+'" aria-label="Remove subtask">×</button></div>'
          ).join('')+'<div class="checklist-nested-actions"><button type="button" class="checklist-add-subtask" data-subtask-add="'+safe(b.id)+'">＋ Add a subtask</button><button type="button" class="checklist-add-subtask" data-subtask-bullet="'+safe(b.id)+'">• Bullet list</button></div></div>';
          details=modeSelector+(mode==='notes'?notes:nested);
        }
        return '<div class="checklist-line checklist-type-'+b.type+(b.checked?' is-done':'')+(b.collapsed?' is-collapsed':'')+'" data-id="'+safe(b.id)+'">'+
          '<div class="checklist-line-tools"><button type="button" class="checklist-insert" data-insert="'+safe(b.id)+'" aria-label="Insert block">+</button><button type="button" class="checklist-handle" aria-label="Drag to rearrange">⠿</button></div>'+
          '<div class="checklist-line-inner">'+icon+
          '<div class="checklist-field-group"><div class="checklist-editor" contenteditable="true" role="textbox" aria-multiline="true" data-block-id="'+safe(b.id)+'" data-placeholder="'+safe(placeholder)+'" spellcheck="true">'+safe(b.text)+'</div>'+
          (details?'<div class="checklist-details">'+details+'</div>':'')+'</div></div>'+
          (isTask?'<label class="checklist-date-pill '+(b.dueDate?'has-date':'')+'" title="Optional due date"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4m8-4v4"/></svg><span>'+safe(b.dueDate?new Date(b.dueDate+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}):'Date')+'</span><input type="date" data-due-date="'+safe(b.id)+'" value="'+safe(b.dueDate)+'" aria-label="Due date"/></label>':'')+
          '<button type="button" class="checklist-delete" data-delete="'+safe(b.id)+'" aria-label="Delete block">×</button></div>';
      }).join('');
      $('checklistEmpty').hidden=true;
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
      const subtask=e.target.closest('[data-subtask-text]');
      if(subtask){const block=blocks.find(b=>b.id===subtask.dataset.subtaskText);const sub=block?.subtasks.find(t=>t.id===subtask.dataset.subtaskId);if(sub){sub.text=subtask.value;scheduleSave();}return;}
      const note=e.target.closest('.checklist-note-editor[data-note-id]');
      if(note){
        const b=blocks.find(x=>x.id===note.dataset.noteId);
        if(b){
          b.note=(note.innerText||note.textContent||'').replace(/\n$/,'').slice(0,10000);
          const pos=editorCaretOffset(note),before=b.note.slice(0,pos);
          const line=before.slice(before.lastIndexOf('\n')+1);
          const command=line.match(/^\/([a-z0-9 -]*)$/i);
          if(command)openSlash('note:'+b.id,command[1].trim());
          else if(slashFor==='note:'+b.id)closeSlash();
          scheduleSave();
        }
        return;
      }
      const field=e.target.closest('[contenteditable="true"][data-block-id]');if(!field)return;
      const b=blocks.find(b=>b.id===field.dataset.blockId);if(!b)return;
      b.text=(field.innerText||field.textContent||'').replace(/\n$/,'').slice(0,5000);
      scheduleSave();
      const match=b.text.match(/^\/([a-z0-9 -]*)$/i);
      if(match)openSlash(b.id,match[1].trim());else if(slashFor===b.id)closeSlash();
    });
    root.addEventListener('keydown',e=>{
      const note=e.target.closest('.checklist-note-editor[data-note-id]');
      if(note&&!e.isComposing){
        if(slashFor==='note:'+note.dataset.noteId&&!$('checklistSlashMenu').hidden){
          if(e.key==='ArrowDown'||e.key==='ArrowUp'){
            e.preventDefault();slashSelected=(slashSelected+(e.key==='ArrowDown'?1:-1)+slashMatches.length)%slashMatches.length;
            $('checklistSlashMenu').querySelectorAll('[data-command]').forEach((el,i)=>el.classList.toggle('selected',i===slashSelected));return;
          }
          if(e.key==='Enter'){
            e.preventDefault();if(slashMatches[slashSelected])applyCommand(slashMatches[slashSelected].id);return;
          }
          if(e.key==='Escape'){e.preventDefault();closeSlash();return;}
        }
        if(handleChecklistArrow(e,note))return;
        if(e.key==='Enter'&&!e.shiftKey){
          const block=blocks.find(b=>b.id===note.dataset.noteId);
          const pos=editorCaretOffset(note);
          const before=(block?.note||'').slice(0,pos);
          const line=before.slice(before.lastIndexOf('\n')+1);
          if(/^•\s/.test(line)){
            e.preventDefault();
            const continuation=line.trim()==='•'?'\n':'\n• ';
            block.note=(block.note||'').slice(0,pos)+continuation+block.note.slice(pos);
            note.textContent=block.note;
            focusEditableAt(note,pos+continuation.length);
            scheduleSave();
            return;
          }
        }
        return;
      }
      const nested=e.target.closest('[data-subtask-text]');
      if(nested&&!e.isComposing&&(e.key==='ArrowUp'||e.key==='ArrowDown')){
        const at=nested.selectionStart??0;
        if((e.key==='ArrowUp'&&at===0)||(e.key==='ArrowDown'&&at===nested.value.length)){
          const fields=[...root.querySelectorAll('.checklist-editor,.checklist-note-editor,[data-subtask-text]')].filter(el=>el.getClientRects().length&&el.offsetParent!==null);
          const index=fields.indexOf(nested),next=fields[index+(e.key==='ArrowDown'?1:-1)];
          if(next){
            e.preventDefault();
            if(next.matches('input')){next.focus();const pos=Math.min(at,next.value.length);next.setSelectionRange(pos,pos);}
            else focusEditableAt(next,Math.min(at,(next.innerText||next.textContent||'').length));
            return;
          }
        }
      }
      if(nested&&!e.isComposing&&e.key===' '&&/^\/(bullet|bulleted|b)$/i.test(nested.value.trim())){
        e.preventDefault();
        const b=blocks.find(x=>x.id===nested.dataset.subtaskText),sub=b?.subtasks.find(x=>x.id===nested.dataset.subtaskId);
        if(sub){sub.type='bullet';sub.text='';renderChecklist(true);scheduleSave(true);requestAnimationFrame(()=>root.querySelector('[data-subtask-id="'+sub.id+'"][data-subtask-text]')?.focus());}
        return;
      }
      if(nested&&e.key==='Enter'&&!e.isComposing){
        e.preventDefault();const b=blocks.find(x=>x.id===nested.dataset.subtaskText);
        if(b&&b.subtasks.length<40){
          const prior=b.subtasks.find(t=>t.id===nested.dataset.subtaskId);
          const sub={id:uniqueId(),text:'',checked:false,type:prior?.type==='bullet'?'bullet':'todo'};
          const ix=b.subtasks.findIndex(t=>t.id===nested.dataset.subtaskId);
          b.subtasks.splice(ix+1,0,sub);renderChecklist(true);scheduleSave(true);
          requestAnimationFrame(()=>root.querySelector('[data-subtask-id="'+sub.id+'"][data-subtask-text]')?.focus());
        }return;
      }
      const field=e.target.closest('[contenteditable="true"][data-block-id]');if(!field)return;
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
      if(handleChecklistArrow(e,field))return;
      if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){
        e.preventDefault();closeSlash();
        const offset=editorCaretOffset(field);
        const before=b.text.slice(0,offset),after=b.text.slice(offset);
        b.text=before;
        const nextType=['todo','todoNote','todoList'].includes(b.type)?(before.trim()?'todo':'text'):b.type==='bullet'?(before.trim()?'bullet':'text'):'text';
        if(!before.trim()&&nextType==='text')b.type='text';
        const newBlock=addBlock(id,nextType,after);
        requestAnimationFrame(()=>focusBlock(newBlock.id,false));
        return;
      }
      if(e.key==='Backspace'&&!e.isComposing&&editorCaretOffset(field)===0&&window.getSelection()?.isCollapsed&&blocks.length>1){
        e.preventDefault();
        const index=blocks.findIndex(x=>x.id===id);
        if(index>0){
          const previous=blocks[index-1],position=previous.text.length;
          previous.text+=b.text;
          blocks.splice(index,1);renderChecklist(true);scheduleSave(true);
          requestAnimationFrame(()=>focusBlockAt(previous.id,position));
        }else if(!b.text){
          blocks.splice(index,1);renderChecklist(true);scheduleSave(true);
          requestAnimationFrame(()=>focusBlock(blocks[0].id,false));
        }
        return;
      }
    });
    function editorCaretOffset(field){
      const selection=window.getSelection();
      if(!selection||!selection.rangeCount||!field.contains(selection.anchorNode))return (field.textContent||'').length;
      const range=selection.getRangeAt(0).cloneRange();
      range.selectNodeContents(field);range.setEnd(selection.anchorNode,selection.anchorOffset);
      return range.toString().length;
    }
    function focusBlockAt(id,offset){
      const field=[...root.querySelectorAll('.checklist-editor')].find(x=>x.dataset.blockId===id);
      if(!field)return;
      field.focus();
      const walker=document.createTreeWalker(field,NodeFilter.SHOW_TEXT);
      let node,remaining=offset;
      while((node=walker.nextNode())){
        if(remaining<=node.textContent.length)break;
        remaining-=node.textContent.length;
      }
      const range=document.createRange(),sel=window.getSelection();
      if(node)range.setStart(node,Math.max(0,remaining));
      else range.selectNodeContents(field);
      range.collapse(true);sel.removeAllRanges();sel.addRange(range);
    }
    // Preserve the caret's relative text position when moving across Notion-like blocks.
    function focusEditableAt(field,offset){
      if(!field)return;
      field.focus();
      const walker=document.createTreeWalker(field,NodeFilter.SHOW_TEXT);
      let node,remaining=Math.max(0,offset);
      while((node=walker.nextNode())){
        if(remaining<=node.textContent.length)break;
        remaining-=node.textContent.length;
      }
      const range=document.createRange(),sel=window.getSelection();
      if(node)range.setStart(node,Math.max(0,Math.min(remaining,node.textContent.length)));
      else range.selectNodeContents(field);
      range.collapse(true);sel.removeAllRanges();sel.addRange(range);
    }
    function handleChecklistArrow(event,field){
      if(event.isComposing||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return false;
      if(event.key!=='ArrowUp'&&event.key!=='ArrowDown')return false;
      const sel=window.getSelection();
      if(!sel?.isCollapsed||!sel.rangeCount||!field.contains(sel.anchorNode))return false;
      const caret=sel.getRangeAt(0).cloneRange();
      caret.collapse(true);
      const caretRect=caret.getBoundingClientRect(),box=field.getBoundingClientRect();
      const lineHeight=parseFloat(getComputedStyle(field).lineHeight)||26;
      const position=editorCaretOffset(field);
      const length=(field.innerText||field.textContent||'').length;
      const first=position===0||caretRect.top<=box.top+lineHeight*.65;
      const last=position>=length||caretRect.bottom>=box.bottom-lineHeight*.65;
      if(event.key==='ArrowUp'&&!first||event.key==='ArrowDown'&&!last)return false;
      const fields=[...root.querySelectorAll('.checklist-editor,.checklist-note-editor,[data-subtask-text]')]
        .filter(el=>el.getClientRects().length&&el.offsetParent!==null);
      const index=fields.indexOf(field),next=fields[index+(event.key==='ArrowDown'?1:-1)];
      if(!next)return false;
      event.preventDefault();
      if(next.matches('input')){next.focus();next.setSelectionRange(Math.min(editorCaretOffset(field),next.value.length),Math.min(editorCaretOffset(field),next.value.length));}
      else focusEditableAt(next,Math.min(editorCaretOffset(field),(next.innerText||next.textContent||'').length));
      return true;
    }
    // Strip pasted HTML, preserving clean text and preventing unexpected formatting.
    // Convert pasted Markdown-style lists into genuine checklist bullet blocks.
    // Hyphens at the start of list lines are formatting cues, not literal content.
    const parsePastedLines=text=>text.replace(/\r/g,'').split('\n').map(line=>{
      const bullet=line.match(/^\s*[-*•]\s+(.+)$/);
      const task=line.match(/^\s*-\s*\[([ xX])\]\s*(.*)$/);
      if(task)return {type:'todo',text:task[2],checked:task[1].toLowerCase()==='x'};
      if(bullet)return {type:'bullet',text:bullet[1],checked:false};
      return {type:'text',text:line,checked:false};
    });
    root.addEventListener('paste',event=>{
      const note=event.target.closest('.checklist-note-editor');
      if(note){
        event.preventDefault();
        const block=blocks.find(x=>x.id===note.dataset.noteId);
        if(!block)return;
        const raw=(event.clipboardData?.getData('text/plain')||'').slice(0,10000);
        const lines=parsePastedLines(raw);
        const formatted=lines.map(x=>x.type==='bullet'?'• '+x.text:x.type==='todo'?(x.checked?'☑ ':'☐ ')+x.text:x.text).join('\n');
        const selection=window.getSelection();
        const start=editorCaretOffset(note);
        const selected=selection&&!selection.isCollapsed&&note.contains(selection.anchorNode)?selection.toString().length:0;
        block.note=block.note.slice(0,start)+formatted+block.note.slice(start+selected);
        note.textContent=block.note;
        focusEditableAt(note,start+formatted.length);
        scheduleSave(true);
        return;
      }
      const field=event.target.closest('.checklist-editor');
      if(!field)return;
      event.preventDefault();
      const plain=(event.clipboardData?.getData('text/plain')||'').replace(/\r/g,'');
      const parts=parsePastedLines(plain);
      if(parts.length===1&&parts[0].type==='text'){
        document.execCommand('insertText',false,parts[0].text);return;
      }
      const block=blocks.find(b=>b.id===field.dataset.blockId);if(!block)return;
      const at=editorCaretOffset(field),original=(field.innerText||field.textContent||'');
      const before=original.slice(0,at),after=original.slice(at);
      const index=blocks.findIndex(b=>b.id===block.id);
      if(!before&&parts.length) {
        block.type=parts[0].type;block.checked=parts[0].checked;
      }
      block.text=before+parts[0].text;
      let insertion=index;
      for(const part of parts.slice(1)){
        const next=normalizeBlock({id:uniqueId(),type:part.type,text:part.text,checked:part.checked},++insertion);
        blocks.splice(insertion,0,next);
      }
      const last=blocks[insertion];
      const finish=last.text.length;
      last.text+=after;
      closeSlash();renderChecklist(true);scheduleSave(true);
      requestAnimationFrame(()=>focusBlockAt(last.id,finish));
    });
    root.addEventListener('change',e=>{
      const subcheck=e.target.closest('[data-subtask-check]');
      if(subcheck){
        const b=blocks.find(x=>x.id===subcheck.dataset.subtaskCheck);
        const t=b?.subtasks.find(x=>x.id===subcheck.dataset.subtaskId);
        if(t){t.checked=subcheck.checked;subcheck.closest('.checklist-subtask')?.classList.toggle('is-done',t.checked);scheduleSave(true);}
        return;
      }
      const dateInput=e.target.closest('[data-due-date]');
      if(dateInput){
        const block=blocks.find(x=>x.id===dateInput.dataset.dueDate);
        if(block){block.dueDate=dateInput.value;renderChecklist(true);scheduleSave(true);}
        return;
      }
      const input=e.target.closest('[data-toggle-check]');if(!input)return;
      const b=blocks.find(x=>x.id===input.dataset.toggleCheck);if(!b)return;
      b.checked=input.checked;input.closest('.checklist-line').classList.toggle('is-done',b.checked);scheduleSave(true);
    });
    root.addEventListener('click',e=>{
      const target=e.target;
      const remove=target.closest('[data-subtask-remove]');
      const add=target.closest('[data-subtask-add]');
      const bullet=target.closest('[data-subtask-bullet]');
      const kind=target.closest('[data-subtask-kind]');
      const mode=target.closest('[data-details-mode]');
      const deletion=target.closest('[data-delete]');
      const collapse=target.closest('[data-collapse]');
      const insert=target.closest('[data-insert]');
      if(insert){
        const before=blocks.find(b=>b.id===insert.dataset.insert);
        if(before){
          const made=addBlock(before.id,'text','/');
          requestAnimationFrame(()=>openSlash(made.id,''));
        }
      }else if(bullet){
        const block=blocks.find(x=>x.id===bullet.dataset.subtaskBullet);
        if(block&&block.subtasks.length<40){
          const sub={id:uniqueId(),text:'',checked:false,type:'bullet'};
          block.subtasks.push(sub);renderChecklist(true);scheduleSave(true);
          requestAnimationFrame(()=>root.querySelector('[data-subtask-id="'+sub.id+'"][data-subtask-text]')?.focus());
        }
      }else if(kind){
        const block=blocks.find(x=>x.id===kind.dataset.subtaskKind);
        const sub=block?.subtasks.find(x=>x.id===kind.dataset.subtaskId);
        if(sub){sub.type=sub.type==='bullet'?'todo':'bullet';renderChecklist(true);scheduleSave(true);}
      }else if(remove){
        const block=blocks.find(x=>x.id===remove.dataset.subtaskRemove);
        if(block){block.subtasks=block.subtasks.filter(x=>x.id!==remove.dataset.subtaskId);renderChecklist(true);scheduleSave(true);}
      }else if(add){
        const block=blocks.find(x=>x.id===add.dataset.subtaskAdd);
        if(block&&block.subtasks.length<40){
          const sub={id:uniqueId(),text:'',checked:false,type:'todo'};block.subtasks.push(sub);
          renderChecklist(true);scheduleSave(true);
          requestAnimationFrame(()=>root.querySelector('[data-subtask-id="'+sub.id+'"][data-subtask-text]')?.focus());
        }
      }else if(mode){
        const block=blocks.find(x=>x.id===mode.dataset.id);
        if(block){block.detailsMode=mode.dataset.detailsMode;renderChecklist(true);scheduleSave(true);}
      }else if(deletion){
        blocks=blocks.filter(x=>x.id!==deletion.dataset.delete);renderChecklist(true);scheduleSave(true);
      }else if(collapse){
        const block=blocks.find(x=>x.id===collapse.dataset.collapse);
        if(block){
          if(['todo','todoNote','todoList'].includes(block.type))block.detailsOpen=!block.detailsOpen;
          else block.collapsed=!block.collapsed;
          renderChecklist(true);scheduleSave(true);
        }
      }
    });
    // Clicking open writing space feels like a document, not an insert-block UI.
    root.addEventListener('click',event=>{
      if(event.target!==root)return;
      const last=blocks.at(-1);
      if(last && !last.text.trim() && last.type==='text')focusBlock(last.id);
      else addBlock(last?.id||null,'text');
    });
    document.querySelector('.checklist-document')?.addEventListener('click',event=>{
      if(!event.target.classList.contains('checklist-document'))return;
      const last=blocks.at(-1);
      if(last && !last.text.trim() && last.type==='text')focusBlock(last.id);
      else addBlock(last?.id||null,'text');
    });
    $('checklistAdd').addEventListener('click',()=>addBlock(blocks.at(-1)?.id||null,'text'));
    $('checklistAddBottom').addEventListener('click',()=>addBlock(blocks.at(-1)?.id||null,'text'));
    $('checklistEmpty').addEventListener('click',()=>addBlock(blocks.at(-1)?.id||null,'text'));
    // Document-wide editing shortcuts. Separate editable blocks would otherwise
    // let the browser's Select All / Undo operate on just one field.
    function checklistText(){
      return blocks.map(b=>{
        const lead=b.type==='bullet'?'• ':['todo','todoNote','todoList'].includes(b.type)?(b.checked?'☑ ':'☐ '):'';
        const note=b.type==='todoNote'&&b.note?'\n'+b.note:'';
        const tasks=b.type==='todoList'?(b.subtasks||[]).map(t=>'\n  '+(t.type==='bullet'?'• ':t.checked?'☑ ':'☐ ')+t.text).join(''):'';
        return lead+b.text+note+tasks;
      }).join('\n');
    }
    function selectWholeChecklist(){
      const fields=[...root.querySelectorAll('.checklist-editor,.checklist-note-editor')].filter(el=>el.getClientRects().length);
      if(!fields.length)return;
      const range=document.createRange();
      range.setStart(fields[0],0);
      range.setEnd(fields.at(-1),fields.at(-1).childNodes.length);
      const sel=window.getSelection();
      sel.removeAllRanges();sel.addRange(range);
      allBlocksSelected=true;
    }
    document.addEventListener('keydown',event=>{
      if(!user||tab!=='checklist'||!root.isConnected)return;
      const inside=root.contains(document.activeElement)||root.contains(event.target);
      if(!inside&&!allBlocksSelected)return;
      const mod=event.ctrlKey||event.metaKey;
      const key=event.key.toLowerCase();
      if(mod&&!event.altKey&&key==='a'){
        event.preventDefault();selectWholeChecklist();return;
      }
      if(mod&&!event.altKey&&(key==='z'||key==='y')){
        event.preventDefault();
        restoreHistory(key==='y'||(key==='z'&&event.shiftKey)?'redo':'undo');
        return;
      }
      if(allBlocksSelected&&mod&&key==='c'){
        event.preventDefault();
        const value=checklistText();
        navigator.clipboard?.writeText(value).catch(()=>{});
        return;
      }
      if(allBlocksSelected&&(key==='backspace'||key==='delete'||(!mod&&!event.altKey&&key.length===1))){
        event.preventDefault();
        blocks=[normalizeBlock({id:uniqueId(),type:'text',text:key.length===1?event.key:''},0)];
        allBlocksSelected=false;
        renderChecklist(true);scheduleSave(true);
        requestAnimationFrame(()=>focusBlock(blocks[0].id,true));
        return;
      }
    },true);
    root.addEventListener('pointerdown',event=>{
      if(allBlocksSelected&&!event.target.closest('#checklistSlashMenu'))allBlocksSelected=false;
    });
    // Cross-block range removal for selections made with mouse or Shift+arrows.
    root.addEventListener('beforeinput',event=>{
      if(event.inputType!=='deleteContentBackward'&&event.inputType!=='deleteContentForward'&&event.inputType!=='deleteByCut')return;
      const selection=window.getSelection();
      if(!selection||selection.isCollapsed||allBlocksSelected)return;
      const nodeToField=node=>(node?.nodeType===1?node:node?.parentElement)?.closest?.('.checklist-editor');
      const left=nodeToField(selection.anchorNode),right=nodeToField(selection.focusNode);
      if(!left||!right||left===right)return;
      const leftIndex=blocks.findIndex(b=>b.id===left.dataset.blockId),rightIndex=blocks.findIndex(b=>b.id===right.dataset.blockId);
      if(leftIndex<0||rightIndex<0)return;
      event.preventDefault();
      const startIndex=Math.min(leftIndex,rightIndex),endIndex=Math.max(leftIndex,rightIndex);
      const startField=leftIndex<=rightIndex?left:right;
      const endField=leftIndex<=rightIndex?right:left;
      const first=blocks[startIndex],last=blocks[endIndex];
      const offsetAt=(field,node,offset)=>{
        const range=document.createRange();range.selectNodeContents(field);range.setEnd(node,offset);
        return range.toString().length;
      };
      const firstOffset=selection.anchorNode&&startField.contains(selection.anchorNode)?
        offsetAt(startField,selection.anchorNode,selection.anchorOffset):
        offsetAt(startField,selection.focusNode,selection.focusOffset);
      const lastOffset=selection.focusNode&&endField.contains(selection.focusNode)?
        offsetAt(endField,selection.focusNode,selection.focusOffset):
        offsetAt(endField,selection.anchorNode,selection.anchorOffset);
      first.text=first.text.slice(0,firstOffset)+last.text.slice(lastOffset);
      blocks.splice(startIndex+1,endIndex-startIndex);
      renderChecklist(true);scheduleSave(true);
      requestAnimationFrame(()=>focusBlockAt(first.id,firstOffset));
    });
    // Drag-select between two separate text blocks with the mouse.
    let dragStart=null;
    root.addEventListener('pointerdown',event=>{
      if(event.pointerType!=='mouse'||event.button!==0)return;
      const field=event.target.closest('.checklist-editor');
      if(!field)return;
      const range=document.caretRangeFromPoint?.(event.clientX,event.clientY);
      if(range)dragStart={node:range.startContainer,offset:range.startOffset,field};
    });
    document.addEventListener('pointermove',event=>{
      if(!dragStart||!(event.buttons&1)||event.pointerType!=='mouse')return;
      const target=document.elementFromPoint(event.clientX,event.clientY)?.closest?.('.checklist-editor');
      if(!target||target===dragStart.field)return;
      const range=document.caretRangeFromPoint?.(event.clientX,event.clientY);
      if(!range||!target.contains(range.startContainer))return;
      const sel=window.getSelection();
      try{sel.setBaseAndExtent(dragStart.node,dragStart.offset,range.startContainer,range.startOffset);}
      catch(error){/* Browser may restrict selections crossing independent edit hosts. */}
    });
    document.addEventListener('pointerup',()=>{dragStart=null;});
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
    const flame='<svg viewBox="0 0 24 24" aria-hidden="true" class="insight-shared-flame"><use href="#flame-solid"></use></svg>';
    const badgeArt={
      flame:flame,
      star:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65"><path d="m12 2 3.1 6.3 7 .9-5.1 5 1.3 7L12 18l-6.3 3.2 1.3-7-5.1-5 7-.9z"/></svg>',
      crown:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m2 7 5.5 5L12 5l4.5 7L22 7l-2.2 12H4.2z"/><path d="M5 22h14"/></svg>',
      sunrise:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 18h18M12 4v3M5 8l2.5 2.5M19 8l-2.5 2.5M7 18a5 5 0 0 1 10 0"/><path d="M3 22h18"/></svg>',
      freeze:'<svg class="insight-freeze-flame" viewBox="0 0 24 24" aria-hidden="true"><use href="#flame-outline"></use></svg>',
      shield:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2 21 6v6c0 5-3.5 8.5-9 10-5.5-1.5-9-5-9-10V6z"/><path d="m8 12 3 3 5-6"/></svg>',
      layers:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m12 2 10 5-10 5L2 7zM2 12l10 5 10-5M2 17l10 5 10-5"/></svg>',
      gem:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M7 3h10l5 7-10 12L2 10zM2 10h20M7 3l5 19L17 3"/></svg>',
      calendar:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4m8-4v4m-7 8 2 2 4-5"/></svg>'
    };
    function achievementItems(habits){
      const chosen=selectedHabit==='all'?habits:habits.filter(h=>h.id===selectedHabit);
      const longest=Math.max(0,...chosen.map(longestFor));
      const total=chosen.reduce((n,h)=>n+(h.completions||[]).length,0);
      const freezes=chosen.reduce((n,h)=>n+(h.freezeDates||[]).length,0);
      const breadth=habits.filter(h=>(h.completions||[]).length>0).length;
      const awards=[
        {title:'First Spark',detail:'Your first completed day',icon:'flame',goal:1,progress:total,tier:'THE BEGINNING'},
        {title:'One Week Strong',detail:'A 7-day streak',icon:'sunrise',goal:7,progress:longest,tier:'BUILDING MOMENTUM'},
        {title:'Two-Week Rhythm',detail:'A 14-day streak',icon:'star',goal:14,progress:longest,tier:'FINDING YOUR FLOW'},
        {title:'Thirty-Day Flame',detail:'A 30-day streak',icon:'crown',goal:30,progress:longest,tier:'A REAL MILESTONE'},
        {title:'Century Club',detail:'A 100-day streak',icon:'gem',goal:100,progress:longest,tier:'RARE MILESTONE'},
        {title:'Every Day Counts',detail:'50 completed days',icon:'calendar',goal:50,progress:total,tier:'SHOWING UP'},
        {title:'Room for Life',detail:'A protected freeze day',icon:'freeze',goal:1,progress:freezes,tier:'BUILT-IN GRACE'},
        {title:'Many Paths',detail:'Check-ins in 3 different habits',icon:'layers',goal:3,progress:breadth,tier:'EXPLORING HABITS',allOnly:true}
      ];
      return awards.filter(a=>!a.allOnly||selectedHabit==='all');
    }
    function renderAchievements(habits){
      const items=achievementItems(habits);
      $('insightAchievementGrid').innerHTML=items.map((a,i)=>{
        const unlocked=a.progress>=a.goal;
        return '<article class="achievement-card '+(unlocked?'unlocked':'locked')+'" style="--badge-delay:'+Math.min(i*55,400)+'ms">'+
          '<div class="achievement-card-top"><span class="achievement-tier">'+safe(a.tier)+'</span><span class="achievement-state">'+(unlocked?'UNLOCKED':'TO DISCOVER')+'</span></div>'+
          '<div class="achievement-emblem achievement-emblem-'+safe(a.icon)+'">'+badgeArt[a.icon]+'</div>'+
          '<h3>'+safe(a.title)+'</h3><p>'+safe(a.detail)+'</p>'+
          '<div class="achievement-foot"><span>'+ (unlocked?'✦ Earned':Math.min(a.progress,a.goal)+' / '+a.goal) +'</span><div class="achievement-progress"><i style="width:'+Math.round(Math.min(1,a.progress/a.goal)*100)+'%"></i></div></div>'+
          '</article>';
      }).join('');
    }
    function renderInsightTabs(){
      const achievements=insightSection==='achievements';
      $('insightOverview').hidden=achievements;
      $('insightAchievements').hidden=!achievements;
      document.querySelector('.insight-section-tabs')?.setAttribute('data-selected',achievements?'achievements':'overview');
      for(const [id,active] of [['insightOverviewTab',!achievements],['insightAchievementsTab',achievements]]){
        $(id).classList.toggle('active',active);
        $(id).setAttribute('aria-selected',String(active));
        $(id).tabIndex=active?0:-1;
      }
    }
    function chooseInsightSection(which){
      insightSection=which==='achievements'?'achievements':'overview';
      renderInsightTabs();renderInsights();
    }
    function renderPicker(habits){
      if(selectedHabit!=='all'&&!habits.some(h=>h.id===selectedHabit))selectedHabit='all';
      const chosen=habits.find(h=>h.id===selectedHabit);
      $('insightHabitLabel').textContent=chosen?.name||'All Habits';
      $('insightHabitTrigger').querySelector('.insight-picker-avatar').innerHTML=chosen?flame:'✦';
      const entries=[{id:'all',name:'All Habits',subtitle:'Your complete journey'},...habits.map(h=>({id:h.id,name:h.name,subtitle:'Individual habit'}))];
      $('insightHabitMenu').innerHTML=entries.map(entry=>
        '<button type="button" role="option" class="insight-option '+(entry.id===selectedHabit?'selected':'')+'" data-habit-id="'+safe(entry.id)+'" aria-selected="'+(entry.id===selectedHabit)+'">'+
        '<span class="insight-option-symbol">'+(entry.id==='all'?'✦':flame)+'</span><span class="insight-option-text"><strong>'+safe(entry.name)+'</strong><small>'+safe(entry.subtitle)+'</small></span><span class="insight-option-check">'+(entry.id===selectedHabit?'✓':'')+'</span></button>'
      ).join('');
    }
    function closePicker(){
      $('insightHabitMenu').hidden=true;$('insightHabitTrigger').setAttribute('aria-expanded','false');
      $('insightHabitPicker').classList.remove('open');
    }
    $('insightHabitTrigger').addEventListener('click',()=>{
      const open=$('insightHabitMenu').hidden;
      $('insightHabitMenu').hidden=!open;
      $('insightHabitTrigger').setAttribute('aria-expanded',String(open));
      $('insightHabitPicker').classList.toggle('open',open);
    });
    $('insightHabitMenu').addEventListener('click',event=>{
      const item=event.target.closest('[data-habit-id]');if(!item)return;
      selectedHabit=item.dataset.habitId;closePicker();renderInsights();
      if(user){
        const uid=user.uid;insightSelectionPending=true;
        setDoc(doc(db,'users',uid,'settings','insights'),{habitId:selectedHabit},{merge:true})
          .catch(e=>console.warn('Unable to save Insights selection',e))
          .finally(()=>{insightSelectionPending=false;});
      }
    });
    document.addEventListener('pointerdown',e=>{if(!e.target.closest('#insightHabitPicker'))closePicker();});
    document.addEventListener('keydown',e=>{if(e.key==='Escape')closePicker();});
    $('insightOverviewTab').addEventListener('click',()=>chooseInsightSection('overview'));
    $('insightAchievementsTab').addEventListener('click',()=>chooseInsightSection('achievements'));
    $('insightViewAchievements').addEventListener('click',()=>chooseInsightSection('achievements'));
    function renderInsights(){
      const habits=getHabits();
      const empty=$('insightEmpty'),content=$('insightsContent');
      empty.hidden=habits.length>0;content.hidden=habits.length===0;
      if(!habits.length){renderInsightTabs();return;}
      renderPicker(habits);renderInsightTabs();
      const all=selectedHabit==='all';
      const chosen=all?habits:habits.filter(h=>h.id===selectedHabit);
      const h=chosen[0]||habits[0];
      const completed=chosen.reduce((n,r)=>n+(r.completions||[]).length,0);
      const freezeCount=chosen.reduce((n,r)=>n+(r.freezeDates||[]).length,0);
      const longest=Math.max(0,...chosen.map(longestFor));
      const current=all?chosen.filter(x=>evaluateHabit(x).streak>0).length:evaluateHabit(h).streak;
      const cards=[
        {label:all?'Active streaks':'Current streak',number:current,icon:flame,hint:all?'Habits with an active streak':'Your ongoing run'},
        {label:all?'Best streak':'Longest streak',number:longest,icon:badgeArt.crown,hint:'Your personal best'},
        {label:'Days completed',number:completed,icon:badgeArt.calendar,hint:all?'Across all habits':'Every check-in counts'},
        {label:'Freeze days',number:freezeCount,icon:badgeArt.freeze,hint:'Days your streak was protected'}
      ];
      $('insightContextNote').textContent=all?'A calm overview of all your habits. Every check-in counts; there is no daily completion quota.':'A closer look at '+h.name+'.';
      $('insightStatGrid').innerHTML=cards.map((x,i)=>
        '<div class="insight-stat-card"><span class="insight-stat-kicker">'+safe(x.label)+'</span><div class="insight-stat-main"><strong>'+x.number+'</strong><span class="insight-stat-icon '+(i===3?'icy':'')+'">'+x.icon+'</span></div><small>'+safe(x.hint)+'</small></div>'
      ).join('');
      // All Habits is an aggregate of check-ins, not a synthetic streak.
      const combined={completions:[...new Set(chosen.flatMap(x=>x.completions||[]))],
        freezeDates:[...new Set(chosen.flatMap(x=>x.freezeDates||[]))]};
      const chart=all?weeklyChartAll(chosen):weeklyChart(h);
      $('insightActivityChart').innerHTML=chart;
      $('insightHeatmap').innerHTML=calendarMonths(all?combined:h);
      $('insightMilestones').innerHTML=achievementItems(habits).slice(0,7).map(a=>
        '<div class="insight-milestone '+(a.progress>=a.goal?'unlocked':'')+'"><span class="milestone-symbol">'+badgeArt[a.icon]+'</span><strong>'+safe(a.title)+'</strong><small>'+safe(a.detail)+'</small></div>'
      ).join('');
      renderAchievements(habits);
    }
    function weeklyChartAll(habits){
      const start=weekStart(new Date()),completed=habits.map(h=>new Set(h.completions||[]));
      return Array.from({length:8},(_,i)=>{
        const monday=shift(start,(i-7)*7);
        let count=0;
        for(let day=0;day<7;day++){const k=key(shift(monday,day));for(const set of completed)if(set.has(k))count++;}
        const max=7*habits.length,height=count?Math.max(8,count/max*100):0;
        return '<div class="insight-week"><div class="insight-week-vertical"><span class="insight-week-bar" style="height:'+height+'%" title="'+count+' check-ins across all habits"></span></div><span class="insight-week-label">'+monday.toLocaleDateString('en-US',{month:'short',day:'numeric'})+'</span></div>';
      }).join('');
    }
    function onHabitsChange(){if(tab==='insights')renderInsights();}
    function dispose(){if(unsub)unsub();if(insightUnsub)insightUnsub();clearTimeout(saveTimer);if(sortable)sortable.destroy();}
    // Deep links should initialize consistently once the account loads.
    updateNav();
    return {setUser,selectTab,onHabitsChange,renderInsights,renderChecklist,tab:()=>tab,dispose};
  }
  window.MyStreaksWorkspace={start};
})();