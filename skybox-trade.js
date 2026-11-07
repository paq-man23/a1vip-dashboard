/* Explicitly confirmed Skybox actions. No credentials or raw provider records reach this UI. */
(()=>{
 const $=id=>document.getElementById(id),el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 const call=body=>A1Data.skyboxTradeRequest(body),money=n=>Number(n).toLocaleString(undefined,{style:'currency',currency:'USD'});
 let dialog,content,notice,preview=null,busy=false,generation=0;
 function button(text,action){const b=el('button',text);b.className='btn';b.type='button';b.onclick=action;return b;}
 function inform(text){notice.textContent=text;}
 function mount(){if(dialog)return;dialog=el('dialog');dialog.id='skyboxTradeDialog';dialog.className='skybox-trade-dialog';dialog.setAttribute('aria-label','Skybox inventory action');dialog.append(el('h2','Manage Skybox Inventory'));content=el('div');notice=el('p');notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');dialog.append(content,notice,button('Close',close));dialog.addEventListener('cancel',e=>{e.preventDefault();close();});document.body.append(dialog);}
 async function close(){if(busy){inform('Wait for this request to finish. Its outcome is saved for reconciliation.');return;}generation++;if(preview){try{await call({action:'cancel',id:preview.id});}catch{}preview=null;}dialog?.close();content?.replaceChildren();if(notice)notice.textContent='';}
 async function status(){
  if(!A1Data.isAdmin())return;
  try{const r=await call({action:'status'});if(!A1Data.authenticated())return;const state=$('skyboxTradeSettingStatus');if(state)state.textContent=r.enabled?'Live inventory actions enabled. Each action requires confirmation.':'Live inventory actions disabled. Previews are available.';
   const list=$('skyboxTradeHistory');if(!list)return;list.replaceChildren();if(!r.orders.length)list.append(el('p','No inventory actions yet.'));
   for(const o of r.orders){const card=el('div');card.className='invoice-history-card';card.append(el('strong',`${o.kind} · Listing ${o.inventory_id}`),el('p',`${o.state} · ${new Date(o.created_at).toLocaleString()}`));if(o.invoice_id)card.append(button('Open Invoice',()=>openInvoice(o.invoice_id)));if(['uncertain','provider_confirmed','executing'].includes(o.state))card.append(button('Reconcile with Skybox',()=>reconcile(o.id,card)));if(o.state==='preview')card.append(button('Cancel Preview',async()=>{try{await call({action:'cancel',id:o.id});await status();}catch(e){card.append(el('p',e.message));}}));list.append(card);}
  }catch(e){const state=$('skyboxTradeSettingStatus');if(state)state.textContent=e.message;}
 }
 async function settings(enabled){if(!A1Data.isAdmin())return;if(enabled&&!$('skyboxWritesApproved').checked){$('skyboxTradeSettingStatus').textContent='Verify Skybox write permissions and check the approval box first.';return;}try{await call({action:'settings',enabled,confirmation:enabled?'ENABLE SKYBOX TRADING':undefined});$('skyboxWritesApproved').checked=false;await status();}catch(e){$('skyboxTradeSettingStatus').textContent=e.message;}}
 async function openInvoice(id){await A1Data.loadSection('invoices',true);window.loadInvoiceFromHistory(id);}
 async function reconcile(id,output){try{const r=await call({action:'reconcile',id});output.append(el('p',r.message||('Action status: '+r.state)));if(r.invoiceId)output.append(button('Open Invoice',()=>openInvoice(r.invoiceId)));}catch(e){output.append(el('p',e.message));}}
 async function open(inventoryId){
  if(!A1Data.isAdmin()||busy)return;mount();if(dialog.open)await close();preview=null;const current=++generation;busy=true;content.replaceChildren();inform('Checking current Skybox availability…');dialog.showModal();
  try{const r=await call({action:'inspect',inventoryId});await A1Data.loadSection('customers');if(current!==generation||!A1Data.authenticated())return;const s=r.snapshot;inform(r.enabled?'Choose an action, then review the exact details.':'Live writes are disabled. You can preview; an admin must verify permissions before enabling actions.');
   content.append(el('strong',s.eventName),el('p',`${s.eventDate} · ${s.venue} · Section ${s.section} · Row ${s.row} · ${s.quantity} tickets`));
   const form=el('form'),kind=el('select'),customer=el('select'),price=el('input'),minutes=el('input'),listing=el('select');
   const label=(text,input)=>{const n=el('label',text);n.append(input);form.append(n);};
   for(const [value,text] of [['sale','Sell tickets & create invoice'],['hold','Place a timed hold'],['price','Change asking price'],['listing','Change marketplace listing visibility']]){const o=el('option',text);o.value=value;kind.append(o);}label('Action',kind);
   customer.append(el('option','Choose a Skybox customer'));customer.firstChild.value='';
   for(const c of A1Data.contacts().filter(c=>c.kind==='customer'&&/^[1-9]\d*$/.test(c.id))){const o=el('option',c.displayName||c.name||c.company||c.id);o.value=c.id;customer.append(o);}label('Customer (existing Skybox customer)',customer);
   price.type='number';price.min='0';price.step='0.01';price.value=s.listPrice??'';label('Price per ticket (USD)',price);
   minutes.type='number';minutes.min='1';minutes.max='30';minutes.value='10';label('Hold duration in minutes',minutes);
   for(const [v,t] of [['false','Stop broadcasting to marketplaces'],['true','Broadcast to marketplaces']]){const o=el('option',t);o.value=v;listing.append(o);}listing.value=String(s.broadcast);label('Listing visibility',listing);
   const seats=el('fieldset');seats.append(el('legend','Select exact tickets'));const boxes=[];
   for(const t of s.tickets){const row=el('label'),box=el('input');box.type='checkbox';box.value=t.id;box.disabled=t.status!=='AVAILABLE'||!!t.invoiceLineId;row.append(box,document.createTextNode(`Seat ${t.seat??'not specified'} · Ticket ${t.id} · ${t.status}`));seats.append(row);boxes.push(box);}form.append(seats);
   function change(){const selectTickets=['sale','hold'].includes(kind.value);customer.parentElement.hidden=!selectTickets;seats.hidden=!selectTickets;price.parentElement.hidden=!['sale','price'].includes(kind.value);minutes.parentElement.hidden=kind.value!=='hold';listing.parentElement.hidden=kind.value!=='listing';}kind.onchange=change;change();
   const submit=el('button','Review Action');submit.type='submit';submit.className='btn';form.append(submit);content.append(form);
   form.onsubmit=async event=>{event.preventDefault();if(busy)return;busy=true;submit.disabled=true;inform('Preparing a fresh, time-limited confirmation…');try{
    const p=await call({action:'prepare',kind:kind.value,inventoryId,customerId:customer.value,ticketIds:boxes.filter(b=>b.checked).map(b=>Number(b.value)),unitPrice:price.value,minutes:Number(minutes.value),broadcast:listing.value==='true'});if(current!==generation||!A1Data.authenticated())return;preview=p;renderPreview(p,current);
   }catch(e){inform(e.message);submit.disabled=false;}finally{busy=false;}};
  }catch(e){inform(e.message);}finally{busy=false;}
 }
 function renderPreview(p,current){
  content.replaceChildren(el('h3','Confirm '+p.kind),el('strong',p.snapshot.eventName),el('p',`${p.snapshot.eventDate} · Section ${p.snapshot.section} · Row ${p.snapshot.row}`));
  const i=p.intent;if(i.customer)content.append(el('p','Customer: '+i.customer.displayName));if(i.ticketIds)content.append(el('p','Ticket IDs: '+i.ticketIds.join(', ')));
  if(p.kind==='sale')content.append(el('p',`${i.ticketIds.length} × ${money(i.unitPrice)} = ${money(i.ticketIds.length*i.unitPrice)}. Creates an unpaid Skybox sale and one linked invoice. It does not collect payment, deliver tickets or email the customer.`));
  if(p.kind==='hold')content.append(el('p','Hold expires '+new Date(i.expiryDate).toLocaleString()));if(p.kind==='price')content.append(el('p','New asking price: '+money(i.unitPrice)+' per ticket'));if(p.kind==='listing')content.append(el('p',i.broadcast?'Enable marketplace broadcast':'Stop marketplace broadcast'));
  content.append(el('p','Preview expires '+new Date(p.expiresAt).toLocaleTimeString()));
  const approval=el('label'),check=el('input');check.type='checkbox';approval.append(check,document.createTextNode(' I approve this exact change in Skybox.'));content.append(approval);
  const confirm=button('Confirm in Skybox',async()=>{if(busy||!check.checked||!p.enabled)return;busy=true;confirm.disabled=true;inform('Submitting once to Skybox. Do not submit this sale elsewhere.');try{const r=await call({action:'commit',id:p.id,confirmation:'CONFIRM SKYBOX ACTION'});if(current!==generation||!A1Data.authenticated())return;preview=null;content.replaceChildren(el('h3',r.state==='complete'?'Action completed':'Action needs review'),el('p',r.message||('Saved status: '+r.state)));if(r.invoiceId)content.append(button('Open Invoice',()=>openInvoice(r.invoiceId)));if(r.state!=='complete')content.append(button('Reconcile with Skybox',()=>reconcile(p.id,content)));inform('The action is saved in Buying & Selling history.');window.A1SeatSniper?.inventory();await status();}catch(e){inform(e.message+' Review Buying & Selling history before trying another action.');preview=null;content.append(button('Reconcile with Skybox',()=>reconcile(p.id,content)));}finally{busy=false;}});
  confirm.disabled=true;check.onchange=()=>{confirm.disabled=!check.checked||!p.enabled;};content.append(confirm,button('Cancel Preview',close));inform(p.enabled?'Review and confirm before expiry.':'Live actions are disabled. The preview cannot submit until Admin enables trading. Cancel it after review.');
 }
 window.A1Trade={open,status,settings,close};
 window.addEventListener('a1-signed-out',()=>{generation++;preview=null;busy=false;dialog?.close();content?.replaceChildren();if(notice)notice.textContent='';$('skyboxTradeHistory')?.replaceChildren();if($('skyboxTradeSettingStatus'))$('skyboxTradeSettingStatus').textContent='';if($('skyboxWritesApproved'))$('skyboxWritesApproved').checked=false;});
})();
