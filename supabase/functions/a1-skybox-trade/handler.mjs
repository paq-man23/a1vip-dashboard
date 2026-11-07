import {id,kinds,safeInventory,fingerprint,intentFor,providerPayload,invoiceDocument,verifySale,verifyHold} from './model.mjs';
const uuid=value=>{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value)))throw Error('Invalid action reference');return value;};
export function createHandler({env,fetchImpl=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 const base=env('SUPABASE_URL'),service=env('SUPABASE_SERVICE_ROLE_KEY'),anon=env('SUPABASE_ANON_KEY');
 async function db(path,body,token=service){
  const r=await fetchImpl(base+path,{method:body===undefined?'GET':'POST',headers:{apikey:token===service?service:anon,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  let data;try{data=await r.json();}catch{}
  if(!r.ok){const e=Error(data?.code==='23505'?'Another pending action already exists for these tickets. Review it in Buying & Selling.':'Dashboard trading request failed. Check administrator access or the saved action status.');e.code=data?.code;throw e;}return data;
 }
 return async req=>{
  const origin=req.headers.get('origin'),allowed=!origin||origin==='https://a1dash.a1eei.com'||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const headers={'Content-Type':'application/json','Cache-Control':'no-store, private','Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type','Access-Control-Allow-Methods':'POST, OPTIONS',...(origin&&allowed?{'Access-Control-Allow-Origin':origin}:{})};
  const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
  if(!allowed)return reply({error:'Origin is not allowed'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply({error:'POST required'},405);
  let order,identity,rpc,dispatched=false;
  try{
   const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');if(!token||token===service)return reply({error:'Sign in as an administrator'},401);
   let user;try{user=await db('/auth/v1/user',undefined,token);}catch{return reply({error:'Sign in again'},401);}
   const members=await db('/rest/v1/a1_staff?select=is_admin&user_id=eq.'+encodeURIComponent(user.id),undefined,token);
   if(members?.[0]?.is_admin!==true)return reply({error:'Administrator access required'},403);
   let session;try{session=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).session_id;}catch{}
   identity={actor:user.id,session};rpc=(action,input={})=>db('/rest/v1/rpc/a1_skybox_trade_service',{p_action:action,p_input:{...input,...identity}});
   const raw=await req.text();if(raw.length>12000)return reply({error:'Request too large'},413);
   const input=JSON.parse(raw);
   if(!['status','settings','inspect','prepare','cancel','commit','reconcile'].includes(input?.action))return reply({error:'Unsupported action'},400);
   if(input.action==='status')return reply(await rpc('status'));
   if(input.action==='settings')return reply(await rpc('settings',{enabled:input.enabled===true,confirmation:input.confirmation}));
   const context=await rpc('context');
   async function provider(method,path,body){
    const slot=await rpc('pace');if(slot.waitMs>0)await sleep(slot.waitMs);
    let response;try{response=await fetchImpl('https://skybox.vividseats.com/services'+path,{method,headers:{'X-Account':context.accountId,'X-Api-Token':context.apiToken,'X-Application-Token':context.applicationToken,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(method==='POST'?45000:20000)});}catch{const e=Error('Skybox did not confirm the request. Reconcile the saved action before trying another sale.');e.uncertain=method!=='GET';throw e;}
    if(response.status===429){const retry=response.headers.get('retry-after'),seconds=retry==null?NaN:Number(retry),ms=Number.isFinite(seconds)?seconds*1000:Date.parse(retry)-Date.now();await rpc('cooldown',{retryMs:Math.max(10000,Number.isFinite(ms)?Math.ceil(ms):0)});}
    if(!response.ok){const e=Error(`Skybox returned HTTP ${response.status}. ${response.status===401||response.status===403?'Write permissions may not be enabled for this account or application.':'Review the saved action before retrying.'}`);e.definitiveWriteFailure=method!=='GET'&&[400,401,403,404,409,422,429].includes(response.status);e.uncertain=method!=='GET'&&response.status>=500;e.httpStatus=response.status;throw e;}
    let data;try{data=await response.json();}catch{data=null;}
    return data;
   }
   async function fresh(inventoryId){
    const inventory=await provider('GET','/inventory/'+id(inventoryId));
    const [tickets,event]=await Promise.all([provider('GET','/inventory/'+id(inventoryId)+'/tickets'),provider('GET','/events/'+id(inventory.eventId))]);
    const snapshot=safeInventory(inventory,tickets,event,context.accountId);
    const holds=await provider('GET','/holds?inventoryId='+id(inventoryId)+'&limit=50');
    if(!Array.isArray(holds?.rows))throw Error('Skybox hold availability could not be verified');
    if(holds.rows.some(h=>!h.removedDate&&Date.parse(h.expiryDate)>Date.now())||holds.rowCount>50)throw Error('A Skybox hold exists for this inventory. Resolve it before creating another action');
    return {inventory,snapshot};
   }
   const resultFor=o=>o.result||{id:o.id,state:o.state,providerId:o.provider_id,invoiceId:o.invoice_id};
   async function finishSale(o,invoice){
    // Some invoice responses omit itemIds; fetch the documented line-ticket resource.
    for(const line of invoice.lines||[]){if(line.lineItemType==='INVENTORY'&&(!Array.isArray(line.itemIds)||!line.itemIds.length)){
     const sold=await provider('GET','/invoices/'+id(invoice.id)+'/lines/'+id(line.id)+'/tickets');
     if(!Array.isArray(sold)||sold.some(t=>String(t.accountId)!==String(context.accountId)||Number(t.invoiceLineId)!==Number(line.id)||t.status!=='SOLD'))throw Error('Skybox sold-ticket details require reconciliation');
     line.itemIds=sold.map(t=>id(t.id));
    }}
    verifySale(o,invoice,context.accountId);
    if(o.state!=='provider_confirmed'){await rpc('state',{id:o.id,state:'provider_confirmed',providerId:String(id(invoice.id))});o.state='provider_confirmed';o.provider_id=String(id(invoice.id));}
    try{return await rpc('finalize',{id:o.id,...invoiceDocument(o,invoice,context.accountId)});}catch{return {id:o.id,state:'provider_confirmed',providerId:o.provider_id,message:'Skybox confirmed the sale. A1 invoice reconciliation is pending; do not submit another sale.'};}
   }
   if(input.action==='inspect'||input.action==='prepare'){
    const {inventory,snapshot}=await fresh(input.inventoryId);
    if(input.action==='inspect')return reply({snapshot,enabled:context.enabled});
    if(!kinds.includes(input.kind))throw Error('Choose a supported inventory action');
    const customer=['sale','hold'].includes(input.kind)?await provider('GET','/customers/'+id(input.customerId)):null;
    const intent=intentFor({...input,accountId:context.accountId},snapshot,customer);
    const prepared=await rpc('prepare',{inventoryId:String(snapshot.id),kind:input.kind,intent,snapshot,fingerprint:await fingerprint(snapshot)});
    return reply({...prepared,kind:input.kind,snapshot,intent});
   }
   const operationId=uuid(input.id);
   if(input.action==='cancel')return reply(await rpc('cancel',{id:operationId}));
   if(input.action==='commit'){
    if(input.confirmation!=='CONFIRM SKYBOX ACTION')throw Error('Explicit confirmation is required');
    order=await rpc('claim',{id:operationId,confirmation:input.confirmation});
    if(!order.claimed)return reply(resultFor(order));
    const current=await fresh(order.inventory_id);
    if(await fingerprint(current.snapshot)!==order.fingerprint)throw Error('Inventory changed after the preview. Create a new preview before confirming');
    if(order.kind==='hold'&&Date.parse(order.intent.expiryDate)<=Date.now())throw Error('Hold preview expired');
    await rpc('write_gate',{id:order.id});
    const request=providerPayload(order,current.inventory,context.accountId);
    // This is the only provider write dispatch. Never retry it automatically.
    dispatched=true;
    const response=await provider(request.method,request.path,request.body);
    if(order.kind==='sale'){
     const invoice=response?.id?await provider('GET','/invoices/'+id(response.id)):null;
     if(!invoice)throw Object.assign(Error('Skybox did not return a confirmed invoice. Reconcile this action.'),{uncertain:true});
     return reply(await finishSale(order,invoice));
    }
    if(order.kind==='hold'){
     if(!response?.id)throw Object.assign(Error('Skybox did not confirm the hold. Reconcile this action.'),{uncertain:true});
     const hold=await provider('GET','/holds/'+id(response.id));
     verifyHold(order,hold,context.accountId);
     return reply(await rpc('state',{id:order.id,state:'complete',providerId:String(id(hold.id)),result:{id:order.id,state:'complete',kind:'hold',providerId:String(hold.id),expiresAt:hold.expiryDate}}));
    }
    const updated=await provider('GET','/inventory/'+id(order.inventory_id));
    if(String(updated?.accountId)!==String(context.accountId)||(order.kind==='price'?Number(updated.listPrice)!==order.intent.unitPrice:updated.broadcast!==order.intent.broadcast))throw Object.assign(Error('Skybox update needs reconciliation'),{uncertain:true});
    return reply(await rpc('state',{id:order.id,state:'complete',result:{id:order.id,state:'complete',kind:order.kind}}));
   }
   order=await rpc('get',{id:operationId});
   if(order.state==='complete'||order.state==='rejected'||order.state==='expired')return reply(resultFor(order));
   if(order.state==='preview')throw Error('This action has not been submitted');
   if(order.state==='executing'&&Date.now()-Date.parse(order.updated_at)<120000)return reply({id:order.id,state:'executing',message:'The request may still be processing. Wait two minutes before reconciliation.'});
   if(order.kind==='sale'){
    let providerId=order.provider_id;
    if(!providerId){const u='/invoices?externalRef='+encodeURIComponent('A1-'+order.id)+'&lastUpdateFrom='+encodeURIComponent(new Date(Date.parse(order.created_at)-300000).toISOString())+'&lastUpdateTo='+encodeURIComponent(new Date().toISOString())+'&limit=2';const found=await provider('GET',u);const rows=found?.rows?.filter(i=>i.externalRef==='A1-'+order.id)||[];if(rows.length!==1||found.rowCount>1)throw Error('A unique Skybox sale was not found. Keep this action locked and check Skybox; do not resubmit');providerId=id(rows[0].id);}
    const invoice=await provider('GET','/invoices/'+id(providerId));return reply(await finishSale(order,invoice));
   }
   if(order.kind==='hold'){
    const found=await provider('GET','/holds?externalRef='+encodeURIComponent('A1-'+order.id)+'&inventoryId='+id(order.inventory_id)+'&limit=2');const rows=found?.rows?.filter(h=>h.externalRef==='A1-'+order.id&&!h.removedDate)||[];
    if(rows.length!==1)throw Error('Hold outcome is not confirmed. Check Skybox; do not resubmit');
    verifyHold(order,rows[0],context.accountId);
    return reply(await rpc('state',{id:order.id,state:'complete',providerId:String(id(rows[0].id)),result:{id:order.id,state:'complete',kind:'hold',providerId:String(rows[0].id)}}));
   }
   const latest=await provider('GET','/inventory/'+id(order.inventory_id));
   if(String(latest.accountId)!==String(context.accountId)||(order.kind==='price'?Number(latest.listPrice)!==order.intent.unitPrice:latest.broadcast!==order.intent.broadcast))throw Error('Update outcome is not confirmed. Check Skybox; this action remains locked');
   return reply(await rpc('state',{id:order.id,state:'complete',result:{id:order.id,state:'complete',kind:order.kind}}));
  }catch(error){
   if(order?.claimed&&order.state==='executing'){
    const state=dispatched&&!error.definitiveWriteFailure?'uncertain':'rejected';
    try{await rpc('state',{id:order.id,state,code:error.httpStatus?'HTTP_'+error.httpStatus:state==='uncertain'?'UNCONFIRMED':'PRECONDITION'});}catch{}
   }
   // Only our own errors are returned. Never forward a provider body, token, or database message.
   const message=error instanceof SyntaxError?'Invalid request':error.message;
   return reply({error:message||'Trading request failed. Review the saved action status.'},400);
  }
 };
}
