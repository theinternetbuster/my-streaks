/* The landing showcase is a scripted, read-only product film.
   No Firebase access, account data, or actual check-in actions occur here. */
(() => {
  const root=document.getElementById('loginPanel');
  const rail=document.getElementById('demoRail');
  const stage=document.getElementById('demoStage');
  const film=root?.querySelector('.landing-film');
  const label=document.getElementById('demoSceneLabel');
  const indexText=document.getElementById('demoSceneIndex');
  const nav=document.getElementById('demoTimelineNav');
  const toggle=document.getElementById('demoMotionToggle');
  if(!root||!rail||!stage||!film||!label||!indexText||!nav||!toggle)return;

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
  // Pre-render all five exact UI scenes, then move the slides like Apple's
  // highlights filmstrip. Inactive slides stay visible in the side gutters.
  const buttons=[...nav.querySelectorAll('.demo-timeline-dot')];
  rail.innerHTML=steps.map((step,i)=>
    '<article class="demo-carousel-card" data-slide="'+i+'" aria-hidden="true">'+
    '<div class="demo-screen">'+render(i)+'</div></article>'
  ).join('');
  const slides=[...rail.querySelectorAll('.demo-carousel-card')];
  buttons.forEach(button=>{
    button.innerHTML='<span class="demo-dot-fill"></span>';
    button.addEventListener('click',()=>{
      const index=Number(button.dataset.slide);
      if(!Number.isInteger(index)||index<0||index>=steps.length)return;
      current=index;elapsed=0;ended=false;pausedByUser=false;
      updateSlides();
      syncPlayback();
    });
  });

  let current=0,elapsed=0,timer=null,startTime=0,playing=false,
      ended=false,pausedByUser=false,onscreen=true,forcedPlay=false;
  const now=()=>performance.now();
  const canPlay=()=>!ended&&!pausedByUser&&(!reduce.matches||forcedPlay)&&
    !root.hidden&&!document.hidden&&onscreen;
  function stopClock(){
    if(playing)elapsed+=Math.max(0,now()-startTime);
    playing=false;
    if(timer!==null){clearTimeout(timer);timer=null;}
  }
  function updateSlides(){
    const len=slides.length;
    slides.forEach((slide,i)=>{
      const delta=i-current;
      const slot=delta===0?'active':delta===-1?'prev':
        delta===1?'next':delta<0?'far-prev':'far-next';
      slide.dataset.slot=slot;
      slide.classList.toggle('is-active',delta===0);
      slide.setAttribute('aria-hidden',String(delta!==0));
      slide.inert=delta!==0;
    });
    buttons.forEach((button,i)=>{
      button.classList.toggle('is-active',i===current);
      button.classList.toggle('is-complete',i<current);
      if(i===current)button.setAttribute('aria-current','step');
      else button.removeAttribute('aria-current');
      button.style.setProperty('--scene-length',steps[i].duration+'ms');
    });
    label.textContent=steps[current].name;
    indexText.textContent=String(current+1).padStart(2,'0')+' / 05';
    film.dataset.activeSlide=String(current);
  }
  function syncPlayback(){
    stopClock();
    if(elapsed>=steps[current].duration&&!ended){
      elapsed=0;
      if(current===steps.length-1){ended=true;}
      else{current++;updateSlides();}
    }
    playing=canPlay();
    film.classList.toggle('demo-is-paused',!playing);
    film.classList.toggle('demo-is-finished',ended);
    toggle.textContent=ended?'↻':playing?'Ⅱ':'▶';
    toggle.setAttribute('aria-label',ended?'Replay demonstration':playing?'Pause demonstration':'Play demonstration');
    toggle.title=ended?'Replay':playing?'Pause':'Play';
    if(playing){
      startTime=now();
      timer=setTimeout(advance,Math.max(20,steps[current].duration-elapsed));
    }
  }
  function advance(){
    stopClock();
    if(current===steps.length-1){
      ended=true;elapsed=steps[current].duration;
    }else{
      current++;elapsed=0;updateSlides();
    }
    syncPlayback();
  }
  toggle.addEventListener('click',()=>{
    if(ended){
      current=0;elapsed=0;ended=false;pausedByUser=false;
      if(reduce.matches)forcedPlay=true;
      updateSlides();
    }else{
      pausedByUser=!pausedByUser;
      if(!pausedByUser&&reduce.matches)forcedPlay=true;
    }
    syncPlayback();
  });
  reduce.addEventListener?.('change',syncPlayback);
  document.addEventListener('visibilitychange',syncPlayback);
  if('IntersectionObserver' in window){
    const observer=new IntersectionObserver(entries=>{
      const visible=entries.some(entry=>entry.isIntersecting);
      if(visible!==onscreen){onscreen=visible;syncPlayback();}
    },{threshold:.05});
    observer.observe(stage);
  }
  new MutationObserver(syncPlayback).observe(root,{attributes:true,attributeFilter:['hidden']});
  updateSlides();
  syncPlayback();

})();


