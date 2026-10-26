/* Privileged Auth operations stay on the server; every management action checks current DB membership. */
export function createHandler({env,fetchImpl=fetch}){
 const base=env('SUPABASE_URL'),serviceKey=env('SUPABASE_SERVICE_ROLE_KEY'),anonKey=env('SUPABASE_ANON_KEY');
 async function api(path,{token=serviceKey,method='GET',body}={}){
  const response=await fetchImpl(base+path,{method,headers:{apikey:token===serviceKey?serviceKey:anonKey,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();let data;try{data=text?JSON.parse(text):null;}catch{throw new Error('Account service returned an invalid response.');}
  if(!response.ok)throw new Error(data?.msg||data?.message||data?.error_description||'Account operation failed.');
  return data;
 }
 const username=value=>String(value||'').trim().toLowerCase();
 const validUsername=value=>/^[a-z0-9][a-z0-9_.-]{1,39}$/.test(value);
 const validId=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value||''));
 return async req=>{
  const origin=req.headers.get('origin');
  const permittedOrigin=!origin||origin==='https://a1dash.a1eei.com'||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type','Access-Control-Allow-Methods':'POST, OPTIONS',...(origin&&permittedOrigin?{'Access-Control-Allow-Origin':origin}:{})};
  const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
  if(!permittedOrigin)return reply({error:'Origin is not allowed.'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply({error:'POST required.'},405);
  try{
   if(Number(req.headers.get('content-length')||0)>12000)return reply({error:'Request is too large.'},413);
   const text=await req.text();if(text.length>12000)return reply({error:'Request is too large.'},413);
   const input=JSON.parse(text),action=input.action;
   if(action==='login'){
    const name=username(input.username);
    if(!validUsername(name)||typeof input.password!=='string')return reply({error:'Invalid username or password.'},400);
    const profiles=await api('/rest/v1/a1_account_profiles?select=user_id,disabled&username=eq.'+encodeURIComponent(name)+'&limit=1');
    const profile=profiles?.[0];
    if(!profile||profile.disabled)return reply({error:'Invalid username or password.'},400);
    const staff=await api('/rest/v1/a1_staff?select=user_id&user_id=eq.'+profile.user_id);
    if(!staff?.length)return reply({error:'Invalid username or password.'},400);
    const account=await api('/auth/v1/admin/users/'+profile.user_id);
    try{
     const session=await api('/auth/v1/token?grant_type=password',{token:anonKey,method:'POST',body:{email:account.email,password:input.password}});
     return reply({session});
    }catch{return reply({error:'Invalid username or password.'},400);}
   }
   const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
   if(!token||token===serviceKey)return reply({error:'Sign in as an administrator.'},401);
   let actor;try{actor=await api('/auth/v1/user',{token});}catch{return reply({error:'Sign in as an administrator.'},401);}
   const membership=await api('/rest/v1/a1_staff?select=is_admin&user_id=eq.'+actor.id,{token});
   if(membership?.[0]?.is_admin!==true)return reply({error:'Administrator access required.'},403);
   const manage=(kind,id,name,display)=>api('/rest/v1/rpc/a1_manage_account',{token,method:'POST',body:{p_action:kind,p_user_id:id,p_username:name??null,p_name:display??null}});
   if(action==='create'){
    const name=username(input.username),display=String(input.name||name).trim();
    if(!validUsername(name)||display.length>120)return reply({error:'Use a 2–40 character username with letters, numbers, dots, dashes, or underscores.'},400);
    if(typeof input.password!=='string'||input.password.length<8||input.password.length>200)return reply({error:'Choose a password with at least 8 characters.'},400);
    const allowed=['main','luxury','accounts','travel','social','invoices','customers','vendors','formLetter','tripItinerary'];
    if(!Array.isArray(input.sections)||input.sections.some(x=>!allowed.includes(x)))return reply({error:'Choose valid categories for this user.'},400);
    const existing=await api('/rest/v1/a1_account_profiles?select=user_id&username=eq.'+encodeURIComponent(name));
    if(existing?.length)return reply({error:'That username is already in use.'},400);
    const email=String(input.email||name+'@a1vip.invalid').trim().toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return reply({error:'Enter a valid email address or leave it blank for a temporary account.'},400);
    const created=await api('/auth/v1/admin/users',{method:'POST',body:{email,password:input.password,email_confirm:true,user_metadata:{display_name:display,username:name}}});
    let registered=false;
    try{await manage('register',created.id,name,display);registered=true;await api('/rest/v1/rpc/a1_set_account_access',{token,method:'POST',body:{p_user_id:created.id,p_sections:Array.isArray(input.sections)?input.sections:[],p_blocked:[]}});}
    catch(error){if(!registered){try{await api('/auth/v1/admin/users/'+created.id,{method:'DELETE'});}catch{}}else throw new Error('Account created with no category access. Refresh Accounts and finish its category setup.');throw error;}
    return reply({ok:true,id:created.id});
   }
   if(!validId(input.id))return reply({error:'Choose an account.'},400);
   if(action==='edit'){
    const name=username(input.username),display=String(input.name||'').trim();
    if(!validUsername(name)||display.length>120)return reply({error:'Enter a valid username and name.'},400);
    const profiles=await api('/rest/v1/a1_account_profiles?select=user_id&user_id=eq.'+input.id);
    await manage(profiles?.length?'edit':'register',input.id,name,display);return reply({ok:true});
   }
   if(action==='password'){
    if(typeof input.password!=='string'||input.password.length<8||input.password.length>200)return reply({error:'Choose a password with at least 8 characters.'},400);
    await api('/auth/v1/admin/users/'+input.id,{method:'PUT',body:{password:input.password}});
    await manage('password',input.id);return reply({ok:true});
   }
   if(action==='disable'){
    await manage('disable',input.id);
    try{await api('/auth/v1/admin/users/'+input.id,{method:'PUT',body:{ban_duration:'876000h'}});}
    catch{return reply({error:'Dashboard access was disabled, but the sign-in ban could not be updated. Retry Disable to finish.'},502);}
    return reply({ok:true});
   }
   if(action==='enable'){
    await api('/auth/v1/admin/users/'+input.id,{method:'PUT',body:{ban_duration:'none'}});
    await manage('enable',input.id);return reply({ok:true});
   }
   return reply({error:'Unsupported account action.'},400);
  }catch(error){return reply({error:error.message||'Account operation failed.'},400);}
 };
}
