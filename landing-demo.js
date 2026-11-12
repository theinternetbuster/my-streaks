/* The landing showcase is a scripted, read-only product film.
   No Firebase access, account data, or actual check-in actions occur here. */
(() => {
  const root=document.getElementById('loginPanel');
  const screen=document.getElementById('demoScreen');
  const label=document.getElementById('demoSceneLabel');
  const indexText=document.getElementById('demoSceneIndex');
  const progress=document.getElementById('demoTimeline');
  const toggle=document.getElementById('demoMotionToggle');
  if(!root||!screen||!label||!indexText||!progress||!toggle)return;

  const reduce=window.matchMedia('(prefers-reduced-motion: reduce)');
  const steps=[
    {name:'Your streaks, all in one place',duration:3050},
    {name:'A satisfying hold to check in',duration:2900},
    {name:'Every day tells a story',duration:3100},
    {name:'A closer look at your calendar',duration:3300},
    {name:'Make it your own',duration:2900}
  ];
  const habits=[
    {name:'German',count:28,done:true},
    {name:'Bible Reading',count:16},
    {name:'Gym',count:11},
    {name:'Morning Walk',count:8},
    {name:'Reading',count:35,done:true},
    {name:'Practice Guitar',count:6}
  ];
  const flame=(outline=false)=>'<svg viewBox="0 0 24 24" class="demo-flame'+(outline?' demo-blue':'')+'" aria-hidden="true"><use href="#flame-'+(outline?'outline':'solid')+'"></use></svg>';
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const month=new Date();
  month.setDate(1);
  const monthName=month.toLocaleDateString('en-US',{month:'long',year:'numeric'});
  const dayCount=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
  const offset=(month.getDay()+6)%7;
  const dayNow=new Date().getDate();
  // Demonstration only: reproducible fake sample completion/freeze history.
  function state(day,seed){
    if(day>dayNow)return '';
    if(day===dayNow&&seed===3)return '';
    if((day+seed*3)%11===0 || (day+seed*5)%13===0)return 'freeze';
    if((day+seed)%6===0 || (day+seed*2)%9===0)return '';
    return 'done';
  }
  function calendar(seed,mode='mini'){
    let out='<div class="demo-weekdays" aria-hidden="true">'+['M','T','W','T','F','S','S'].map(d=>'<span>'+d+'</span>').join('')+'</div><div class="demo-days">';
    for(let i=0;i<offset;i++)out+='<span class="demo-date demo-outside"></span>';
    for(let d=1;d<=dayCount;d++){
      const status=state(d,seed);
      out+='<span class="demo-date '+status+' '+(d===dayNow?'demo-today':'')+'"><small>'+d+'</small>'+(status==='done'?flame():status==='freeze'?flame(true):'')+'</span>';
    }
    return out+'</div>';
  }
  function demoTop(){
    return '<div class="demo-ui-top"><div class="demo-ui-brand"><span class="demo-ui-logo">'+flame()+'</span><span>My Streaks</span></div><span class="demo-ui-account"><span class="demo-avatar">A</span> Hi, Alex</span></div>';
  }
  function titleBar(calendarMode=false){
    return '<div class="demo-ui-heading"><div><span class="demo-eyebrow">YOUR HABITS</span><h3>Keep the <em>fire</em> going<span>.</span></h3><p>One day at a time. You’ve got this.</p></div><div class="demo-switches"><span class="demo-mode-switch '+(calendarMode?'is-selected':'')+'">▦</span><span class="demo-plus">+</span></div></div>';
  }
  function cards(checkin=false){
    return '<div class="demo-card-grid">'+habits.slice(0,4).map((h,i)=>{
      const target=i===1&&checkin,completed=target||h.done;
      return '<div class="demo-habit-card '+(completed?'demo-completed':'')+' '+(target?'demo-checkin-card':'')+'"><b>'+esc(h.name)+'</b><span class="demo-card-bottom"><span class="demo-card-count">'+flame()+' <strong class="'+(target?'demo-count-change':'')+'">'+(h.count+(target?1:0))+'</strong></span><span class="demo-arrow">↗</span></span>'+(target?'<span class="demo-hold-fill"></span><span class="demo-demo-cursor"></span>':'')+'</div>';
    }).join('')+'</div>';
  }
  function miniCards(){
    return '<div class="demo-mini-grid">'+habits.slice(0,3).map((h,i)=>'<div class="demo-mini-card"><div class="demo-mini-title"><b>'+esc(h.name)+'</b><span>'+flame()+' '+h.count+'</span></div><small>'+esc(monthName)+'</small>'+calendar(i+1)+'</div>').join('')+'</div>';
  }
  function expandedCalendar(){
    return '<div class="demo-edit-stage">'+
      '<div class="demo-dim-ui">'+titleBar(true)+miniCards()+'</div>'+
      '<div class="demo-calendar-dialog"><div class="demo-dialog-top"><div><small>ACTIVITY CALENDAR</small><h3>German</h3></div><span class="demo-dialog-x">×</span></div>'+
      '<div class="demo-dialog-month"><span>‹</span><b>'+monthName+'</b><span>›</span></div>'+
      calendar(1,'large')+
      '<div class="demo-legend"><span>'+flame()+' Completed</span><span>'+flame(true)+' Streak freeze</span></div>'+
      '<p>Tap a day to mark it complete or incomplete.</p></div></div>';
  }
  function settings(){
    return '<div class="demo-settings-layout"><nav><h3>Profile and Settings</h3><span>Settings</span><span class="active">Appearance</span><span>Rearrange habits</span></nav><div class="demo-settings-panel"><h3>Appearance</h3><p>Make My Streaks feel like yours.</p><div class="demo-theme-selector"><span>Light</span><span>Device</span><span class="demo-theme-on">Dark</span></div><div class="demo-settings-preview"><div class="demo-settings-preview-flame">'+flame()+'</div><b>Your habits. Your style.</b><small>Beautifully simple on every screen.</small></div></div></div>';
  }
  function render(index){
    switch(index){
      case 0:return demoTop()+titleBar()+cards();
      case 1:return demoTop()+titleBar()+cards(true);
      case 2:return demoTop()+titleBar(true)+miniCards();
      case 3:return demoTop()+expandedCalendar();
      default:return demoTop()+settings();
    }
  }
  let current=0,timer=null,runId=0,manualPause=false,onscreen=true,shown=false;
  function shouldRun(){return !root.hidden&&!manualPause&&!reduce.matches&&onscreen&&!document.hidden;}
  function stop(){clearTimeout(timer);timer=null;runId++;progress.style.animation='none';}
  function show(index,animate=true){
    current=index;
    screen.classList.remove('demo-scene-visible');
    screen.innerHTML=render(index);
    label.textContent=steps[index].name;
    indexText.textContent=String(index+1).padStart(2,'0')+' / 05';
    screen.dataset.scene=String(index);
    // Force the transition into the new scene.
    void screen.offsetWidth;
    if(animate)screen.classList.add('demo-scene-visible');
    else screen.classList.add('demo-scene-visible');
    progress.style.animation='none';
    if(shouldRun()){
      void progress.offsetWidth;
      progress.style.animation='demo-timeline '+steps[index].duration+'ms linear forwards';
    }
  }
  function tick(){
    if(!shouldRun())return;
    show((current+1)%steps.length);
    const token=++runId;
    timer=setTimeout(()=>{if(token===runId)tick();},steps[current].duration);
  }
  function reconcile(){
    const running=shouldRun();
    toggle.setAttribute('aria-label',running?'Pause demonstration':'Play demonstration');
    toggle.textContent=running?'Ⅱ':'▶';
    if(!shown){shown=true;show(0,false);}
    stop();
    if(running){
      show(current,false);
      const token=++runId;
      timer=setTimeout(()=>{if(token===runId)tick();},steps[current].duration);
    }
  }
  toggle.addEventListener('click',()=>{manualPause=!manualPause;reconcile();});
  reduce.addEventListener?.('change',reconcile);
  document.addEventListener('visibilitychange',reconcile);
  const io='IntersectionObserver' in window ? new IntersectionObserver(entries=>{
    onscreen=entries.some(e=>e.isIntersecting);reconcile();
  },{threshold:.05}):null;
  if(io)io.observe(root);
  new MutationObserver(reconcile).observe(root,{attributes:true,attributeFilter:['hidden']});
  reconcile();
})();
