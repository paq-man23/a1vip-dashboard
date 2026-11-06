const {test}=require('node:test'),assert=require('node:assert/strict');
const mod=()=>import('../supabase/functions/a1-skybox-sync/convert.mjs');
test('API contacts map exact IDs and address phones without exposing payment cards',async()=>{const {convert}=await mod();const r=convert('customer',{id:7,displayName:'Test',firstName:'A',lastName:'B',address:{phone1:'123',postalCode:'10001'},cards:[{number:'NEVER'}]});assert.equal(r.document.phone,'123');assert.equal(r.record['Customer ID'],'7');assert.doesNotMatch(JSON.stringify(r),/NEVER/);});
test('API documents preserve totals, balances, line seating, and reject missing amounts or foreign currency',async()=>{const {convert}=await mod();const row={id:9,total:220,outstandingBalance:20,shippingAmount:10,taxAmount:10,paymentStatus:'PARTIAL',createdDate:'2026-11-05T12:00:00Z',currencyCode:'USD',lines:[{quantity:2,amount:200,inventory:{section:'101',row:'A'}}]};const d=convert('invoice',row).document;assert.equal(d.credit,200);assert.equal(d.lines[0].unitCost,100);assert.equal(d.lines[0].section,'101');assert.equal(d.lines.reduce((s,l)=>s+l.qty*l.unitCost,0)+d.tax+d.shipping-d.credit,20);assert.equal(convert('purchase',row).document.number,'SB-PO-9');assert.throws(()=>convert('invoice',{...row,total:undefined}));assert.throws(()=>convert('invoice',{...row,currencyCode:'EUR'}));assert.throws(()=>convert('invoice',{...row,total:221}));});
test('inventory excludes barcodes, transfers and internal cost; hidden seats remain hidden',async()=>{const {convert}=await mod();const r=convert('inventory',{id:5,quantity:2,section:'A',row:'1',listPrice:150,hideSeatNumbers:true,seatNumbers:'3,4',tickets:[{barcode:'SECRET'}],transferUrls:['SECRET'],cost:60,event:{name:'Concert',date:'2027-03-01',venue:{city:'Miami'}}});assert.equal(r.document.city,'Miami');assert.equal(r.document.seats,'');assert.doesNotMatch(JSON.stringify(r),/SECRET|cost/);});
test('document updates use fixed windows; pagination handles either verified page base and rejects malformed pages',async()=>{const {pageUrl,validatePage}=await mod();const u=pageUrl('invoice',{page:2,pageBase:1,since:'2026-11-01',until:'2026-11-05'});assert.equal(u.searchParams.get('pageNumber'),'3');assert.equal(u.searchParams.get('lastUpdateFrom'),'2026-11-01');assert.equal(pageUrl('customer',{page:0}).searchParams.has('pageNumber'),false);assert.equal(pageUrl('customer',{page:2,pageBase:0}).searchParams.get('pageNumber'),'2');assert.throws(()=>validatePage({rows:[],rowCount:100},0));assert.throws(()=>validatePage({rows:[{id:1},{id:1}],rowCount:2},0));assert.equal(validatePage({rows:[{id:1}],rowCount:1},0).done,true);});
const env=k=>({SUPABASE_URL:'https://db.invalid',SUPABASE_SERVICE_ROLE_KEY:'SERVICE',SUPABASE_ANON_KEY:'ANON'})[k];
test('edge refuses anonymous, forged scheduler and unauthorized origins without reaching Skybox',async()=>{const {createHandler}=await import('../supabase/functions/a1-skybox-sync/handler.mjs');let skybox=0;const h=createHandler({env,fetchImpl:async url=>{if(String(url).startsWith('https://skybox.vividseats.com'))skybox++;return new Response(JSON.stringify('scheduler-secret'));}});for(const [headers,action,status] of [[{},'status',401],[{'x-a1-sync-token':'wrong'},'scheduled',401],[{origin:'https://evil.invalid'},'status',403]]){const r=await h(new Request('https://fn.invalid',{method:'POST',headers,body:JSON.stringify({action})}));assert.equal(r.status,status);}assert.equal(skybox,0);});
test('worker retains failed pages, redacts provider errors, and releases its lease',async()=>{const {createHandler}=await import('../supabase/functions/a1-skybox-sync/handler.mjs');const calls=[];const h=createHandler({env,fetchImpl:async(url,opts)=>{if(String(url).startsWith('https://skybox'))return new Response('secret-value',{status:429});const body=JSON.parse(opts.body);calls.push(body);if(body.p_kind)return Response.json({reserved:true,waitMs:0});if(body.p_action==='scheduler_secret')return new Response(JSON.stringify('scheduler-secret'));if(body.p_action==='claim')return new Response(JSON.stringify({lease:'lease',accountId:'1',states:{customer:{page:0,page_base:1,next_due:'2020-01-01'}},contacts:{}}));return new Response('{}');}});const r=await h(new Request('https://fn.invalid',{method:'POST',headers:{'x-a1-sync-token':'scheduler-secret'},body:JSON.stringify({action:'scheduled'})}));assert.equal(r.status,200);assert.equal(calls.some(x=>x.p_action==='apply'),false);assert.equal(calls.at(-1).p_action,'release');assert.doesNotMatch(await r.text(),/secret-value/);});
function authenticatedHandler(createHandler,{admin=true,foreign=false,providerFailure=false}={}){
 const calls=[];const token='header.'+Buffer.from(JSON.stringify({session_id:'session'})).toString('base64url')+'.signature';
 const handler=createHandler({env,sleep:async()=>{},fetchImpl:async(url,opts)=>{
  const path=String(url);
  if(path.includes('/auth/v1/user'))return Response.json({id:'admin'});
  if(path.includes('/a1_staff?'))return Response.json([{is_admin:admin}]);
  if(path.startsWith('https://skybox')){calls.push({url:path,headers:opts.headers});if(providerFailure)return new Response('PRIVATE PROVIDER BODY',{status:403});return Response.json({rows:[{id:1,accountId:foreign?999:123}],rowCount:1});}
  const body=JSON.parse(opts.body);calls.push(body);if(body.p_kind)return Response.json({reserved:true,waitMs:0});return Response.json({configured:true,enabled:true});
 }});
 return {calls,request:body=>handler(new Request('https://fn.invalid',{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify(body)}))};
}
test('configuration probes all five endpoints, stores credentials only after validation and never returns tokens',async()=>{
 const {createHandler}=await import('../supabase/functions/a1-skybox-sync/handler.mjs');const {calls,request}=authenticatedHandler(createHandler);
 const response=await request({action:'configure',accountId:'123',applicationToken:'APP-PRIVATE',apiToken:'API-PRIVATE'});assert.equal(response.status,200);assert.doesNotMatch(await response.text(),/PRIVATE/);
 const saved=calls.find(c=>c.p_action==='configure');assert.deepEqual(saved.p_input.pageBases,{customer:1,vendor:1,invoice:1,purchase:1,inventory:1});assert.equal(saved.p_input.apiToken,'API-PRIVATE');assert.equal(calls.filter(c=>c.url).length,10);
});
test('foreign accounts and failed endpoint access never store credentials; regular users cannot configure',async()=>{
 const {createHandler}=await import('../supabase/functions/a1-skybox-sync/handler.mjs');
 for(const options of [{foreign:true},{providerFailure:true},{admin:false}]){
  const {calls,request}=authenticatedHandler(createHandler,options);const response=await request({action:'configure',accountId:'123',applicationToken:'APP-PRIVATE',apiToken:'API-PRIVATE'});
  assert.ok([400,403].includes(response.status));assert.equal(calls.some(c=>c.p_action==='configure'),false);assert.doesNotMatch(await response.text(),/PRIVATE/);
 }
});
test('setup paces inventory probes and retries a provider throttle without changing the supplied tokens',async()=>{
 const {createHandler}=await import('../supabase/functions/a1-skybox-sync/handler.mjs');let clock=0,inventoryCalls=0,previous=-Infinity,deferred=false;const waits=[],calls=[];
 const bearer='header.'+Buffer.from(JSON.stringify({session_id:'fixture-session'})).toString('base64url')+'.signature';
 const h=createHandler({env,sleep:async ms=>{waits.push(ms);clock+=ms;},fetchImpl:async(url,options)=>{
  const path=String(url);if(path.includes('/auth/v1/user'))return Response.json({id:'admin'});if(path.includes('/a1_staff?'))return Response.json([{is_admin:true}]);
  if(path.includes('/a1_skybox_reserve_request')){const b=JSON.parse(options.body);if(b.p_retry_ms){assert.equal(b.p_retry_ms,12000);deferred=true;return Response.json({deferred:true});}return Response.json({reserved:true,waitMs:b.p_kind==='inventory'?(deferred?12000:inventoryCalls?10500:0):0});}
  if(path.startsWith('https://skybox')){
   assert.equal(options.headers['X-Api-Token'],'NEW-API');assert.equal(options.headers['X-Application-Token'],'NEW-APP');
   if(path.includes('/inventory?')){inventoryCalls++;if(inventoryCalls===1)return Response.json({error:'secret provider details'},{status:429,headers:{'Retry-After':'12'}});assert.ok(clock-previous>=10000);previous=clock;deferred=false;}
   return Response.json({rows:[{id:1,accountId:123}],rowCount:1});
  }
  const b=JSON.parse(options.body);calls.push(b);return Response.json({configured:true,enabled:true});
 }});
 const r=await h(new Request('https://fn.invalid',{method:'POST',headers:{authorization:'Bearer '+bearer},body:JSON.stringify({action:'configure',accountId:'123',apiToken:'NEW-API',applicationToken:'NEW-APP'})}));assert.equal(r.status,200);assert.equal(inventoryCalls,3);assert.deepEqual(waits,[12000,10500]);assert.equal(calls.find(c=>c.p_action==='configure').p_input.apiToken,'NEW-API');assert.doesNotMatch(await r.text(),/NEW-API|NEW-APP|secret provider/);
});
test('Retry-After supports seconds and HTTP dates and never shortens the minimum cooldown',async()=>{const {retryAfterMs}=await import('../supabase/functions/a1-skybox-sync/handler.mjs');assert.equal(retryAfterMs('12',10500),12000);assert.equal(retryAfterMs('0',10500),10500);assert.equal(retryAfterMs('invalid',10500),10500);assert.equal(retryAfterMs('Fri, 06 Nov 2026 23:00:30 GMT',10500,Date.parse('2026-11-06T23:00:00Z')),30000);});
test('diagnostics summarize provider failures without retaining tokens, headers or customer data',async()=>{
 const {responseSummary,dashboardFailure}=await import('../supabase/functions/a1-skybox-sync/diagnostics.mjs');
 const r=Response.json({error:'Invalid API token NEW-API-PRIVATE',rows:[{email:'private@example.invalid',apiToken:'NEW-API-PRIVATE'}],rowCount:1},{status:401,headers:{'X-Api-Token':'HEADER-PRIVATE'}});
 const summary=await responseSummary(r);assert.equal(summary.httpStatus,401);assert.equal(summary.category,'authentication');assert.equal(summary.returnedRows,1);assert.doesNotMatch(JSON.stringify(summary),/PRIVATE|example.invalid|apiToken/);
 const failure=dashboardFailure('/rest/v1/rpc/a1_skybox_service',400,{code:'P0001',message:'Sign in again SECRET-PRIVATE',details:'PRIVATE'});assert.equal(failure.diagnostic.category,'session');assert.equal(failure.diagnostic.code,'P0001');assert.doesNotMatch(JSON.stringify(failure.diagnostic),/PRIVATE/);
});
test('admin failures return a diagnostic reference and safe database code in the existing error message',async()=>{
 const {createHandler}=await import('../supabase/functions/a1-skybox-sync/handler.mjs');const logs=[];
 const bearer='header.'+Buffer.from(JSON.stringify({session_id:'fixture-session'})).toString('base64url')+'.signature';
 const h=createHandler({env,logger:e=>logs.push(e),fetchImpl:async(url,options)=>{
  if(String(url).includes('/auth/v1/user'))return Response.json({id:'admin'});
  if(String(url).includes('/a1_staff?'))return Response.json([{is_admin:true}]);
  return Response.json({code:'PGRST202',message:'Could not find the function; PRIVATE-TOKEN',details:'private@example.invalid'},{status:404});
 }});
 const r=await h(new Request('https://fn.invalid',{method:'POST',headers:{authorization:'Bearer '+bearer},body:JSON.stringify({action:'configure',accountId:'123',apiToken:'PRIVATE-TOKEN',applicationToken:'PRIVATE-APP'})}));
 const body=await r.json();assert.equal(r.status,500);assert.match(body.error,/Diagnostic .*a1_skybox_reserve_request.*PGRST202/);assert.ok(body.diagnostic.id);assert.ok(logs.some(x=>x.category==='schema_cache'));assert.doesNotMatch(JSON.stringify({logs,body}),/PRIVATE-TOKEN|PRIVATE-APP|example.invalid/);
});
