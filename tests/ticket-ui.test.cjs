const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const load=async()=>Promise.all([import('../supabase/functions/a1-ticket-ui/handler.mjs'),import('../supabase/functions/a1-ticket-ui/catalog.mjs'),import('../supabase/functions/a1-ticket-ui/contract.mjs')]);
async function setup({admin=true,providerStatus=200,providerError=false}={}){
 const [{createHandler}]=await load(),calls=[],ledger=new Set();const token='header.'+btoa(JSON.stringify({session_id:'session'}))+'.signature';
 const fetchImpl=async(url,options)=>{url=String(url);calls.push({url,options});if(url.endsWith('/auth/v1/user'))return Response.json({id:'actor'});
 if(url.includes('a1_ticket_ui_service')){const r=JSON.parse(options.body);if(!admin)return Response.json({}, {status:403});if(r.p_action==='connection')return Response.json({accountId:'123',applicationToken:'SYNTHETIC-APP',apiToken:'SYNTHETIC-API'});if(r.p_action==='begin'){if(ledger.has(r.p_input.id))return Response.json(false);ledger.add(r.p_input.id);return Response.json(true);}return Response.json({});}
 if(url.includes('reserve_request'))return Response.json({reserved:true,waitMs:0});
 if(url.startsWith('https://skybox.vividseats.com/services')){if(providerError)throw Error('network');return Response.json({id:777,rows:[],rowCount:0,applicationToken:'SYNTHETIC-APP'},{status:providerStatus});}throw Error(url);};
 const handler=createHandler({env:n=>({SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'SYNTHETIC-SERVICE',SUPABASE_ANON_KEY:'SYNTHETIC-ANON'})[n],fetchImpl});
 const request=(body,origin='https://a1dash.a1eei.com')=>handler(new Request('https://fixture/ticket-ui',{method:'POST',headers:{origin,Authorization:'Bearer '+token},body:JSON.stringify(body)}));return {request,calls,ledger};
}
test('Ticket UI denies nonadmins, unapproved origins and unknown operations before reaching Skybox',async()=>{
 const a=await setup({admin:false});assert.equal((await a.request({action:'catalog'})).status,403);assert.equal(a.calls.filter(c=>c.url.includes('skybox.vividseats.com')).length,0);
 const b=await setup();assert.equal((await b.request({action:'catalog'},'https://evil.invalid')).status,403);assert.equal(b.calls.length,0);assert.equal((await b.request({action:'read',operation:'notInContract'})).status,400);
});
test('Skybox changes require a signed review and cannot be replayed or changed',async()=>{
 const {request,calls}=await setup();const p={operation:'holdsInsert',body:{inventoryId:777,quantity:2,expiryDate:'2026-11-11T12:00:00'}};
 assert.equal((await request({action:'read',...p})).status,400);const preview=await(await request({action:'preview',...p})).json();assert.ok(preview.confirmation.signature);assert.equal(calls.filter(c=>c.url.includes('skybox.vividseats.com')).length,0);
 assert.equal((await request({action:'execute',...p,body:{...p.body,quantity:3},confirmation:preview.confirmation})).status,409);
 const result=await request({action:'execute',...p,confirmation:preview.confirmation});assert.equal(result.status,200);assert.doesNotMatch(JSON.stringify(await result.json()),/SYNTHETIC/);
 assert.equal((await request({action:'execute',...p,confirmation:preview.confirmation})).status,409);assert.equal(calls.filter(c=>c.url.includes('skybox.vividseats.com')).length,1);
});
test('GET send operations require confirmation; timeouts and provider errors are never retried',async()=>{
 for(const opts of [{providerError:true},{providerStatus:500}]){const {request,calls}=await setup(opts),p={operation:'invoicesSend',parameters:{'invoice-id':123,emailAddress:['fixture@example.invalid']}};assert.equal((await request({action:'read',...p})).status,400);const preview=await(await request({action:'preview',...p})).json();const r=await request({action:'execute',...p,confirmation:preview.confirmation});assert.ok(r.status>=500);assert.equal(calls.filter(c=>c.url.includes('skybox.vividseats.com')).length,1);assert.equal((await request({action:'execute',...p,confirmation:preview.confirmation})).status,409);}
});
test('contract validation rejects arbitrary URLs, query keys, invalid enums, traversal, cross-account values and populates accountId',async()=>{
 const [,,{buildRequest}]=await load();assert.throws(()=>buildRequest({operation:'inventorySearch',parameters:{url:'https://evil.invalid'}},'123'),/Unknown filter/);assert.throws(()=>buildRequest({operation:'inventorySearch',parameters:{sortedBy:'wrong'}},'123'),/invalid selection/);assert.throws(()=>buildRequest({operation:'assetsGet',parameters:{filename:'..'}},'123'),/Invalid record/);assert.throws(()=>buildRequest({operation:'invoicesInsertInvoice',body:{accountId:999}},'123'),/mismatch/);
 const r=buildRequest({operation:'invoicesInsertInvoice',body:{customerId:1,lines:[{lineItemType:'INVENTORY',amount:120,itemIds:[1]}]}},'123');assert.equal(r.body.lines[0].accountId,123);
});
function browser(catalog,{admin=true,broadcast=true,currentBroadcast=broadcast,total=1,chartUrl='https://maps.example.invalid/event-1.svg'}={}){
 const dom=new JSDOM('<section id="ticketUI"></section>',{url:'https://a1dash.a1eei.com',runScripts:'outside-only'}),w=dom.window,calls=[];w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 const row={id:777,eventId:1,eventName:'<img src=x onerror=alert(1)>',eventDate:'2026-12-01',broadcast,quantity:2,listPrice:100,section:'101',row:'A',status:'AVAILABLE'};
 w.A1Data={isAdmin:()=>admin,canAccess:()=>true,skyboxRequest:async p=>{calls.push(p);return {rows:[row],total};},ticketRequest:async p=>{calls.push(p);if(p.action==='catalog')return {catalog};if(p.operation==='inventoryGetById')return {data:{...row,broadcast:currentBroadcast}};if(p.operation==='eventsGet')return {data:{id:1,name:'Fixture event',chartUrl}};return {data:{rows:[row],rowCount:total}};}};w.eval(fs.readFileSync('venue-links.js','utf8'));w.eval(fs.readFileSync('ticket-ui.js','utf8'));return {w,calls};
}
test('Ticket UI uses safe dense tables, offers native actions, and clears private records on signout',async()=>{const [,{catalog}]=await load();const {w,calls}=browser(catalog);await w.A1TicketUI.open();assert.equal(w.document.querySelectorAll('.ticket-grid tbody tr').length,2);assert.equal(w.document.querySelectorAll('img').length,0);assert.match(w.document.body.textContent,/<img src=x/);assert.ok([...w.document.querySelectorAll('button')].some(b=>b.textContent==='Sell'));await w.A1TicketUI.openAction('invoicesInsertInvoice',{}, {lines:[{amount:100,lineItemType:'INVENTORY',itemIds:[1]}]});assert.ok(w.document.querySelector('input[aria-label="Customer ID"]'));assert.equal(w.document.querySelector('input[aria-label="Event ID"]'),null,'Optional nested inventory must not block invoice creation');w.dispatchEvent(new w.Event('a1-signed-out'));assert.equal(w.document.getElementById('ticketUI').textContent,'');assert.equal(w.document.getElementById('ticketDialog').textContent,'');assert.ok(calls.some(c=>c.action==='read'));w.close();});
test('regular staff keep existing inventory permissions without receiving the admin operation catalog',async()=>{const [,{catalog}]=await load();const {w,calls}=browser(catalog,{admin:false});await w.A1TicketUI.open();assert.deepEqual(calls.map(c=>c.action),['inventory']);assert.equal([...w.document.querySelectorAll('button')].some(b=>b.textContent==='Sell'),false);w.close();});

