const {test}=require('node:test'),assert=require('node:assert/strict');
const id='11111111-1111-4111-8111-111111111111',sid='22222222-2222-4222-8222-222222222222';
async function harness({member=true,checked=false,ip='1.1.1.1',failGeo=false}={}){
 const {createHandler}=await import('../supabase/functions/a1-login-location/handler.mjs'),calls=[];
 const handle=createHandler({env:k=>({SUPABASE_URL:'https://project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'secret',SUPABASE_ANON_KEY:'public'})[k],fetchImpl:async(url,options={})=>{
  calls.push({url,...options,body:options.body?JSON.parse(options.body):undefined});let value;
  if(url.endsWith('/auth/v1/user'))value={id};else if(url.includes('a1_staff?'))value=member?[{user_id:id}]:[];
  else if(options.method==='PATCH')return new Response(null,{status:204});else if(url.includes('a1_activity_sessions?'))value=[{id:sid,login_ip:ip,login_location_checked_at:checked?'2026-01-01':null}];
  else {if(failGeo)throw Error('Lookup unavailable');value={ip,city:'Example City',region:'Example State',country:'Example Country',latitude:10,longitude:20};}
  return new Response(JSON.stringify(value));
 }});const token='test.'+Buffer.from(JSON.stringify({sub:id,session_id:sid})).toString('base64url')+'.test';
 return {calls,run:()=>handle(new Request('https://project.supabase.co/functions/v1/a1-login-location',{method:'POST',headers:{Authorization:'Bearer '+token,Origin:'https://a1dash.a1eei.com'},body:JSON.stringify({user_id:'forged',ip:'8.8.8.8'})}))};
}
test('login lookup uses the server-recorded IP and stores only coarse location, without exposing results to users',async()=>{
 const h=await harness(),r=await h.run();assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true});const geo=h.calls.find(c=>c.url.startsWith('https://api.ipapi.is'));assert.equal(geo.url,'https://api.ipapi.is?q=1.1.1.1');assert.equal(geo.headers,undefined);const patch=h.calls.find(c=>c.method==='PATCH');assert.equal(patch.body.login_city,'Example City');assert.equal(patch.body.latitude,undefined);assert.equal(patch.body.longitude,undefined);assert.ok(h.calls.find(c=>c.url.includes('auth_session_id=eq.'+sid)));
});
test('nonstaff and previously checked sessions never query the geolocation provider',async()=>{
 for(const args of [{member:false},{checked:true}]){const h=await harness(args),r=await h.run();assert.equal(r.status,args.member===false?403:200);assert.equal(h.calls.some(c=>c.url.startsWith('https://api.ipapi.is')),false);assert.equal(h.calls.some(c=>c.method==='PATCH'),false);}
});
test('lookup failure and private addresses produce unavailable location without failing sign-in',async()=>{
 for(const args of [{failGeo:true},{ip:'192.168.1.1'}]){const h=await harness(args);assert.equal((await h.run()).status,200);const patch=h.calls.find(c=>c.method==='PATCH');assert.equal(patch.body.login_city,null);if(args.ip)assert.equal(h.calls.some(c=>c.url.startsWith('https://api.ipapi.is')),false);}
});
