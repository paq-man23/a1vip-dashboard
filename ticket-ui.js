/* A native Skybox API workspace. No embedded Skybox pages or browser-stored API keys. */
(() => {
 const $=id=>document.getElementById(id),el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const label=s=>String(s).replace(/([a-z\d])([A-Z])/g,'$1 $2').replace(/[_-]/g,' ').replace(/\bIds\b/g,'IDs').replace(/\bId\b/g,'ID').replace(/^./,x=>x.toUpperCase());
 const currency=(v,code='USD')=>v==null?'—':Number(v).toLocaleString(undefined,{style:'currency',currency:/^[A-Z]{3}$/.test(code)?code:'USD'});
 const groups=[['Inventory','inventorySearch'],['Invoices','invoicesSearch'],['Purchases','purchasesSearch'],['Holds','holdsSearch'],['Customers','customersSearch'],['Vendors','vendorsSearch'],['Events','eventsIndex'],['Reports','reportsListDefinitions'],['More','accountGet']];
 const createOps={Invoices:'invoicesInsertInvoice',Purchases:'purchasesInsertPurchase',Holds:'holdsInsert',Customers:'customersInsert',Vendors:'vendorsInsert'};
 const preferred={Invoice:['customerId','lines','paymentMethod','deliveryMethod','salesTerm','publicNotes','externalRef'],Purchase:['vendorId','lines','paymentMethod','purchaseTerm','publicNotes','externalRef'],Inventory:['id','eventId','quantity','section','row','seatType','stockType','splitType','listPrice','publicNotes','broadcast','version'],Line:['quantity','amount','lineItemType','itemIds','inventory'],Customer:['displayName','firstName','lastName','company','email','address','customerType','defaultDeliveryMethod','paymentMethod','salesTerm'],Vendor:['displayName','firstName','lastName','company','email','address'],HoldRequest:['inventoryId','customerId','quantity','expiryDate','notes']};
 let catalog=null,group='Inventory',page=1,pageSize=50,epoch=0,modalEpoch=0,rows=[],total=0,mode='live',busy=false,pending=null,downloadUrls=[];
 const request=body=>A1Data.ticketRequest(body);
 const schema=s=>s?.$ref?catalog.schemas[s.$ref.split('/').pop()]||{}:s||{};
 const title=op=>({inventorySearch:'Search inventory',invoicesSearch:'Search invoices',purchasesSearch:'Search purchases',customersSearch:'Search customers',vendorsSearch:'Search vendors',invoicesInsertInvoice:'Create invoice / Sell tickets',purchasesInsertPurchase:'Create purchase order',inventoryUpdate:'Edit listing',holdsInsert:'Hold tickets'}[op.id]||label(op.id.replace(/^[a-z]+?(?=[A-Z])/,'').replace(/ById$/,'')));
 function message(text,error=false){const n=$('ticketMessage');n.textContent=text;n.classList.toggle('ticket-error',error);}
 function button(text,fn,primary=false){const b=el('button',text,'btn'+(primary?' ticket-primary':''));b.type='button';b.onclick=fn;return b;}
 function clear(){epoch++;modalEpoch++;catalog=null;rows=[];pending=null;busy=false;for(const u of downloadUrls)URL.revokeObjectURL(u);downloadUrls=[];if($('ticketDialog')?.open)$('ticketDialog').close();$('ticketUI')?.replaceChildren();}
 function build(){
  if(mode==='cached'&&pageSize>50)pageSize=50;
  const root=$('ticketUI');root.replaceChildren();const shell=el('div',undefined,'ticket-shell');
  const top=el('div',undefined,'ticket-top'),brand=el('h2',undefined,'ticket-brand');brand.append(el('span','A1 '),document.createTextNode('Ticket UI'));top.append(brand,el('small','Inventory · Sales · Purchasing'),el('span',mode==='cached'?'Synced inventory':'Skybox connection','ticket-badge'));shell.append(top);
  const nav=el('nav',undefined,'ticket-nav');nav.setAttribute('aria-label','Ticket UI workspaces');
  for(const [name] of groups){const b=button(name,()=>select(name));b.disabled=!A1Data.isAdmin()&&name!=='Inventory';if(group===name)b.setAttribute('aria-current','page');nav.append(b);}shell.append(nav);
  const toolbar=el('div',undefined,'ticket-toolbar');toolbar.append(el('h3',group));
  if(A1Data.isAdmin()){
   const actions=el('select');actions.setAttribute('aria-label','Skybox action');actions.append(new Option('Choose an action…',''));
   for(const op of Object.values(catalog?.operations||{}).filter(o=>group==='More'||o.group.toLowerCase().replace(/\s/g,'')===group.toLowerCase()))actions.append(new Option(title(op),op.id));
   actions.onchange=()=>{if(actions.value)openAction(actions.value);actions.value='';};toolbar.append(actions);
   if(createOps[group])toolbar.append(button(group==='Invoices'?'New invoice':group==='Purchases'?'New purchase':'Add '+group.replace(/s$/,''),()=>openAction(createOps[group]),true));
  }
  toolbar.append(button('Refresh',()=>load()));if(group==='Inventory'&&A1Data.isAdmin())toolbar.append(button(mode==='live'?'View synced inventory':'View live inventory',()=>{mode=mode==='live'?'cached':'live';page=1;build();load();}));shell.append(toolbar);
  const layout=el('div',undefined,'ticket-layout'),filters=el('details',undefined,'ticket-filters');filters.open=window.innerWidth>850;filters.append(el('summary','Filters'));
  const form=el('form');form.id='ticketSearch';const names=group==='Inventory'?[['event','Event / artist / team'],['venue','Venue'],['state','State'],['section','Section'],['row','Row'],['eventDateFrom','Event date from'],['eventDateTo','Event date through']]:group==='Customers'||group==='Vendors'?[['displayName','Name / company']]:group==='Invoices'||group==='Purchases'?[['displayName',group==='Invoices'?'Customer':'Vendor'],['createdDateFrom','Created from'],['createdDateTo','Created through'],['eventDateFrom','Event date from'],['eventDateTo','Event date through']]:[];
  for(const [name,text] of names){const wrap=el('label',text),input=el('input');input.name=name;input.type=name.includes('Date')?'date':'search';if(name==='eventDateFrom'&&group==='Inventory')input.value=today();if(name==='createdDateFrom')input.value=new Date(Date.now()-30*86400000).toISOString().slice(0,10);if(name==='createdDateTo')input.value=today();wrap.append(input);form.append(wrap);}
  form.append(button('Apply filters',()=>{page=1;load();},true),button('Clear',()=>{form.reset();page=1;load();}));form.onsubmit=e=>{e.preventDefault();page=1;load();};
  if(A1Data.isAdmin())form.append(button('All filters',()=>openAction(groups.find(g=>g[0]===group)?.[1]||'accountGet')));
  form.append(el('p',mode==='cached'?'Synced snapshot. Refresh live availability before quoting or selling.':'Records load through the saved Skybox connection. Account permissions apply to every action.'));filters.append(form);
  const content=el('div',undefined,'ticket-content');content.append(Object.assign(el('div',undefined,'ticket-summary'),{id:'ticketSummary'}),Object.assign(el('p','','ticket-message'),{id:'ticketMessage'}),Object.assign(el('div',undefined,'ticket-grid-wrap'),{id:'ticketGrid'}),Object.assign(el('div',undefined,'ticket-pagination'),{id:'ticketPages'}));layout.append(filters,content);shell.append(layout);root.append(shell);
  if(!$('ticketDialog')){const dialog=el('dialog',undefined,'ticket-dialog');dialog.id='ticketDialog';dialog.setAttribute('aria-labelledby','ticketDialogTitle');dialog.addEventListener('close',()=>{modalEpoch++;pending=null;dialog.replaceChildren();});document.body.append(dialog);}
 }
 function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
 async function open(){const current=++epoch;if(!A1Data.canAccess('ticketUI'))return;try{mode=A1Data.isAdmin()?'live':'cached';group='Inventory';page=1;if(A1Data.isAdmin()){const r=await request({action:'catalog'});if(current!==epoch)return;catalog=r.catalog;}build();await load();}catch(e){if(current!==epoch)return;build();message(e.message,true);}}
 async function select(name){epoch++;group=name;page=1;if(group!=='Inventory')mode='live';build();await load();}
 function getFilters(){const values=Object.fromEntries(new FormData($('ticketSearch')));return Object.fromEntries(Object.entries(values).filter(([,v])=>v!==''));}
 async function load(){
  const current=++epoch;message('Loading '+group.toLowerCase()+'…');$('ticketGrid').replaceChildren();$('ticketSummary').replaceChildren();$('ticketPages').replaceChildren();
  try{const filters=getFilters();let r,localPaging=false;
   if(mode==='cached'&&group==='Inventory'){const query=Object.values(filters).filter(v=>!/^\d{4}-\d{2}-\d{2}$/.test(v)).join(' ');r=await A1Data.skyboxRequest({action:'inventory',query,page:Math.floor(((page-1)*pageSize)/50)});const offset=((page-1)*pageSize)%50;r={data:{rows:r.rows.slice(offset,offset+pageSize),rowCount:r.total},snapshot:r.completedAt};}
   else{const operation=groups.find(g=>g[0]===group)[1],op=catalog.operations[operation],parameters={};const pmap=new Map(op.parameters.map(p=>[p.name,p]));for(const [name,value]of Object.entries(filters)){if(!pmap.has(name))continue;const s=schema(pmap.get(name).schema);parameters[name]=s.type==='array'?value.split(',').map(v=>v.trim()):name.includes('Date')?value+'T'+(name.endsWith('To')?'23:59:59':'00:00:00'):value;}
    localPaging=!pmap.has('pageNumber');if(pmap.has('limit')&&!localPaging)parameters.limit=pageSize;if(pmap.has('pageNumber'))parameters.pageNumber=page;
    if(pmap.has('sortedBy')){const options=schema(pmap.get('sortedBy').schema).enum||[];const desired=group==='Inventory'?'EVENT_DATE':group==='Vendors'?'DISPLAY_NAME':'ID';if(options.includes(desired))parameters.sortedBy=desired;}if(pmap.has('sortDir'))parameters.sortDir=group==='Inventory'?'ASC':'DESC';
    r=await request({action:'read',operation,parameters});
   }
   if(current!==epoch)return;rows=Array.isArray(r.data)?r.data:Array.isArray(r.data?.rows)?r.data.rows:r.data?[r.data]:[];total=r.data?.rowCount??rows.length;if(localPaging){total=rows.length;rows=rows.slice((page-1)*pageSize,page*pageSize);}const lastPage=Math.max(1,Math.ceil(total/pageSize));if(page>lastPage){page=lastPage;return load();}
   renderRows();message(mode==='cached'?`Synced inventory · Last full refresh: ${r.snapshot?new Date(r.snapshot).toLocaleString():'Pending'}`:'Loaded from Skybox · '+new Date().toLocaleTimeString());
  }catch(e){if(current===epoch){message(e.message,true);if(group==='Inventory'&&mode==='live')$('ticketGrid').append(button('Show synced inventory',()=>{mode='cached';page=1;build();load();}));}}
 }
 function eventOf(r){return r.event||{name:r.eventName,date:r.eventDate,venue:{name:r.venue,city:r.city,state:r.state}};}
 function renderRows(){
  const wrap=$('ticketGrid');wrap.replaceChildren();let count=rows.length,qty=rows.reduce((s,r)=>s+(Number(r.quantity)||0),0);$('ticketSummary').replaceChildren(el('span',`${total.toLocaleString()} results`),el('span',`${count} on this page`));if(group==='Inventory')$('ticketSummary').append(el('span',`${qty} tickets on this page`));
  if(!rows.length)wrap.append(el('div','No records match these filters.','ticket-empty'));
  else{const table=el('table',undefined,'ticket-grid'),head=el('thead'),tr=el('tr');
   const columns=group==='Inventory'?['Listing','Qty','Section','Row','Seats','Cost / ticket','List / ticket','Status','Broadcast','Actions']:group==='Invoices'||group==='Purchases'?['ID','Name','Created','Total','Balance','Payment','Fulfillment','Actions']:group==='Customers'||group==='Vendors'?['ID','Name','Company','Email','Phone','Balance','Actions']:['Record','Details','Actions'];
   columns.forEach(c=>tr.append(el('th',c)));head.append(tr);table.append(head);const body=el('tbody');let previous='';
   for(const r of rows){const e=eventOf(r);if(group==='Inventory'){const key=String(e.id||r.eventId||e.name);if(key!==previous){const g=el('tr',undefined,'ticket-event-row'),td=el('td');td.colSpan=columns.length;td.append(document.createTextNode(e.name||'Event '+(r.eventId||'—')),el('small',[e.date,e.venue?.name,e.venue?.city,e.venue?.state].filter(Boolean).join(' · ')));if(A1Data.isAdmin()||e.chartUrl)td.append(button('Open seat map',()=>seatMap(r)));g.append(td);body.append(g);previous=key;}}
    const row=el('tr'),values=group==='Inventory'?[r.id,r.quantity,r.section,r.row,r.seatNumbers||r.seats||[r.lowSeat,r.highSeat].filter(v=>v!=null).join('–'),currency(r.unitCostAverage??r.costAverage,r.currencyCode),currency(r.listPrice,r.listPriceCurrencyCode||r.currency),r.status,typeof r.broadcast==='boolean'?(r.broadcast?'On':'Off'):'Unavailable']:group==='Invoices'||group==='Purchases'?[r.id,r.displayName||r.customer?.displayName||r.vendor?.displayName,r.createdDate,currency(r.total,r.currencyCode),currency(r.outstandingBalance,r.currencyCode),r.paymentStatus,r.fulfillmentStatus||r.status]:group==='Customers'||group==='Vendors'?[r.id,r.displayName,r.company,r.email,r.address?.phone1,currency(r.outstandingBalance)]:[r.name||r.displayName||r.id||'Record',r.description||r.status||'View record'];
    values.forEach((v,i)=>{const td=el('td');if(i===0){const b=button(String(v??'—'),()=>detail(r));b.className='ticket-link';td.append(b);}else td.textContent=v==null||v===''?'—':String(v);row.append(td);});
    const actions=el('td'),buttons=el('div',undefined,'ticket-row-actions');buttons.append(button('View',()=>detail(r)));
    if(group==='Events')buttons.append(button('Seat map',()=>seatMap(r)));
    if(A1Data.isAdmin()&&mode==='live'){
     if(group==='Inventory'){buttons.append(button(typeof r.broadcast==='boolean'?(r.broadcast?'Turn broadcast off':'Turn broadcast on'):'Set broadcast',()=>broadcastListing(r)),button('Edit',()=>editListing(r)),button('Sell',()=>sell(r)),button('Hold',()=>openAction('holdsInsert',{}, {inventoryId:r.id,quantity:r.quantity})));}
     else if(group==='Invoices'||group==='Purchases'){const prefix=group.toLowerCase(),param=group==='Invoices'?'invoice-id':'purchase-id';buttons.append(button('Lines',()=>openAction(group==='Invoices'?'invoicesGetInvoiceLines':'purchasesGetPurchaseLines',{[param]:r.id})),button('Send',()=>openAction(prefix+'Send',{[param]:r.id})));}
     else if(group==='Customers'||group==='Vendors'){const param=group==='Customers'?'customer-id':'vendor-id';buttons.append(button('Edit',()=>openAction(group==='Customers'?'customersUpdate':'vendorsUpdate',{[param]:r.id},r)));}
    }
    actions.append(buttons);row.append(actions);body.append(row);
   }table.append(body);wrap.append(table);
  }
  renderPagination();
 }
 function renderPagination(){
  const pager=$('ticketPages'),pages=Math.max(1,Math.ceil(total/pageSize));
  const first=total?(page-1)*pageSize+1:0,last=total?Math.min((page-1)*pageSize+rows.length,total):0;
  pager.replaceChildren(el('span',`Showing ${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()} ${group==='Inventory'?'listings':'records'} · Page ${page} of ${pages}`));
  const sizeLabel=el('label','Rows per page'),size=el('select');size.setAttribute('aria-label','Rows per page');
  for(const n of mode==='cached'?[10,25,50]:[10,25,50,100])size.append(new Option(String(n),String(n)));size.value=String(pageSize);size.onchange=()=>{pageSize=Number(size.value);page=1;load();};sizeLabel.append(size);pager.append(sizeLabel);
  const go=target=>{page=Math.min(pages,Math.max(1,target));load();};
  const prev=button('‹ Previous',()=>go(page-1));prev.disabled=page<=1;pager.append(prev);
  const numbers=[...new Set([1,pages,page-1,page,page+1].filter(n=>n>=1&&n<=pages))].sort((a,b)=>a-b);let previous=0;
  for(const n of numbers){if(previous&&n>previous+1)pager.append(el('span','…','ticket-page-gap'));const b=button(String(n),()=>go(n));b.setAttribute('aria-label','Page '+n);if(n===page)b.setAttribute('aria-current','page');pager.append(b);previous=n;}
  const next=button('Next ›',()=>go(page+1));next.disabled=page>=pages;pager.append(next);
  if(pages>1){const jump=el('form',undefined,'ticket-page-jump'),input=el('input');input.type='number';input.min='1';input.max=String(pages);input.step='1';input.required=true;input.value=String(page);input.setAttribute('aria-label','Go to page');jump.append(input,button('Go',()=>jump.requestSubmit()));jump.onsubmit=event=>{event.preventDefault();const target=Number(input.value);if(Number.isInteger(target)&&target>=1&&target<=pages)go(target);};pager.append(jump);}

 }
 function showDialog(name,description=''){
  const dialog=$('ticketDialog');modalEpoch++;pending=null;dialog.replaceChildren();const head=el('div',undefined,'ticket-dialog-head'),heading=el('h3',name);heading.id='ticketDialogTitle';head.append(heading,button('×',()=>dialog.close()));head.lastChild.className='ticket-close';head.lastChild.setAttribute('aria-label','Close');const body=el('div',undefined,'ticket-dialog-body');if(description)body.append(el('p',description,'ticket-help'));const foot=el('div',undefined,'ticket-dialog-foot');dialog.append(head,body,foot);if(!dialog.open)dialog.showModal();return {dialog,body,foot,current:modalEpoch};
 }
 function describe(value,depth=0,expanded=false){if(value==null)return el('span','—');if(typeof value!=='object')return el('span',String(value));if(depth>8)return el('span','More nested details available in Skybox.');
  const dl=el('dl',undefined,'ticket-detail');for(const [key,v]of Object.entries(value)){const dt=el('dt',label(key)),dd=el('dd');if(v&&typeof v==='object'){const d=el('details');d.open=expanded&&depth<4;d.append(el('summary',Array.isArray(v)?v.length+' items':'View details'),describe(v,depth+1,expanded));dd.append(d);}else dd.textContent=v==null?'—':key==='broadcast'&&typeof v==='boolean'?(v?'On':'Off'):String(v);dl.append(dt,dd);}return dl;
 }
 async function detail(row){
  const view=showDialog((group==='Inventory'?'Listing #':group.replace(/s$/,'')+' #')+(row.id||''));view.body.append(describe(row));view.foot.append(button('Close',()=>view.dialog.close()));
  if(A1Data.isAdmin()&&mode==='live'){
   const op={Inventory:['inventoryGetById','inventory-id'],Invoices:['invoicesGetInvoiceById','invoice-id'],Purchases:['purchasesGetPurchaseById','purchase-id'],Customers:['customersGetById','customer-id'],Vendors:['vendorsGetById','vendor-id'],Holds:['holdsGetById','hold-id'],Events:['eventsGet','event-id']}[group];
   if(op)try{const r=await request({action:'read',operation:op[0],parameters:{[op[1]]:row.id}});if(view.current!==modalEpoch)return;view.body.replaceChildren(describe(r.data));}catch(e){if(view.current===modalEpoch)view.body.prepend(el('p',e.message,'ticket-error'));}
  }
 }
 function mapURL(value){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!A1Data.linkBlocked?.(url.href)?url.href:null;}catch{return null;}}
 async function seatMap(row){
  const event=group==='Events'?row:eventOf(row),view=showDialog('Seat map · '+(event.name||'Event '+(event.id||row.eventId||'')));
  view.body.append(el('p','Loading the event seating map…','ticket-help'));view.foot.append(button('Close',()=>view.dialog.close()));
  try{
   let details=event;
   if(!details.chartUrl&&A1Data.isAdmin()){
    const id=Number(event.id||row.eventId);if(!Number.isSafeInteger(id)||id<1)throw Error('This listing has no event ID for a seating map.');
    const response=await request({action:'read',operation:'eventsGet',parameters:{'event-id':id}});if(view.current!==modalEpoch)return;details=response.data||{};
   }
   if(view.current!==modalEpoch)return;view.body.replaceChildren();
   const url=mapURL(details.chartUrl);
   if(url){
    const link=el('a','Open full-size seat map','btn');link.href=url;link.target='_blank';link.rel='noopener noreferrer';view.body.append(link);
    const img=el('img',undefined,'ticket-seat-map');img.alt=(details.name||event.name||'Event')+' seating map';img.src=url;img.onerror=()=>{img.remove();view.body.append(el('p','The map preview could not load. Try the full-size map link above.','ticket-help'));};view.body.append(img);
   }else{
    view.body.append(el('p','Skybox has not supplied an available seating-map link for this event.','ticket-help'));
    const eventURL=mapURL(details.vividSeatsEventUrl);if(eventURL){const link=el('a','View event on Vivid Seats','btn');link.href=eventURL;link.target='_blank';link.rel='noopener noreferrer';view.body.append(link);}
   }
  }catch(e){if(view.current===modalEpoch)view.body.replaceChildren(el('p',e.message,'ticket-error'));}
 }
 async function broadcastListing(row){
  const current=epoch;
  try{
   message('Checking the current broadcast setting…');
   const response=await request({action:'read',operation:'inventoryGetById',parameters:{'inventory-id':row.id}});
   if(current!==epoch)return;
   const listing=response.data;
   if(!listing||String(listing.id)!==String(row.id))throw Error('Skybox did not return the requested listing. Refresh inventory and try again.');
   if(typeof listing.broadcast!=='boolean')throw Error('Skybox did not return a broadcast setting for this listing. Open Edit to choose the setting explicitly.');
   // Change only broadcasting: preserve price, quantity, seats, and other listing fields.
   openAction('inventoryBulkUpdate',{}, {inventoryIds:[Number(listing.id)],broadcast:!listing.broadcast});
   $('ticketDialogTitle').textContent='Turn broadcast '+(listing.broadcast?'off':'on')+' · Listing #'+listing.id;
   message('');
  }catch(e){if(current===epoch)message(e.message,true);}
 }
 async function editListing(row){const current=epoch;try{message('Loading the current listing…');const r=await request({action:'read',operation:'inventoryGetById',parameters:{'inventory-id':row.id}});if(current!==epoch)return;const b={};for(const k of preferred.Inventory)if(r.data[k]!==undefined)b[k]=r.data[k];openAction('inventoryUpdate',{'inventory-id':row.id},b);message('');}catch(e){message(e.message,true);}}
 async function sell(row){const current=epoch;try{message('Checking available tickets…');const r=await request({action:'read',operation:'inventoryGetTicketsById',parameters:{'inventory-id':row.id}});if(current!==epoch)return;const tickets=(Array.isArray(r.data)?r.data:r.data?.rows||[]).filter(t=>t.status==='AVAILABLE');if(!tickets.length)throw Error('No available tickets were returned. Refresh the listing before selling.');openAction('invoicesInsertInvoice',{}, {lines:[{quantity:tickets.length,amount:Math.round((Number(row.listPrice)||0)*tickets.length*100)/100,lineItemType:'INVENTORY',itemIds:tickets.map(t=>t.id)}]});message('');}catch(e){message(e.message,true);}}
 // Fields are generated from Skybox's typed contract. Optional fields are added explicitly.
 function field(spec,value,name,required=false,depth=0){
  let s=schema(spec);const ref=spec?.$ref?.split('/').pop();if(ref==='Invoice')s={...s,required:[...(s.required||[]),'customerId','lines']};if(ref==='Purchase')s={...s,required:[...(s.required||[]),'vendorId','lines']};const type=s.type||(s.properties?'object':'string');
  if(depth>12)throw Error('Form nesting limit reached');
  if(type==='object'&&value===undefined&&!required){const container=el('div',undefined,'ticket-fieldset');let nested;const add=button('Add '+label(name)+' details',()=>{nested=field(spec,{},name,true,depth+1);container.replaceChildren(nested.node);});container.append(add);return {node:container,read:()=>nested?.read()};}
  if(type==='object'){
   const fieldset=el('fieldset',undefined,'ticket-fieldset');if(name)fieldset.append(el('legend',label(name)));const grid=el('div',undefined,'ticket-form-grid');fieldset.append(grid);const fields=new Map(),props=s.properties||{};
   const add=k=>{if(fields.has(k)||!props[k]||k==='accountId'||schema(props[k]).readOnly)return;const f=field(props[k],value?.[k],k,(s.required||[]).includes(k),depth+1);fields.set(k,f);grid.insertBefore(f.node,extra);update();};
   const extra=el('div',undefined,'ticket-field-add'),choose=el('select');choose.setAttribute('aria-label','Add '+(name?label(name)+' ':'')+'field');const addButton=button('Add field',()=>{if(choose.value)add(choose.value);});extra.append(choose,addButton);grid.append(extra);
   const update=()=>{choose.replaceChildren(new Option('Additional field…',''));for(const k of Object.keys(props))if(!fields.has(k)&&k!=='accountId'&&!schema(props[k]).readOnly)choose.append(new Option(label(k),k));extra.hidden=choose.options.length<2;};
   const keys=new Set([...(s.required||[]),...(preferred[ref]||[]),...Object.keys(value||{})]);if(!keys.size)Object.keys(props).slice(0,6).forEach(k=>keys.add(k));for(const k of keys)add(k);update();
   return {node:fieldset,read:()=>{const out={};for(const[k,f]of fields){const v=f.read();if(v!==undefined)out[k]=v;}return Object.keys(out).length||required?out:undefined;}};
  }
  if(type==='array'){
   const fieldset=el('fieldset',undefined,'ticket-fieldset');fieldset.append(el('legend',label(name)+(required?' *':'')));const items=el('div');fieldset.append(items);const readers=[];
   const add=v=>{const wrap=el('div',undefined,'ticket-array-item'),f=field(s.items,v,'Item',true,depth+1);const entry={f,wrap};readers.push(entry);wrap.append(f.node,button('Remove',()=>{readers.splice(readers.indexOf(entry),1);wrap.remove();}));items.append(wrap);};(value||[]).forEach(add);fieldset.append(button('Add item',()=>add(undefined)));return {node:fieldset,read:()=>readers.length?readers.map(r=>r.f.read()):required?[]:undefined};
  }
  const wrap=el('label',label(name)+(required?' *':''));let input;
  if(s.enum||type==='boolean'){input=el('select');input.append(new Option('Select…',''));for(const v of s.enum||(type==='boolean'?[true,false]:[]))input.append(new Option(type==='boolean'?(name==='broadcast'?(v?'On':'Off'):(v?'Yes':'No')):label(v),String(v)));}
  else{input=el('input');input.type=type==='integer'||type==='number'?'number':s.format==='date-time'?'datetime-local':s.format==='date'?'date':/password|cardNumber|cvv|securityCode|secret|token/i.test(name)?'password':'text';if(type==='number')input.step='any';if(type==='integer')input.step='1';if(s.minimum!==undefined)input.min=s.minimum;if(s.maximum!==undefined)input.max=s.maximum;if(s.maxLength)input.maxLength=s.maxLength;}
  input.required=required;input.setAttribute('aria-label',label(name));if(s.description)input.title=s.description;
  if(value!==undefined&&value!==null)input.value=s.format==='date-time'?String(value).slice(0,19):String(value);wrap.append(input);
  if(s.format==='byte'||/base64FileBytes/.test(name)){const upload=el('input');upload.type='file';upload.accept='application/pdf';upload.setAttribute('aria-label','Upload PDF');upload.onchange=()=>{const file=upload.files[0];if(!file)return;if(file.size>5000000){upload.value='';return;}const reader=new FileReader();reader.onload=()=>{input.value=String(reader.result).split(',')[1];};reader.readAsDataURL(file);};wrap.append(upload);}
  return {node:wrap,read:()=>{const v=input.value;if(v===''){if(required)throw Error(label(name)+' is required');return undefined;}if(type==='integer'||type==='number')return Number(v);if(type==='boolean')return v==='true';return v;}};
 }
 async function openAction(id,parameters={},bodyValue){
  const op=catalog?.operations[id];if(!op)return message('This action is unavailable.',true);const view=showDialog(title(op),op.description),form=el('form');form.id='ticketActionForm';const grid=el('div',undefined,'ticket-form-grid'),paramFields=new Map();
  for(const p of op.parameters){const f=field(p.schema,parameters[p.name],p.name,!!p.required);paramFields.set(p.name,f);grid.append(f.node);}form.append(grid);let bodyField;
  if(op.body){bodyField=field(op.body,bodyValue,'Details',op.bodyRequired);form.append(bodyField.node);}
  const status=el('p','','ticket-help');status.setAttribute('role','status');const result=el('div');view.body.append(form,status,result);const submit=button(op.changes?'Review changes':'Search',()=>form.requestSubmit(),op.changes);view.foot.append(button('Cancel',()=>view.dialog.close()),submit);
  form.onsubmit=async event=>{event.preventDefault();if(busy)return;let payload;try{payload={operation:id,parameters:{}};for(const [k,f]of paramFields){const v=f.read();if(v!==undefined)payload.parameters[k]=v;}if(bodyField){const value=bodyField.read();if(value!==undefined)payload.body=value;}}catch(e){status.textContent=e.message;return;}
   busy=true;submit.disabled=true;status.textContent=op.changes?'Preparing review…':'Loading…';try{const r=await request({action:op.changes?'preview':'read',...payload});if(view.current!==modalEpoch)return;status.textContent='';result.replaceChildren();
    if(op.changes){pending={payload,confirmation:r.confirmation};form.hidden=true;submit.hidden=true;result.className='ticket-review';result.append(el('h4','Review before submitting'),el('p','This action will be sent to your Skybox account. Review the record IDs, quantities, and amounts below.'),describe({action:title(op),parameters:payload.parameters,details:payload.body},0,true));const confirm=button('Confirm and submit to Skybox',async()=>{
      if(busy||!pending)return;busy=true;confirm.disabled=true;status.textContent='Submitting once…';const submission=pending;pending=null;
      try{const outcome=await request({action:'execute',...submission.payload,confirmation:submission.confirmation});if(view.current!==modalEpoch)return;result.replaceChildren(el('h4','Skybox confirmed the action'),describe(outcome.data));status.textContent='Refresh the workspace to see the latest record. Automatic sync will reconcile dashboard records.';confirm.remove();handleDownload(outcome,result);}
      catch(e){if(view.current===modalEpoch){status.textContent=e.message;confirm.remove();}}finally{busy=false;}
     },true);view.foot.append(confirm);
    }else{result.append(describe(r.data));handleDownload(r,result);}
   }catch(e){if(view.current===modalEpoch)status.textContent=e.message;}finally{busy=false;submit.disabled=false;}
  };
 }
 function handleDownload(r,target){if(!r.download)return;const bytes=Uint8Array.from(atob(r.download.base64),c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:r.download.type}));downloadUrls.push(url);const a=el('a','Download file','btn');a.href=url;a.download='skybox-'+Date.now()+(r.download.type==='application/pdf'?'.pdf':r.download.type==='text/csv'?'.csv':'.bin');target.append(a);}
 window.A1TicketUI={open,load,select,openAction,clear};window.addEventListener('a1-signed-out',clear);window.addEventListener('a1-access-changed',clear);
})();