test('broadcast row controls refresh current state and preview a broadcast-only change in both directions',async()=>{
 const [,{catalog}]=await load();
 for(const broadcast of [true,false]){
  const {w,calls}=browser(catalog,{broadcast});await w.A1TicketUI.open();
  assert.ok([...w.document.querySelectorAll('th')].some(n=>n.textContent==='Broadcast'));
  const button=[...w.document.querySelectorAll('button')].find(n=>n.textContent===(broadcast?'Turn broadcast off':'Turn broadcast on'));assert.ok(button);
  await button.onclick();
  const select=w.document.querySelector('select[aria-label="Broadcast"]');assert.ok(select);assert.equal(select.value,String(!broadcast));
  w.document.getElementById('ticketActionForm').requestSubmit();await new Promise(resolve=>setImmediate(resolve));
  const preview=calls.find(c=>c.action==='preview');assert.equal(preview.operation,'inventoryBulkUpdate');assert.equal(preview.body.broadcast,!broadcast);assert.deepEqual(Array.from(preview.body.inventoryIds),[777]);assert.deepEqual(Object.keys(preview.body).sort(),['broadcast','inventoryIds']);assert.equal(calls.some(c=>c.action==='execute'),false);
  w.close();
 }
});
test('broadcast controls use fresh Skybox state and refuse missing status instead of guessing',async()=>{
 const [,{catalog}]=await load();
 const {w}=browser(catalog,{broadcast:true,currentBroadcast:false});await w.A1TicketUI.open();await [...w.document.querySelectorAll('button')].find(n=>n.textContent==='Turn broadcast off').onclick();assert.equal(w.document.querySelector('select[aria-label="Broadcast"]').value,'true');w.close();
 const missing=browser(catalog,{broadcast:true,currentBroadcast:null});await missing.w.A1TicketUI.open();await [...missing.w.document.querySelectorAll('button')].find(n=>n.textContent==='Turn broadcast off').onclick();assert.match(missing.w.document.getElementById('ticketMessage').textContent,/did not return a broadcast setting/);assert.equal(missing.calls.some(c=>c.action==='preview'||c.action==='execute'),false);missing.w.close();
});

