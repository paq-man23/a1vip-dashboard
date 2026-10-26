/* Read-only user dashboard preview. Does not impersonate users or write preferences. */
(function(root){
 const sections=[['main','Main Links'],['luxury','Suites'],['accounts','Ticket Accounts'],['travel','Travel'],['social','Social'],['invoices','Invoices & POs'],['customers','Customers'],['vendors','Vendors'],['formLetter','Letters'],['tripItinerary','Trips']];
 const children={privatejet:'Private Jet',luxhomes:'Luxury Homes',yachts:'Yachts'};
 const normalize=url=>{try{return new URL(url).href;}catch{return String(url||'');}};
 function build(choices,shared){
  const visible=sections.filter(([id])=>choices.allowed_sections==null||choices.allowed_sections.includes(id));
  const allowed=new Set(visible.map(([id])=>id)),hidden=new Set(choices.hidden_buttons||[]),blocked=new Set(choices.blocked_links||[]);
  const blockedUrls=new Set();for(const key of blocked){try{const url=JSON.parse(key)[2];if(url)blockedUrls.add(normalize(url));}catch{}}
  const available=section=>allowed.has(children[section]?'travel':section);
  const key=link=>JSON.stringify([link.section,link.label.trim(),link.url||'']);
  const links=shared.filter(link=>available(link.section)&&!hidden.has(link.key||key(link))&&!blocked.has(link.key||key(link))&&!blockedUrls.has(normalize(link.url)));
  for(const item of choices.added_links||[]){
   const section=['main','luxury','accounts','travel','social','privatejet','luxhomes','yachts'].includes(item.section)?item.section:'main';
   const link={section,label:item.label,url:item.url};
   let valid=false;try{valid=['http:','https:'].includes(new URL(link.url).protocol);}catch{}
   if(typeof link.label!=='string'||!valid||!available(section)||blocked.has(key(link))||blockedUrls.has(normalize(link.url)))continue;
   links.push(link);
  }
  return {sections:visible,links};
 }
 if(typeof module!=='undefined'&&module.exports){module.exports={build};return;}
 let dialog=null,serial=0;
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 function close(){serial++;dialog?.close();dialog?.remove();dialog=null;}
 async function open(row){
  if(!root.A1Data.isAdmin()||row.is_admin)return;
  close();const token=serial,owner=root.A1Data.account()?.email;
  dialog=el('dialog',undefined,'account-dashboard-preview');dialog.setAttribute('aria-labelledby','accountPreviewTitle');
  const toolbar=el('div',undefined,'account-preview-toolbar'),title=el('h2','Dashboard Preview · '+(row.username||row.name||'User'));title.id='accountPreviewTitle';
  const exit=el('button','Close Preview','btn');exit.type='button';exit.onclick=close;toolbar.append(title,exit);
  const note=el('p','Read-only preview. You remain signed in as admin. Links and records do not open here.');
  const content=el('div','Loading saved dashboard setup…');content.setAttribute('role','status');
  dialog.append(toolbar,note,content);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});document.body.append(dialog);dialog.showModal();
  try{
   const choices=await root.A1Data.fetchPreferences(row.id);
   if(token!==serial||!root.A1Data.isAdmin()||root.A1Data.account()?.email!==owner)return;
   const shared=[...document.querySelectorAll('.grid[data-section] > .btn')].filter(b=>!b.dataset.personalLink&&!b.hasAttribute('data-admin-only')).map(b=>({section:b.closest('.grid').dataset.section,label:(b.dataset.label||b.textContent).trim(),url:b.dataset.url||'',key:root.A1Activity.buttonKey(b)}));
   const model=build(choices,shared);content.replaceChildren();
   const brand=el('div',undefined,'account-preview-brand'),logo=el('img');logo.src='A1VIP_LOGO_WIDE_for_White_backgrounds_large.png';logo.alt='A1 VIP';brand.append(logo,el('strong','A1 VIP Ticket Dashboard'),el('span',(row.name||row.username||'User')+(row.enabled?'':' · Disabled account')));content.append(brand);
   const nav=el('nav',undefined,'account-preview-tabs');nav.setAttribute('aria-label','User preview categories');const view=el('div',undefined,'account-preview-content');content.append(nav,view);
   function show(id,label){
    view.replaceChildren();view.append(el('h3',label));for(const n of nav.children)n.setAttribute('aria-pressed',String(n.dataset.previewCategory===id));
    const groups=id==='travel'?[[id,label],...Object.entries(children)]:[[id,label]];let count=0;
    for(const [section,name] of groups){const links=model.links.filter(link=>link.section===section);if(!links.length)continue;count+=links.length;if(section!==id)view.append(el('h4',name));const grid=el('div',undefined,'account-preview-grid');for(const link of links){const b=el('button',link.label,'btn');b.type='button';b.tabIndex=-1;b.setAttribute('aria-disabled','true');grid.append(b);}view.append(grid);}
    if(!count)view.append(el('p',['invoices','customers','vendors','formLetter','tripItinerary'].includes(id)?'This category is available to the user. Saved records are not loaded in this layout preview.':'No visible buttons in this category.'));
   }
   for(const [id,label] of model.sections){const style={customers:'invoices',vendors:'invoices',formLetter:'letter',tripItinerary:'itinerary'};const tab=el('button',label,'tab tab-'+(style[id]||id));tab.type='button';tab.dataset.previewCategory=id;tab.onclick=()=>show(id,label);nav.append(tab);}
   if(model.sections.length)show(...model.sections[0]);else view.append(el('p','No dashboard categories are assigned to this user.'));
  }catch(error){if(token===serial&&dialog)content.textContent='Could not load preview: '+error.message;}
 }
 root.addEventListener('a1-signed-out',close);root.addEventListener('a1-access-changed',close);
 root.A1AccountPreview={open,close};
})(typeof window==='undefined'?globalThis:window);
