/* Private ticket links: Alt-click or a stationary three-second press. */
(function(root){
 let alt=false,press=null,timer=null,suppressUntil=0;
 const selector='#accounts .grid[data-section="accounts"] > .btn';
 const ticketUrl=button=>normalizeStoredLinkUrl(getBtnURL(button));
 const eligible=button=>button?.matches(selector)&&/^https?:\/\//i.test(ticketUrl(button));
 function paint(button,ready){button.classList.toggle('private-ready',ready);}
 function cancel(){clearTimeout(timer);timer=null;if(press)paint(press.button,alt);press=null;}
 function refresh(){
  document.querySelectorAll('#accounts .private-link-btn').forEach(n=>n.remove());
  for(const button of document.querySelectorAll(selector)){
   if(!eligible(button))continue;
   if(!button.querySelector('.ticket-lock')){
    button.insertAdjacentHTML('beforeend','<svg class="ticket-lock" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v3"/></svg>');
    button.title=(button.title?button.title+' · ':'')+'Alt-click or hold 3 seconds and release to open privately';
   }paint(button,alt||press?.button===button&&press.ready);
  }
 }
 function init(){
  document.addEventListener('pointerdown',event=>{
   const button=event.target.closest?.(selector);if(event.button!==0||!eligible(button))return;
   cancel();press={button,id:event.pointerId,x:event.clientX,y:event.clientY,ready:false};
   timer=setTimeout(()=>{if(press?.button===button){press.ready=true;paint(button,true);}},3000);
  },true);
  document.addEventListener('pointermove',event=>{if(press&&event.pointerId===press.id&&Math.hypot(event.clientX-press.x,event.clientY-press.y)>10)cancel();},true);
  document.addEventListener('pointerup',event=>{
   if(!press||event.pointerId!==press.id)return;
   const button=press.button,ready=press.ready;cancel();
   if(ready){event.preventDefault();suppressUntil=Date.now()+1000;openPrivateShortcut(ticketUrl(button),button.dataset.label||button.textContent.trim());}
  },true);
  document.addEventListener('pointercancel',cancel,true);
  document.addEventListener('dragstart',cancel,true);
  document.addEventListener('contextmenu',event=>{if(press&&eligible(event.target.closest?.(selector)))event.preventDefault();},true);
  document.addEventListener('click',event=>{
   const button=event.target.closest?.(selector);if(!eligible(button))return;
   if(Date.now()<suppressUntil){event.preventDefault();event.stopImmediatePropagation();return;}
   if(event.altKey||alt){event.preventDefault();event.stopImmediatePropagation();cancel();openPrivateShortcut(ticketUrl(button),button.dataset.label||button.textContent.trim());}
  },true);
  document.addEventListener('keydown',event=>{if(event.key==='Alt'){alt=true;refresh();}if(event.key==='Escape')cancel();});
  document.addEventListener('keyup',event=>{if(event.key==='Alt'){alt=false;refresh();}});
  const reset=()=>{alt=false;cancel();refresh();};root.addEventListener('blur',reset);root.addEventListener('a1-signed-out',reset);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)reset();});refresh();
 }
 const eventHosts=['ticketmaster.com','ticketmaster.ca','ticketmaster.co.uk','ticketmaster.ie','ticketmaster.de','ticketmaster.fr','ticketmaster.es','ticketmaster.nl','ticketmaster.se','ticketmaster.no','ticketmaster.dk','ticketmaster.fi','ticketmaster.be','ticketmaster.at','ticketmaster.ch','ticketmaster.com.au','ticketmaster.co.nz','ticketmaster.com.mx'];
 function isTicketmasterUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&eventHosts.some(host=>u.hostname===host||u.hostname.endsWith('.'+host));}catch{return false;}}
 function openAssistantTicketmaster(value){
  if(!root.A1Data?.authenticated())throw new Error('Sign in before opening this event.');
  if(!isTicketmasterUrl(value))throw new Error('This is not a supported Ticketmaster event address.');
  if(root.A1Data.linkBlocked?.(value))throw new Error('This link is restricted by your administrator.');
  const nav=root.navigator||{};
  const mac=/Mac/i.test(nav.platform||nav.userAgent||'')&&!/iPhone|iPad|iPod/i.test(nav.userAgent||'')&&!(nav.maxTouchPoints>1);
  if(!mac)return {requested:false};
  // A normal web popup shares cookies. Only dispatch to the OS private opener;
  // never substitute window.open, the staff iframe, or a regular tab.
  root.location.href='shortcuts://run-shortcut?name='+encodeURIComponent('A1VIP Private Open')+'&input=text&text='+encodeURIComponent(value);
  return {requested:true};
 }
 root.A1PrivateLinks={refresh,cancel,isTicketmasterUrl,openAssistantTicketmaster};document.addEventListener('DOMContentLoaded',init);
})(window);
