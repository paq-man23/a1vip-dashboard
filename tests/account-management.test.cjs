const {test}=require('node:test'),assert=require('node:assert/strict');
const base='https://project.supabase.co',id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
async function harness({admin=true,custom}={}){
 const {createHandler}=await import('../supabase/functions/a1-account-management/handler.mjs');const calls=[];
 const handle=createHandler({env:name=>({SUPABASE_URL:base,SUPABASE_SERVICE_ROLE_KEY:'server-secret',SUPABASE_ANON_KEY:'public-key'})[name],fetchImpl:async(url,options)=>{
  const call={url,...options,body:options.body?JSON.parse(options.body):null};calls.push(call);
  const override=custom?.(call);if(override)return override;
  let value=null;
  if(url.endsWith('/auth/v1/user'))value={id};
  else if(url.includes('/rest/v1/a1_staff?'))value=[{is_admin:admin,user_id:id}];
  else if(url.includes('/rest/v1/a1_account_profiles?'))value=[];
  else if(url.endsWith('/auth/v1/admin/users'))value={id:other};
  return new Response(JSON.stringify(value));
 }});
 return {calls,request:async(body,token='user-token',origin='https://a1dash.a1eei.com')=>handle(new Request('https://project.supabase.co/functions/v1/a1-account-management',{method:'POST',headers:{...(token?{Authorization:'Bearer '+token}:{}),Origin:origin},body:JSON.stringify(body)}))};
}
test('anonymous requests cannot invoke account administration',async()=>{const h=await harness();const r=await h.request({action:'create'},null);assert.equal(r.status,401);assert.equal(h.calls.length,0);});
test('regular users and forged admin claims cannot reach privileged operations',async()=>{const h=await harness({admin:false});const r=await h.request({action:'create',is_admin:true});assert.equal(r.status,403);assert.equal(h.calls.length,2);assert.equal(h.calls.some(c=>c.url.includes('/admin/users')),false);});
test('admin user creation confirms identity, registers only a regular account, and sets explicit categories',async()=>{
 const h=await harness();const r=await h.request({action:'create',username:'NewUser',password:'test-only-password',name:'New User',sections:['main'],is_admin:true});assert.equal(r.status,200);
 const auth=h.calls.find(c=>c.url.endsWith('/auth/v1/admin/users'));assert.equal(auth.body.email,'newuser@a1vip.invalid');assert.equal(auth.body.email_confirm,true);assert.equal(auth.body.app_metadata,undefined);
 assert.equal(h.calls.find(c=>c.url.endsWith('/rpc/a1_manage_account')).body.p_action,'register');assert.deepEqual(h.calls.find(c=>c.url.endsWith('/rpc/a1_set_account_access')).body.p_sections,['main']);
 assert.equal(JSON.stringify(await r.json()).includes('test-only-password'),false);
});
test('username-only login rejects disabled accounts before checking a password',async()=>{const h=await harness({custom:c=>c.url.includes('a1_account_profiles?')?new Response(JSON.stringify([{user_id:other,disabled:true}])):null});const r=await h.request({action:'login',username:'disabled',password:'test-only'},null);assert.equal(r.status,400);assert.equal(h.calls.length,1);});
test('untrusted origins are rejected before any account call',async()=>{const h=await harness();assert.equal((await h.request({action:'create'},'user-token','https://unrelated.example')).status,403);assert.equal(h.calls.length,0);});
test('disable revokes database membership before attempting the Auth sign-in ban',async()=>{const h=await harness();assert.equal((await h.request({action:'disable',id:other})).status,200);const manage=h.calls.findIndex(c=>c.url.endsWith('/rpc/a1_manage_account'));const ban=h.calls.findIndex(c=>c.method==='PUT');assert.ok(manage<ban);assert.equal(h.calls[ban].body.ban_duration,'876000h');});
test('a rejected self-disable never reaches the Auth ban',async()=>{const h=await harness({custom:c=>c.url.endsWith('/rpc/a1_manage_account')?new Response(JSON.stringify({message:'You cannot disable your own account'}),{status:400}):null});assert.equal((await h.request({action:'disable',id})).status,400);assert.equal(h.calls.some(c=>c.method==='PUT'),false);});
test('admin email edit updates only Auth without overwriting category or layout settings',async()=>{
 const h=await harness({custom:c=>c.url.includes('a1_account_profiles?')?new Response(JSON.stringify([{user_id:other,admin_role:false}])):null});
 assert.equal((await h.request({action:'email',id:other,email:' New@Example.com ',sections:['main'],blocked_links:[]})).status,200);
 const writes=h.calls.filter(c=>c.method==='PUT'||c.method==='POST');assert.equal(writes.length,1);assert.equal(writes[0].url,base+'/auth/v1/admin/users/'+other);assert.deepEqual(writes[0].body,{email:'new@example.com',email_confirm:true});
});
test('email changes reject regular users, invalid addresses, missing accounts and admin identities',async()=>{
 const denied=await harness({admin:false});assert.equal((await denied.request({action:'email',id:other,email:'new@example.com'})).status,403);
 for(const target of [[],[{user_id:other,admin_role:true}]]){const h=await harness({custom:c=>c.url.includes('a1_account_profiles?')?new Response(JSON.stringify(target)):null});assert.equal((await h.request({action:'email',id:other,email:'new@example.com'})).status,400);assert.equal(h.calls.some(c=>c.method==='PUT'),false);}
 const h=await harness();assert.equal((await h.request({action:'email',id:other,email:'bad'})).status,400);assert.equal(h.calls.some(c=>c.method==='PUT'),false);
});
test('username sign-in uses the changed Auth email and the original account identity',async()=>{
 const h=await harness({custom:c=>{
  if(c.url.includes('a1_account_profiles?'))return new Response(JSON.stringify([{user_id:other,disabled:false}]));
  if(c.url.endsWith('/auth/v1/admin/users/'+other))return new Response(JSON.stringify({id:other,email:'updated@example.com'}));
  if(c.url.includes('/auth/v1/token?'))return new Response(JSON.stringify({access_token:'test-access',refresh_token:'test-refresh'}));
 }});assert.equal((await h.request({action:'login',username:'user1',password:'test-only'},null)).status,200);assert.equal(h.calls.find(c=>c.url.includes('/auth/v1/token?')).body.email,'updated@example.com');
});
