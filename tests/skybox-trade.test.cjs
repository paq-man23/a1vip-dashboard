const {test}=require('node:test'),assert=require('node:assert/strict');
const env=k=>({SUPABASE_URL:'https://db.invalid',SUPABASE_SERVICE_ROLE_KEY:'SERVICE',SUPABASE_ANON_KEY:'ANON'})[k];
const operation='12345678-1234-4123-8123-123456789abc';
const token='header.'+Buffer.from(JSON.stringify({session_id:'fixture-session'})).toString('base64url')+'.sig';
function fixture({stale=false,timeout=false,readbackFail=false,forbidden=false,rateLimited=false,admin=true,enabled=true}={}){
 const orders=new Map(),calls=[];let posts=0,inspectCount=0,confirmed=false;
 const inventory=()=>({id:10,accountId:1,eventId:2,quantity:2,status:'AVAILABLE',section:'A',row:'1',version:stale&&inspectCount>1?2:1,listPrice:100,listPriceCurrencyCode:'USD',splitType:'ANY',broadcast:true,barCode:'NEVER-EXPOSE'});
 const tickets=[{id:11,accountId:1,inventoryId:10,seatNumber:1,status:'AVAILABLE'},{id:12,accountId:1,inventoryId:10,seatNumber:2,status:'AVAILABLE'}];
 const invoice=()=>({id:90,accountId:1,customerId:3,externalRef:'A1-'+operation,paymentStatus:'UNPAID',outstandingBalance:200,createdDate:'2026-11-07T00:00:00Z',lines:[{lineItemType:'INVENTORY',itemIds:[11,12],amount:200}]});
 const fetchImpl=async(url,options)=>{
  const p=String(url);calls.push({url:p,method:options.method,body:options.body?JSON.parse(options.body):null});
  if(p.startsWith('https://db.invalid')){
   if(p.endsWith('/auth/v1/user'))return Response.json({id:'admin'});if(p.includes('/a1_staff?'))return Response.json([{is_admin:admin}]);
   const {p_action:a,p_input:b}=JSON.parse(options.body);
   if(a==='context')return Response.json({accountId:'1',apiToken:'PRIVATE-API',applicationToken:'PRIVATE-APP',enabled});
   if(a==='pace')return Response.json({waitMs:0});
   if(a==='prepare'){const o={id:operation,actor_id:'admin',inventory_id:b.inventoryId,kind:b.kind,state:'preview',intent:b.intent,snapshot:b.snapshot,fingerprint:b.fingerprint,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};orders.set(operation,o);return Response.json({id:operation,expiresAt:new Date(Date.now()+120000).toISOString(),enabled});}
   const o=orders.get(b.id);
   if(a==='claim'){if(!enabled)return Response.json({code:'P0001'},{status:400});if(o.state!=='preview')return Response.json({...o,claimed:false});o.state='executing';return Response.json({...o,claimed:true});}
   if(a==='write_gate')return Response.json({});
   if(a==='state'){o.state=b.state;o.provider_id=b.providerId||o.provider_id;o.result=b.result||null;return Response.json({id:o.id,state:o.state});}
   if(a==='get')return Response.json(o);
   if(a==='finalize'){o.state='complete';o.result={id:o.id,state:'complete',invoiceId:'inv-skybox-invoice-90',providerId:'90'};return Response.json(o.result);}
   return Response.json({enabled,orders:[]});
  }
  assert.equal(options.headers['X-Api-Token'],'PRIVATE-API');
  if(p.endsWith('/invoices')&&options.method==='POST'){posts++;confirmed=true;if(rateLimited)return Response.json({}, {status:429,headers:{'Retry-After':'30'}});if(forbidden)return Response.json({secret:'provider body'},{status:403});if(timeout)throw Error('PRIVATE-PROVIDER-ERROR');return Response.json({id:90});}
  if(p.endsWith('/inventory/10')){inspectCount++;return Response.json(inventory());}
  if(p.endsWith('/inventory/10/tickets'))return Response.json(tickets);
  if(p.endsWith('/events/2'))return Response.json({id:2,name:'Fixture Concert',date:'2030-11-07T20:00:00-05:00',venue:{name:'Fixture Arena'}});
  if(p.includes('/holds?'))return Response.json({rows:[],rowCount:0});
  if(p.endsWith('/customers/3'))return Response.json({id:3,accountId:1,displayName:'Fixture Customer',email:'person@example.invalid'});
  if(p.endsWith('/invoices/90')){if(readbackFail&&confirmed)throw Error('PRIVATE-READBACK');return Response.json(invoice());}
  if(p.includes('/invoices?externalRef='))return Response.json({rows:[invoice()],rowCount:1});
  throw Error('Unmocked request '+p);
 };
 return {fetchImpl,orders,calls,posts:()=>posts};
}
async function setup(options){const f=fixture(options),{createHandler}=await import('../supabase/functions/a1-skybox-trade/handler.mjs');const handler=createHandler({env,fetchImpl:f.fetchImpl,sleep:async()=>{}});return {...f,request:async input=>{const response=await handler(new Request('https://fn.invalid',{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify(input)}));return {status:response.status,body:await response.json()};}};}
const prepare={action:'prepare',kind:'sale',inventoryId:'10',customerId:'3',ticketIds:[11,12],unitPrice:'100'};
const commit={action:'commit',id:operation,confirmation:'CONFIRM SKYBOX ACTION'};
test('confirmed sale posts exact ticket IDs once and returns one linked invoice; repeats never resend',async()=>{const f=await setup();const p=await f.request(prepare);assert.equal(p.status,200);assert.doesNotMatch(JSON.stringify(p.body),/PRIVATE|NEVER-EXPOSE|barCode/);const sale=await f.request(commit);assert.equal(sale.body.invoiceId,'inv-skybox-invoice-90');await f.request(commit);assert.equal(f.posts(),1);const write=f.calls.find(c=>c.method==='POST'&&c.url.endsWith('/invoices'));assert.deepEqual(write.body.lines[0].itemIds,[11,12]);assert.equal(write.body.lines[0].amount,200);assert.equal(write.body.externalRef,'A1-'+operation);assert.ok(!write.url.includes('force'));});
test('stale inventory fails before any provider write',async()=>{const f=await setup({stale:true});await f.request(prepare);const r=await f.request(commit);assert.equal(r.status,400);assert.match(r.body.error,/Inventory changed/);assert.equal(f.posts(),0);assert.equal(f.orders.get(operation).state,'rejected');});
test('a timed-out sale remains locked; reconciliation performs only reads and no duplicate sale',async()=>{const f=await setup({timeout:true});await f.request(prepare);const first=await f.request(commit);assert.equal(first.status,400);assert.equal(f.orders.get(operation).state,'uncertain');await f.request(commit);assert.equal(f.posts(),1);const reconciled=await f.request({action:'reconcile',id:operation});assert.equal(reconciled.body.invoiceId,'inv-skybox-invoice-90');assert.equal(f.posts(),1);assert.doesNotMatch(JSON.stringify(first.body),/PRIVATE/);});
test('a successful write followed by a readback failure remains uncertain, never rejected/retried',async()=>{const f=await setup({readbackFail:true});await f.request(prepare);await f.request(commit);assert.equal(f.orders.get(operation).state,'uncertain');await f.request(commit);assert.equal(f.posts(),1);});
test('permission denial does not create a local invoice or expose provider error bodies',async()=>{const f=await setup({forbidden:true});await f.request(prepare);const r=await f.request(commit);assert.equal(f.orders.get(operation).state,'rejected');assert.match(r.body.error,/Write permissions/);assert.doesNotMatch(JSON.stringify(r.body),/provider body|PRIVATE/);assert.equal(f.calls.filter(c=>c.body?.p_action==='finalize').length,0);});
test('regular users, disabled rollout and missing confirmation cannot dispatch writes',async()=>{const regular=await setup({admin:false});assert.equal((await regular.request(prepare)).status,403);assert.equal(regular.calls.some(c=>c.url.startsWith('https://skybox')),false);const off=await setup({enabled:false});await off.request(prepare);assert.equal((await off.request(commit)).status,400);assert.equal(off.posts(),0);const on=await setup();await on.request(prepare);assert.equal((await on.request({...commit,confirmation:undefined})).status,400);assert.equal(on.posts(),0);});
test('safe snapshots reject past events and strip barcode/transfer/cost data',async()=>{const {safeInventory}=await import('../supabase/functions/a1-skybox-trade/model.mjs');const i={id:1,accountId:1,eventId:2,quantity:1,status:'AVAILABLE',listPrice:12,barCode:'PRIVATE',cost:5,transferUrls:['PRIVATE']};const t=[{id:3,accountId:1,inventoryId:1,status:'AVAILABLE',barCode:'PRIVATE'}];assert.throws(()=>safeInventory(i,t,{id:2,date:'2020-01-01'},1));assert.doesNotMatch(JSON.stringify(safeInventory(i,t,{id:2,date:'2030-01-01',name:'Future'},1)),/PRIVATE|transfer|cost/);});
test('invoice verification rejects ticket, customer, amount and payment mismatches',async()=>{const {verifySale}=await import('../supabase/functions/a1-skybox-trade/model.mjs');const o={id:operation,intent:{customer:{id:3},ticketIds:[11,12],unitPrice:100}};const good={accountId:1,externalRef:'A1-'+operation,customerId:3,paymentStatus:'UNPAID',outstandingBalance:200,lines:[{lineItemType:'INVENTORY',itemIds:[11,12],amount:200}]};assert.equal(verifySale(o,good,1),200);for(const bad of [{customerId:4},{outstandingBalance:0},{paymentStatus:'PAID'},{lines:[{lineItemType:'INVENTORY',itemIds:[13],amount:200}]}])assert.throws(()=>verifySale(o,{...good,...bad},1));});
test('hold verification enforces customer, exact selected seats, expiry and inventory; price/listing writes are narrowly built',async()=>{
 const {verifyHold,providerPayload}=await import('../supabase/functions/a1-skybox-trade/model.mjs');const expiry=new Date(Date.now()+600000).toISOString();const o={id:operation,inventory_id:'10',kind:'hold',intent:{customer:{id:3},ticketIds:[11,12],lowSeat:1,expiryDate:expiry},snapshot:{tickets:[{id:11,seat:1},{id:12,seat:2}]}};const hold={id:40,accountId:1,inventoryId:10,externalRef:'A1-'+operation,customerId:3,quantity:2,expiryDate:expiry,seats:'1-2'};assert.doesNotThrow(()=>verifyHold(o,hold,1));for(const bad of [{inventoryId:99},{seats:'3-4'},{expiryDate:new Date(Date.now()+1200000).toISOString()},{customerId:4}])assert.throws(()=>verifyHold(o,{...hold,...bad},1));
 const payload=providerPayload(o,{},1);assert.equal(payload.method,'POST');assert.equal(payload.path,'/holds');assert.equal(payload.body.lowSeat,1);assert.equal(payload.body.externalRef,'A1-'+operation);
 const listing=providerPayload({...o,kind:'listing',intent:{broadcast:false}},null,1);assert.deepEqual(listing.body,{inventoryIds:[10],broadcast:false});assert.equal(listing.body.force,undefined);
 const original={id:10,version:7,quantity:2,listPrice:100,splitType:'NEVERLEAVEONE',publicNotes:'Preserve'};const price=providerPayload({...o,kind:'price',intent:{unitPrice:125}},original,1);assert.deepEqual(price.body,{...original,listPrice:125});assert.equal(original.listPrice,100);
});

test('rate limits reserve provider cooldown without automatically repeating a write',async()=>{const f=await setup({rateLimited:true});await f.request(prepare);await f.request(commit);assert.equal(f.posts(),1);assert.equal(f.orders.get(operation).state,'rejected');const cooldown=f.calls.find(c=>c.body?.p_action==='cooldown');assert.equal(cooldown.body.p_input.retryMs,30000);await f.request(commit);assert.equal(f.posts(),1);});
