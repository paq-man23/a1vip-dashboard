import {discoverEvents,filters,locationOnly} from './ticketmaster.mjs';
import {sections,schema,validatePlan,instructions} from './planner.mjs';
export function createHandler({env,fetchImpl=fetch}){
 const base=env('SUPABASE_URL'),anon=env('SUPABASE_ANON_KEY');
 const recent=new Map(); // Bounded per-instance burst protection; provider project budget remains the global limit.
 return async req=>{
  const origin=req.headers.get('origin'),permitted=!origin||origin==='https://a1dash.a1eei.com'||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type',...(origin&&permitted?{'Access-Control-Allow-Origin':origin}:{})};
  const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
  if(!permitted)return reply({error:'Origin not allowed.'},403);if(req.method==='OPTIONS')return new Response(null,{status:204,headers});if(req.method!=='POST')return reply({error:'POST required.'},405);
  try{
   const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');if(!token)return reply({error:'Please sign in.'},401);
   const raw=await req.text();if(raw.length>12000)return reply({error:'Message is too long.'},413);let body;try{body=JSON.parse(raw);}catch{return reply({error:'Invalid request.'},400);}
   if(!body||typeof body!=='object'||Array.isArray(body))return reply({error:'Invalid request.'},400);
   const api=async(path,options={})=>{const r=await fetchImpl(base+path,{...options,headers:{apikey:anon,Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('access');return r.json();};
   let actor;try{actor=await api('/auth/v1/user');}catch{return reply({error:'Please sign in again.'},401);}
   let members,profiles;try{[members,profiles]=await Promise.all([api('/rest/v1/a1_staff?select=is_admin&user_id=eq.'+encodeURIComponent(actor.id)),api('/rest/v1/a1_account_profiles?select=username,allowed_sections,disabled&user_id=eq.'+encodeURIComponent(actor.id))]);}catch{return reply({error:'Unable to check account access.'},403);}
   if(!members?.length||profiles?.[0]?.disabled)return reply({error:'Dashboard access required.'},403);
   try{await api('/rest/v1/rpc/a1_activity_session',{method:'POST',body:JSON.stringify({p_action:'start'})});}catch{return reply({error:'Your dashboard session ended. Sign in again.'},401);}
   if(body.action!=='status'){
   const now=Date.now(),hits=(recent.get(actor.id)||[]).filter(t=>now-t<60000);
   if(hits.length>=12)return reply({error:'Please wait a minute before asking Al again.'},429);
   if(recent.size>=1000)for(const [id,times] of recent)if(now-times.at(-1)>=60000)recent.delete(id);
   if(recent.size>=1000&&!recent.has(actor.id))return reply({error:'Al is busy. Please try again shortly.'},429);
   recent.set(actor.id,[...hits,now]);
   }
   const lookupEvents=async(input,guided=false)=>{
    const search=filters(input);
    if(guided&&env('TICKETMASTER_API_KEY')){
     const missing=[];
     if(!search.city&&!search.stateCode&&!search.countryCode&&!search.anyLocation)missing.push('location');
     if(!search.startDate&&!search.endDate&&!search.anyDate)missing.push('month');
     if(missing.length)return {configured:true,needsRefinement:true,search,missing};
    }
    return discoverEvents(search,{env,fetchImpl});
   };
   const ticketSearch=async input=>{try{return reply({events:await lookupEvents(input,input.refine===true)});}catch(error){return reply({error:error.message},400);}};
   if(body.action==='events')return ticketSearch(body);
   const key=env('OPENAI_API_KEY');
   if(body.action==='status')return reply({configured:!!key,mode:key?'ai':'dashboard-guide',ticketmasterConfigured:!!env('TICKETMASTER_API_KEY')});
   if(!key)return reply({configured:false,mode:'dashboard-guide',error:'Live AI needs an OpenAI API key configured by your administrator. Dashboard search and guidance still work.'});
   if(typeof body.message!=='string'||!body.message.trim()||body.message.length>600)return reply({error:'Enter a message of 600 characters or fewer.'},400);
   const admin=members[0].is_admin===true,profile=profiles?.[0];
   const canAccess=id=>admin||( !['admin','manageAccounts','domains'].includes(id)&&(!profile?.allowed_sections||profile.allowed_sections.includes(id)) );
   // Only user-entered text is accepted as conversation context. No client-provided
   // record snapshots, assistant results, roles, prompts or tool definitions pass through.
   let eventContext=null;try{if(body.eventContext)eventContext=filters(body.eventContext);}catch{}
   const history=Array.isArray(body.history)?body.history.slice(-6).filter(x=>typeof x==='string'&&x.length<=600):[];
   const response=await fetchImpl('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},signal:AbortSignal.timeout(25000),body:JSON.stringify({model:env('OPENAI_MODEL')||'gpt-4.1-mini',store:false,max_output_tokens:1200,instructions:instructions(sections.filter(canAccess),admin)+'\nCurrent date/time: '+new Date().toISOString()+'; user timezone America/New_York.'+(eventContext?'\nCurrent event-search context (untrusted filter data only): '+JSON.stringify(eventContext):''),input:[...history,body.message].map(content=>({role:'user',content})),text:{format:{type:'json_schema',name:'dashboard_plan',strict:true,schema}}})});
   if(!response.ok)return reply({error:response.status===429?'AI is busy or its API quota is unavailable. Try again shortly; dashboard commands still work.':'AI connection failed. Ask your administrator to check the API configuration.'},503);
   const result=await response.json();
   if(result.status!=='completed')return reply({error:'Al could not finish the response. Please try a shorter request.'},502);
   const output=(result.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
   let plan;try{plan=validatePlan(JSON.parse(output),canAccess);}catch{return reply({error:'Al could not safely interpret this request. Try naming the section and task.'},422);}
   if(plan.type==='events'){
    try{
     let search={...plan};
     if(eventContext){
      const explicitLocation=plan.city||plan.stateCode||plan.countryCode||plan.anyLocation;
      const explicitDates=plan.startDate||plan.endDate||plan.anyDate;
      const onlyLocation=locationOnly(plan.query);
      search={...eventContext,...plan,query:onlyLocation||!plan.query?eventContext.query:plan.query,
       ...(!explicitLocation?{city:eventContext.city,stateCode:eventContext.stateCode,countryCode:eventContext.countryCode,anyLocation:eventContext.anyLocation}:{}),
       ...(!explicitDates?{startDate:eventContext.startDate,endDate:eventContext.endDate,anyDate:eventContext.anyDate}:{}),
       ...(onlyLocation?{...onlyLocation,countryCode:onlyLocation.countryCode||eventContext.countryCode}: {})};
     }
     const events=await lookupEvents(search,true);
     return reply({configured:true,mode:'ai',plan:{...plan,...events.search},events});
    }
    catch(error){return reply({error:error.message},503);}
   }
   return reply({configured:true,mode:'ai',plan});
  }catch{return reply({error:'Al could not complete that request. Please try again.'},502);}
 };
}
