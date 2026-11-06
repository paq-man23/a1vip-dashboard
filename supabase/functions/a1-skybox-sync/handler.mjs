import {convert,pageUrl,validatePage,resources} from './convert.mjs';
export function createHandler({env,fetchImpl=fetch}) {
 const base=env('SUPABASE_URL'),service=env('SUPABASE_SERVICE_ROLE_KEY'),anon=env('SUPABASE_ANON_KEY');
 async function api(path,{token=service,method='GET',body}={}){
  const r=await fetchImpl(base+path,{method,headers:{apikey:token===service?service:anon,Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),body:body===undefined?undefined:JSON.stringify(body)});
  const data=await r.json();if(!r.ok)throw Error('Dashboard sync request failed');return data;
 }
 const rpc=(action,input={})=>api('/rest/v1/rpc/a1_skybox_service',{method:'POST',body:{p_action:action,p_input:input}});
 return async req=>{
  const origin=req.headers.get('origin'),allowed=!origin||origin==='https://a1dash.a1eei.com'||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const headers={'Content-Type':'application/json','Cache-Control':'no-store, private','Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type','Access-Control-Allow-Methods':'POST, OPTIONS',...(origin&&allowed?{'Access-Control-Allow-Origin':origin}:{})};
  const reply=(v,status=200)=>new Response(JSON.stringify(v),{status,headers});
  if(!allowed)return reply({error:'Origin is not allowed'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply({error:'POST required'},405);
  let lease;
  try{
   const raw=await req.text();if(raw.length>12000)return reply({error:'Request too large'},413);let input;try{input=JSON.parse(raw);}catch{return reply({error:'Invalid request'},400);}
   if(!input||!['status','configure','pause','resume','sync','inventory','scheduled'].includes(input.action))return reply({error:'Unsupported action'},400);
   const scheduled=input.action==='scheduled';
   if(scheduled){const secret=await rpc('scheduler_secret');if(!secret||req.headers.get('x-a1-sync-token')!==secret)return reply({error:'Unauthorized scheduler'},401);}
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
    if(input.action==='status')return reply(await rpc('status',identity));
    if(input.action==='configure'){
     const fields=['accountId','applicationToken','apiToken'];if(fields.some(k=>typeof input[k]!=='string'||!input[k].trim()||input[k].length>2000)||!/^\d+$/.test(input.accountId))return reply({error:'Enter Account ID and both Skybox tokens'},400);
     // Validate all five read endpoints before storing credentials or starting imports.
     const pageBases={};
     await Promise.all(Object.keys(resources).map(async kind=>{
      const u=pageUrl(kind,{page:0,until:new Date().toISOString()});u.searchParams.set('limit','1');
      const r=await fetchImpl(u,{headers:{'X-Account':input.accountId,'X-Api-Token':input.apiToken.trim(),'X-Application-Token':input.applicationToken.trim()},signal:AbortSignal.timeout(12000)});
      if(!r.ok)throw Error(`Skybox ${resources[kind]} access failed (HTTP ${r.status}). Check the account, tokens, and permissions.`);
      const first=await r.json();if(!Array.isArray(first.rows)||!Number.isInteger(first.rowCount))throw Error('Unexpected Skybox response format');
      if(first.rows.some(row=>String(row.accountId)!==input.accountId))throw Error('Skybox returned a different account');
      pageBases[kind]=1;
      if(first.rows.length){u.searchParams.set('pageNumber','1');const probe=await fetchImpl(u,{headers:{'X-Account':input.accountId,'X-Api-Token':input.apiToken.trim(),'X-Application-Token':input.applicationToken.trim()},signal:AbortSignal.timeout(12000)});if(!probe.ok)throw Error('Skybox pagination verification failed');const second=await probe.json();if(!Array.isArray(second.rows))throw Error('Unexpected Skybox pagination');pageBases[kind]=second.rows[0]?.id===first.rows[0].id?1:0;}

     }));
     return reply(await rpc('configure',{...identity,accountId:input.accountId,applicationToken:input.applicationToken.trim(),apiToken:input.apiToken.trim(),pageBases}));
    }
    if(['pause','resume'].includes(input.action))return reply(await rpc(input.action,identity));
    await rpc('authorize',identity);
   }
   const job=await rpc('claim',{manual:!scheduled});if(!job)return reply({message:'Sync is paused, not configured, already running, or waiting for its next refresh.'});lease=job.lease;
   const results=[];
   for(const kind of Object.keys(resources)){
    const state=job.states[kind];if(state)state.pageBase=state.page_base;if(!state||(!job.manual&&new Date(state.next_due)>new Date()))continue;
    try{
     const response=await fetchImpl(pageUrl(kind,state),{headers:{'X-Account':job.accountId,'X-Api-Token':job.apiToken,'X-Application-Token':job.applicationToken},signal:AbortSignal.timeout(12000)});
     if(!response.ok)throw Error(`Skybox ${resources[kind]} HTTP ${response.status}${response.status===429?' — rate limited; will retry':''}`);
     const page=validatePage(await response.json(),state.page);if(page.rows.length&&page.rows.some(row=>String(row.accountId)!==String(job.accountId)))throw Error('Skybox returned a different account');
     const items=[];let errors=0;
     for(const row of page.rows){try{items.push(convert(kind,row,job.contacts[(kind==='purchase'?'vendor:':'customer:')+(row.vendorId||row.customerId)]));}catch{errors++;}}
     const result=await rpc('apply',{lease,kind,items,errors,total:page.total,done:page.done,page:state.page});results.push({kind,...result});
    }catch(error){const message=/^Skybox |^Unexpected Skybox|^Duplicate Skybox/.test(error.message)?error.message:'Skybox sync page failed; it will retry.';await rpc('failure',{lease,kind,message});results.push({kind,error:message});}
   }
   await rpc('release',{lease});lease=null;return reply({message:'Sync pass finished. Further pages continue automatically.',results});
  }catch(error){if(lease)try{await rpc('release',{lease});}catch{}if(/^Skybox |^Unexpected Skybox/.test(error.message))return reply({error:error.message},400);return reply({error:'Skybox connection could not complete. Check connection status and try again.'},500);}
 };
}
