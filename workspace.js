/* My Streaks Workspace: navigation, read-only insights, and private checklist.
   Standalone so an optional workspace failure never stops the habit app. */
(function(){
  const $=id=>document.getElementById(id);
  const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const types=[
    {id:'h1',title:'Heading 1',subtitle:'Large section heading',symbol:'H1'},
    {id:'h2',title:'Heading 2',subtitle:'Smaller heading',symbol:'H2'},
    {id:'todo',title:'To-do list',subtitle:'A task to check off',symbol:'☐'},
    {id:'todoList',title:'Expandable to-do',subtitle:'A task with freely editable indented blocks',symbol:'☰'},
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
    let historyUndo=[],historyRedo=[],historyPresent='[]',lastHistoryAt=0,lastHistoryField='',restoringHistory=false,allBlocksSelected=false,pendingUndoFocus=null;
    const serializeBlocks=()=>JSON.stringify(blocks.map((b,i)=>({...b,order:i})));
    const resetHistory=()=>{historyUndo=[];historyRedo=[];historyPresent=serializeBlocks();lastHistoryAt=0;lastHistoryField='';allBlocksSelected=false;pendingUndoFocus=null;};
    function trackHistory(){
      if(restoringHistory)return;
      const next=serializeBlocks();
      if(next===historyPresent)return;
      const active=document.activeElement;
      const field=active?.dataset?.blockId||active?.dataset?.noteId||active?.dataset?.subtaskText||'structure';
      const now=Date.now();
      // Coalesce fast typing into one undo step but never merge different fields or structural edits.
      const typed=active?.matches?.('.checklist-editor,.checklist-note-editor,[data-subtask-text]');
      const coalesce=!pendingUndoFocus&&typed&&field===lastHistoryField&&now-lastHistoryAt<650&&historyUndo.length>0;
      if(!coalesce||pendingUndoFocus){historyUndo.push({content:historyPresent,focus:pendingUndoFocus||{id:field,offset:typed?editorCaretOffset(active):0}});if(historyUndo.length>100)historyUndo.shift();}
      pendingUndoFocus=null;
      historyRedo=[];
      historyPresent=next;lastHistoryAt=now;lastHistoryField=typed?field:'';
    }
    function restoreHistory(direction){
      closeBlockMenu();
      const from=direction==='undo'?historyUndo:historyRedo;
      const to=direction==='undo'?historyRedo:historyUndo;
      if(!from.length)return;
      const active=document.activeElement;
      const focusId=active?.dataset?.blockId||(active?.dataset?.noteId?'note:'+active.dataset.noteId:null);
      const position=active?.matches?.('.checklist-editor,.checklist-note-editor')?editorCaretOffset(active):null;
      const previous=from.pop();
      const restored=typeof previous==='string'?{content:previous,focus:null}:previous;
      to.push({content:serializeBlocks(),focus:focusId?{id:focusId,offset:position??0}:null});
      restoringHistory=true;
      clearDocumentSelection();
      blocks=migrateChecklistBlocks(JSON.parse(restored.content));
      closeSlash();renderChecklist(true);
      historyPresent=serializeBlocks();lastHistoryAt=0;lastHistoryField='';
      restoringHistory=false;scheduleSave(true);
      const saved=restored.focus;
      const savedId=saved?.id;
      const target=savedId&&blocks.some(b=>b.id===savedId)?savedId:
        focusId&&blocks.some(b=>b.id===focusId)?focusId:blocks.at(-1)?.id;
      if(target)requestAnimationFrame(()=>{
        if(target.startsWith('note:'))focusEditableAt(root.querySelector('.checklist-note-editor[data-note-id="'+target.slice(5)+'"]'),saved?.offset??position??0);
        else focusBlockAt(target,savedId===target?(saved.offset??0):(position??blocks.find(b=>b.id===target)?.text.length??0));
      });
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
    document.querySelectorAll('[data-workspace]').forEach(b=>b.addEventListener('click',event=>{
      // Let the browser handle middle-click, Ctrl/Cmd-click, Shift-click and
      // context-menu Open in new tab/window on genuine anchor navigation.
      if(b.tagName==='A'&&(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey))return;
      if(b.tagName==='A')event.preventDefault();
      selectTab(b.dataset.workspace);
    }));
    window.addEventListener('popstate',()=>{
      if(!user||location.pathname.includes('/settings/'))return;
      selectTab(new URLSearchParams(location.search).get('view')||'home',{history:false});
    });
    function setUser(next){
      if(unsub){unsub();unsub=null;}
      if(insightUnsub){insightUnsub();insightUnsub=null;}
      clearTimeout(saveTimer);editRevision++;
      user=next;blocks=[];dirty=false;saveSerial++;clearDocumentSelection();resetHistory();selectedHabit='all';insightSection='overview';insightSelectionPending=false;
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
            const nextBlocks=Array.isArray(incoming)?migrateChecklistBlocks(incoming.filter(b=>b&&typeof b.text==='string').slice(0,500)):[];
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
      return {parentId:typeof b.parentId==='string'?b.parentId:'',id:String(b.id||uniqueId()),type:normalizedType(b.type),text:String(b.text||'').slice(0,5000),checked:!!b.checked,collapsed:!!b.collapsed,detailsOpen:typeof b.detailsOpen==='boolean'?b.detailsOpen:(b.type==='todoNote'||b.type==='todoList')&&!b.collapsed,note:String(b.note||'').slice(0,10000),detailsMode:b.type==='todoList'?'tasks':'notes',subtasks:Array.isArray(b.subtasks)?b.subtasks.slice(0,40).filter(t=>t&&typeof t.text==='string').map(t=>({id:String(t.id||uniqueId()),text:String(t.text).slice(0,500),checked:!!t.checked,type:t.type==='bullet'?'bullet':'todo'})):[],dueDate:/^\d{4}-\d{2}-\d{2}$/.test(b.dueDate||'')?b.dueDate:'',endDate:/^\d{4}-\d{2}-\d{2}$/.test(b.endDate||'')?b.endDate:'',dateFormat:b.dateFormat==='absolute'?'absolute':'relative',includeTime:!!b.includeTime,dueTime:/^([01]\d|2[0-3]):[0-5]\d$/.test(b.dueTime||'')?b.dueTime:'09:00',blockBackground:typeof b.blockBackground==='string'&&Object.hasOwn(backgroundPalette,b.blockBackground)?b.blockBackground:'default',blockColor:typeof b.blockColor==='string'&&Object.hasOwn(markPalette,b.blockColor)?b.blockColor:'default',marks:Array.isArray(b.marks)?b.marks.slice(0,100).filter(m=>m&&Number.isInteger(m.start)&&Number.isInteger(m.end)&&m.start>=0&&m.end>m.start&&m.end<=String(b.text||'').length&&['bold','italic','underline','strike','color','background'].includes(m.kind)&&(!m.value||/^[a-z0-9-]{1,24}$/i.test(m.value))).map(m=>({start:m.start,end:m.end,kind:m.kind,value:m.value||''})):[],order:Number.isFinite(b.order)?b.order:i,createdAt:Number(b.createdAt)||Date.now()};
    }
    // Convert the old two-style subtask/note format to ordinary nested
    // blocks. The migration is deterministic for a stored snapshot and
    // never discards existing notes or subtasks.
    function migrateChecklistBlocks(items){
      const out=[];
      for(const original of items){
        const b=normalizeBlock(original,out.length);
        const legacy=['todoNote','todoList'].includes(b.type);
        if(legacy)b.type='todoList';
        out.push(b);
        const hasStoredChildren=items.some(x=>x.parentId===b.id);
        if(legacy&&!hasStoredChildren){
          if(b.note.trim()){
            for(const [index,line] of b.note.split('\n').entries()){
              if(!line.trim())continue;
              out.push(normalizeBlock({
                id:b.id+'-note-'+index,type:line.startsWith('• ')?'bullet':'text',
                text:line.replace(/^• /,''),parentId:b.id
              },out.length));
            }
          }
          for(const t of b.subtasks){
            out.push(normalizeBlock({
              id:t.id,type:t.type==='bullet'?'bullet':'todo',
              checked:t.checked,text:t.text,parentId:b.id
            },out.length));
          }
        }
        if(legacy){b.note='';b.subtasks=[];b.detailsMode='tasks';}
      }
      return out;
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
    function addBlock(afterId=null,type='todo',text='',forcedParentId=null){
      const preceding=blocks.find(x=>x.id===afterId);
      const parentId=forcedParentId!==null?forcedParentId:(preceding?.parentId||'');
      const b={id:uniqueId(),type,text,parentId,checked:false,collapsed:false,detailsOpen:type==='todoList',note:'',detailsMode:'tasks',subtasks:[],dueDate:'',order:blocks.length,createdAt:Date.now()};
      const index=afterId?blocks.findIndex(x=>x.id===afterId):-1;
      if(index>=0)blocks.splice(index+1,0,b);else blocks.push(b);
      renderChecklist(true);scheduleSave(true);
      requestAnimationFrame(()=>focusBlockAt(b.id,b.text.length));
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
      const field=id.startsWith('note:')?
        root.querySelector('.checklist-note-editor[data-note-id="'+id.slice(5)+'"]'):
        root.querySelector('.checklist-editor[data-block-id="'+id+'"]');
      if(field){
        // Anchor to the current caret/line, not the bottom-left of the viewport.
        const selection=window.getSelection();
        let rect=null;
        if(selection?.rangeCount&&field.contains(selection.anchorNode)){
          const caret=selection.getRangeAt(0).cloneRange();
          caret.collapse(true);
          rect=caret.getClientRects()[0]||null;
        }
        rect=rect||field.getBoundingClientRect();
        const width=Math.min(315,window.innerWidth-24);
        const x=Math.max(12,Math.min(rect.left,window.innerWidth-width-12));
        const below=rect.bottom+8;
        const remaining=window.innerHeight-below-12;
        const above=rect.top-8;
        const placeAbove=remaining<175&&above>remaining;
        menu.style.left=x+'px';
        menu.style.top=(placeAbove?Math.max(12,above-Math.min(320,menu.scrollHeight||280)):Math.min(below,window.innerHeight-90))+'px';
        menu.style.maxHeight=Math.min(350,Math.max(120,placeAbove?above-12:window.innerHeight-below-12))+'px';
      }
      menu.hidden=false;
    }
    // Due dates are explicit: users type @today/@tomorrow or choose a date.
    // Nothing is displayed on a plain task until a date has been assigned.
    let dateTargetId=null,dateSuggestionId=null,dateViewMonth=null;
    const dateScrim=document.createElement('div');
    dateScrim.className='checklist-date-scrim';dateScrim.hidden=true;
    document.body.appendChild(dateScrim);
    const isMobileDate=()=>window.matchMedia('(max-width:799px)').matches;
    const dateMenu=document.createElement('div');
    dateMenu.className='checklist-date-menu';
    dateMenu.setAttribute('role','dialog');
    dateMenu.setAttribute('aria-label','Choose due date');
    dateMenu.hidden=true;
    document.body.appendChild(dateMenu);
    const localDay=(delta=0)=>{
      const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()+delta);return key(d);
    };
    const nextWeekday=day=>{
      const current=new Date();current.setHours(12,0,0,0);
      let gap=(day-current.getDay()+7)%7;
      if(gap===0)gap=7;
      return localDay(gap);
    };
    const weekdayNames=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const relativeWeekday=(day,shift)=>{
      const today=new Date(localDay()+'T12:00:00');
      const monday=(today.getDay()+6)%7;
      return localDay(-monday+shift*7+(day+6)%7);
    };
    const dateFromChoice=value=>value==='today'?localDay():value==='yesterday'?localDay(-1):value==='tomorrow'?localDay(1):value==='week'?localDay(7):
      value.startsWith('last')?relativeWeekday(Number(value.slice(4)),-1):
      value.startsWith('next')?relativeWeekday(Number(value.slice(4)),1):
      value.startsWith('day')?nextWeekday(Number(value.slice(3))):'';
    const choiceName=value=>value==='week'?'nextweek':value.startsWith('last')?'last'+weekdayNames[Number(value.slice(4))].toLowerCase():
      value.startsWith('next')?'next'+weekdayNames[Number(value.slice(4))].toLowerCase():
      value.startsWith('day')?weekdayNames[Number(value.slice(3))].toLowerCase():value;
    const relativeDateMention=date=>{
      if(!date)return '';
      const base=new Date(localDay()+'T12:00:00');
      const target=new Date(date+'T12:00:00');
      const days=Math.round((target-base)/86400000);
      if(days===-1)return 'Yesterday';
      if(days===0)return 'Today';
      if(days===1)return 'Tomorrow';
      // Within the surrounding calendar weeks use a weekday; farther out
      // show the actual calendar date including year, like Notion.
      const mondayOffset=(base.getDay()+6)%7;
      const week=Math.floor((days+mondayOffset)/7);
      if(week>=-1&&week<=1){
        const day=weekdayNames[target.getDay()];
        return (week<0?'Last ':week>0?'Next ':'')+day;
      }
      return target.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
    };
    const dateLabel=date=>{
      if(!date)return '';
      return new Date(date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
    };
    // Match entire saved date tokens before any shorter month prefix.
    const dateMentionRegex=/@(?:Today|Tomorrow|Yesterday|(?:Last|Next)\s+(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,?\s+\d{4})?)/i;
    function findDateMention(value){
      const text=String(value||'');
      const match=text.match(dateMentionRegex);
      if(!match)return null;
      let end=match.index+match[0].length;
      // Previously broken month matching left numbers at the very end:
      // "@Nov 23 25 12 25". Clean only a terminal run of stray numbers.
      const residue=text.slice(end).match(/^(?:\s+\d{1,2})+(?=\s*$)/);
      if(residue)end+=residue[0].length;
      return {start:match.index,end,text:match[0]};
    }
    const markPalette={
      default:'',gray:'#9a9a9f',brown:'#b68a72',orange:'#ee8755',yellow:'#e9b857',
      green:'#73c494',blue:'#7eaeed',purple:'#be9df5',pink:'#e6a0be',red:'#e28b8b'
    };
    const backgroundPalette={
      default:'',gray:'rgba(150,150,155,.22)',brown:'rgba(150,100,65,.27)',
      orange:'rgba(244,112,47,.24)',yellow:'rgba(240,184,52,.25)',
      green:'rgba(77,181,118,.23)',blue:'rgba(67,144,233,.25)',
      purple:'rgba(152,104,222,.25)',pink:'rgba(221,99,153,.24)',red:'rgba(231,89,89,.25)'
    };
    const pendingTextStyle=new Map();
    function htmlWithMarks(b){
      const text=b.text||'',marks=b.marks||[];
      const mention=b.dueDate?findDateMention(text):null;
      if(!marks.length)return inlineDateText(b);
      let html='',index=0;
      while(index<text.length){
        if(mention&&index===mention.start){
          // Formatting a selection that includes @Today must include the
          // entire atomic mention; do not lose its highlight or text style.
          const active=marks.filter(m=>m.start<mention.end&&m.end>mention.start);
          const classes=active.filter(m=>['bold','italic','underline','strike'].includes(m.kind)).map(m=>'fmt-'+m.kind).join(' ');
          const color=active.filter(m=>m.kind==='color').at(-1)?.value||'default';
          const bg=active.filter(m=>m.kind==='background').at(-1)?.value||'default';
          const style=(markPalette[color]?'color:'+markPalette[color]+';':'')+
            (backgroundPalette[bg]?'background-color:'+backgroundPalette[bg]+';':'');
          html+='<span class="checklist-date-mention '+safe(classes)+'" style="'+style+'" data-date-mention="'+safe(b.id)+'" contenteditable="false" role="button" tabindex="0">'+safe('@'+relativeDateMention(b.dueDate))+'</span>';
          index=mention.end;continue;
        }
        if(mention&&index>mention.start&&index<mention.end){index=mention.end;continue;}
        const active=marks.filter(m=>m.start<=index&&m.end>index);
        const classes=active.filter(m=>['bold','italic','underline','strike'].includes(m.kind)).map(m=>'fmt-'+m.kind).join(' ');
        const color=active.filter(m=>m.kind==='color').at(-1)?.value||'default';
        const bg=active.filter(m=>m.kind==='background').at(-1)?.value||'default';
        let end=index+1;
        const sameAt=k=>{
          const ms=marks.filter(m=>m.start<=k&&m.end>k);
          return classes===ms.filter(m=>['bold','italic','underline','strike'].includes(m.kind)).map(m=>'fmt-'+m.kind).join(' ')&&
            color===(ms.filter(m=>m.kind==='color').at(-1)?.value||'default')&&
            bg===(ms.filter(m=>m.kind==='background').at(-1)?.value||'default');
        };
        while(end<text.length&&(!mention||end<mention.start||end>=mention.end)&&sameAt(end))end++;
        const style=(markPalette[color]?'color:'+markPalette[color]+';':'')+
          (backgroundPalette[bg]?'background-color:'+backgroundPalette[bg]+';':'');
        html+=active.length?'<span class="'+safe(classes)+'" style="'+style+'">'+safe(text.slice(index,end))+'</span>':safe(text.slice(index,end));
        index=end;
      }
      return html;
    }
    function updateMarksForEdit(b,newText){
      const old=b.text||'',marks=b.marks||[];
      if(old===newText)return;
      let prefix=0;
      while(prefix<old.length&&prefix<newText.length&&old[prefix]===newText[prefix])prefix++;
      let tail=0;
      while(tail<old.length-prefix&&tail<newText.length-prefix&&old[old.length-tail-1]===newText[newText.length-tail-1])tail++;
      const oldEnd=old.length-tail,newEnd=newText.length-tail;
      const delta=newEnd-oldEnd;
      b.marks=marks.map(m=>{
        if(m.end<=prefix)return m;
        if(m.start>=oldEnd)return {...m,start:m.start+delta,end:m.end+delta};
        // Any style overlapping newly typed text expands over the insertion.
        return {...m,start:Math.min(m.start,prefix),end:Math.max(prefix,m.end+delta)};
      }).filter(m=>m.start>=0&&m.end>m.start&&m.end<=newText.length);
      const pending=pendingTextStyle.get(b.id);
      if(pending&&newEnd>prefix){
        for(const [kind,value] of Object.entries(pending)){
          if(value&&value!=='default')b.marks.push({start:prefix,end:newEnd,kind,value:value===true?'':value});
        }
      }
    }
    // Compact contextual formatting tools. The selection is preserved while
    // clicking buttons, with formatting saved as ranges rather than raw HTML.
    const formatToolbar=document.createElement('div');
    formatToolbar.className='checklist-format-toolbar';
    formatToolbar.hidden=true;
    formatToolbar.innerHTML=
      '<button type="button" data-format-menu="block" class="fmt-type" aria-label="Change block type">Text ▾</button>'+
      '<button type="button" data-format="bold" title="Bold · Ctrl+B"><b>B</b></button>'+
      '<button type="button" data-format="italic" title="Italic · Ctrl+I"><i>I</i></button>'+
      '<button type="button" data-format="underline" title="Underline · Ctrl+U"><u>U</u></button>'+
      '<button type="button" data-format="strike" title="Strikethrough · Ctrl+Shift+S"><s>S</s></button>'+
      '<button type="button" data-format-menu="colors" class="fmt-highlight-button" title="Text and highlight color · Ctrl+Shift+H" aria-label="Text and highlight color"><span class="fmt-highlight-symbol">A</span></button>'+
      '<button type="button" data-format-clear title="Clear formatting · Ctrl+Alt+\\" aria-label="Clear formatting"><span class="fmt-clear-icon">T<small>×</small></span></button>'+
      '<div class="fmt-dropdown" hidden></div>';
    document.body.appendChild(formatToolbar);
    let activeFormatId=null,formatRange=null,formatApplying=false,formatInteracting=false;
    function currentEditorSelection(){
      const sel=window.getSelection();
      if(!sel?.rangeCount)return null;
      const field=sel.anchorNode?.parentElement?.closest?.('.checklist-editor[data-block-id]')||
        (sel.anchorNode?.nodeType===1?sel.anchorNode.closest?.('.checklist-editor[data-block-id]'):null);
      if(!field||!field.contains(sel.focusNode))return null;
      const getPos=(node,offset)=>{
        try{
          const range=document.createRange();range.selectNodeContents(field);range.setEnd(node,offset);
          const fragment=range.cloneContents();
          let length=fragment.textContent.length;
          // An atomic @date shows a relative label but is stored as a date
          // token with a potentially different length. Map DOM selection
          // offsets to the actual saved text, including selected date pills.
          const block=blocks.find(b=>b.id===field.dataset.blockId);
          const mention=block?.dueDate?findDateMention(block.text):null;
          if(mention){
            fragment.querySelectorAll('[data-date-mention]').forEach(pill=>{
              length+=mention.end-mention.start-pill.textContent.length;
            });
          }
          return length;
        }catch(e){return null;}
      };
      const a=getPos(sel.anchorNode,sel.anchorOffset),b=getPos(sel.focusNode,sel.focusOffset);
      return a===null||b===null?null:{id:field.dataset.blockId,start:Math.min(a,b),end:Math.max(a,b)};
    }
    function selectFormatRange(id,start,end){
      const field=root.querySelector('.checklist-editor[data-block-id="'+id+'"]');
      if(!field)return;
      const pointAt=offset=>{
        const block=blocks.find(b=>b.id===id);
        const mention=block?.dueDate?findDateMention(block.text):null;
        let left=offset,walker=document.createTreeWalker(field,NodeFilter.SHOW_TEXT),node;
        while((node=walker.nextNode())){
          const token=node.parentElement?.closest?.('[data-date-mention]');
          if(token){
            if(node!==token.firstChild)continue;
            const length=mention?mention.end-mention.start:token.textContent.length;
            if(left<=length)return {node:token.parentNode,offset:left===0?Array.prototype.indexOf.call(token.parentNode.childNodes,token):Array.prototype.indexOf.call(token.parentNode.childNodes,token)+1};
            left-=length;continue;
          }
          if(left<=node.textContent.length)return {node,offset:left};
          left-=node.textContent.length;
        }
        return {node:field,offset:field.childNodes.length};
      };
      const first=pointAt(start),last=pointAt(end),range=document.createRange();
      range.setStart(first.node,first.offset);range.setEnd(last.node,last.offset);
      field.focus();const sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);
    }
    function placeFormatToolbar(){
      const s=currentEditorSelection();
      // A toolbar is only useful when real text is highlighted, not when
      // merely typing or tapping into an empty block.
      if(!formatApplying&&s&&s.end>s.start){formatRange=s;activeFormatId=s.id;}
      if(!formatRange||formatRange.end<=formatRange.start||tab!=='checklist'){
        formatToolbar.hidden=true;
        formatToolbar.querySelector('.fmt-dropdown').hidden=true;
        return;
      }
      const field=root.querySelector('.checklist-editor[data-block-id="'+formatRange.id+'"]');
      if(!field||!root.contains(field)){
        formatToolbar.hidden=true;return;
      }
      const rect=field.getBoundingClientRect();
      if(rect.bottom<0||rect.top>innerHeight){formatToolbar.hidden=true;return;}
      const width=Math.min(356,innerWidth-24);
      const selection=window.getSelection();
      const selectedRect=selection?.rangeCount?selection.getRangeAt(0).getBoundingClientRect():rect;
      const target=selectedRect?.width?selectedRect:rect;
      const centered=target.left+target.width/2-width/2;
      formatToolbar.style.width=width+'px';
      formatToolbar.style.left=Math.max(12,Math.min(centered,innerWidth-width-12))+'px';
      const top=target.top-54;
      formatToolbar.style.top=(top>=8?top:Math.min(innerHeight-62,target.bottom+10))+'px';
      formatToolbar.hidden=false;
      const b=blocks.find(x=>x.id===activeFormatId);
      formatToolbar.querySelector('.fmt-type').textContent=(types.find(t=>t.id===b?.type)?.title||'Text')+' ▾';
    }
    function applyFormat(kind,value=true){
      const current=currentEditorSelection();
      const selection=(current&&current.end>current.start?current:formatRange);
      const b=blocks.find(x=>x.id===(selection?.id||activeFormatId));
      if(!b)return;
      const s=selection?.start??0,e=selection?.end??s;
      if(e>s){
        // Force a distinct undo checkpoint even immediately after typing.
        // This captures both the prior formatting and the caret position.
        pendingUndoFocus={id:b.id,offset:s};
        const old=b.marks||[];
        const exact=old.some(m=>m.kind===kind&&m.start<=s&&m.end>=e&&(!['color','background'].includes(kind)));
        b.marks=old.flatMap(m=>{
          if(m.kind!==kind||m.end<=s||m.start>=e)return [m];
          const pieces=[];
          if(m.start<s)pieces.push({...m,end:s});
          if(m.end>e)pieces.push({...m,start:e});
          return pieces;
        });
        if(!exact&&value!=='default')b.marks.push({start:s,end:e,kind,value:typeof value==='string'?value:''});
        formatApplying=true;
        renderChecklist(true);scheduleSave(true);
        requestAnimationFrame(()=>{
          selectFormatRange(b.id,s,e);
          formatRange={id:b.id,start:s,end:e};
          activeFormatId=b.id;
          formatApplying=false;
          placeFormatToolbar();
        });
      }else{
        const pending={...(pendingTextStyle.get(b.id)||{})};
        if(kind==='color'||kind==='background')pending[kind]=value;
        else pending[kind]=!pending[kind];
        pendingTextStyle.set(b.id,pending);
        const field=root.querySelector('.checklist-editor[data-block-id="'+b.id+'"]');
        if(field&&!b.text.length){
          field.style.fontWeight=pending.bold?'800':'';
          field.style.fontStyle=pending.italic?'italic':'';
          field.style.textDecoration=[pending.underline?'underline':'',pending.strike?'line-through':''].filter(Boolean).join(' ');
          field.style.color=markPalette[pending.color]||'';
          field.style.backgroundColor=backgroundPalette[pending.background]||'';
        }
        placeFormatToolbar();
      }
    }
    function clearSelectedFormat(){
      const current=currentEditorSelection();
      const selection=current&&current.end>current.start?current:formatRange;
      const b=blocks.find(x=>x.id===selection?.id);
      if(!b||selection.end<=selection.start)return;
      const {start:s,end:e}=selection;
      pendingUndoFocus={id:b.id,offset:s};
      b.marks=(b.marks||[]).flatMap(m=>{
        if(m.end<=s||m.start>=e)return [m];
        const pieces=[];
        if(m.start<s)pieces.push({...m,end:s});
        if(m.end>e)pieces.push({...m,start:e});
        return pieces;
      });
      formatApplying=true;
      formatToolbar.querySelector('.fmt-dropdown').hidden=true;
      renderChecklist(true);scheduleSave(true);
      requestAnimationFrame(()=>{
        selectFormatRange(b.id,s,e);formatRange={id:b.id,start:s,end:e};
        activeFormatId=b.id;formatApplying=false;placeFormatToolbar();
      });
    }
    function showFormatDropdown(mode){
      const menu=formatToolbar.querySelector('.fmt-dropdown');
      if(!menu.hidden&&menu.dataset.mode===mode){menu.hidden=true;return;}
      menu.dataset.mode=mode;menu.hidden=false;
      if(mode==='block'){
        menu.innerHTML='<div class="fmt-menu-label">TURN INTO</div>'+
          types.map(t=>'<button type="button" data-format-block="'+safe(t.id)+'">'+safe(t.symbol)+'　'+safe(t.title)+'</button>').join('');
      }else{
        const swatches=['default','gray','brown','orange','yellow','green','blue','purple','pink','red'];
        menu.innerHTML='<div class="fmt-menu-label">TEXT COLOR</div><div class="fmt-swatches">'+
          swatches.map(x=>'<button type="button" data-format-color="'+x+'" title="'+x+'" style="color:'+(markPalette[x]||'inherit')+'">'+(x==='default'?'A':'A')+'</button>').join('')+
          '</div><div class="fmt-menu-label">BACKGROUND COLOR</div><div class="fmt-swatches">'+
          swatches.map(x=>'<button type="button" data-format-background="'+x+'" title="'+x+'" style="background:'+(backgroundPalette[x]||'transparent')+'"></button>').join('')+'</div>';
      }
    }
    formatToolbar.addEventListener('pointerdown',event=>{
      formatInteracting=true;
      const selection=currentEditorSelection();
      if(selection&&selection.end>selection.start){
        formatRange=selection;activeFormatId=selection.id;
      }
      event.preventDefault();
    });
    formatToolbar.addEventListener('click',event=>{
      setTimeout(()=>{formatInteracting=false;},0);
      const button=event.target.closest('button');if(!button)return;
      if(button.hasAttribute('data-format-clear')){clearSelectedFormat();return;}
      if(button.dataset.format){applyFormat(button.dataset.format);return;}
      if(button.dataset.formatMenu){showFormatDropdown(button.dataset.formatMenu);return;}
      if(button.dataset.formatColor){applyFormat('color',button.dataset.formatColor);formatToolbar.querySelector('.fmt-dropdown').hidden=true;return;}
      if(button.dataset.formatBackground){applyFormat('background',button.dataset.formatBackground);formatToolbar.querySelector('.fmt-dropdown').hidden=true;return;}
      if(button.dataset.formatBlock){
        const b=blocks.find(x=>x.id===activeFormatId);if(!b)return;
        b.type=normalizedType(button.dataset.formatBlock);b.checked=false;
        b.detailsOpen=['todoNote','todoList'].includes(b.type);
        b.detailsMode=b.type==='todoList'?'tasks':'notes';
        formatToolbar.querySelector('.fmt-dropdown').hidden=true;
        renderChecklist(true);scheduleSave(true);
        requestAnimationFrame(()=>{focusBlockAt(b.id,0);placeFormatToolbar()});
      }
    });
    root.addEventListener('focusin',event=>{
      const field=event.target.closest('.checklist-editor[data-block-id]');
      if(!field)return;
      // Focus alone must not show the toolbar.
      if(!currentEditorSelection()||currentEditorSelection().end===currentEditorSelection().start){
        formatToolbar.hidden=true;
      }
    });
    function hideFormatToolbar({clearSelection=false}={}){
      formatToolbar.hidden=true;
      const dropdown=formatToolbar.querySelector('.fmt-dropdown');
      dropdown.hidden=true;dropdown.dataset.mode='';
      formatRange=null;activeFormatId=null;
      if(clearSelection){
        const selection=window.getSelection();
        if(selection?.rangeCount)selection.removeAllRanges();
      }
    }
    document.addEventListener('selectionchange',()=>{
      if(formatApplying||formatInteracting)return;
      const selection=currentEditorSelection();
      if(selection&&selection.end>selection.start){
        const changed=!formatRange||selection.id!==formatRange.id||
          selection.start!==formatRange.start||selection.end!==formatRange.end;
        if(changed){
          // A new highlight starts at the main toolbar, never inside a
          // previously open color or block-type submenu.
          formatToolbar.querySelector('.fmt-dropdown').hidden=true;
          formatToolbar.querySelector('.fmt-dropdown').dataset.mode='';
        }
        formatRange=selection;activeFormatId=selection.id;
        placeFormatToolbar();
      }else{
        // Hide on a collapsed caret or selection outside the editor.
        // Retain a selected range only while interacting with the toolbar.
        if(!formatToolbar.contains(document.activeElement))hideFormatToolbar();
      }
    });
    document.addEventListener('pointerdown',event=>{
      if(formatToolbar.contains(event.target))return;
      if(!root.contains(event.target)){
        hideFormatToolbar();
      }else if(!event.target.closest('.checklist-editor[data-block-id]')){
        hideFormatToolbar();
      }
    });
    // iOS Safari retains a DOM selection after its Done keyboard button.
    // Blur, a collapsed selection, or tapping outside the active text should
    // always dismiss our additional toolbar.
    root.addEventListener('focusout',event=>{
      if(!event.target.closest('.checklist-editor[data-block-id]'))return;
      setTimeout(()=>{
        if(formatInteracting||formatApplying)return;
        const selection=currentEditorSelection();
        if(!selection||selection.end<=selection.start)hideFormatToolbar();
      },0);
    });
    document.addEventListener('touchstart',event=>{
      if(formatToolbar.hidden||formatToolbar.contains(event.target))return;
      if(!event.target.closest('.checklist-editor[data-block-id]')){
        hideFormatToolbar();
      }
    },{passive:true});
    window.visualViewport?.addEventListener('resize',()=>{
      if(formatToolbar.hidden)return;
      const selection=currentEditorSelection();
      const editor=document.activeElement?.closest?.('.checklist-editor[data-block-id]');
      if(!editor||!selection||selection.end<=selection.start)hideFormatToolbar();
    });
    root.addEventListener('keydown',event=>{
      // Notion-style keyboard shortcut to remove all formatting in selection.
      if((event.ctrlKey||event.metaKey)&&event.altKey&&event.key==='\\'){
        const selection=currentEditorSelection();
        if(selection&&selection.end>selection.start){
          event.preventDefault();formatRange=selection;activeFormatId=selection.id;clearSelectedFormat();
        }
        return;
      }
      if((event.ctrlKey||event.metaKey)&&event.shiftKey&&event.key.toLowerCase()==='h'){
        const selection=currentEditorSelection();
        if(selection&&selection.end>selection.start){
          event.preventDefault();formatRange=selection;activeFormatId=selection.id;
          placeFormatToolbar();showFormatDropdown('colors');
        }
        return;
      }
      if(!(event.ctrlKey||event.metaKey)||event.altKey)return;
      const key=event.key.toLowerCase();
      const kind=!event.shiftKey&&key==='b'?'bold':!event.shiftKey&&key==='i'?'italic':
        !event.shiftKey&&key==='u'?'underline':event.shiftKey&&key==='s'?'strike':null;
      const editor=event.target.closest('.checklist-editor[data-block-id]');
      if(!editor)return;
      if(kind){
        event.preventDefault();
        const selected=currentEditorSelection();
        if(selected&&selected.end>selected.start){formatRange=selected;activeFormatId=selected.id;applyFormat(kind);}
      }
    },true);
    function inlineDateText(b){
      const text=b.text||'';
      if(!b.dueDate)return safe(text);
      const match=findDateMention(text);
      if(!match)return safe(text);
      return safe(text.slice(0,match.start))+
        '<span class="checklist-date-mention" data-date-mention="'+safe(b.id)+'" contenteditable="false" role="button" tabindex="0" aria-label="Edit due date '+safe(dateLabel(b.dueDate))+'">'+safe('@'+relativeDateMention(b.dueDate))+'</span>'+
        safe(text.slice(match.end));
    }
    function closeDateMenu(){
      dateMenu.hidden=true;dateScrim.hidden=true;dateMenu.classList.remove('is-sheet','is-suggestion');
      document.body.classList.remove('checklist-date-sheet-open');
      dateTargetId=null;dateSuggestionId=null;
    }
    function renderDateCalendar(){
      if(!dateViewMonth)return '';
      const first=new Date(dateViewMonth.getFullYear(),dateViewMonth.getMonth(),1);
      const offset=first.getDay();
      const length=new Date(first.getFullYear(),first.getMonth()+1,0).getDate();
      const selected=blocks.find(b=>b.id===dateTargetId)?.dueDate;
      let cells='';
      for(let i=0;i<Math.ceil((offset+length)/7)*7;i++){
        const date=new Date(first.getFullYear(),first.getMonth(),i-offset+1,12);
        const value=key(date),outside=date.getMonth()!==first.getMonth();
        cells+='<button type="button" data-date-day="'+value+'" class="checklist-date-day'+
          (outside?' outside':'')+(value===localDay()?' today':'')+(value===selected?' selected':'')+'">'+date.getDate()+'</button>';
      }
      return '<div class="checklist-date-cal-header"><strong>'+
        first.toLocaleDateString('en-US',{month:'long',year:'numeric'})+
        '</strong><div><button type="button" data-date-shift="-1" aria-label="Previous month">‹</button>'+
        '<button type="button" data-date-shift="1" aria-label="Next month">›</button></div></div>'+
        '<div class="checklist-date-weekdays">'+['S','M','T','W','T','F','S'].map(x=>'<span>'+x+'</span>').join('')+'</div>'+
        '<div class="checklist-date-grid">'+cells+'</div>';
    }
    function renderMobileDateSheet(b){
      const current=b.dueDate||localDay();
      return '<div class="checklist-date-sheet-handle" aria-hidden="true"></div>'+
        '<div class="checklist-date-sheet-top">'+
          '<button type="button" class="checklist-date-help" aria-label="Date help" title="Select a date or clear it">?</button>'+
          '<h2 id="checklistDateSheetHeading">Date</h2>'+
          '<button type="button" class="checklist-date-close" aria-label="Close date picker">×</button>'+
        '</div>'+
        '<div class="checklist-date-sheet-scroll">'+
          '<div class="checklist-date-sheet-card checklist-date-input-card">'+
            '<input id="checklistCustomDate" type="date" value="'+safe(current)+'" aria-label="Due date"/>'+
          '</div>'+
          '<section class="checklist-date-sheet-card checklist-date-calendar-slot" aria-label="Choose date">'+renderDateCalendar()+'</section>'+
          '<div class="checklist-date-sheet-card checklist-date-option-card">'+
            '<label class="checklist-date-option-row">End date <input type="checkbox" data-date-end-toggle '+(b.endDate?'checked':'')+' /></label>'+
            (b.endDate?'<label class="checklist-date-option-row">End on <input type="date" data-date-end-value value="'+safe(b.endDate)+'" min="'+safe(current)+'" /></label>':'')+
            '<button type="button" class="checklist-date-option-row" data-date-format-toggle>Date format <span>'+
              (b.dateFormat==='absolute'?'Absolute':'Relative')+' ›</span></button>'+
            '<label class="checklist-date-option-row">Include time <input type="checkbox" data-date-time-toggle '+(b.includeTime?'checked':'')+' /></label>'+
            (b.includeTime?'<label class="checklist-date-option-row">Time <input type="time" data-date-time-value value="'+safe(b.dueTime||'09:00')+'" /></label>':'')+
            '<div class="checklist-date-option-row checklist-date-remind-disabled" title="Reminders require notification support">Remind <span>Not available on web</span></div>'+
          '</div>'+
          '<div class="checklist-date-sheet-card checklist-date-clear-card">'+
            '<button type="button" data-date-quick="clear">Clear</button>'+
          '</div>'+
        '</div>';
    }
    function openDateMenu(id,anchorEl=null,query=''){
      const b=blocks.find(x=>x.id===id);
      if(!b)return;
      dateTargetId=id;
      if(!dateViewMonth||dateMenu.hidden){
        const selected=b.dueDate?new Date(b.dueDate+'T12:00:00'):new Date();
        dateViewMonth=new Date(selected.getFullYear(),selected.getMonth(),1);
      }
      const suggestion=!!query||dateSuggestionId===id;
      dateMenu.classList.toggle('is-suggestion',suggestion);
      dateMenu.classList.toggle('is-sheet',isMobileDate()&&!suggestion);
      const mobileSheet=isMobileDate()&&!suggestion;
      dateMenu.classList.toggle('calendar-only',!mobileSheet&&!suggestion);
      dateMenu.innerHTML=mobileSheet?renderMobileDateSheet(b):
        '<div class="checklist-date-sheet-handle"></div><div class="checklist-date-menu-title">'+(query?'ADD A DATE':'Date')+
        '<button type="button" class="checklist-date-close" aria-label="Close date picker">×</button></div>'+
        '<div class="checklist-date-quick">'+
        '<button type="button" data-date-quick="today">Today <span>'+dateLabel(localDay())+'</span></button>'+ 
        '<button type="button" data-date-quick="yesterday">Yesterday <span>'+dateLabel(localDay(-1))+'</span></button>'+
        '<button type="button" data-date-quick="tomorrow">Tomorrow <span>'+dateLabel(localDay(1))+'</span></button>'+
        '<button type="button" data-date-quick="week">Next week <span>'+dateLabel(localDay(7))+'</span></button>'+ 
        weekdayNames.map((day,i)=>'<button type="button" data-date-quick="day'+i+'">'+day+' <span>'+dateLabel(nextWeekday(i))+'</span></button>').join('')+
        weekdayNames.map((day,i)=>'<button type="button" data-date-quick="last'+i+'">Last '+day+' <span>'+dateLabel(relativeWeekday(i,-1))+'</span></button>').join('')+
        weekdayNames.map((day,i)=>'<button type="button" data-date-quick="next'+i+'">Next '+day+' <span>'+dateLabel(relativeWeekday(i,1))+'</span></button>').join('')+
        (b.dueDate?'<button type="button" data-date-quick="clear">Clear date</button>':'')+
        '</div><div class="checklist-date-custom">'+renderDateCalendar()+
        '<label for="checklistCustomDate">Or enter a date</label>'+
        '<input id="checklistCustomDate" type="date" value="'+safe(b.dueDate||localDay())+'" aria-label="Custom due date"/></div>';
      dateMenu.hidden=false;
      dateScrim.hidden=!mobileSheet;
      document.body.classList.toggle('checklist-date-sheet-open',mobileSheet);
      if(query){
        const q=query.toLowerCase().replace(/\s/g,'');
        let count=0;
        dateMenu.querySelectorAll('[data-date-quick]').forEach(button=>{
          const keyword=choiceName(button.dataset.dateQuick);
          const match=keyword.startsWith(q)&&button.dataset.dateQuick!=='clear';
          button.hidden=!match;if(match)count++;
        });
        if(!count&&q!=='custom'){closeDateMenu();return;}
      }
      const el=anchorEl||root.querySelector('.checklist-editor[data-block-id="'+id+'"]');
      let rect=el?.getBoundingClientRect();
      const sel=window.getSelection();
      if(el?.classList.contains('checklist-editor')&&sel?.rangeCount&&el.contains(sel.anchorNode)){
        const range=sel.getRangeAt(0).cloneRange();range.collapse(true);
        rect=range.getClientRects()[0]||rect;
      }
      if(isMobileDate()&&!suggestion){
        document.activeElement?.closest?.('.checklist-editor')?.blur();
        dateMenu.style.left='0';dateMenu.style.top='auto';dateMenu.style.maxHeight='';
      }else{
        const width=285,height=suggestion?250:450;
        dateMenu.style.left=Math.max(12,Math.min(rect?.left||12,innerWidth-width-12))+'px';
        dateMenu.style.top=Math.max(12,Math.min((rect?.bottom||80)+7,innerHeight-height-12))+'px';
        dateMenu.style.maxHeight='';
      }
    }
    function suggestDate(field,b){
      const caret=editorCaretOffset(field);
      const before=b.text.slice(0,caret);
      const match=before.match(/(?:^|\s)@([a-z ]*)$/i);
      if(match){
        closeSlash();dateSuggestionId=b.id;openDateMenu(b.id,field,(match[1]||'').trim());
      }else if(dateSuggestionId===b.id)closeDateMenu();
    }
    function applyDueDate(id,date,fromSuggestion=false){
      const b=blocks.find(x=>x.id===id);if(!b)return;
      const existing=findDateMention(b.text);
      const token=date?'@'+relativeDateMention(date):'';
      delete dateMenu.dataset.chosenWeekday;
      if(existing){
        b.text=b.text.slice(0,existing.start)+token+b.text.slice(existing.end);
      }else if(fromSuggestion){
        b.text=b.text.replace(/@[a-z ]*$/i,token);
      }
      b.dueDate=date||'';
      if(!date){b.endDate='';b.includeTime=false;b.dueTime='09:00';}
      if(b.endDate&&b.endDate<b.dueDate)b.endDate=b.dueDate;
      closeDateMenu();renderChecklist(true);scheduleSave(true);
      requestAnimationFrame(()=>focusBlock(b.id));
    }
    // Dismiss the full-height date sheet by pulling down from its handle/header.
    let dateDragStart=null;
    dateMenu.addEventListener('touchstart',event=>{
      if(!dateMenu.classList.contains('is-sheet')||!event.target.closest('.checklist-date-sheet-top,.checklist-date-sheet-handle'))return;
      dateDragStart=event.touches[0]?.clientY??null;
    },{passive:true});
    dateMenu.addEventListener('touchend',event=>{
      if(dateDragStart===null)return;
      const end=event.changedTouches[0]?.clientY??dateDragStart;
      if(end-dateDragStart>90)closeDateMenu();
      dateDragStart=null;
    },{passive:true});
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&!dateMenu.hidden){event.preventDefault();closeDateMenu();}
    });
    dateScrim.addEventListener('click',closeDateMenu);
    dateMenu.addEventListener('pointerdown',e=>{
      if(e.target.closest('[data-date-quick]'))e.preventDefault();
    });
    dateMenu.addEventListener('click',e=>{
      if(e.target.closest('.checklist-date-help'))return;
      if(e.target.closest('[data-date-format-toggle]')){
        const b=blocks.find(x=>x.id===dateTargetId);
        if(b){b.dateFormat=b.dateFormat==='absolute'?'relative':'absolute';
          const scroll=dateMenu.querySelector('.checklist-date-sheet-scroll')?.scrollTop||0;
          dateMenu.innerHTML=renderMobileDateSheet(b);
          const panel=dateMenu.querySelector('.checklist-date-sheet-scroll');if(panel)panel.scrollTop=scroll;
          scheduleSave(true);
        }
        return;
      }
      if(e.target.closest('.checklist-date-close')){closeDateMenu();return;}
      const day=e.target.closest('[data-date-day]');
      if(day&&dateTargetId){
        applyDueDate(dateTargetId,day.dataset.dateDay,!!dateSuggestionId);return;
      }
      const navigation=e.target.closest('[data-date-shift]');
      if(navigation&&dateTargetId){
        dateViewMonth.setMonth(dateViewMonth.getMonth()+Number(navigation.dataset.dateShift));
        const grid=dateMenu.querySelector('.checklist-date-calendar-slot')||dateMenu.querySelector('.checklist-date-custom');
        if(grid)grid.innerHTML=renderDateCalendar()+(grid.classList.contains('checklist-date-custom')?
          '<label for="checklistCustomDate">Or enter a date</label><input id="checklistCustomDate" type="date" value="'+safe(blocks.find(b=>b.id===dateTargetId)?.dueDate||localDay())+'" aria-label="Custom due date"/>':'');
        return;
      }
      const button=e.target.closest('[data-date-quick]');
      if(!button||!dateTargetId)return;
      const value=button.dataset.dateQuick;
      const date=dateFromChoice(value);
      if(value.startsWith('day'))dateMenu.dataset.chosenWeekday=weekdayNames[Number(value.slice(3))];
      applyDueDate(dateTargetId,date,!!dateSuggestionId);
    });
    dateMenu.addEventListener('change',e=>{
      if(e.target.matches('#checklistCustomDate')&&dateTargetId){
        if(e.target.value)applyDueDate(dateTargetId,e.target.value,!!dateSuggestionId);
        return;
      }
      const b=blocks.find(x=>x.id===dateTargetId);
      if(!b)return;
      if(e.target.matches('[data-date-end-toggle]')){
        b.endDate=e.target.checked?(b.endDate||b.dueDate||localDay()):'';
      }else if(e.target.matches('[data-date-end-value]')){
        b.endDate=e.target.value&&e.target.value>=b.dueDate?e.target.value:b.dueDate;
      }else if(e.target.matches('[data-date-time-toggle]')){
        b.includeTime=e.target.checked;
      }else if(e.target.matches('[data-date-time-value]')){
        b.dueTime=e.target.value||'09:00';
      }else return;
      const scroll=dateMenu.querySelector('.checklist-date-sheet-scroll')?.scrollTop||0;
      dateMenu.innerHTML=renderMobileDateSheet(b);
      const panel=dateMenu.querySelector('.checklist-date-sheet-scroll');
      if(panel)panel.scrollTop=scroll;
      scheduleSave(true);
    });
    document.addEventListener('pointerdown',e=>{
      if(!dateMenu.hidden&&!dateMenu.contains(e.target)&&!e.target.closest('[data-date-mention]'))closeDateMenu();
    });
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
      // Replace only the command before the caret, never the original
      // text that followed it (e.g. "/todo the dog").
      const editor=root.querySelector('.checklist-editor[data-block-id="'+id+'"]');
      const position=editor?editorCaretOffset(editor):b.text.length;
      const prefix=b.text.slice(0,position);
      const command=prefix.match(/^\s*\/[a-z0-9-]*$/i);
      const removeTo=command?position:0;
      b.text=(removeTo?b.text.slice(removeTo):b.text).replace(/^\s+/,'');
      b.type=normalizedType(type);
      b.checked=false;
      b.detailsOpen=type==='todoList';
      b.detailsMode='tasks';
      if(type==='todoList'&&!blocks.some(x=>x.parentId===b.id)){
        const index=blocks.indexOf(b);
        blocks.splice(index+1,0,normalizeBlock({id:uniqueId(),parentId:b.id,type:'todo',text:''},index+1));
      }
      closeSlash();renderChecklist(true);scheduleSave(true);
      requestAnimationFrame(()=>focusBlockAt(id,0));
    }
    $('checklistSlashMenu').addEventListener('pointerdown',e=>e.preventDefault());
    $('checklistSlashMenu').addEventListener('click',e=>{
      const item=e.target.closest('[data-command]');if(item)applyCommand(item.dataset.command);
    });
    document.addEventListener('pointerdown',e=>{
      if(slashFor&&!e.target.closest('#checklistSlashMenu')&&!e.target.closest('#checklistBlocks'))closeSlash();
    });
    window.addEventListener('scroll',()=>{if(slashFor)closeSlash();},{passive:true});
    // The six-dot grip is both a drag handle and a click-triggered
    // block menu. A real drag is still owned by Sortable.
    const blockMenu=document.createElement('div');
    blockMenu.className='checklist-block-menu';
    blockMenu.hidden=true;
    document.body.appendChild(blockMenu);
    let blockMenuId=null,blockMenuMode='main',blockMenuSearch='';
    let selectedBlockId=null;
    function paintBlockSelection(){
      root.classList.toggle('has-selected-block',!!selectedBlockId);
      root.classList.toggle('block-menu-is-open',!blockMenu.hidden);
      root.querySelectorAll('.checklist-line').forEach(line=>{
        const selected=line.dataset.id===selectedBlockId;
        line.classList.toggle('block-is-selected',selected);
        line.setAttribute('aria-selected',String(selected));
      });
    }
    function clearBlockSelection(){selectedBlockId=null;paintBlockSelection();}
    const blockColors=['default','gray','brown','orange','yellow','green','blue','purple','pink','red'];
    function closeBlockMenu(){
      blockMenu.hidden=true;blockMenuId=null;blockMenuMode='main';
      root.querySelectorAll('.block-menu-active').forEach(el=>el.classList.remove('block-menu-active'));
      paintBlockSelection();
    }
    function renderBlockMenu(){
      const b=blocks.find(x=>x.id===blockMenuId);
      if(!b){closeBlockMenu();return;}
      const button=(action,text,shortcut='')=>
        '<button type="button" data-block-action="'+action+'"><span>'+text+'</span><small>'+shortcut+'</small></button>';
      blockMenu.classList.toggle('is-colors',blockMenuMode==='colors');
      if(blockMenuMode==='colors'){
        blockMenu.innerHTML='<div class="block-color-menu-header"><button type="button" data-block-action="back" aria-label="Back to actions">‹</button><strong>Block colors</strong></div>'+
          '<div class="block-color-columns">'+
            '<section class="block-color-group"><div class="block-menu-label">TEXT COLOR</div>'+
            blockColors.map(color=>button('text:'+color,'<span class="block-color-swatch text" style="color:'+(markPalette[color]||'inherit')+'">A</span> '+color[0].toUpperCase()+color.slice(1)+' text'+(b.blockColor===color?' <span class="block-color-check">✓</span>':''))).join('')+
            '</section><section class="block-color-group"><div class="block-menu-label">BACKGROUND COLOR</div>'+
            blockColors.map(color=>button('background:'+color,'<span class="block-color-swatch" style="background:'+(backgroundPalette[color]||'transparent')+'"></span> '+color[0].toUpperCase()+color.slice(1)+' background'+(b.blockBackground===color?' <span class="block-color-check">✓</span>':''))).join('')+'</section></div>';
      }else if(blockMenuMode==='turn'){
        blockMenu.innerHTML='<div class="block-menu-subheading"><button type="button" data-block-action="back">‹</button><strong>Turn into</strong></div>'+
          types.map(t=>button('type:'+t.id,safe(t.symbol)+'　'+safe(t.title))).join('');
      }else{
        blockMenu.innerHTML='<input class="block-menu-search" placeholder="Search actions…" aria-label="Search block actions" value="'+safe(blockMenuSearch)+'" />'+
          '<div class="block-menu-label">'+safe(types.find(t=>t.id===b.type)?.title||'Text')+'</div>'+
          button('turn','⇄　Turn into','›')+
          button('colors','▤　Color','›')+
          '<div class="block-menu-separator"></div>'+
          button('duplicate','▢　Duplicate','Ctrl+D')+
          button('move-up','↑　Move up','')+
          button('move-down','↓　Move down','')+
          button('delete','♧　Delete','Del')+
          '<div class="block-menu-label">BLOCK</div>'+
          '<div class="block-menu-info">'+safe(b.text.trim()||'Empty block')+'</div>';
      }
    }
    function placeBlockMenu(handle){
      if(blockMenu.hidden)return;
      const anchor=handle||root.querySelector('.checklist-line[data-id="'+blockMenuId+'"] .checklist-handle');
      const rect=anchor?.getBoundingClientRect()||{left:20,right:40,top:70,bottom:96};
      const width=Math.min(blockMenuMode==='colors'?536:268,innerWidth-24);
      const height=Math.min(blockMenu.scrollHeight,innerHeight-24);
      const x=Math.max(12,Math.min(rect.right+9,innerWidth-width-12));
      const y=Math.max(8,Math.min(rect.top,innerHeight-height-12));
      blockMenu.style.left=x+'px';
      blockMenu.style.top=y+'px';
    }
    function openBlockMenu(id,handle){
      if(blockMenuId===id&&!blockMenu.hidden){closeBlockMenu();return;}
      closeBlockMenu();selectedBlockId=id;blockMenuId=id;blockMenuMode='main';blockMenuSearch='';
      renderBlockMenu();blockMenu.hidden=false;paintBlockSelection();
      handle.closest('.checklist-line')?.classList.add('block-menu-active');
      const rect=handle.getBoundingClientRect();
      placeBlockMenu(handle);
    }
    function descendantIds(id){
      const ids=new Set([id]);
      for(let changed=true;changed;){
        changed=false;
        for(const b of blocks){if(b.parentId&&ids.has(b.parentId)&&!ids.has(b.id)){ids.add(b.id);changed=true;}}
      }
      return ids;
    }
    function deleteChecklistBlock(id){
      const index=blocks.findIndex(b=>b.id===id);
      if(index<0)return;
      const next=blocks[index+1]?.id||blocks[index-1]?.id||null;
      pendingUndoFocus={id:next||id,offset:0};
      const ids=descendantIds(id);
      blocks=blocks.filter(b=>!ids.has(b.id));closeBlockMenu();
      renderChecklist(true);scheduleSave(true);
      if(next)requestAnimationFrame(()=>focusBlockAt(next,0));
    }
    blockMenu.addEventListener('click',event=>{
      const button=event.target.closest('[data-block-action]');if(!button)return;
      const action=button.dataset.blockAction;
      const b=blocks.find(x=>x.id===blockMenuId);
      if(!b)return;
      if(action==='back'){blockMenuMode='main';renderBlockMenu();placeBlockMenu();return;}
      if(action==='colors'||action==='turn'){
        blockMenuMode=action;renderBlockMenu();placeBlockMenu();return;
      }
      if(action==='delete'){deleteChecklistBlock(b.id);return;}
      if(action==='duplicate'){
        const family=descendantIds(b.id);
        const originals=blocks.filter(x=>family.has(x.id));
        const ids=new Map(originals.map(x=>[x.id,uniqueId()]));
        const copies=originals.map((x,i)=>normalizeBlock({
          ...x,id:ids.get(x.id),
          parentId:ids.get(x.parentId)||x.parentId,createdAt:Date.now()
        },i));
        const index=blocks.findIndex(x=>x.id===originals.at(-1).id);
        blocks.splice(index+1,0,...copies);
        closeBlockMenu();renderChecklist(true);scheduleSave(true);
        requestAnimationFrame(()=>focusBlockAt(copies[0].id,copies[0].text.length));
        return;
      }
      if(action.startsWith('type:')){
        pendingUndoFocus={id:b.id,offset:0};
        b.type=normalizedType(action.slice(5));b.checked=false;
        b.detailsOpen=b.type==='todoList';
        b.detailsMode='tasks';
        if(b.type==='todoList'&&!blocks.some(x=>x.parentId===b.id)){
          blocks.splice(blocks.indexOf(b)+1,0,normalizeBlock({
            id:uniqueId(),parentId:b.id,type:'todo',text:''
          },blocks.length));
        }
        if(b.type!=='todoList')blocks.filter(x=>x.parentId===b.id).forEach(x=>x.parentId=b.parentId||'');
      }else if(action.startsWith('text:')||action.startsWith('background:')){
        pendingUndoFocus={id:b.id,offset:0};
        const [which,color]=action.split(':');
        if(!blockColors.includes(color))return;
        if(which==='text')b.blockColor=color;
        else b.blockBackground=color;
      }else if(action==='move-up'||action==='move-down'){
        const index=blocks.findIndex(x=>x.id===b.id);
        const next=index+(action==='move-up'?-1:1);
        if(next<0||next>=blocks.length||blocks[next].parentId!==b.parentId)return;
        [blocks[index],blocks[next]]=[blocks[next],blocks[index]];
        pendingUndoFocus={id:b.id,offset:0};
      }else return;
      closeBlockMenu();renderChecklist(true);scheduleSave(true);
    });
    blockMenu.addEventListener('input',event=>{
      if(!event.target.matches('.block-menu-search'))return;
      const query=event.target.value.trim().toLowerCase();
      blockMenu.querySelectorAll('[data-block-action]').forEach(item=>{
        item.hidden=!item.textContent.toLowerCase().includes(query);
      });
    });
    document.addEventListener('pointerdown',event=>{
      if(event.target.closest('.checklist-handle'))return;
      if(!blockMenu.hidden){
        if(!blockMenu.contains(event.target)){
          // First outside click dismisses the menu but retains blue selection.
          closeBlockMenu();
        }
        return;
      }
      if(selectedBlockId){
        // Second outside click clears the block highlight.
        clearBlockSelection();
      }
    },true);
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&selectedBlockId){
        if(!blockMenu.hidden)closeBlockMenu();
        else clearBlockSelection();
      }
    });
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
        const parent=blocks.find(x=>x.id===b.parentId);
        const isNested=!!parent;
        const hiddenByParent=!!parent&&(parent.type!=='todoList'||!parent.detailsOpen);
        const noteExpanded=isToggle&&!b.collapsed;
        const checkbox=isTask?'<input class="checklist-check" type="checkbox" data-toggle-check="'+safe(b.id)+'" '+(b.checked?'checked':'')+' aria-label="Complete task"/>':'';
        const isOpen=b.type==='todoList'?b.detailsOpen:!b.collapsed;
        const arrow=b.type==='todoList'||isToggle?
          '<button type="button" class="checklist-toggle-icon '+(!isOpen?'collapsed':'')+'" data-collapse="'+safe(b.id)+'" aria-label="'+(!isOpen?'Expand details':'Collapse details')+'" aria-expanded="'+String(isOpen)+'">'+(!isOpen?'▸':'▾')+'</button>':'';
        const icon=isTask?checkbox+arrow:isToggle?arrow:isBullet?'<span class="checklist-bullet">•</span>':'';
        const placeholder=(b.type==='h1'?'Heading':b.type==='h2'?'Subheading':isTask?'To-do':isToggle?'Toggle title':isBullet?'List item':"Type here, or press / for commands");
        let details='';
        if(noteExpanded&&b.note)details='<div class="checklist-note-editor" contenteditable="true" role="textbox" aria-multiline="true" data-note-id="'+safe(b.id)+'" data-placeholder="Type notes…" spellcheck="true">'+safe(b.note)+'</div>';
        return '<div class="checklist-line checklist-type-'+b.type+(isNested?' checklist-child':'')+(hiddenByParent?' checklist-child-hidden':'')+(b.checked?' is-done':'')+(b.collapsed?' is-collapsed':'')+'" data-id="'+safe(b.id)+'" data-parent-id="'+safe(b.parentId||'')+'" style="'+(backgroundPalette[b.blockBackground]?'--checklist-block-bg:'+backgroundPalette[b.blockBackground]+';':'')+(markPalette[b.blockColor]?'--checklist-block-color:'+markPalette[b.blockColor]+';':'')+'">'+
          '<div class="checklist-line-tools"><button type="button" class="checklist-insert" data-insert="'+safe(b.id)+'" aria-label="Insert block">+</button><button type="button" class="checklist-handle" aria-label="Drag to rearrange or click for block actions" title="Drag to move · Click for actions">⠿</button></div>'+
          '<div class="checklist-line-inner">'+icon+
          '<div class="checklist-field-group"><div class="checklist-editor" contenteditable="true" role="textbox" aria-multiline="true" data-block-id="'+safe(b.id)+'" data-placeholder="'+safe(placeholder)+'" spellcheck="true">'+htmlWithMarks(b)+'</div>'+
          (details?'<div class="checklist-details">'+details+'</div>':'')+'</div></div>'+
          (b.dueDate?'<span class="checklist-date-label" aria-label="Due '+safe(dateLabel(b.dueDate))+'"><span class="checklist-date-label-short">'+safe(dateLabel(b.dueDate))+'</span><span class="checklist-date-label-long">'+safe(new Date(b.dueDate+'T12:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric'}))+'</span></span>':'')+
          '</div>';
      }).join('');
      $('checklistEmpty').hidden=true;
      root.querySelectorAll('textarea').forEach(resizeField);
      setupSortable();
      paintBlockSelection();
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
        onMove:event=>{
          const dragged=blocks.find(b=>b.id===event.dragged?.dataset.id);
          const target=blocks.find(b=>b.id===event.related?.dataset.id);
          return !!dragged&&!!target&&dragged.parentId===target.parentId&&
            !blocks.some(x=>x.parentId===dragged.id);
        },
        onEnd:()=>{
          const ids=[...root.querySelectorAll('.checklist-line')].map(x=>x.dataset.id);
          blocks.sort((a,b)=>ids.indexOf(a.id)-ids.indexOf(b.id));
          scheduleSave(true);
        }
      });
    }
    // Native iOS keyboards commonly produce beforeinput(insertParagraph) without
    // a keydown. Both desktop Enter and the virtual Return key must share the
    // exact same block transition, rather than letting WebKit add <div><br>.
    function insertChecklistParagraph(field,overrideOffset=null){
      const id=field?.dataset?.blockId;
      const b=blocks.find(item=>item.id===id);
      if(!b)return false;
      closeSlash();
      closeDateMenu();
      const isTask=['todo','todoNote','todoList'].includes(b.type);
      if((isTask||b.type==='bullet')&&!b.text.trim()){
        pendingUndoFocus={id,offset:0};
        b.type='text';
        b.text='';
        b.checked=false;
        b.collapsed=false;
        b.detailsOpen=false;
        b.detailsMode='notes';
        b.subtasks=[];
        b.note='';
        b.dueDate='';
        for(const child of blocks.filter(x=>x.parentId===b.id))child.parentId=b.parentId||'';
        renderChecklist(true);
        scheduleSave(true);
        requestAnimationFrame(()=>focusBlockAt(id,0));
        return true;
      }
      const offset=Math.max(0,Math.min(overrideOffset??editorCaretOffset(field),b.text.length));
      const before=b.text.slice(0,offset);
      const after=b.text.slice(offset);
      b.text=before;
      const nextType=isTask?'todo':b.type==='bullet'?'bullet':'text';
      const newBlock=addBlock(id,nextType,after,b.type==='todoList'?b.id:null);
      requestAnimationFrame(()=>focusBlockAt(newBlock.id,0));
      return true;
    }
    root.addEventListener('beforeinput',event=>{
      const editor=event.target.closest?.('.checklist-editor[data-block-id]');
      if(editor&&!event.isComposing&&
         (event.inputType==='insertParagraph'||
          (event.inputType==='insertLineBreak'&&window.matchMedia('(pointer:coarse)').matches))){
        // Safari's software keyboard uses this event instead of keydown.
        event.preventDefault();
        if(slashFor===editor.dataset.blockId&&!$('checklistSlashMenu').hidden){
          if(slashMatches[slashSelected])applyCommand(slashMatches[slashSelected].id);
        }else if(dateSuggestionId===editor.dataset.blockId&&!dateMenu.hidden){
          const first=dateMenu.querySelector('[data-date-quick]:not([hidden])');
          const choice=first?.dataset.dateQuick||'today';
          const date=dateFromChoice(choice)||localDay();
          if(choice.startsWith('day'))dateMenu.dataset.chosenWeekday=weekdayNames[Number(choice.slice(3))];
          applyDueDate(editor.dataset.blockId,date,true);
        }else insertChecklistParagraph(editor);
        return;
      }
      const field=event.target.closest?.('.checklist-editor,.checklist-note-editor');
      if(!field||restoringHistory)return;
      if(event.inputType?.startsWith('delete')&&!event.inputType.includes('ByCut')){
        pendingUndoFocus={id:field.dataset.blockId||('note:'+field.dataset.noteId),offset:editorCaretOffset(field)};
      }
    });
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
      // Fallback for iOS WebKit versions that deliver input without a
      // cancellable beforeinput for the software keyboard's Return key.
      if(e.inputType==='insertParagraph'||
          (e.inputType==='insertLineBreak'&&window.matchMedia('(pointer:coarse)').matches)){
        insertChecklistParagraph(field,Math.max(0,editorCaretOffset(field)-1));
        return;
      }
      const nextText=(field.innerText||field.textContent||'').replace(/\n$/,'').slice(0,5000);
      updateMarksForEdit(b,nextText);
      b.text=nextText;
      scheduleSave();
      // Slash commands can precede existing text; inspect only the text
      // BEFORE the caret, and preserve any content after it.
      const prefix=b.text.slice(0,editorCaretOffset(field));
      const match=prefix.match(/^\s*\/([a-z0-9-]*)$/i);
      if(match)openSlash(b.id,match[1].trim());else if(slashFor===b.id)closeSlash();
      suggestDate(field,b);
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
      if(nested&&e.key==='Backspace'&&!e.isComposing&&!e.ctrlKey&&!e.metaKey){
        const b=blocks.find(x=>x.id===nested.dataset.subtaskText);
        const index=b?.subtasks.findIndex(x=>x.id===nested.dataset.subtaskId)??-1;
        const item=index>=0?b.subtasks[index]:null;
        if(item&&!nested.value.length&&nested.selectionStart===0&&nested.selectionEnd===0){
          e.preventDefault();
          b.subtasks.splice(index,1);
          const previous=b.subtasks[index-1]||b.subtasks[index]||null;
          renderChecklist(true);scheduleSave(true);
          requestAnimationFrame(()=>{
            const input=previous?root.querySelector('[data-subtask-id="'+previous.id+'"][data-subtask-text]'):root.querySelector('.checklist-editor[data-block-id="'+b.id+'"]');
            input?.focus();
            if(previous)input?.setSelectionRange(previous.text.length,previous.text.length);
          });
          return;
        }
      }
      if(nested&&e.key==='Enter'&&!e.isComposing){
        e.preventDefault();
        const b=blocks.find(x=>x.id===nested.dataset.subtaskText);
        if(b&&b.subtasks.length<40){
          const prior=b.subtasks.find(t=>t.id===nested.dataset.subtaskId);
          if(!prior)return;
          const ix=b.subtasks.indexOf(prior);
          const offset=nested.selectionStart??prior.text.length;
          // Enter at the beginning inserts an empty subtask ABOVE the current one.
          // In the middle, split text just as a normal document editor does.
          const left=prior.text.slice(0,offset),right=prior.text.slice(offset);
          const sub={id:uniqueId(),text:'',checked:false,type:prior.type==='bullet'?'bullet':'todo'};
          let focusId=sub.id;
          if(offset===0&&prior.text.length){
            b.subtasks.splice(ix,0,sub);
          }else{
            prior.text=left;sub.text=right;
            b.subtasks.splice(ix+1,0,sub);
          }
          renderChecklist(true);scheduleSave(true);
          requestAnimationFrame(()=>{
            const input=root.querySelector('[data-subtask-id="'+focusId+'"][data-subtask-text]');
            input?.focus();input?.setSelectionRange(0,0);
          });
        }return;
      }
      const field=e.target.closest('[contenteditable="true"][data-block-id]');if(!field)return;
      const id=field.dataset.blockId,b=blocks.find(x=>x.id===id);
      if(!b)return;
      if(dateSuggestionId===id&&!dateMenu.hidden){
        if(e.key==='Enter'||e.key==='Tab'){
          e.preventDefault();
          const q=(b.text.slice(0,editorCaretOffset(field)).match(/@([a-z ]*)$/i)?.[1]||'').trim().toLowerCase().replace(/\s/g,'');
          const option=[...dateMenu.querySelectorAll('[data-date-quick]:not([hidden])')].find(x=>{
            const value=x.dataset.dateQuick;
            const name=choiceName(value);
            return name.startsWith(q);
          });
          const value=option?.dataset.dateQuick||'today';
          const date=dateFromChoice(value)||localDay();
          if(value.startsWith('day'))dateMenu.dataset.chosenWeekday=weekdayNames[Number(value.slice(3))];
          applyDueDate(id,date,true);
          return;
        }
        if(e.key==='Escape'){e.preventDefault();closeDateMenu();return;}
      }
      if(slashFor===id&&!$('checklistSlashMenu').hidden){
        // Typing a space after a complete command converts in place, even
        // when an existing sentence follows the slash command.
        if(e.key===' '&&!e.isComposing){
          const prefix=b.text.slice(0,editorCaretOffset(field));
          const token=prefix.match(/^\s*\/([a-z0-9-]+)$/i);
          const selected=token&&types.find(t=>t.id.toLowerCase()===token[1].toLowerCase());
          if(selected){e.preventDefault();applyCommand(selected.id);return;}
        }
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
        e.preventDefault();
        insertChecklistParagraph(field);
        return;
      }
      if(e.key==='Backspace'&&!e.ctrlKey&&!e.metaKey&&!e.isComposing&&editorCaretOffset(field)===0&&window.getSelection()?.isCollapsed&&blocks.length>1){
        e.preventDefault();
        const index=blocks.findIndex(x=>x.id===id);
        pendingUndoFocus={id,offset:0};
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
        let start=editorCaretOffset(note),end=start;
        if(selection?.rangeCount){
          const range=selection.getRangeAt(0);
          if(note.contains(range.startContainer)&&note.contains(range.endContainer)){
            const pos=(node,offset)=>{
              const part=document.createRange();part.selectNodeContents(note);part.setEnd(node,offset);
              return part.toString().length;
            };
            start=pos(range.startContainer,range.startOffset);
            end=pos(range.endContainer,range.endOffset);
          }
        }
        pendingUndoFocus={id:'note:'+block.id,offset:start};
        block.note=block.note.slice(0,start)+formatted+block.note.slice(end);
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

      const input=e.target.closest('[data-toggle-check]');if(!input)return;
      const b=blocks.find(x=>x.id===input.dataset.toggleCheck);if(!b)return;
      b.checked=input.checked;input.closest('.checklist-line').classList.toggle('is-done',b.checked);scheduleSave(true);
    });
    // On iOS a tap on the contextual + blurs the editor and hides its own
    // button before click fires. Insert on pointerdown for touch/pen instead.
    // Desktop mouse keeps the normal click path.
    let touchInsertTime=0;
    root.addEventListener('pointerdown',event=>{
      const insert=event.target.closest?.('[data-insert]');
      if(!insert||event.pointerType==='mouse')return;
      event.preventDefault();
      event.stopPropagation();
      const before=blocks.find(b=>b.id===insert.dataset.insert);
      if(!before)return;
      touchInsertTime=Date.now();
      addBlock(before.id,'text','');
    },true);
    // Date mentions are atomic inline controls; tapping never starts text editing.
    root.addEventListener('pointerdown',event=>{
      const token=event.target.closest?.('[data-date-mention]');
      if(!token)return;
      event.preventDefault();event.stopPropagation();
      openDateMenu(token.dataset.dateMention,token);
    },true);
    root.addEventListener('keydown',event=>{
      const token=event.target.closest?.('[data-date-mention]');
      if(token&&(event.key==='Enter'||event.key===' ')){
        event.preventDefault();openDateMenu(token.dataset.dateMention,token);
      }
    },true);
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
      const dateBadge=target.closest('[data-date-badge]');
      const handle=target.closest('.checklist-handle');
      if(handle){
        const line=handle.closest('.checklist-line');
        if(line)openBlockMenu(line.dataset.id,handle);
        return;
      }
      if(target.closest('[data-date-mention]')){
        // Pointer and keyboard capture already opened the picker; don't reopen on click.
        return;
      }else if(dateBadge){
        openDateMenu(dateBadge.dataset.dateBadge,dateBadge);
      }else if(target.closest('.checklist-editor[data-block-id]')){
        // Clicks adjacent to an @date must edit text normally. Only tapping
        // the actual [data-date-mention] control opens the date picker.
        return;
      }else if(insert){
        // Avoid a second insertion from Safari's synthetic click after touch.
        if(Date.now()-touchInsertTime<650)return;
        const before=blocks.find(b=>b.id===insert.dataset.insert);
        if(before)addBlock(before.id,'text','');
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
        deleteChecklistBlock(deletion.dataset.delete);
      }else if(collapse){
        const block=blocks.find(x=>x.id===collapse.dataset.collapse);
        if(block){
          if(block.type==='todoList'){
            block.detailsOpen=!block.detailsOpen;
            if(block.detailsOpen&&!blocks.some(x=>x.parentId===block.id)){
              const pos=blocks.indexOf(block);
              blocks.splice(pos+1,0,normalizeBlock({
                id:uniqueId(),parentId:block.id,type:'text',text:''
              },pos+1));
            }
          }else block.collapsed=!block.collapsed;
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
      if(!blocks.length)return;
      documentRange={anchor:{id:blocks[0].id,offset:0},focus:{id:blocks.at(-1).id,offset:blocks.at(-1).text.length}};
      allBlocksSelected=true;
      drawDocumentSelection();
    }
    document.addEventListener('keydown',event=>{
      if(!user||tab!=='checklist'||!root.isConnected)return;
      const inside=root.contains(document.activeElement)||root.contains(event.target);
      // Block menu deletion leaves focus on the menu: Undo must still work
      // when the checklist itself does not currently own keyboard focus.
      const undoKey=(event.ctrlKey||event.metaKey)&&!event.altKey&&
        ['z','y'].includes(event.key.toLowerCase());
      if(!inside&&!allBlocksSelected&&!undoKey)return;
      const mod=event.ctrlKey||event.metaKey;
      const key=event.key.toLowerCase();
      if(mod&&!event.altKey&&key==='a'){
        const note=event.target.closest?.('.checklist-note-editor');
        if(note){
          event.preventDefault();
          clearDocumentSelection();
          const range=document.createRange();
          range.selectNodeContents(note);
          const selection=window.getSelection();
          selection.removeAllRanges();selection.addRange(range);
          return;
        }
        event.preventDefault();selectWholeChecklist();return;
      }
      if(mod&&!event.altKey&&(key==='z'||key==='y')){
        event.preventDefault();
        restoreHistory(key==='y'||(key==='z'&&event.shiftKey)?'redo':'undo');
        return;
      }
      if(documentRange&&mod&&key==='c'){
        event.preventDefault();
        const value=allBlocksSelected?checklistText():selectedDocumentText();
        navigator.clipboard?.writeText(value).catch(()=>{});
        return;
      }
      // Native note selection always wins over the whole-document selection.
      if(event.target.closest?.('.checklist-note-editor')&&documentRange)clearDocumentSelection();
      if(documentRange&&!mod&&!event.altKey&&(key==='backspace'||key==='delete'||key.length===1)){
        event.preventDefault();
        if(allBlocksSelected){
          const id=blocks[0]?.id||uniqueId();
          pendingUndoFocus={id,offset:0};
          blocks=[normalizeBlock({id,type:'text',text:key.length===1?event.key:''},0)];
          clearDocumentSelection();renderChecklist(true);scheduleSave(true);
          requestAnimationFrame(()=>focusBlockAt(id,blocks[0].text.length));
        }else removeDocumentSelection(key.length===1?event.key:'');
        return;
      }
      if(!allBlocksSelected&&(key==='backspace'||key==='delete')&&!mod){
        const sel=window.getSelection();
        const fieldFor=node=>(node?.nodeType===1?node:node?.parentElement)?.closest?.('.checklist-editor');
        const first=fieldFor(sel?.anchorNode),last=fieldFor(sel?.focusNode);
        if(sel&&!sel.isCollapsed&&first&&last&&first!==last){
          event.preventDefault();
          root.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'deleteContentBackward'}));
          return;
        }
      }
      if(allBlocksSelected&&(key==='backspace'||key==='delete'||(!mod&&!event.altKey&&key.length===1))){
        event.preventDefault();
        blocks=[normalizeBlock({id:uniqueId(),type:'text',text:key.length===1?event.key:''},0)];
        clearDocumentSelection();
        renderChecklist(true);scheduleSave(true);
        requestAnimationFrame(()=>focusBlock(blocks[0].id,true));
        return;
      }
    },true);
    root.addEventListener('pointerdown',event=>{
      if(allBlocksSelected&&!event.target.closest('#checklistSlashMenu'))clearDocumentSelection();
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
    // Persistent cross-block text selection. Multiple independent contenteditable
    // hosts cannot reliably keep a native browser Selection on mouse release.
    // Draw the selected text rectangles without changing the saved document.
    let documentRange=null,dragStart=null,suppressSelectionClick=false;
    const selectionLayer=document.createElement('div');
    selectionLayer.className='checklist-selection-layer';
    document.body.appendChild(selectionLayer);
    function caretFromPoint(x,y){
      const native=document.caretRangeFromPoint?.(x,y);
      if(native)return {node:native.startContainer,offset:native.startOffset};
      const pos=document.caretPositionFromPoint?.(x,y);
      return pos?{node:pos.offsetNode,offset:pos.offset}:null;
    }
    function textOffset(field,node,offset){
      try{
        const range=document.createRange();
        range.selectNodeContents(field);range.setEnd(node,offset);
        return range.toString().length;
      }catch(error){return 0;}
    }
    function boundaryAt(field,offset){
      const walker=document.createTreeWalker(field,NodeFilter.SHOW_TEXT);
      let node,left=Math.max(0,offset);
      while((node=walker.nextNode())){
        if(left<=node.textContent.length)return {node,offset:left};
        left-=node.textContent.length;
      }
      return {node:field,offset:field.childNodes.length};
    }
    function orderedRange(){
      if(!documentRange)return null;
      const a=blocks.findIndex(b=>b.id===documentRange.anchor.id);
      const b=blocks.findIndex(b=>b.id===documentRange.focus.id);
      if(a<0||b<0)return null;
      return a<b||(a===b&&documentRange.anchor.offset<=documentRange.focus.offset)?
        {start:a,end:b,startOffset:documentRange.anchor.offset,endOffset:documentRange.focus.offset}:
        {start:b,end:a,startOffset:documentRange.focus.offset,endOffset:documentRange.anchor.offset};
    }
    function drawDocumentSelection(){
      selectionLayer.replaceChildren();
      const range=orderedRange();
      if(!range)return;
      for(let i=range.start;i<=range.end;i++){
        const field=root.querySelector('.checklist-editor[data-block-id="'+blocks[i].id+'"]');
        if(!field)continue;
        const len=(field.textContent||'').length;
        const start=i===range.start?Math.min(len,range.startOffset):0;
        const end=i===range.end?Math.min(len,range.endOffset):len;
        if(end<=start)continue;
        const selection=document.createRange();
        const first=boundaryAt(field,start),last=boundaryAt(field,end);
        try{selection.setStart(first.node,first.offset);selection.setEnd(last.node,last.offset);}
        catch(error){continue;}
        for(const rect of selection.getClientRects()){
          if(!rect.width||!rect.height)continue;
          const mark=document.createElement('div');
          mark.className='checklist-selection-rect';
          Object.assign(mark.style,{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px'});
          selectionLayer.appendChild(mark);
        }
        // Nested notes and subtasks belong to the document selection too.
        if(allBlocksSelected||(i>range.start&&i<range.end)){
          const line=root.querySelector('.checklist-line[data-id="'+blocks[i].id+'"]');
          for(const nested of line?.querySelectorAll('.checklist-note-editor,[data-subtask-text]')||[]){
            const nestedRange=document.createRange();
            nestedRange.selectNodeContents(nested);
            for(const box of nestedRange.getClientRects()){
              if(!box.width||!box.height)continue;
              const mark=document.createElement('div');
              mark.className='checklist-selection-rect';
              Object.assign(mark.style,{left:box.left+'px',top:box.top+'px',width:box.width+'px',height:box.height+'px'});
              selectionLayer.appendChild(mark);
            }
          }
        }
      }
    }
    function clearDocumentSelection(){
      documentRange=null;allBlocksSelected=false;
      selectionLayer.replaceChildren();
    }
    function selectedDocumentText(){
      const range=orderedRange();
      if(!range)return '';
      return blocks.slice(range.start,range.end+1).map((b,i)=>{
        const start=i===0?range.startOffset:0;
        const end=range.start+i===range.end?range.endOffset:b.text.length;
        return b.text.slice(start,end);
      }).join('\n');
    }
    function removeDocumentSelection(replacement=''){
      const range=orderedRange();
      if(!range)return false;
      const first=blocks[range.start],last=blocks[range.end];
      const position=range.startOffset;
      pendingUndoFocus={id:first.id,offset:position};
      first.text=first.text.slice(0,range.startOffset)+replacement+last.text.slice(range.endOffset);
      if(range.end>range.start)blocks.splice(range.start+1,range.end-range.start);
      clearDocumentSelection();
      renderChecklist(true);scheduleSave(true);
      requestAnimationFrame(()=>focusBlockAt(first.id,position+replacement.length));
      return true;
    }
    root.addEventListener('pointerdown',event=>{
      if(documentRange)clearDocumentSelection();
      if(event.pointerType!=='mouse'||event.button!==0)return;
      const field=event.target.closest('.checklist-editor');
      if(!field)return;
      const caret=caretFromPoint(event.clientX,event.clientY);
      if(!caret||!field.contains(caret.node))return;
      dragStart={id:field.dataset.blockId,offset:textOffset(field,caret.node,caret.offset),crossed:false};
    });
    document.addEventListener('pointermove',event=>{
      if(!dragStart||event.pointerType!=='mouse'||!(event.buttons&1))return;
      const target=document.elementFromPoint(event.clientX,event.clientY)?.closest?.('.checklist-editor');
      if(!target||!root.contains(target))return;
      const caret=caretFromPoint(event.clientX,event.clientY);
      const offset=caret&&target.contains(caret.node)?textOffset(target,caret.node,caret.offset):
        event.clientY<target.getBoundingClientRect().top?0:(target.textContent||'').length;
      if(target.dataset.blockId===dragStart.id&&!dragStart.crossed)return;
      dragStart.crossed=true;
      documentRange={anchor:{id:dragStart.id,offset:dragStart.offset},focus:{id:target.dataset.blockId,offset}};
      drawDocumentSelection();
      event.preventDefault();
    },{passive:false,capture:true});
    document.addEventListener('pointerup',event=>{
      if(dragStart?.crossed){
        event.preventDefault();
        suppressSelectionClick=true;
        // A native selection may be collapsed by the browser, but our highlight persists.
        window.getSelection()?.removeAllRanges();
      }
      dragStart=null;
    },{capture:true});
    document.addEventListener('click',event=>{
      if(!suppressSelectionClick)return;
      suppressSelectionClick=false;
      event.preventDefault();event.stopImmediatePropagation();
    },true);
    window.addEventListener('scroll',()=>{if(documentRange)drawDocumentSelection();},{passive:true});
    window.addEventListener('resize',()=>{if(documentRange)drawDocumentSelection();});
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