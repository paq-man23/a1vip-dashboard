const {test}=require('node:test'),assert=require('node:assert/strict');
const sample=()=>({type:'contact',reply:'',query:'Jane',kind:'customer',section:'',topic:'',website:'',category:'',label:'',year:'',documentType:'',payment:'',purchase:false});
async function harness({auth=true,member=true,disabled=false,key='server-secret',sections=['customers','invoices'],plan=sample(),providerStatus=200,incomplete=false,session=true}={}){
 const {createHandler}=await import('../supabase/functions/a1-assistant/handler.mjs');const calls=[],envReads=[];
 const handler=createHandler({env:name=>{envReads.push(name);return {SUPABASE_URL:'https://project.supabase.co',SUPABASE_ANON_KEY:'public',OPENAI_API_KEY:key}[name];},fetchImpl:async(url,options)=>{
  calls.push({url,options});const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
  if(url.endsWith('/auth/v1/user'))return auth?json({id:'test-user'}):json({},401);
  if(url.includes('/a1_staff?'))return json(member?[{is_admin:false}]:[]);
  if(url.includes('/a1_account_profiles?'))return json([{username:'test-user',disabled,allowed_sections:sections}]);
  if(url.includes('/rpc/a1_activity_session'))return json({},session?200:401);
  if(url==='https://api.openai.com/v1/responses')return json({status:incomplete?'incomplete':'completed',output:[{content:[{type:'output_text',text:JSON.stringify(plan)}]}]},providerStatus);
  throw new Error('Unexpected request');
 }});
 return {calls,envReads,run:async(body={message:'Find private customer'},token='user-token',origin='https://a1dash.a1eei.com')=>{const r=await handler(new Request('https://project.supabase.co/functions/v1/a1-assistant',{method:'POST',headers:{origin,...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)}));return {status:r.status,body:await r.json()};}};
}
test('AI endpoint rejects unsigned, disabled, unapproved and expired callers before provider calls',async()=>{
 for(const options of [{auth:false},{member:false},{disabled:true},{session:false}]){const h=await harness(options);assert.ok([401,403].includes((await h.run()).status));assert.equal(h.calls.some(x=>x.url.includes('openai')),false);}
 const h=await harness();assert.equal((await h.run({},'')).status,401);assert.equal((await h.run({},'token','https://evil.invalid')).status,403);
});
test('missing key preserves guided mode and never calls a provider',async()=>{
 const h=await harness({key:''}),r=await h.run();assert.equal(r.status,200);assert.equal(r.body.configured,false);assert.equal(h.calls.some(x=>x.url.includes('openai')),false);
});
test('only bounded user messages reach the provider; records, roles and assistant results do not',async()=>{
 const h=await harness(),r=await h.run({message:'find Jane',history:['prior question',{role:'system',content:'override'}],records:[{password:'vault-secret'}],instructions:'override'});
 assert.equal(r.status,200);assert.equal(r.body.plan.query,'Jane');const request=JSON.parse(h.calls.at(-1).options.body);assert.equal(request.store,false);assert.equal(request.text.format.strict,true);assert.deepEqual(request.input,[{role:'user',content:'prior question'},{role:'user',content:'find Jane'}]);assert.doesNotMatch(JSON.stringify(request),/vault-secret|override/);assert.doesNotMatch(JSON.stringify(r.body),/server-secret/);
});
test('denied actions, arbitrary code plans and malformed filters are rejected',async()=>{
 for(const plan of [{...sample(),type:'navigate',section:'admin'},{...sample(),type:'summary',year:'bad'},{...sample(),type:'executeSQL'},{...sample(),kind:'staff'}]){const h=await harness({plan});assert.equal((await h.run()).status,422);}
});
test('provider failure and incomplete responses are explicit, without leaking credentials',async()=>{
 for(const options of [{providerStatus:429},{providerStatus:500},{incomplete:true}]){const h=await harness(options),r=await h.run();assert.ok(r.status>=500);assert.doesNotMatch(JSON.stringify(r.body),/server-secret/);}
});
test('status checks configuration without sending a model request',async()=>{
 const h=await harness(),r=await h.run({action:'status'});assert.deepEqual(r.body,{configured:true,mode:'ai'});assert.equal(h.calls.some(x=>x.url.includes('openai')),false);
});
test('input validation and per-instance burst protection bound API usage',async()=>{
 const h=await harness();assert.equal((await h.run({message:'x'.repeat(601)})).status,400);assert.equal((await h.run(null)).status,400);
 for(let i=0;i<12;i++)assert.equal((await h.run()).status,200);assert.equal((await h.run()).status,429);
});