test('rows per page, numbered pages and direct jumps request the correct live Skybox page',async()=>{
 const [,{catalog}]=await load();const {w,calls}=browser(catalog,{total:240});await w.A1TicketUI.open();
 const size=w.document.querySelector('select[aria-label="Rows per page"]');assert.deepEqual([...size.options].map(o=>o.value),['10','25','50','100']);
 size.value='25';size.dispatchEvent(new w.Event('change'));await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.at(-1).parameters.limit,25);assert.equal(calls.at(-1).parameters.pageNumber,1);assert.match(w.document.getElementById('ticketPages').textContent,/Page 1 of 10/);
 const page3=w.document.querySelector('button[aria-label="Page 10"]');assert.ok(page3);page3.click();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.at(-1).parameters.pageNumber,10);assert.equal(w.document.querySelector('button[aria-label="Page 10"]').getAttribute('aria-current'),'page');assert.equal([...w.document.querySelectorAll('button')].find(b=>b.textContent==='Next ›').disabled,true);
 const jump=w.document.querySelector('input[aria-label="Go to page"]');jump.value='4';jump.form.requestSubmit();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.at(-1).parameters.pageNumber,4);
 w.document.getElementById('ticketSearch').requestSubmit();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.at(-1).parameters.pageNumber,1);w.close();
});
test('synced inventory page sizes map to the correct fixed-size backend page',async()=>{
 const [,{catalog}]=await load();const {w,calls}=browser(catalog,{admin:false,total:240});await w.A1TicketUI.open();
 const size=w.document.querySelector('select[aria-label="Rows per page"]');assert.deepEqual([...size.options].map(o=>o.value),['10','25','50']);size.value='25';size.dispatchEvent(new w.Event('change'));await new Promise(resolve=>setImmediate(resolve));
 const jump=w.document.querySelector('input[aria-label="Go to page"]');jump.value='3';jump.form.requestSubmit();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.at(-1).page,1);w.close();
});

