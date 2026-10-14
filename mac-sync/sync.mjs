import { createClient } from '@supabase/supabase-js';
import { readFile, writeFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { scanExports,makePlan,loadContacts,synchronize,agentPlist } from './core.mjs';
const directory=dirname(fileURLToPath(import.meta.url));
const configPath=join(directory,'config.json'),statePath=join(directory,'state.json'),lockPath=join(directory,'sync.lock');
const service='com.a1vip.skybox-sync.session',account='dashboard-sync';
const check=r=>{if(r.error)throw new Error(r.error.message);return r.data;};
const log=message=>console.log(new Date().toISOString()+' '+message);
async function jsonFile(path,fallback){try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw new Error('Local sync configuration could not be read. Run Install.command again.');}}
async function saveJson(path,value){const temporary=path+'.tmp';await writeFile(temporary,JSON.stringify(value,null,2),{mode:0o600});await rename(temporary,path);}
function storeSession(session){
  try{
    const saved={access_token:session.access_token,refresh_token:session.refresh_token};
    const payload=JSON.stringify(saved);
    // Feed credentials on stdin instead of exposing them in process arguments.
    const quoted="'"+payload.replaceAll("'", "'\\''")+"'";
    execFileSync('/usr/bin/security',['-i'],{input:'add-generic-password -U -a '+account+' -s '+service+' -w '+quoted+'\n',stdio:['pipe','ignore','ignore']});
    const verified=getSession();
    if(verified.access_token!==saved.access_token||verified.refresh_token!==saved.refresh_token)throw new Error('Keychain verification failed');
  }catch{throw new Error('macOS Keychain could not save the dashboard session. Unlock your login Keychain and try setup again.');}
}
function getSession(){
  try{return JSON.parse(execFileSync('/usr/bin/security',['find-generic-password','-a',account,'-s',service,'-w'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));}
  catch{throw new Error('Dashboard login is missing or unavailable in Keychain. Run Install.command again while logged into your Mac.');}
}
const apple=value=>'"'+String(value).replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('\n',' ')+'"';
function prompt(label,defaultValue='',hidden=false){
  try{
    const answer=execFileSync('/usr/bin/osascript',['-e','text returned of (display dialog '+apple(label)+' default answer '+apple(defaultValue)+(hidden?' with hidden answer':'')+' with title "A1VIP Skybox Sync")'],{encoding:'utf8',stdio:['ignore','pipe','ignore']});
    return hidden?answer.replace(/\r?\n$/,''):answer.trim();
  }catch{throw new Error('Setup was cancelled.');}
}
const publicContext={window:{}};
vm.runInNewContext(await readFile(join(directory,'supabase-config.js'),'utf8'),publicContext);
const publicConfig=publicContext.window.A1_SUPABASE_CONFIG;
const client=createClient(publicConfig.url,publicConfig.publishableKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(url,options={})=>fetch(url,{...options,signal:AbortSignal.timeout(30000)})}});
async function requireStaff(){const identity=check(await client.auth.getUser()).user;const member=check(await client.from('a1_staff').select('user_id').eq('user_id',identity.id).maybeSingle());if(!member)throw new Error('This dashboard account is not approved for A1 staff access.');return identity;}
async function setup(){
  const existing=await jsonFile(configPath,{});
  const identifier=prompt('Dashboard username or email (JAW or JV)',existing.identifier||'JAW');
  const alias=Object.entries(publicConfig.adminAliases||{}).find(([name])=>name.toLowerCase()===identifier.toLowerCase());
  const email=identifier.includes('@')?identifier:alias?.[1];if(!email)throw new Error('Use a configured dashboard username or email.');
  let password=prompt('Dashboard password. It will be used to sign in, then discarded.','',true);
  let response;try{response=await client.auth.signInWithPassword({email,password});}finally{password='';}
  const data=check(response);await requireStaff();storeSession(data.session);
  const folder=join(homedir(),'skyexport');await mkdir(folder,{recursive:true,mode:0o700});
  const machineLabel=prompt('Name shown in the dashboard sync history',existing.machineLabel||'JAW Mac');
  const config={identifier,folder,machineLabel,jobId:existing.jobId||randomUUID()};await saveJson(configPath,config);
  const agents=join(homedir(),'Library','LaunchAgents'),logs=join(directory,'logs');await mkdir(agents,{recursive:true});await mkdir(logs,{recursive:true,mode:0o700});
  const plist=join(agents,'com.a1vip.skybox-sync.plist');
  await writeFile(plist,agentPlist({node:process.execPath,script:join(directory,'sync.mjs'),folder,logs}),{mode:0o600});
  execFileSync('/bin/launchctl',['bootstrap','gui/'+process.getuid(),plist],{stdio:'ignore'});
  log('Setup complete. Export Skybox files to '+folder+'. Checks run every five minutes while this Mac is awake and logged in.');
}
async function authenticate(){const data=check(await client.auth.setSession(getSession()));storeSession(data.session);await requireStaff();}
async function acquireLock(){
  for(let retry=0;retry<2;retry++){
    try{await mkdir(lockPath,{mode:0o700});await saveJson(join(lockPath,'owner.json'),{pid:process.pid});return true;}
    catch(e){if(e.code!=='EEXIST')throw e;}
    const owner=await jsonFile(join(lockPath,'owner.json'),null);let alive=false;
    if(owner?.pid)try{process.kill(owner.pid,0);alive=true;}catch(e){if(e.code==='EPERM')alive=true;}
    if(alive)return false;
    if(!owner&&(Date.now()-(await stat(lockPath)).mtimeMs)<900000)return false;
    await rm(lockPath,{recursive:true,force:true});
  }return false;
}
async function run(){
  const config=await jsonFile(configPath,null);if(!config)throw new Error('Run Install.command to set up folder synchronization first.');
  if(!await acquireLock()){log('Another sync is already running.');return;}
  let runId=null, recordedResult=false;
  try{
    const files=await scanExports(config.folder),state=await jsonFile(statePath,{processed:{}});
    if(!files.some(f=>!state.processed[f.hash]))return;
    await authenticate();
    const contacts=await loadContacts(client),plan=makePlan(files,state.processed,contacts);
    if(process.argv.includes('--dry-run')){log('Preview: '+plan.items.length+' records; '+plan.errors.length+' blocked rows. No records imported.');return;}
    check(await client.from('a1_skybox_sync_runs').update({status:'failed',finished_at:new Date().toISOString(),summary:{message:'Previous local run was interrupted; completed records remain saved.'}}).eq('job_id',config.jobId).eq('status','running'));
    const row=check(await client.from('a1_skybox_sync_runs').insert({job_id:config.jobId,machine_label:config.machineLabel,status:'running',source_files:plan.pending.map(f=>({name:f.name,sha256:f.hash}))}).select('id').single());runId=row.id;
    if(plan.errors.length)throw new Error('Export validation failed: '+plan.errors.slice(0,10).join('; '));
    const result=await synchronize(client,plan.items,(done,total)=>{if(done===total||done%500===0)log('Processed '+done+' of '+total+' records.');});
    const status=result.errors.length?'failed':result.conflicts?'review':'success';
    check(await client.from('a1_skybox_sync_runs').update({status,finished_at:new Date().toISOString(),summary:result}).eq('id',runId));recordedResult=true;
    if(!result.errors.length){for(const f of plan.pending)state.processed[f.hash]={name:f.name,at:new Date().toISOString()};await saveJson(statePath,state);}
    log('Finished: '+result.imported+' new; '+result.updated+' updated; '+result.skipped+' unchanged; '+result.conflicts+' need review; '+result.errors.length+' errors.');
    if(result.errors.length)throw new Error('Some records could not sync. Check Admin sync history. The files will be retried.');
  }catch(error){
    if(runId&&!recordedResult)await client.from('a1_skybox_sync_runs').update({status:'failed',finished_at:new Date().toISOString(),summary:{message:error.message}}).eq('id',runId);
    throw error;
  }finally{await rm(lockPath,{recursive:true,force:true});}
}
try{
  if(process.platform!=='darwin')throw new Error('This installer is for macOS.');
  if(process.argv.includes('--setup'))await setup();else await run();
}catch(error){console.error(new Date().toISOString()+' '+error.message);process.exitCode=1;}
