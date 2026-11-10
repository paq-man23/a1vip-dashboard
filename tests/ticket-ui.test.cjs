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
 w.A1Data={isAdmin:()=>admin,canAccess:()=>true,skyboxRequest:async p=>{calls.push(p);return {rows:[row],total};},ticketRequest:async p=>{calls.push(p);if(p.action==='catalog')return {catalog};if(p.operation==='inventoryGetById')return {data:{...row,broadcast:currentBroadcast}};if(p.operation==='eventsGet')return {data:{id:1,name:'Fixture event',chartUrl}};return {data:{rows:[row],rowCount:total}};}};w.eval(fs.readFileSync('ticket-ui.js','utf8'));return {w,calls};
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
 const img=w.document.querySelector('.ticket-seat-map'),link=w.document.querySelector('#ticketDialog a');assert.equal(img.src,'https://maps.example.invalid/event-1.svg');assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');assert.equal(w.document.querySelectorAll('#ticketDialog iframe').length,0);w.dispatchEvent(new w.Event('a1-signed-out'));assert.equal(w.document.querySelector('.ticket-seat-map'),null);w.close();
});
test('missing and unsafe seat-map URLs show an explanation instead of opening an invalid map',async()=>{
 const [,{catalog}]=await load();for(const chartUrl of [null,'javascript:alert(1)','http://maps.example.invalid/chart']){const {w}=browser(catalog,{chartUrl});await w.A1TicketUI.open();await [...w.document.querySelectorAll('button')].find(b=>b.textContent==='Open seat map').onclick();assert.equal(w.document.querySelector('#ticketDialog img'),null);assert.equal(w.document.querySelector('#ticketDialog a'),null);assert.match(w.document.getElementById('ticketDialog').textContent,/has not supplied/);w.close();}
});