/* Scroll-driven feature story: sample illustrations only, no authenticated data. */
(() => {
  const story=document.getElementById('features');
  const login=document.getElementById('loginPanel');
  if(!story||!login)return;
  const grid=document.getElementById('storyCalendarGrid');
  const flame=type=>'<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#flame-'+type+'"></use></svg>';
  if(grid){
    let cells='';
    // November 2026 begins on Sunday; use a fixed month for a coherent preview.
    for(let i=0;i<6;i++)cells+='<span class="story-calendar-cell outside" aria-hidden="true"></span>';
    for(let day=1;day<=30;day++){
      const frozen=[5,13,21].includes(day);
      const done=[2,3,4,6,7,9,10,11,12,14,16,17,18,19,20,22,23,24,25,26,27,29].includes(day);
      const type=frozen?'frozen':done?'done':'blank';
      cells+='<span class="story-calendar-cell '+type+'" aria-hidden="true"><small>'+day+'</small>'+(frozen?flame('outline'):done?flame('solid'):'')+'</span>';
    }
    grid.innerHTML=cells;
  }
  story.classList.add('js-story-ready');
  const reveals=[...story.querySelectorAll('.story-reveal')];
  const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
  let observer=null;
  function revealAll(){
    reveals.forEach(el=>el.classList.add('is-visible'));
  }
  if(motion.matches||!('IntersectionObserver' in window))revealAll();
  else {
    observer=new IntersectionObserver(entries=>{
      for(const entry of entries){
        if(entry.isIntersecting){
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      }
    },{threshold:0.12,rootMargin:'0px 0px -4% 0px'});
    reveals.forEach(el=>observer.observe(el));
  }
  // Subtle scroll-based depth, throttled to one animation frame. No scroll hijacking.
  const visuals=[...story.querySelectorAll('.story-feature-visual')];
  let frame=0;
  function updateParallax(){
    frame=0;
    if(motion.matches||login.hidden)return;
    const viewHeight=window.innerHeight||720;
    for(const element of visuals){
      const rect=element.getBoundingClientRect();
      if(rect.bottom<0||rect.top>viewHeight)continue;
      const normalized=(rect.top+rect.height*.5-viewHeight*.5)/viewHeight;
      const shift=Math.max(-64,Math.min(64,-normalized*96));
      const scale=Math.max(.91,Math.min(1.035,1.035-Math.abs(normalized)*.22));
      element.style.setProperty('--story-shift',shift.toFixed(1)+'px');
      element.style.setProperty('--story-scale',scale.toFixed(3));
    }
  }
  function onScroll(){
    if(!frame)frame=requestAnimationFrame(updateParallax);
  }
  window.addEventListener('scroll',onScroll,{passive:true});
  window.addEventListener('resize',onScroll,{passive:true});
  motion.addEventListener?.('change',()=>{
    if(motion.matches){
      revealAll();
      visuals.forEach(el=>{el.style.removeProperty('--story-shift');el.style.removeProperty('--story-scale');});
      observer?.disconnect();
    }
    else onScroll();
  });
  onScroll();
})();