test('event seat-map action loads the documented chart link and opens a safe native map viewer',async()=>{
 const [,{catalog}]=await load();const {w,calls}=browser(catalog);await w.A1TicketUI.open();const button=[...w.document.querySelectorAll('button')].find(b=>b.textContent==='Open seat map');assert.ok(button);await button.onclick();
 assert.equal(calls.at(-1).operation,'eventsGet');assert.equal(calls.at(-1).parameters['event-id'],1);
 const img=w.document.querySelector('.ticket-seat-map'),link=w.document.querySelector('#ticketDialog a[href="https://maps.example.invalid/event-1.svg"]');assert.equal(img.src,'https://maps.example.invalid/event-1.svg');assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');assert.equal(w.document.querySelectorAll('#ticketDialog iframe').length,0);w.dispatchEvent(new w.Event('a1-signed-out'));assert.equal(w.document.querySelector('.ticket-seat-map'),null);w.close();
});
test('missing and unsafe seat-map URLs show an explanation instead of opening an invalid map',async()=>{
 const [,{catalog}]=await load();for(const chartUrl of [null,'javascript:alert(1)','http://maps.example.invalid/chart']){const {w}=browser(catalog,{chartUrl});await w.A1TicketUI.open();await [...w.document.querySelectorAll('button')].find(b=>b.textContent==='Open seat map').onclick();assert.equal(w.document.querySelector('#ticketDialog img'),null);assert.equal(w.document.querySelector('#ticketDialog a[href^="javascript:"]'),null);assert.match(w.document.getElementById('ticketDialog').textContent,/has not supplied/);w.close();}
});

test('missing Skybox charts search external providers by event date and venue city, then show user-selected charts',async()=>{
 const [,{catalog}]=await load();const {w}=browser(catalog,{chartUrl:null});let input;
 w.A1Data.assistantRequest=async p=>{input=p;return {events:{events:[{name:'Fixture event',date:'2026-12-01',time:'19:00',venue:'Fixture Arena',city:'Miami',seatMapUrl:'https://maps.ticketmaster.com/fixture',seatMapSource:'Ticketmaster',offers:[{source:'SeatGeek',url:'https://seatgeek.com/fixture'}]}]}};};
 await w.A1TicketUI.open();await [...w.document.querySelectorAll('button')].find(b=>b.textContent==='Open seat map').onclick();await new Promise(resolve=>setImmediate(resolve));assert.equal(input.action,'events');assert.equal(input.startDate,'2026-12-01');assert.equal(input.endDate,'2026-12-01');assert.equal(w.document.querySelector('.ticket-seat-map'),null,'Do not automatically substitute a candidate event');
 const link=w.document.querySelector('.ticket-map-result a');assert.equal(link.href,'https://seatgeek.com/fixture');assert.match(link.textContent,/SeatGeek/);
 const choose=[...w.document.querySelectorAll('button')].find(b=>b.textContent==='View Ticketmaster seat map');assert.ok(choose);choose.click();assert.equal(w.document.querySelector('.ticket-seat-map').src,'https://maps.ticketmaster.com/fixture');w.close();
});

