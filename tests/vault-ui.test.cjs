const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync('vault.html','utf8'),code=fs.readFileSync('vault.js','utf8');
const tick=()=>new Promise(r=>setImmediate(r));
async function ui({admin=true,custom}={}){
 const dom=new JSDOM(html,{url:'https://a1dash.a1eei.com/vault.html',runScripts:'outside-only'}),w=dom.window,calls=[];
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.HTMLElement.prototype.scrollIntoView=function(){};w.AbortSignal=AbortSignal;w.confirm=()=>true;
 w.A1_SUPABASE_CONFIG={url:'https://fixture.supabase.co',publishableKey:'fixture'};
 w.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'fixture'}}}),onAuthStateChange(){}},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{state:{added:{accounts:[{label:'Fixture tickets',url:'https://tickets.example.invalid/'}]}}}})})})})})};
 w.fetch=async(url,options)=>{const input=JSON.parse(options.body);calls.push(input);const overridden=await custom?.(input);if(overridden)return overridden;let result={ok:true};
  if(input.action==='status')result={admin,passwords:true,cards:admin,can_edit:admin};
  if(input.action==='unlock')result={unlock_token:'fixture-unlock-token',expires_at:new Date(Date.now()+300000).toISOString()};
  if(input.action==='list')result=[{id:'fixture-login',kind:'login',label:'Fixture tickets',site_host:'tickets.example.invalid',last_four:'',version:1}];
  if(input.action==='reveal'||input.action==='edit')result={id:'fixture-login',kind:'login',label:'Fixture tickets',version:1,details:{username:'fixture-user',password:'SYNTHETIC-SECRET',url:'https://tickets.example.invalid/'}};
  if(input.action==='accounts')result=[{id:'sales',name:'Fixture salesperson',admin:false,passwords:true,cards:false,can_edit:false}];
  if(input.action==='grants')result=['sales'];
  return {ok:true,status:200,json:async()=>result};
 };
 w.eval(code);await tick();await tick();
 const $=id=>w.document.getElementById(id);
 async function unlock(){ $('unlockPassword').value='synthetic-dashboard-password';$('unlockForm').dispatchEvent(new w.Event('submit',{cancelable:true}));for(let i=0;i<5;i++)await tick();}
 return {w,$,calls,unlock,close:()=>w.close()};
}
test('vault unlocks with existing password, masks list values, clears reveal details, and never caches its unlock',async()=>{
 const h=await ui();try{await h.unlock();assert.equal(h.$('content').hidden,false);assert.equal(h.$('unlockPassword').value,'');assert.ok(!h.w.document.body.textContent.includes('SYNTHETIC-SECRET'));
 h.$('items').querySelector('button').click();for(let i=0;i<3;i++)await tick();assert.equal(h.$('reveal').open,true);assert.ok(h.$('revealDetails').textContent.includes('SYNTHETIC-SECRET'));
 h.$('closeReveal').click();assert.equal(h.$('revealDetails').textContent,'');assert.equal(h.w.localStorage.length,0);assert.equal(h.w.sessionStorage.length,0);
 h.$('lock').click();assert.equal(h.$('items').textContent,'');assert.equal(h.$('content').hidden,true);
 }finally{h.close();}
});
test('read-only salesperson has no admin, card, sharing, or editing controls',async()=>{
 const h=await ui({admin:false});try{await h.unlock();assert.equal(h.$('accessTab').hidden,true);assert.equal(h.$('auditTab').hidden,true);assert.equal(h.$('addCard').hidden,true);assert.equal(h.$('addLogin').hidden,true);assert.deepEqual([...h.$('items').querySelectorAll('button')].map(b=>b.textContent),['Reveal']);}finally{h.close();}
});
test('blur and pagehide clear editor secrets and the unlocked screen',async()=>{
 for(const event of ['blur','pagehide']){const h=await ui();try{await h.unlock();h.$('addLogin').click();await tick();h.$('entryPassword').value='SYNTHETIC-UNSAVED';h.w.dispatchEvent(new h.w.Event(event));assert.equal(h.$('entryPassword').value,'');assert.equal(h.$('content').hidden,true);assert.equal(h.$('editor').open,false);}finally{h.close();}}
});
test('late secret responses cannot restore values after the vault locks',async()=>{
 let release;const delayed=new Promise(r=>release=r);
 const h=await ui({custom:async input=>input.action==='reveal'?delayed:null});try{await h.unlock();h.$('items').querySelector('button').click();await tick();h.$('lock').click();release({ok:true,status:200,json:async()=>({label:'Late',kind:'login',details:{password:'LATE-SECRET'}})});for(let i=0;i<4;i++)await tick();assert.equal(h.$('reveal').open,false);assert.ok(!h.w.document.body.textContent.includes('LATE-SECRET'));}finally{h.close();}
});
test('revoked backend access locks and empties the vault immediately',async()=>{
 const h=await ui({custom:async input=>input.action==='reveal'?{ok:false,status:403,json:async()=>({error:'Vault entry is unavailable'})}:null});try{await h.unlock();h.$('items').querySelector('button').click();for(let i=0;i<4;i++)await tick();assert.equal(h.$('content').hidden,true);assert.equal(h.$('items').textContent,'');assert.equal(h.$('status').textContent,'Vault entry is unavailable');}finally{h.close();}
});
test('creating a linked login sends only chosen fields and clears password inputs on save',async()=>{
 const h=await ui();try{await h.unlock();h.$('addLogin').click();for(let i=0;i<3;i++)await tick();h.$('siteLinks').value='https://tickets.example.invalid/';h.$('siteLinks').dispatchEvent(new h.w.Event('change'));assert.equal(h.$('entryUrl').value,'https://tickets.example.invalid/');h.$('entryUsername').value='fixture';h.$('entryPassword').value='NEW-SYNTHETIC';h.$('entryForm').dispatchEvent(new h.w.Event('submit',{cancelable:true}));for(let i=0;i<4;i++)await tick();const save=h.calls.find(c=>c.action==='save');assert.equal(save.kind,'login');assert.equal(save.details.password,'NEW-SYNTHETIC');assert.equal(save.unlock_token,'fixture-unlock-token');assert.equal(h.$('entryPassword').value,'');assert.equal(h.$('editor').open,false);}finally{h.close();}
});
