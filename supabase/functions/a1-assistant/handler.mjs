export function createHandler({env,fetchImpl=fetch}){
 const base=env('SUPABASE_URL'),anon=env('SUPABASE_ANON_KEY');
 return async req=>{
  const origin=req.headers.get('origin'),permitted=!origin||origin==='https://a1dash.a1eei.com'||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type',...(origin&&permitted?{'Access-Control-Allow-Origin':origin}:{})};
  const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
  if(!permitted)return reply({error:'Origin not allowed.'},403);if(req.method==='OPTIONS')return new Response(null,{status:204,headers});if(req.method!=='POST')return reply({error:'POST required.'},405);
  try{
   const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');if(!token)return reply({error:'Please sign in.'},401);
   const raw=await req.text();if(raw.length>12000)return reply({error:'Message is too long.'},413);let body;try{body=JSON.parse(raw);}catch{return reply({error:'Invalid request.'},400);}
   const api=async(path,options={})=>{const r=await fetchImpl(base+path,{...options,headers:{apikey:anon,Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('access');return r.json();};
   let actor;try{actor=await api('/auth/v1/user');}catch{return reply({error:'Please sign in again.'},401);}
   let members,profiles;try{[members,profiles]=await Promise.all([api('/rest/v1/a1_staff?select=is_admin&user_id=eq.'+encodeURIComponent(actor.id)),api('/rest/v1/a1_account_profiles?select=username,allowed_sections,disabled&user_id=eq.'+encodeURIComponent(actor.id))]);}catch{return reply({error:'Unable to check account access.'},403);}
   if(!members?.length||profiles?.[0]?.disabled)return reply({error:'Dashboard access required.'},403);
   try{await api('/rest/v1/rpc/a1_activity_session',{method:'POST',body:JSON.stringify({p_action:'start'})});}catch{return reply({error:'Your dashboard session ended. Sign in again.'},401);}
   // Fail closed for old clients too: provider keys are intentionally never read.
   return reply({configured:false,internalOnly:true,mode:'dashboard-guide'});
  }catch{return reply({error:'Al could not complete that request. Please try again.'},502);}
 };
}
