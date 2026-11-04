const {test}=require('node:test'),assert=require('node:assert/strict');
const id='11111111-1111-4111-8111-111111111111',sid='22222222-2222-4222-8222-222222222222';
const jwt='e30.'+Buffer.from(JSON.stringify({session_id:sid})).toString('base64url')+'.signature';
async function harness(custom){
 const {createHandler}=await import('../supabase/functions/a1-secure-vault/handler.mjs');const calls=[];
 const handle=createHandler({env:n=>({SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service',SUPABASE_ANON_KEY:'anon'})[n],fetchImpl:async(url,options)=>{
  const c={url,...options,body:options.body?JSON.parse(options.body):undefined};calls.push(c);const override=custom?.(c);if(override)return override;
  if(url.endsWith('/auth/v1/user'))return Response.json({id,email:'fixture@example.invalid'});
  if(url.includes('/auth/v1/token?'))return Response.json({user:{id},access_token:'temporary-auth-token',refresh_token:'must-never-reach-browser'});
  if(url.includes('/logout?'))return new Response(null,{status:204});
  if(c.body?.p_action==='unlock_attempt')return Response.json({allowed:true});
  if(c.body?.p_action==='unlock')return Response.json({unlock_token:'test-only-unlock',expires_at:'2099-01-01T00:00:00Z'});
  return Response.json({ok:true});
 }});
 return {calls,request:(body,token=jwt,origin='https://a1dash.a1eei.com')=>handle(new Request('https://fixture/functions/v1/a1-secure-vault',{method:'POST',headers:{Origin:origin,...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)}))};
}
test('vault rejects anonymous, service tokens, untrusted origins and malformed actions before privileged calls',async()=>{
 for(const [token,origin,action,status] of [[null,undefined,'list',401],['service',undefined,'list',401],[jwt,'https://evil.example','list',403],[jwt,undefined,'unlock_attempt',400]]){const h=await harness();assert.equal((await h.request({action},token,origin)).status,status);assert.equal(h.calls.length,0);}
});
test('vault never trusts actor, session, admin or verified-password claims in browser input',async()=>{
 const h=await harness();await h.request({action:'list',p_actor:'attacker',p_session:'attacker',is_admin:true,password_verified:true});const rpc=h.calls.at(-1);assert.equal(rpc.body.p_actor,id);assert.equal(rpc.body.p_session,sid);assert.equal(rpc.body.p_action,'list');
});
test('unlock verifies the actual account password, never sends it to SQL, and revokes the temporary login',async()=>{
 const h=await harness(),r=await h.request({action:'unlock',password:'synthetic-password'});assert.equal(r.status,200);
 assert.equal(h.calls.find(c=>c.url.includes('/token?')).body.email,'fixture@example.invalid');
 assert.equal(h.calls.filter(c=>c.url.includes('/rpc/')).some(c=>JSON.stringify(c.body).includes('synthetic-password')),false);
 const body=await r.text();assert.ok(body.includes('test-only-unlock'));assert.ok(!body.includes('temporary-auth-token'));assert.ok(!body.includes('must-never-reach-browser'));
 assert.equal(h.calls.at(-1).headers.Authorization,'Bearer temporary-auth-token');assert.ok(h.calls.at(-1).url.endsWith('/logout?scope=local'));assert.match(r.headers.get('Cache-Control'),/no-store/);
});
test('wrong passwords and throttled attempts cannot create an unlock',async()=>{
 for(const blocked of [false,true]){const h=await harness(c=>blocked&&c.body?.p_action==='unlock_attempt'?Response.json({allowed:false}):c.url.includes('/token?')?Response.json({message:'rejected'},{status:400}):null);
 const r=await h.request({action:'unlock',password:'wrong'});assert.equal(r.status,blocked?429:403);assert.equal(h.calls.some(c=>c.body?.p_action==='unlock'),false);if(blocked)assert.equal(h.calls.some(c=>c.url.includes('/token?')),false);}
});
test('live session and permission failures are returned without database details or secret values',async()=>{
 const h=await harness(c=>c.body?.p_action==='reveal'?Response.json({code:'42501',message:'Vault entry is unavailable'},{status:403}):null);
 const r=await h.request({action:'reveal',id,unlock_token:'not-authorized'});assert.equal(r.status,403);assert.deepEqual(await r.json(),{error:'Vault entry is unavailable'});
 const broken=await harness(c=>c.body?.p_action==='list'?Response.json({message:'internal secret query details'},{status:500}):null);
 assert.ok(!(await (await broken.request({action:'list'})).text()).includes('internal secret'));
});
test('successful password checks for a different identity never unlock the vault',async()=>{
 const h=await harness(c=>c.url.includes('/token?')?Response.json({user:{id:sid},access_token:'temporary-auth-token'}):null);
 assert.equal((await h.request({action:'unlock',password:'synthetic'})).status,403);assert.equal(h.calls.some(c=>c.body?.p_action==='unlock'),false);assert.ok(h.calls.at(-1).url.endsWith('/logout?scope=local'));
});
test('Excel import accepts bounded batches while preserving server identity and rejecting oversized requests',async()=>{
 const h=await harness();const entries=[{row:2,label:'Fixture site',username:'fixture-user',password:'SYNTHETIC-IMPORT',url:'',notes:'x'.repeat(25000),keep_separate:true}];
 const r=await h.request({action:'import_logins',batch_id:sid,unlock_token:'fixture-unlock',entries,p_actor:sid});assert.equal(r.status,200);const rpc=h.calls.at(-1);assert.equal(rpc.body.p_actor,id);assert.equal(rpc.body.p_action,'import_logins');assert.equal(rpc.body.p_input.entries[0].password,'SYNTHETIC-IMPORT');assert.ok(!(await r.text()).includes('SYNTHETIC-IMPORT'));
 const tooLarge=await harness();assert.equal((await tooLarge.request({action:'import_logins',entries:[{notes:'x'.repeat(256001)}]})).status,413);assert.equal(tooLarge.calls.length,0);
});
