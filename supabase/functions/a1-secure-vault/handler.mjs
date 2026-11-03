export function createHandler({env,fetchImpl=fetch}) {
 const base=env('SUPABASE_URL'),service=env('SUPABASE_SERVICE_ROLE_KEY'),anon=env('SUPABASE_ANON_KEY');
 const actions=new Set(['status','unlock','lock','list','reveal','edit','save','delete','accounts','permissions','grants','audit']);
 const uuid=value=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value||'');
 async function api(path,{token=service,method='GET',body}={}) {
  const r=await fetchImpl(base+path,{method,signal:AbortSignal.timeout(15000),headers:{apikey:token===service?service:anon,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  let data;try{data=await r.json();}catch{data=null;}
  if(!r.ok){const error=new Error('Vault request failed.');error.code=data?.code;error.safe=data?.message;throw error;}
  return data;
 }
 return async req=>{
  const origin=req.headers.get('origin');
  const allowed=!origin||origin==='https://a1dash.a1eei.com'||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const headers={'Content-Type':'application/json','Cache-Control':'no-store, private','Pragma':'no-cache','Vary':'Origin','X-Content-Type-Options':'nosniff','Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS',...(origin&&allowed?{'Access-Control-Allow-Origin':origin}:{})};
  const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
  if(!allowed)return reply({error:'Origin is not allowed.'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply({error:'POST required.'},405);
  try{
   if(Number(req.headers.get('content-length')||0)>24000)return reply({error:'Request is too large.'},413);
   const raw=await req.text();if(raw.length>24000)return reply({error:'Request is too large.'},413);
   let input;try{input=JSON.parse(raw);}catch{return reply({error:'Invalid request.'},400);}
   if(!input||!actions.has(input.action))return reply({error:'Unsupported vault action.'},400);
   const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
   if(!token||token===service)return reply({error:'Sign in to the dashboard again.'},401);
   let actor;try{actor=await api('/auth/v1/user',{token});}catch{return reply({error:'Sign in to the dashboard again.'},401);}
   let session;try{const s=token.split('.')[1];session=JSON.parse(atob(s.replace(/-/g,'+').replace(/_/g,'/'))).session_id;}catch{}
   if(!uuid(actor?.id)||!uuid(session))return reply({error:'Sign in to the dashboard again.'},401);
   const rpc=(action,data={})=>api('/rest/v1/rpc/a1_vault_service',{method:'POST',body:{p_actor:actor.id,p_session:session,p_action:action,p_input:data}});
   if(input.action==='unlock'){
    if(typeof input.password!=='string'||input.password.length<1||input.password.length>2000)return reply({error:'Enter your dashboard password.'},400);
    const attempt=await rpc('unlock_attempt');
    if(!attempt.allowed)return reply({error:'Too many unlock attempts. Try again in 15 minutes.'},429);
    let verified;
    try{verified=await api('/auth/v1/token?grant_type=password',{token:anon,method:'POST',body:{email:actor.email,password:input.password}});}
    catch{return reply({error:'Password was not accepted.'},403);}
    finally{input.password='';}
    try{
     if(verified?.user?.id!==actor.id)return reply({error:'Password was not accepted.'},403);
     return reply(await rpc('unlock'));
    }finally{
     // Reauthentication never replaces the dashboard session. Revoke its
     // temporary Auth session instead of leaving a second login active.
     if(verified?.access_token)try{await api('/auth/v1/logout?scope=local',{token:verified.access_token,method:'POST'});}catch{}
    }
   }
   // Passwords must never enter the general-purpose RPC or audit payload.
   delete input.password;const action=input.action;delete input.action;
   return reply(await rpc(action,input));
  }catch(error){
   const safe=new Set(['Sign in to the dashboard again','Vault access has not been granted','Vault is locked. Enter your dashboard password again','Administrator access required','Choose a regular staff account','Choose valid staff accounts','Vault entry is unavailable','Vault editing has not been granted','This entry changed. Refresh before saving','Enter a name and valid entry type','Entry type cannot be changed','Enter valid entry details','Enter an HTTPS site URL, username, and password','Enter a valid company card number, cardholder, and MM/YY expiration','Choose a vault entry']);
   return reply({error:safe.has(error.safe)?error.safe:'The vault request could not be completed. Please retry.'},error.code==='42501'?403:400);
  }
 };
}
