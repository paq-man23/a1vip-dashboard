const {test}=require('node:test'),assert=require('node:assert/strict');
async function harness({auth=true,member=true,disabled=false}={}){
 const {createHandler}=await import('../supabase/functions/a1-assistant/handler.mjs');const calls=[],envReads=[];
 const handler=createHandler({env:name=>{envReads.push(name);return {SUPABASE_URL:'https://project.supabase.co',SUPABASE_ANON_KEY:'public',OPENAI_API_KEY:'must-not-be-used'}[name];},fetchImpl:async(url)=>{
  calls.push(url);const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
  if(url.endsWith('/auth/v1/user'))return auth?json({id:'test-user'}):json({},401);
  if(url.includes('/a1_staff?'))return json(member?[{is_admin:false}]:[]);
  if(url.includes('/a1_account_profiles?'))return json([{username:'test-user',disabled}]);
  if(url.includes('/rpc/a1_activity_session'))return json(new Date().toISOString());
  throw new Error('Unexpected external request');
 }});
 return {calls,envReads,run:async(body={message:'Find private customer'},token='user-token',origin='https://a1dash.a1eei.com')=>{const r=await handler(new Request('https://project.supabase.co/functions/v1/a1-assistant',{method:'POST',headers:{origin,...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)}));return {status:r.status,body:await r.json()};}};
}
test('internal-only endpoint rejects unsigned, disabled and unapproved callers',async()=>{
 for(const options of [{auth:false},{member:false},{disabled:true}]){const h=await harness(options);assert.ok([401,403].includes((await h.run()).status));}
 const h=await harness();assert.equal((await h.run({},'')).status,401);assert.equal((await h.run({},'token','https://evil.invalid')).status,403);
});
test('even old clients with a configured key cannot forward messages to an AI provider',async()=>{
 const h=await harness(),r=await h.run({message:'private customer name',history:[{role:'user',content:'private record'}]});
 assert.equal(r.status,200);assert.deepEqual(r.body,{configured:false,internalOnly:true,mode:'dashboard-guide'});assert.ok(h.calls.every(url=>url.startsWith('https://project.supabase.co/')));assert.equal(h.envReads.includes('OPENAI_API_KEY'),false);
});
test('status explicitly reports internal-only mode without returning messages or secrets',async()=>{
 const h=await harness(),r=await h.run({action:'status'});assert.equal(r.body.internalOnly,true);assert.equal(r.body.configured,false);assert.doesNotMatch(JSON.stringify(r.body),/private|key|secret/);
});