test('broadcast lights distinguish on, off, and unknown without relying on color alone',async()=>{
 const [,{catalog}]=await load();for(const [broadcast,cls,text] of [[true,'is-on','On'],[false,'is-off','Off'],[null,'is-unknown','Unknown']]){const {w}=browser(catalog,{broadcast});await w.A1TicketUI.open();const status=w.document.querySelector('.ticket-broadcast');assert.ok(status.classList.contains(cls));assert.equal(status.textContent,text);assert.equal(status.querySelector('.ticket-broadcast-light').getAttribute('aria-hidden'),'true');w.close();}
});
test('sale views send documented Skybox filters and clear back to all inventory',async()=>{
 const [,{catalog}]=await load();const {w,calls}=browser(catalog);await w.A1TicketUI.open();let view=w.document.querySelector('select[aria-label="Inventory view"]');view.value='forSale';view.dispatchEvent(new w.Event('change'));await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.at(-1).parameters.listed,true);assert.deepEqual(Array.from(calls.at(-1).parameters.ticketStatus),['AVAILABLE']);assert.equal(calls.at(-1).parameters.minQuantity,1);assert.equal(calls.at(-1).parameters.pageNumber,1);
 view.value='unlisted';view.dispatchEvent(new w.Event('change'));await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.at(-1).parameters.listed,false);assert.equal(calls.at(-1).parameters.ticketStatus,undefined);
 view.value='all';view.dispatchEvent(new w.Event('change'));await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.at(-1).parameters.listed,undefined);w.close();
 const snapshot=browser(catalog,{admin:false});await snapshot.w.A1TicketUI.open();assert.equal(snapshot.w.document.querySelector('select[aria-label="Inventory view"]').disabled,true);assert.equal(snapshot.calls[0].query,'');snapshot.w.close();
});
test('listing selection persists across pages and prepares only selected IDs for reviewed bulk broadcast',async()=>{
 const [,{catalog}]=await load();const {w,calls}=browser(catalog,{total:100});const original=w.A1Data.ticketRequest;w.A1Data.ticketRequest=async p=>{if(p.operation==='inventorySearch'){calls.push(p);return {data:{rowCount:100,rows:[{id:p.parameters.pageNumber===2?778:777,eventId:1,eventName:'Fixture',quantity:2,broadcast:true}]}};}return original(p);};await w.A1TicketUI.open();
 w.document.querySelector('.ticket-select-listing').click();assert.match(w.document.getElementById('ticketSelectedCount').textContent,/1 listings selected/);
 w.document.querySelector('button[aria-label="Page 2"]').click();await new Promise(resolve=>setImmediate(resolve));w.document.getElementById('ticketSelectPage').click();assert.match(w.document.getElementById('ticketSelectedCount').textContent,/2 listings selected.*4 tickets/);
 const bulk=[...w.document.querySelectorAll('button')].find(b=>b.textContent==='Broadcast selected off');bulk.click();w.document.getElementById('ticketActionForm').requestSubmit();await new Promise(resolve=>setImmediate(resolve));const preview=calls.find(c=>c.action==='preview');assert.deepEqual(Array.from(preview.body.inventoryIds),[777,778]);assert.equal(preview.body.broadcast,false);assert.equal(calls.some(c=>c.action==='execute'),false);
 w.document.getElementById('ticketDialog').close();const view=w.document.querySelector('select[aria-label="Inventory view"]');view.value='forSale';view.dispatchEvent(new w.Event('change'));await new Promise(resolve=>setImmediate(resolve));assert.equal(w.document.getElementById('ticketSelectedCount').textContent,'No listings selected');assert.equal(w.document.querySelector('.ticket-select-listing').checked,false);w.close();
});

