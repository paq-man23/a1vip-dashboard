// Run with Playwright installed in the development environment.
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;const filename=path.join(root,pathname);try{const content=fs.readFileSync(filename);res.setHeader('Content-Type',filename.endsWith('.js')?'application/javascript':filename.endsWith('.css')?'text/css':'text/html');res.end(content);}catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 let browser;
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/vendor/supabase-2.99.1.js',r=>r.fulfill({contentType:'application/javascript',body:`window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'fixture-token'}}}),onAuthStateChange(){}},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{state:{added:{accounts:[{label:'Fixture tickets',url:'https://tickets.example.invalid'}]}}}})})})})})};`}));
  const saved=[];let admin=true,denied=false;
  await page.route('**/functions/v1/a1-secure-vault',async r=>{
   const input=r.request().postDataJSON();let data={ok:true};let status=200;
   if(input.action==='status')data={admin,passwords:true,cards:admin,can_edit:admin};
   if(input.action==='unlock')data={unlock_token:'fixture-unlock',expires_at:new Date(Date.now()+300000).toISOString()};
   if(input.action==='list')data=[{id:'fixture-login',kind:'login',label:'Fixture tickets',site_host:'tickets.example.invalid',last_four:'',version:1}];
   if(input.action==='reveal')data={label:'Fixture tickets',kind:'login',details:{username:'fixture-user',password:'SYNTHETIC-REVEAL-ONLY',url:'https://tickets.example.invalid'}};
   if(input.action==='save'){saved.push(input);data={id:'saved-fixture',version:1};}
   if(input.action==='accounts')data=[{id:'sales',name:'Fixture sales',admin:false,passwords:true,cards:false,can_edit:false}];
   if(input.action==='grants')data=['sales'];
   if(input.action==='audit')data=[{actor:'Fixture admin',action:'reveal',created_at:new Date().toISOString()}];
   if(denied&&input.action==='reveal'){data={error:'Vault entry is unavailable'};status=403;}
   await r.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':origin},body:JSON.stringify(data)});
  });
  async function unlock(){await page.locator('#unlockPassword').fill('synthetic-password');await page.locator('#unlockButton').click();await page.locator('#items .card').waitFor();}
  await page.goto(origin+'/vault.html');await unlock();
  assert.ok(!(await page.locator('body').innerText()).includes('SYNTHETIC-REVEAL-ONLY'));
  await page.screenshot({path:'/tmp/a1-vault-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'Reveal',exact:true}).click();await page.getByText('SYNTHETIC-REVEAL-ONLY',{exact:true}).waitFor();
  await page.locator('#closeReveal').click();assert.ok(!(await page.locator('body').innerText()).includes('SYNTHETIC-REVEAL-ONLY'));
  await page.locator('#addLogin').click();await page.locator('#entryLabel').fill('New login');await page.locator('#entryUrl').fill('https://new.example.invalid/');await page.locator('#entryUsername').fill('fixture');await page.locator('#entryPassword').fill('SYNTHETIC-SAVED');await page.locator('#saveEntry').click();await page.locator('#editor').waitFor({state:'hidden'});assert.equal(saved.at(-1).details.password,'SYNTHETIC-SAVED');assert.equal(await page.locator('#entryPassword').inputValue(),'');
  await page.locator('#accessTab').click();await page.getByText('Fixture sales',{exact:true}).waitFor();assert.equal(await page.locator('#accounts input[type=checkbox]').count(),3);
  await page.locator('#itemsTab').click();await page.getByRole('button',{name:'Share',exact:true}).click();await page.locator('#sharing').waitFor();assert.equal(await page.locator('#shareAccounts input:checked').count(),1);await page.locator('#cancelSharing').click();
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/a1-vault-mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('#lock').click();assert.equal(await page.locator('#items').innerText(),'');assert.equal(await page.locator('#revealDetails').innerText(),'');
  admin=false;await unlock();assert.equal(await page.locator('#accessTab').isVisible(),false);assert.equal(await page.locator('#addLogin').isVisible(),false);assert.equal(await page.getByRole('button',{name:'Share',exact:true}).count(),0);
  denied=true;await page.getByRole('button',{name:'Reveal',exact:true}).click();await page.getByText('Vault entry is unavailable',{exact:true}).waitFor();assert.equal(await page.locator('#content').isVisible(),false);
  denied=false;await unlock();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));assert.equal(await page.locator('#content').isVisible(),false);
  assert.deepEqual(errors,[]);console.log('PASS: masked list, reveal cleanup, create, permissions, sharing, mobile layout, regular-user restrictions, revoked access and blur locking');
 }finally{await browser?.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
