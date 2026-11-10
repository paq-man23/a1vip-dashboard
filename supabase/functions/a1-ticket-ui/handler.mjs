import {catalog} from './catalog.mjs';
import {buildRequest,canonical} from './contract.mjs';
const encoder=new TextEncoder();
const hex=buffer=>Array.from(new Uint8Array(buffer),b=>b.toString(16).padStart(2,'0')).join('');
export function createHandler({env,fetchImpl=fetch,now=()=>Date.now()}){
 const base=env('SUPABASE_URL'),service=env('SUPABASE_SERVICE_ROLE_KEY'),anon=env('SUPABASE_ANON_KEY');
 async function db(path,body,token=service){const r=await fetchImpl(base+path,{method:body===undefined?'GET':'POST',headers:{apikey:token===service?service:anon,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(!r.ok){const e=Error('Dashboard authorization or connection unavailable. Sign in again or contact an administrator.');e.status=r.status===401?401:r.status===403?403:500;throw e;}return r.json();}
 async function sign(value){const key=await crypto.subtle.importKey('raw',encoder.encode(service),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',key,encoder.encode(canonical(value))));}
 return async req=>{
  const origin=req.headers.get('origin');const allowed=!origin||origin==='https://a1dash.a1eei.com'||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const headers={'Content-Type':'application/json','Cache-Control':'no-store, private','Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type','Access-Control-Allow-Methods':'POST, OPTIONS',...(allowed&&origin?{'Access-Control-Allow-Origin':origin}:{})};
  const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
  if(!allowed)return reply({error:'Origin is not allowed'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});if(req.method!=='POST')return reply({error:'POST required'},405);
  let input,connection,identity;
  try{
   const raw=await req.text();if(raw.length>8000000)return reply({error:'Form or attachment exceeds 8 MB'},413);try{input=JSON.parse(raw);}catch{return reply({error:'Invalid request'},400);}
   if(!['catalog','read','preview','execute'].includes(input?.action))return reply({error:'Unsupported action'},400);
   const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');if(!token||token===service)return reply({error:'Sign in again'},401);
   const user=await db('/auth/v1/user',undefined,token);
   let session;try{session=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).session_id;}catch{}
   if(!user.id||!session)return reply({error:'Sign in again'},401);identity={actor:user.id,session};
   // Service-only RPC rechecks current staff role, disabled state, and active dashboard session.
   connection=await db('/rest/v1/rpc/a1_ticket_ui_service',{p_action:'connection',p_input:identity});
   if(input.action==='catalog')return reply({catalog,configured:!!connection.accountId,access:'admin',permissions:'Skybox checks account permissions on each action.'});
   if(!connection.accountId)return reply({error:'Connect Skybox from Admin first'},409);
   const op=catalog.operations[input.operation];if(!op)return reply({error:'Unknown Skybox action'},400);
   let prepared;try{prepared=buildRequest(input,connection.accountId);}catch(e){return reply({error:e.message},400);}
   if(input.action==='preview'){
    if(!op.changes)return reply({error:'Use Search for this action'},400);
    const confirmation={id:crypto.randomUUID(),actor:user.id,session,request:prepared,expires:now()+300000};
    return reply({confirmation:{...confirmation,signature:await sign(confirmation)},summary:prepared,title:op.description||op.id});
   }
   if(op.changes&&input.action!=='execute')return reply({error:'Review this action before submitting'},400);
   if(!op.changes&&input.action!=='read')return reply({error:'Use Search for this action'},400);
   if(op.changes){
    const {signature,...confirmation}=input.confirmation||{};
    if(!signature||confirmation.actor!==user.id||confirmation.session!==session||confirmation.expires<now()||confirmation.expires>now()+300000||canonical(confirmation.request)!==canonical(prepared)||await sign(confirmation)!==signature)return reply({error:'The review expired or the form changed. Review again.'},409);
    const claimed=await db('/rest/v1/rpc/a1_ticket_ui_service',{p_action:'begin',p_input:{...identity,id:confirmation.id,operation:op.id}});
    if(!claimed)return reply({error:'This submission has already been attempted. Check the Skybox record before starting another action.'},409);
   }
   const kind=op.path.split('/')[1];
   // Use the existing global request reservation shared with automatic sync.
   const slot=await db('/rest/v1/rpc/a1_skybox_reserve_request',{p_kind:({customers:'customer',vendors:'vendor',invoices:'invoice',purchases:'purchase',inventory:'inventory'})[kind]||'customer',p_retry_ms:0});
   const finish=async status=>{if(op.changes)await db('/rest/v1/rpc/a1_ticket_ui_service',{p_action:'finish',p_input:{...identity,id:input.confirmation.id,status}});};
   if(!slot?.reserved||slot.waitMs>15000){await finish('not_sent');return reply({error:'Skybox is busy or rate limited. Wait briefly, then review the action again.'},429);}
   if(slot.waitMs>0)await new Promise(resolve=>setTimeout(resolve,slot.waitMs));
   const url='https://skybox.vividseats.com/services'+prepared.path+(prepared.query?'?'+prepared.query:'');
   let response;
   try{response=await fetchImpl(url,{method:prepared.method,headers:{'X-Account':connection.accountId,'X-Api-Token':connection.apiToken,'X-Application-Token':connection.applicationToken,'Content-Type':'application/json',Accept:'application/json, application/pdf'},body:prepared.body===undefined?undefined:JSON.stringify(prepared.body),redirect:'error',signal:AbortSignal.timeout(45000)});}
   catch{await finish('unknown');return reply({error:op.changes?'Skybox did not confirm the result. Do not resubmit until you check the record in Skybox.':'Skybox could not be reached. Try again shortly.',outcome:op.changes?'unknown':undefined},504);}
   if(!response.ok){await finish(response.status>=500?'unknown':'rejected');return reply({error:`Skybox returned HTTP ${response.status}. `+({400:'Check the required fields and selections.',401:'The saved Skybox connection needs attention in Admin.',403:'Your Skybox account does not permit this action.',404:'This record was not found.',409:'The record changed or this action conflicts with its current state.',429:'Skybox is rate limiting requests. Wait before trying again.'}[response.status]||'Check the record in Skybox before resubmitting.'),providerStatus:response.status},response.status>=500?502:response.status);}
   await finish('succeeded');
   const type=response.headers.get('content-type')||'';
   const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>8000000)return reply({error:'The result is too large to display. Narrow the search.',outcome:op.changes?'succeeded':undefined},413);
   if(!bytes.length)return reply({data:null,outcome:op.changes?'succeeded':undefined});
   if(type.includes('json')){let data;try{data=JSON.parse(new TextDecoder().decode(bytes));}catch{return reply({error:'Skybox returned an unreadable response. Check the record before retrying.',outcome:op.changes?'succeeded':undefined},502);}
    // Never echo saved service credentials, even if an upstream response contains them.
    const clean=v=>Array.isArray(v)?v.map(clean):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!/(?:token|apiKey|password|securityCode|cvv|cardNumber|secret)$/i.test(k)).map(([k,x])=>[k,clean(x)])):v;
    return reply({data:clean(data),outcome:op.changes?'succeeded':undefined});
   }
   if(!type.includes('pdf')&&!type.includes('octet-stream')&&!type.includes('csv'))return reply({error:'Skybox returned a page instead of a data response. Try again shortly.',outcome:op.changes?'succeeded':undefined},502);
   let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
   return reply({download:{type:type.includes('pdf')?'application/pdf':type.includes('csv')?'text/csv':'application/octet-stream',base64:btoa(binary)},outcome:op.changes?'succeeded':undefined});
  }catch(e){return reply({error:'Ticket UI could not complete the request. Sign in again or check the connection in Admin.'},e.status||500);}
 };
}
