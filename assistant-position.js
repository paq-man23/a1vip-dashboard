/* Movable companion and compact speech bubble; layout data stays on this device. */
(function(root){
 const clamp=(v,min,max)=>Math.min(Math.max(v,min),Math.max(min,max));
 const fit=(x,y,w,h,vw,vh)=>({x:clamp(x,8,vw-w-8),y:clamp(y,8,vh-h-8)});
 const dimensions=(w,h,vw,vh)=>({width:clamp(Number(w)||300,Math.min(250,vw-16),Math.min(560,vw-16)),height:clamp(Number(h)||220,Math.min(160,vh-24),Math.min(600,vh-24))});
 if(typeof module!=='undefined'&&module.exports){module.exports={fit,dimensions};return;}
 root.A1AssistantPosition={init(launcher,panel){
  let position=null,size={width:300,height:220},preferred={width:300,height:220},drag=null,resizing=null,suppress=false,latest=null,measure=0;
  const log=panel.querySelector('.copilot-log'),form=panel.querySelector('.copilot-form');
  const cue=document.createElement('button');cue.type='button';cue.className='al-scroll-cue';cue.textContent='More below ↓';cue.hidden=true;cue.setAttribute('aria-label','Scroll down to read the rest of Al’s reply');panel.append(cue);
  function updateCue(){if(!log)return;cue.hidden=panel.hidden||log.scrollHeight-log.clientHeight-log.scrollTop<10;cue.style.bottom=((form?.offsetHeight||48)+4)+'px';}
  log?.addEventListener('scroll',updateCue);cue.addEventListener('click',()=>log?.scrollBy({top:Math.max(80,log.clientHeight*.7),behavior:'smooth'}));
  const key=()=>{const email=root.A1Data?.account()?.email;return email?'a1-al-companion:'+email.toLowerCase():null;};
  function persist(){try{if(key())localStorage.setItem(key(),JSON.stringify({position,size:preferred}));}catch{}}
  function apply(){
   document.body.classList.remove('al-chat-open');size=dimensions(size.width,size.height,innerWidth,innerHeight);
   const r=launcher.getBoundingClientRect(),w=r.width||72,h=r.height||80;
   const p=position?fit(position.x*(innerWidth-w),position.y*(innerHeight-h),w,h,innerWidth,innerHeight):fit(innerWidth-w-18,innerHeight-h-18,w,h,innerWidth,innerHeight);
   Object.assign(launcher.style,{left:p.x+'px',top:p.y+'px',right:'auto',bottom:'auto'});
   if(panel.hidden)return;
   const above=p.y-size.height-12,below=p.y+h+12;
   const q=fit(p.x+w-size.width,above>=8?above:below,size.width,size.height,innerWidth,innerHeight);
   Object.assign(panel.style,{left:q.x+'px',top:q.y+'px',right:'auto',bottom:'auto',width:size.width+'px',height:size.height+'px'});
   panel.classList.toggle('bubble-below',above<8);panel.style.setProperty('--al-tail-left',clamp(p.x+w/2-q.x,20,size.width-24)+'px');updateCue();
  }
  function fitReply(reply){
   latest=reply;if(panel.hidden||!log)return;const ticket=++measure;
   const frame=root.requestAnimationFrame||((fn)=>fn());
   frame(()=>{
    if(ticket!==measure||panel.hidden||!reply.isConnected)return;
    size=dimensions(Math.max(preferred.width,reply.textContent.length>320?400:300),preferred.height,innerWidth,innerHeight);apply();
    const previous=reply.previousElementSibling,question=previous?.classList.contains('is-user')?previous:null;
    const overhead=panel.offsetHeight-log.clientHeight;
    const desired=reply.offsetHeight+(question?.offsetHeight||0)+overhead+24;
    size.height=Math.max(preferred.height,Math.min(desired,Math.min(600,innerHeight-100)));size=dimensions(size.width,size.height,innerWidth,innerHeight);apply();
    const target=question&&question.offsetHeight+reply.offsetHeight+20<=log.clientHeight?question:reply;
    log.scrollTop=Math.max(0,target.offsetTop-log.offsetTop-6);updateCue();
   });
  }
  function restore(){
   position=null;size={width:300,height:220};preferred={...size};latest=null;drag=null;let saved;
   try{saved=key()&&JSON.parse(localStorage.getItem(key()));}catch{}
   if(saved?.position&&Number.isFinite(saved.position.x)&&Number.isFinite(saved.position.y))position={x:clamp(saved.position.x,0,1),y:clamp(saved.position.y,0,1)};
   if(saved?.size)size=dimensions(saved.size.width,saved.size.height,innerWidth,innerHeight);preferred={...size};apply();
  }
  launcher.title='Click to talk with Al. Drag to move him. Keyboard: Alt + arrow keys.';
  launcher.addEventListener('pointerdown',event=>{if(event.button!==0||!root.A1Data?.authenticated())return;const r=launcher.getBoundingClientRect();drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:r.left,top:r.top,moved:false};launcher.setPointerCapture(event.pointerId);});
  launcher.addEventListener('pointermove',event=>{if(!drag||drag.id!==event.pointerId)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(!drag.moved&&Math.hypot(dx,dy)<7)return;drag.moved=true;event.preventDefault();const r=launcher.getBoundingClientRect(),p=fit(drag.left+dx,drag.top+dy,r.width,r.height,innerWidth,innerHeight);position={x:p.x/Math.max(1,innerWidth-r.width),y:p.y/Math.max(1,innerHeight-r.height)};apply();});
  function finish(event){if(!drag||drag.id!==event.pointerId)return;const moved=drag.moved;drag=null;if(moved){persist();suppress=true;setTimeout(()=>suppress=false,300);}if(launcher.hasPointerCapture(event.pointerId))launcher.releasePointerCapture(event.pointerId);}
  launcher.addEventListener('pointerup',finish);launcher.addEventListener('pointercancel',finish);launcher.addEventListener('click',event=>{if(suppress){event.preventDefault();event.stopImmediatePropagation();suppress=false;}},true);
  launcher.addEventListener('keydown',event=>{if(!event.altKey||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const r=launcher.getBoundingClientRect(),p=fit(r.left+(event.key==='ArrowRight'?24:event.key==='ArrowLeft'?-24:0),r.top+(event.key==='ArrowDown'?24:event.key==='ArrowUp'?-24:0),r.width,r.height,innerWidth,innerHeight);position={x:p.x/Math.max(1,innerWidth-r.width),y:p.y/Math.max(1,innerHeight-r.height)};apply();persist();});
  const grip=document.createElement('div');grip.className='al-bubble-resize';grip.tabIndex=0;grip.setAttribute('role','button');grip.setAttribute('aria-label','Resize Al chat bubble');grip.title='Drag to resize. Arrow keys adjust the bubble size.';panel.append(grip);
  grip.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();resizing={id:event.pointerId,x:event.clientX,y:event.clientY,...size};grip.setPointerCapture(event.pointerId);});
  grip.addEventListener('pointermove',event=>{if(!resizing||event.pointerId!==resizing.id)return;event.preventDefault();size=dimensions(resizing.width+event.clientX-resizing.x,resizing.height+event.clientY-resizing.y,innerWidth,innerHeight);apply();});
  const end=event=>{if(!resizing||event.pointerId!==resizing.id)return;resizing=null;preferred={...size};persist();if(grip.hasPointerCapture(event.pointerId))grip.releasePointerCapture(event.pointerId);};grip.addEventListener('pointerup',end);grip.addEventListener('pointercancel',end);
  grip.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();size=dimensions(size.width+(event.key==='ArrowRight'?20:event.key==='ArrowLeft'?-20:0),size.height+(event.key==='ArrowDown'?20:event.key==='ArrowUp'?-20:0),innerWidth,innerHeight);preferred={...size};apply();persist();});
  root.addEventListener('resize',()=>{apply();if(latest)fitReply(latest);});root.addEventListener('a1-layout-changed',()=>{apply();if(latest)fitReply(latest);});root.addEventListener('a1-dashboard-ready',restore);root.addEventListener('a1-signed-out',()=>{position=null;size={width:300,height:220};apply();});
  restore();return {restore,fitReply,layoutPanel:()=>{apply();if(latest)fitReply(latest);}};
 }};
})(typeof window==='undefined'?globalThis:window);
