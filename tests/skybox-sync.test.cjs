const {test}=require('node:test'),assert=require('node:assert/strict');const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const core=()=>import('../mac-sync/core.mjs');
const csv='Customer ID,Display Name,Email,First Name,Last Name,Company\n123,Example,person@example.invalid,First,Last,Company';
test('folder scan waits for copies, ignores lock files, and selects the newest export per kind',async()=>{
 const {scanExports}=await core();const dir=await fs.mkdtemp(path.join(os.tmpdir(),'a1-sync-'));try{
  const now=Date.now();for(const [name,age] of [['old.csv',300000],['new.csv',120000],['copying.csv',10000],['~$lock.csv',200000]]){const p=path.join(dir,name);await fs.writeFile(p,csv);await fs.utimes(p,new Date(now-age),new Date(now-age));}
  await fs.symlink(path.join(dir,'new.csv'),path.join(dir,'linked.csv'));
  const files=await scanExports(dir,now);assert.equal(files.length,1);assert.equal(files[0].name,'new.csv');assert.match(files[0].hash,/^[a-f0-9]{64}$/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('completed file hashes skip while new exports are validated before any write',async()=>{
 const {makePlan}=await core();const record={'Customer ID':'123','Display Name':'Example','Email':'','First Name':'First','Last Name':'Last','Company':''};
 const files=[{name:'file',hash:'one',sheets:[{name:'file',kind:'customer',records:[record]}]}];assert.equal(makePlan(files,{one:{}},[]).items.length,0);assert.equal(makePlan(files,{},[]).items.length,1);
 const invalid=[{...files[0],sheets:[{name:'file',kind:'customer',records:[{...record,'Customer ID':''}]}]}];assert.equal(makePlan(invalid,{},[]).errors.length,1);
});
test('batch sync counts updates and preserved conflicts, and supports retry after a failed row',async()=>{
 const {synchronize}=await core();const items=Array.from({length:51},(_,i)=>({kind:'invoice',sourceId:String(i),record:{},document:{},presets:{}}));const calls=[];
 const client={rpc:async(name,args)=>{calls.push({name,args});return {data:args.p_items.map((_,i)=>({outcome:i===0?'updated':i===1?'conflict':i===2?'error':'skipped',reason:'review fixture'}))};}};
 const result=await synchronize(client,items);assert.equal(calls.length,2);assert.equal(calls[0].args.p_items.length,50);assert.equal(result.updated,2);assert.equal(result.conflicts,1);assert.equal(result.errors.length,1);
 await assert.rejects(synchronize(client,[{error:'bad'}]),/Blocked preview/);
});
test('LaunchAgent uses absolute escaped paths and a five-minute interval without credentials',async()=>{
 const {agentPlist}=await core();const xml=agentPlist({node:'/opt/node',script:'/Users/JAW/Library/Application Support/Sync/sync.mjs',folder:'/Users/JAW/skyexport & exports',logs:'/Users/JAW/logs'});
 assert.match(xml,/<integer>300<\/integer>/);assert.match(xml,/skyexport &amp; exports/);assert.match(xml,/<key>WatchPaths<\/key>/);assert.match(xml,/<key>RunAtLoad<\/key><true\/>/);assert.doesNotMatch(xml,/password|refresh_token|access_token/);
});
