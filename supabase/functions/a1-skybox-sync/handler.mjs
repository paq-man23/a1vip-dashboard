import {convert,pageUrl,validatePage,resources} from './convert.mjs';
import {responseSummary,dashboardFailure} from './diagnostics.mjs';
export function createHandler({env,fetchImpl=fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),logger=entry=>console.info(JSON.stringify(entry))}) {
 const base=env('SUPABASE_URL'),service=env('SUPABASE_SERVICE_ROLE_KEY'),anon=env('SUPABASE_ANON_KEY');
 async function api(path,{token=service,method='GET',body}={}){
  const r=await fetchImpl(base+path,{method,headers:{apikey:token===service?service:anon,Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),body:body===undefined?undefined:JSON.stringify(body)});
  let data;try{data=await r.json();}catch{throw dashboardFailure(path,r.status,null);}
  if(!r.ok)throw dashboardFailure(path,r.status,data);return data;
 }
 const rpc=(action,input={})=>api('/rest/v1/rpc/a1_skybox_service',{method:'POST',body:{p_action:action,p_input:input}});
 const reserve=(kind,retryMs=0)=>api('/rest/v1/rpc/a1_skybox_reserve_request',{method:'POST',body:{p_kind:kind,p_retry_ms:retryMs}});
 async function skyboxRead(url,kind,headers,retry=false,report=()=>{},stage='sync_page'){
  for(let attempt=0;attempt<(retry?2:1);attempt++){
   const slot=await reserve(kind);
   report({stage:'request_pacing',resource:resources[kind],waitMs:Number(slot?.waitMs)||0,reserved:slot?.reserved===true});
   if(!slot?.reserved)throw Error(`Skybox ${resources[kind]} is cooling down. Try again after a short wait.`);
   if(slot.waitMs>0)await sleep(slot.waitMs);
   let response;try{response=await fetchImpl(url,{headers,signal:AbortSignal.timeout(12000)});}catch(error){report({stage,resource:resources[kind],failure:error.name==='TimeoutError'||error.name==='AbortError'?'timeout':'network'});throw error;}
   report({stage,resource:resources[kind],pageNumber:url.searchParams.get('pageNumber')===null?'default':Number(url.searchParams.get('pageNumber')),attempt:attempt+1,...await responseSummary(response)});
   if(response.status!==429)return response;
   const wait=retryAfterMs(response.headers.get('retry-after'),kind==='inventory'?10500:1100);
   await reserve(kind,wait);
   if(!retry||attempt===1||wait>20000)return response;
  }
 }

 return async req=>{
  const origin=req.headers.get('origin'),allowed=!origin||origin==='https://a1dash.a1eei.com'||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const headers={'Content-Type':'application/json','Cache-Control':'no-store, private','Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type','Access-Control-Allow-Methods':'POST, OPTIONS',...(origin&&allowed?{'Access-Control-Allow-Origin':origin}:{})};
  const trace=globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
  const events=[];let diagnosticsAllowed=false;
  const report=entry=>{if(!diagnosticsAllowed)return;const record={time:new Date().toISOString(),...entry};if(events.length<40)events.push(record);try{logger({type:'a1_skybox_diagnostic',trace,...record});}catch{}};
  const reply=(v,status=200)=>{
   if(v?.error&&diagnosticsAllowed){
    const last=[...events].reverse().find(e=>e.httpStatus>=400)||[...events].reverse().find(e=>e.failure)||events.at(-1);
    const detail=last?[last.stage,last.resource,last.httpStatus&&'HTTP '+last.httpStatus,last.code].filter(Boolean).join(' · '):'request';
    v={...v,error:v.error+` [Diagnostic ${trace}: ${detail}]`,diagnostic:{id:trace,events}};
   }
   return new Response(JSON.stringify(v),{status,headers});
  };
  if(!allowed)return reply({error:'Origin is not allowed'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply({error:'POST required'},405);
  let lease;
  try{
   const raw=await req.text();if(raw.length>12000)return reply({error:'Request too large'},413);let input;try{input=JSON.parse(raw);}catch{return reply({error:'Invalid request'},400);}
   if(!input||!['status','configure','pause','resume','sync','inventory','scheduled'].includes(input.action))return reply({error:'Unsupported action'},400);
   const scheduled=input.action==='scheduled';
   if(scheduled){const secret=await rpc('scheduler_secret');if(!secret||req.headers.get('x-a1-sync-token')!==secret)return reply({error:'Unauthorized scheduler'},401);diagnosticsAllowed=true;}
   else {
    const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');if(!token||token===service)return reply({error:'Sign in again'},401);
    let actor;try{actor=await api('/auth/v1/user',{token});}catch{return reply({error:'Sign in again'},401);}
    const members=await api('/rest/v1/a1_staff?select=is_admin&user_id=eq.'+encodeURIComponent(actor.id),{token});
    if(!members?.length)return reply({error:'Dashboard access required'},403);
    // Database also checks a current auth.sessions row before configuration or data access.
    let session;try{session=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).session_id;}catch{}
    const identity={actor:actor.id,session};
    if(input.action==='inventory')return reply(await rpc('inventory',{...identity,query:String(input.query||'').slice(0,120),page:Math.max(0,Math.min(10000,Number(input.page)||0))}));
    if(!members[0].is_admin)return reply({error:'Administrator access required'},403);
    diagnosticsAllowed=true;report({stage:'request',action:input.action});
    if(input.action==='status')return reply(await rpc('status',identity));
    if(input.action==='configure'){
     const fields=['accountId','applicationToken','apiToken'];if(fields.some(k=>typeof input[k]!=='string'||!input[k].trim()||input[k].length>2000)||!/^\d+$/.test(input.accountId))return reply({error:'Enter Account ID and both Skybox tokens'},400);
     // Validate all five read endpoints before storing credentials or starting imports.
     const pageBases={};
     const skyboxHeaders={'X-Account':input.accountId,'X-Api-Token':input.apiToken.trim(),'X-Application-Token':input.applicationToken.trim()};
     await Promise.all(Object.keys(resources).map(async kind=>{
      const u=pageUrl(kind,{page:0,until:new Date().toISOString()});u.searchParams.set('limit','1');
      const r=await skyboxRead(u,kind,skyboxHeaders,true,report,'connection_access');
      if(!r.ok)throw Error(`Skybox ${resources[kind]} access failed (HTTP ${r.status}). Check the account, tokens, and permissions.`);
      const first=await r.json();if(!Array.isArray(first.rows)||!Number.isInteger(first.rowCount))throw Error('Unexpected Skybox response format');
      if(first.rows.some(row=>String(row.accountId)!==input.accountId))throw Error('Skybox returned a different account');
      pageBases[kind]=1;
      if(first.rows.length){u.searchParams.set('pageNumber','1');const probe=await skyboxRead(u,kind,skyboxHeaders,true,report,'connection_pagination');if(!probe.ok)throw Error(`Skybox ${resources[kind]} pagination verification failed (HTTP ${probe.status}). Try again after a short wait.`);const second=await probe.json();if(!Array.isArray(second.rows))throw Error('Unexpected Skybox pagination');pageBases[kind]=second.rows[0]?.id===first.rows[0].id?1:0;}

     }));
     return reply(await rpc('configure',{...identity,accountId:input.accountId,applicationToken:input.applicationToken.trim(),apiToken:input.apiToken.trim(),pageBases}));
    }
    if(['pause','resume'].includes(input.action))return reply(await rpc(input.action,identity));
    await rpc('authorize',identity);
   }
   const job=await rpc('claim',{manual:!scheduled});if(!job)return reply({message:'Sync is paused, not configured, already running, or waiting for its next refresh.'});lease=job.lease;
   const results=[];
   for(const kind of Object.keys(resources)){
    const state=job.states[kind];if(state)state.pageBase=state.page_base;if(!state||((!job.manual||state.errors>0)&&new Date(state.next_due)>new Date()))continue;
    try{
     const response=await skyboxRead(pageUrl(kind,state),kind,{'X-Account':job.accountId,'X-Api-Token':job.apiToken,'X-Application-Token':job.applicationToken},false,report);
     if(!response.ok){const error=Error(`Skybox ${resources[kind]} HTTP ${response.status}${response.status===429?' — rate limited; will retry':''}`);error.retryMs=response.status===429?retryAfterMs(response.headers.get('retry-after'),300000):0;throw error;}
     const page=validatePage(await response.json(),state.page);if(page.rows.length&&page.rows.some(row=>String(row.accountId)!==String(job.accountId)))throw Error('Skybox returned a different account');
     const items=[];let errors=0;
     for(const row of page.rows){try{items.push(convert(kind,row,job.contacts[(kind==='purchase'?'vendor:':'customer:')+(row.vendorId||row.customerId)]));}catch{errors++;}}
     const result=await rpc('apply',{lease,kind,items,errors,total:page.total,done:page.done,page:state.page});results.push({kind,...result});
    }catch(error){report(error.diagnostic||{stage:'sync_page',resource:resources[kind],failure:'page_failed'});const message=/^Skybox |^Unexpected Skybox|^Duplicate Skybox/.test(error.message)?error.message:'Skybox sync page failed; it will retry.';await rpc('failure',{lease,kind,message});results.push({kind,error:message});}
   }
   await rpc('release',{lease});lease=null;return reply({message:'Sync pass finished. Further pages continue automatically.',results});
  }catch(error){report(error.diagnostic||{stage:'request_failed',failure:/Timeout|Abort/.test(error.name)?'timeout':'validation_or_unexpected_response'});if(lease)try{await rpc('release',{lease});}catch{}if(/^Skybox |^Unexpected Skybox/.test(error.message))return reply({error:error.message},400);return reply({error:'Skybox connection could not complete. Check connection status and try again.'},500);}
 };
}

export function retryAfterMs(value,fallback,now=Date.now()){
 if(value==null)return fallback;
 const seconds=Number(value),ms=Number.isFinite(seconds)?seconds*1000:Date.parse(value)-now;
 return Number.isFinite(ms)?Math.max(fallback,Math.ceil(ms)):fallback;
}