test('map viewer always offers Ticketmaster and SeatGeek comparisons even when Skybox has a chart',async()=>{
 const [,{catalog}]=await load();const {w}=browser(catalog);await w.A1TicketUI.open();await [...w.document.querySelectorAll('button')].find(b=>b.textContent==='Open seat map').onclick();
 const options=w.document.querySelector('.ticket-event-options');assert.ok(options);const links=[...options.querySelectorAll('a')];assert.equal(links.length,2);assert.ok(links.some(a=>a.textContent==='Ticketmaster tickets & map'));assert.ok(links.some(a=>a.textContent==='SeatGeek tickets & map'));for(const a of links){assert.equal(a.target,'_blank');assert.equal(a.rel,'noopener noreferrer');assert.equal(a.dataset.a1BrowserTab,'1');}assert.ok(w.document.querySelector('.ticket-seat-map'));w.close();
});
test('verified venue maps appear alongside comparisons and blocked links are omitted',async()=>{
 const [,{catalog}]=await load();const {w}=browser(catalog,{chartUrl:null});const original=w.A1Data.ticketRequest;w.A1Data.assistantRequest=async()=>({events:{events:[]}});w.A1Data.ticketRequest=async p=>p.operation==='eventsGet'?{data:{id:1,name:'Dolphins fixture',venue:{name:'Hard Rock Stadium',state:'FL'}}}:original(p);
 await w.A1TicketUI.open();await [...w.document.querySelectorAll('button')].find(b=>b.textContent==='Open seat map').onclick();assert.ok(w.document.querySelector('a[href="https://miamidolphins.io-media.com/web/index.html"]'));assert.match(w.document.querySelector('.ticket-event-options').textContent,/Football/);
 w.document.getElementById('ticketDialog').close();w.A1Data.linkBlocked=url=>url.includes('io-media.com');await [...w.document.querySelectorAll('button')].find(b=>b.textContent==='Open seat map').onclick();assert.equal(w.document.querySelector('a[href="https://miamidolphins.io-media.com/web/index.html"]'),null);w.dispatchEvent(new w.Event('a1-signed-out'));w.close();
});

test('assistant navigation opens the exact live Skybox record and correct workspace',async()=>{
 const [,{catalog}]=await load();const {w,calls}=browser(catalog);await w.A1TicketUI.open({resource:'invoices',recordId:'123'});assert.equal(w.document.querySelector('.ticket-toolbar h3').textContent,'Invoices');assert.ok(calls.some(c=>c.operation==='invoicesGetInvoiceById'&&c.parameters['invoice-id']===123));assert.equal(calls.some(c=>c.operation==='inventorySearch'),false);assert.equal(w.document.getElementById('ticketDialog').open,true);w.close();
});
test('assistant record navigation cannot open staff live records or load records after signout',async()=>{
 const [,{catalog}]=await load();const {w,calls}=browser(catalog,{admin:false});await w.A1TicketUI.open({resource:'invoices',recordId:'123'});assert.equal(calls.length,0);assert.match(w.document.body.textContent,/administrator/);w.close();
});

test('Ticket UI keyword search finds Dolphins within full event names and retains filters on paging',async()=>{
 const [,{catalog}]=await load(),{w,calls}=browser(catalog,{total:100}),original=w.A1Data.ticketRequest;
 w.A1Data.ticketRequest=async input=>{
  const response=await original(input);if(input.operation==='inventorySearch'){
   if(input.parameters.event)return {data:{rows:[],rowCount:0}};
   if(input.parameters.eventKeywords)response.data.rows[0].eventName='New York Jets at Miami Dolphins';
  }return response;
 };
 await w.A1TicketUI.open();const form=w.document.getElementById('ticketSearch');form.elements.namedItem('event').value='Dolphins';form.requestSubmit();await new Promise(r=>setImmediate(r));
 assert.match(w.document.getElementById('ticketGrid').textContent,/New York Jets at Miami Dolphins/);let p=calls.at(-1).parameters;assert.deepEqual(Array.from(p.eventKeywords),['Dolphins']);assert.equal('event' in p,false);assert.ok(p.eventDateFrom);
 w.document.querySelector('button[aria-label="Page 2"]').click();await new Promise(r=>setImmediate(r));p=calls.at(-1).parameters;assert.equal(p.pageNumber,2);assert.deepEqual(Array.from(p.eventKeywords),['Dolphins']);
 form.elements.namedItem('event').value='';form.requestSubmit();await new Promise(r=>setImmediate(r));assert.equal('eventKeywords' in calls.at(-1).parameters,false);w.close();
});
