/* Confirmed category moves, including touch dragging and pending local sync receipts. */
(function(root){
 const normalize=v=>String(v||'').trim().replace(/\s+/g,' ').toLowerCase();
 const copy=v=>JSON.parse(JSON.stringify(v));
 function applyMove(state,move){
  const next=copy(state),{from,to,label,url}=move,key=normalize(label);next.added||={};next.removed||={};
  next.added[from]=(next.added[from]||[]).filter(x=>normalize(x.label)!==key);
  next.removed[from]=[...(next.removed[from]||[]).filter(x=>normalize(x)!==key),label];
  next.removed[to]=(next.removed[to]||[]).filter(x=>normalize(x)!==key);
  next.added[to]=[...(next.added[to]||[]).filter(x=>normalize(x.label)!==key),{label,url}].sort((a,b)=>normalize(a.label).localeCompare(normalize(b.label)));
  return next;
 }
 function moveState(state,move){
  if(!move.from||!move.to||move.from===move.to||!normalize(move.label)||!move.url)throw Error('Invalid button move');
  const next=applyMove(state,move);
  next.pendingMoves=[...(state.pendingMoves||[]).filter(x=>normalize(x.label)!==normalize(move.label)||x.url!==move.url),copy(move)];return next;
 }
 function reconcile(state,remote){
  let next=copy(state);const pending=[];
  for(const move of state.pendingMoves||[]){
   const key=normalize(move.label);
   const ack=(remote?.added?.[move.to]||[]).some(x=>normalize(x.label)===key&&x.url===move.url)&&(remote?.removed?.[move.from]||[]).some(x=>normalize(x)===key)&&!(remote?.removed?.[move.to]||[]).some(x=>normalize(x)===key);
   if(!ack){next=applyMove(next,move);pending.push(move);}
  }next.pendingMoves=pending;return next;
 }
 if(typeof module!=='undefined'&&module.exports){module.exports={moveState,reconcile};return;}
 let dragging=null,timer=null,touchStart=null,ghost=null,suppressUntil=0,busy=false,wasOpen=false;
 const permitted=()=>root.A1Data?.authenticated?.()===true||root.A1Data?.isAdmin?.()===true;
 const allowed=id=> (!root.A1Data?.canAccess||root.A1Data.canAccess(id))&&manageableSections.some(s=>s.id===id)&&!!sectionGrid(id)&&(root.A1Data?.isAdmin?.()===true||!['domains','admin','system','upload','buttonManager'].includes(id));
 const name=id=>manageableSections.find(s=>s.id===id)?.label||id;
 function source(button){const from=button.closest('.grid[data-section]')?.dataset.section;const url=getBtnURL(button);return allowed(from)&&url&&(root.A1Data?.isAdmin?.()===true||/^https?:\/\//i.test(url))?{from,label:button.getAttribute('data-label')||button.textContent.trim(),url,personal:button.dataset.personalLink==='1',key:root.A1Activity?.buttonKey?.(button)}:null;}
 function refresh(){for(const button of document.querySelectorAll('.grid[data-section]>.btn')){const canMove=permitted()&&!!source(button);button.draggable=canMove&&root.matchMedia?.('(pointer:coarse)').matches!==true;button.classList.toggle('can-drag-link',canMove);}}
 function cleanup(){const active=!!dragging;clearTimeout(timer);timer=null;touchStart=null;dragging=null;ghost?.remove();ghost=null;document.body.classList.remove('moving-link');for(const n of document.querySelectorAll('.is-dragging,.is-drop-target'))n.classList.remove('is-dragging','is-drop-target');if(active&&!wasOpen){setSectionMenuExpanded(false);}refresh();}
 function begin(button,touch=false){const item=source(button);if(busy||!permitted()||!item)return false;dragging=item;wasOpen=document.querySelector('.top-tabs').classList.contains('is-open');button.classList.add('is-dragging');document.body.classList.add('moving-link');if(touch){ghost=document.createElement('div');ghost.className='link-drag-ghost';ghost.textContent=item.label;document.body.append(ghost);setSectionMenuExpanded(true);}return true;}
 function destination(element){const category=element?.closest('[data-category]')?.dataset.category;const grid=element?.closest('.grid[data-section]')?.dataset.section;const id=category||grid;return allowed(id)&&id!==dragging?.from?id:null;}
 function highlight(element){for(const n of document.querySelectorAll('.is-drop-target'))n.classList.remove('is-drop-target');const id=destination(element);if(id)element.closest('[data-category],.grid[data-section]')?.classList.add('is-drop-target');return id;}
 async function move(item,to){
  if(busy||!permitted()||!allowed(to)||item.from===to)return;
  if(!confirm('Move “'+item.label+'” from '+name(item.from)+' to '+name(to)+'?'))return;
  busy=true;
  try{
   const existing=[...sectionGrid(to).querySelectorAll(':scope > .btn')].some(b=>!b.classList.contains('a1-personally-hidden')&&normalize(b.getAttribute('data-label')||b.textContent)===normalize(item.label));
   if(existing)throw Error('That category already has a button with this name. No buttons were changed.');
   if(root.A1Data?.isAdmin?.()!==true||item.personal){await root.A1Activity.moveButton(item,to);showSection(to);return;}
   const remote=await fetchRemoteConfig();if(!permitted())throw Error('Administrator access required');
   const baseline=mergeStates(loadState(),remote);
   if((baseline.removed?.[item.from]||[]).some(x=>normalize(x)===normalize(item.label)))throw Error('This button was removed. Refresh links and try again.');
   const current=(baseline.added?.[item.from]||[]).find(x=>normalize(x.label)===normalize(item.label));
   if(current&&current.url!==item.url)throw Error('This button changed. Refresh links and try again.');
   const moved=moveState(baseline,{...item,to});saveState(moved);applyState(moved);showSection(to);broadcastRefresh();
   await syncRemote(moved);
  }catch(error){alert(error.message);}finally{busy=false;}
 }
 function init(){
  document.addEventListener('dragstart',event=>{const button=event.target.closest?.('.grid[data-section]>.btn');if(!button)return;if(touchStart||!begin(button)){event.preventDefault();return;}event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',dragging.label);});
  document.addEventListener('dragover',event=>{if(!dragging)return;if(highlight(event.target)){event.preventDefault();event.dataTransfer.dropEffect='move';}});
  document.addEventListener('drop',event=>{if(!dragging)return;event.preventDefault();const item=dragging,to=destination(event.target);suppressUntil=Date.now()+800;cleanup();if(to)move(item,to);});
  document.addEventListener('dragend',()=>{if(dragging){suppressUntil=Date.now()+800;cleanup();}});
  document.addEventListener('touchstart',event=>{if(event.touches.length!==1||!permitted())return;const button=event.target.closest?.('.grid[data-section]>.btn');if(!button||!source(button))return;button.draggable=false;const t=event.touches[0];touchStart={x:t.clientX,y:t.clientY,button,started:Date.now(),privateLink:button.closest('.grid')?.dataset.section==='accounts'};if(touchStart.privateLink)return;timer=setTimeout(()=>{if(begin(button,true)){ghost.style.left=touchStart.x+'px';ghost.style.top=touchStart.y+'px';suppressUntil=Date.now()+1000;}},450);},{passive:true});
  document.addEventListener('touchmove',event=>{if(!touchStart)return;const t=event.touches[0];if(!t)return;if(!dragging){if(Math.hypot(t.clientX-touchStart.x,t.clientY-touchStart.y)>10){if(touchStart.privateLink&&Date.now()-touchStart.started>=450){root.A1PrivateLinks?.cancel();begin(touchStart.button,true);}else cleanup();}if(!dragging)return;}event.preventDefault();ghost.style.left=t.clientX+'px';ghost.style.top=t.clientY+'px';highlight(document.elementFromPoint(t.clientX,t.clientY));},{passive:false});
  document.addEventListener('touchend',event=>{if(!touchStart)return;const item=dragging,t=event.changedTouches[0],to=item&&t?destination(document.elementFromPoint(t.clientX,t.clientY)):null;if(item){event.preventDefault();suppressUntil=Date.now()+1000;}cleanup();if(item&&to)move(item,to);},{passive:false});
  document.addEventListener('touchcancel',cleanup);
  document.addEventListener('contextmenu',event=>{if(dragging)event.preventDefault();});
  document.addEventListener('click',event=>{if(Date.now()<suppressUntil){event.preventDefault();event.stopImmediatePropagation();}},{capture:true});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')cleanup();});root.addEventListener('a1-signed-out',cleanup);refresh();
 }
 root.A1ButtonMoves={moveState,reconcile,refresh,move,source,destinations:()=>manageableSections.filter(s=>allowed(s.id))};document.addEventListener('DOMContentLoaded',init);
})(typeof window==='undefined'?globalThis:window);
