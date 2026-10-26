/* Safari spatial-style layout: standard click activation supports look-and-pinch selection. */
(() => {
 let moving=false,toolbar,toggle,help,dialog,origin;
 const active=()=>document.body.classList.contains('a1-vision');
 function reset(){
  moving=false;document.body.classList.remove('vision-moving');
  if(toggle){toggle.textContent='Move a Button';toggle.setAttribute('aria-pressed','false');}
  if(help)help.textContent='Select a category, then look at a button and pinch to open it. Use Move a Button to organize links without dragging.';
  if(dialog?.open)dialog.close();
 }
 function sync(){reset();if(toolbar)toolbar.hidden=!active();}
 function choose(button){
  const item=window.A1ButtonMoves?.source(button);if(!item)return;
  origin=button;dialog.replaceChildren();
  const title=document.createElement('h2');title.id='visionMoveTitle';title.textContent='Move '+item.label;dialog.append(title);
  const info=document.createElement('p');info.textContent=A1Data.isAdmin()&&!item.personal?'Choose a category. This updates the shared layout.':'Choose a category for your personal layout.';dialog.append(info);
  const choices=document.createElement('div');choices.className='vision-destinations';dialog.append(choices);
  for(const section of window.A1ButtonMoves.destinations().filter(s=>s.id!==item.from)){
   const choice=document.createElement('button');choice.type='button';choice.className='btn';choice.textContent=section.label;
   choice.onclick=async()=>{choices.inert=true;try{await window.A1ButtonMoves.move(item,section.id);reset();}finally{choices.inert=false;}};choices.append(choice);
  }
  if(!choices.children.length)info.textContent='No other categories are available for this button.';
  const cancel=document.createElement('button');cancel.type='button';cancel.className='cta';cancel.textContent='Cancel';cancel.onclick=reset;dialog.append(cancel);dialog.showModal();
 }
 // Registered before the normal click handlers: moving never opens the selected link.
 document.addEventListener('click',event=>{
  if(!active()||!moving||!window.A1Data?.authenticated())return;
  const button=event.target.closest?.('.grid[data-section]>.btn');if(!button)return;
  event.preventDefault();event.stopImmediatePropagation();window.A1PrivateLinks?.cancel();choose(button);
 },true);
 for(const type of ['pointerdown','touchstart'])document.addEventListener(type,event=>{if(active()&&moving&&event.target.closest?.('.grid[data-section]>.btn'))event.stopImmediatePropagation();},true);
 document.addEventListener('DOMContentLoaded',()=>{
  toolbar=document.createElement('aside');toolbar.className='vision-toolbar';toolbar.setAttribute('aria-label','Vision Pro controls');toolbar.hidden=!active();
  const title=document.createElement('strong');title.textContent='Vision Pro';toolbar.append(title);
  help=document.createElement('p');help.setAttribute('role','status');toolbar.append(help);
  toggle=document.createElement('button');toggle.type='button';toggle.className='cta';toggle.onclick=()=>{
   if(!A1Data.authenticated())return;
   if(moving){reset();return;}moving=true;document.body.classList.add('vision-moving');toggle.textContent='Done Moving';toggle.setAttribute('aria-pressed','true');help.textContent='Select the link you want to move, then select its destination category.';
  };toolbar.append(toggle);document.querySelector('main').prepend(toolbar);
  dialog=document.createElement('dialog');dialog.className='vision-move-dialog';dialog.setAttribute('aria-labelledby','visionMoveTitle');dialog.addEventListener('cancel',reset);dialog.addEventListener('close',()=>origin?.isConnected&&origin.focus());document.body.append(dialog);reset();
 });
 window.addEventListener('a1-layout-changed',sync);window.addEventListener('a1-signed-out',reset);
})();
