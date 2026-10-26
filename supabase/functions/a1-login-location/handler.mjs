import { isIP } from 'node:net';
export function publicIP(ip){
 if(isIP(ip)===4){const [a,b]=ip.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127);}
 return isIP(ip)===6&&!/^(?:::|fc|fd|fe[89ab]|ff)/i.test(ip);
}
export function createHandler({env,fetchImpl=fetch}){
 const base=env('SUPABASE_URL'),secret=env('SUPABASE_SERVICE_ROLE_KEY'),anon=env('SUPABASE_ANON_KEY');let limitedUntil=0;
 async function api(path,token=secret,method='GET',body){
  const r=await fetchImpl(base+path,{method,headers:{apikey:token===secret?secret:anon,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(5000)});
  if(!r.ok)throw Error('Login location could not be recorded.');return r.status===204?null:r.json();
 }
 return async req=>{
  const origin=req.headers.get('origin');const allowed=!origin||origin==='https://a1dash.a1eei.com';
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type','Access-Control-Allow-Methods':'POST, OPTIONS',...(origin&&allowed?{'Access-Control-Allow-Origin':origin}:{})};
  const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
  if(!allowed)return reply({error:'Origin not allowed.'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply({error:'POST required.'},405);
  const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');if(!token||token===secret)return reply({error:'Sign in required.'},401);
  try{
   let actor;try{actor=await api('/auth/v1/user',token);}catch{return reply({error:'Sign in required.'},401);}
   const claims=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))),sid=claims.session_id;
   if(claims.sub!==actor.id||!/^[a-f0-9-]{36}$/i.test(sid||''))return reply({error:'Signed-in session required.'},401);
   const member=await api('/rest/v1/a1_staff?select=user_id&user_id=eq.'+actor.id);
   if(!member?.length)return reply({error:'Staff access required.'},403);
   const rows=await api('/rest/v1/a1_activity_sessions?select=id,login_ip,login_location_checked_at&user_id=eq.'+actor.id+'&auth_session_id=eq.'+sid+'&ended_at=is.null&limit=1');
   const row=rows?.[0];if(!row||row.login_location_checked_at)return reply({ok:true});
   let location={login_city:null,login_region:null,login_country:null};
   if(row.login_ip&&publicIP(row.login_ip)&&Date.now()>limitedUntil){
    try{
     // Fixed provider endpoint; sends only the recorded IP, never Auth headers or customer data.
     const r=await fetchImpl('https://api.ipapi.is?q='+encodeURIComponent(row.login_ip),{signal:AbortSignal.timeout(4000),redirect:'error'});
     if(r.status===429)limitedUntil=Date.now()+86400000;
     if(r.ok){const data=await r.json();if(data.ip===row.login_ip){const clean=v=>typeof v==='string'?v.trim().slice(0,120)||null:null;location={login_city:clean(data.city),login_region:clean(data.region),login_country:clean(data.country)};}}
    }catch{ /* Lookup failure must never block dashboard sign-in. */ }
   }
   await api('/rest/v1/a1_activity_sessions?id=eq.'+row.id+'&login_location_checked_at=is.null',secret,'PATCH',{...location,login_location_checked_at:new Date().toISOString()});
   return reply({ok:true});
  }catch{return reply({error:'Login location could not be recorded.'},502);}
 };
}
