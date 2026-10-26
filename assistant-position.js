/* Non-overlapping docks, saved separately for each account on this device. */
(function(root){
 const sanitize=value=>['left','right','bottom'].includes(value)?value:'right';
 const effective=(preference,width)=>width<1000?'bottom':sanitize(preference);
 if(typeof module!=='undefined'&&module.exports){module.exports={sanitize,effective};return;}
 root.A1AssistantPosition={init(launcher,panel){
  let preference='right',drag=null,suppress=false;
  const key=()=>{const email=root.A1Data?.account()?.email;return email?'a1-al-dock:'+email.toLowerCase():null;};
  function apply(){const dock=effective(preference,innerWidth);document.body.dataset.alDock=dock;select.value=dock;}
  function save(value){preference=sanitize(value);try{if(key())localStorage.setItem(key(),preference);}catch{}apply();}
  function restore(){let saved;try{saved=key()&&localStorage.getItem(key());}catch{}preference=sanitize(saved);apply();}
  const label=document.createElement('label');label.className='copilot-position';label.textContent='Al dock';
  const select=document.createElement('select');select.setAttribute('aria-label','Al dock position');
  for(const [value,text] of [['','Move Al…'],['left','Left side'],['right','Right side'],['bottom','Bottom']]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}
  select.addEventListener('change',()=>{if(select.value)save(select.value);});label.append(select);panel.querySelector('.copilot-form').before(label);
  const handle=document.getElementById('a1AssistantTab')||launcher;
  handle.title='Open Al. Drag toward the left, right, or bottom to change his dock. Keyboard: Alt + arrow keys.';
  handle.addEventListener('pointerdown',event=>{if(event.button!==0||!root.A1Data?.authenticated())return;drag={id:event.pointerId,x:event.clientX,y:event.clientY,moved:false};handle.setPointerCapture(event.pointerId);});
  handle.addEventListener('pointermove',event=>{if(!drag||drag.id!==event.pointerId)return;if(Math.hypot(event.clientX-drag.x,event.clientY-drag.y)>20){drag.moved=true;event.preventDefault();handle.classList.add('is-repositioning');}});
  function finish(event){
   if(!drag||drag.id!==event.pointerId)return;const moved=drag.moved;drag=null;handle.classList.remove('is-repositioning');
   if(moved&&event.type!=='pointercancel'){save(event.clientY>innerHeight*.75?'bottom':event.clientX<innerWidth/2?'left':'right');suppress=true;setTimeout(()=>suppress=false,300);}
   if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);
  }
  handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);
  handle.addEventListener('click',event=>{if(suppress){event.preventDefault();event.stopImmediatePropagation();suppress=false;}},true);
  handle.addEventListener('keydown',event=>{if(!event.altKey||!['ArrowLeft','ArrowRight','ArrowDown'].includes(event.key))return;event.preventDefault();save({ArrowLeft:'left',ArrowRight:'right',ArrowDown:'bottom'}[event.key]);});
  root.addEventListener('resize',apply);root.addEventListener('a1-layout-changed',apply);root.addEventListener('a1-dashboard-ready',restore);
  root.addEventListener('a1-signed-out',()=>{drag=null;preference='right';apply();});
  restore();return {restore,layoutPanel:apply};
 }};
})(typeof window==='undefined'?globalThis:window);
