import { readdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { DOMParser } from '@xmldom/xmldom';
const require=createRequire(import.meta.url);
const S=require(existsSync(new URL('./skybox-import.cjs',import.meta.url))?'./skybox-import.cjs':'../skybox-import.js');
export async function scanExports(folder,now=Date.now()){
  const candidates=[];
  for(const entry of await readdir(folder,{withFileTypes:true})){
    if(!entry.isFile()||entry.name.startsWith('~$')||!/\.(xlsx|csv)$/i.test(entry.name))continue;
    const path=join(folder,entry.name),before=await stat(path);
    if(now-before.mtimeMs<60000)continue;
    if(before.size>15_000_000)throw new Error(entry.name+' exceeds the 15 MB export limit.');
    const bytes=await readFile(path),after=await stat(path);
    if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)continue;
    const hash=createHash('sha256').update(bytes).digest('hex');
    const sheets=/\.xlsx$/i.test(entry.name)?S.xlsx(new Uint8Array(bytes),{unzipSync},DOMParser):[S.table(S.csv(bytes.toString('utf8')),entry.name)];
    candidates.push({name:entry.name,hash,mtime:after.mtimeMs,sheets:sheets.map(s=>({...s,name:entry.name+' / '+s.name}))});
  }
  // Select the latest modified export of each kind; source revision receipts prevent reapplying previously seen records.
  candidates.sort((a,b)=>b.mtime-a.mtime||b.name.localeCompare(a.name));
  const chosen=new Set(),selected=[];
  for(const file of candidates){
    const sheets=file.sheets.filter(s=>{if(chosen.has(s.kind))return false;chosen.add(s.kind);return true;});
    if(sheets.length)selected.push({...file,sheets});
  }
  return selected;
}
export function makePlan(files,processed,contacts){
  const pending=files.filter(f=>!processed[f.hash]);
  const items=S.preview(pending.flatMap(f=>f.sheets),contacts);
  return {pending,items,errors:items.filter(i=>i.error).map(i=>i.file+' row '+i.row+': '+i.error)};
}
const check=r=>{if(r.error)throw new Error(r.error.message);return r.data;};
export async function loadContacts(client){
  const contacts=[];
  for(const kind of ['customer','vendor'])for(let offset=0;;offset+=500){
    const rows=check(await client.from('a1_skybox_contacts').select('document').eq('kind',kind).order('source_id').range(offset,offset+499));
    contacts.push(...rows.map(r=>r.document));if(rows.length<500)break;
  }
  return contacts;
}
export async function synchronize(client,items,progress=()=>{}){
  const result={imported:0,updated:0,skipped:0,conflicts:0,errors:[]};
  for(let offset=0;offset<items.length;offset+=50){
    const batch=items.slice(offset,offset+50);
    if(batch.some(i=>i.error))throw new Error('Blocked preview rows must be fixed before syncing.');
    const rows=check(await client.rpc('a1_sync_skybox_batch',{p_items:batch.map(({kind,sourceId,record,document,presets})=>({kind,sourceId,record,document,presets}))}));
    if(!Array.isArray(rows)||rows.length!==batch.length)throw new Error('Incomplete sync response. Completed rows can be retried safely.');
    rows.forEach((row,index)=>{
      const item=batch[index];
      if(row.outcome==='error')result.errors.push(item.kind+' '+item.sourceId+': '+row.reason);
      else if(row.outcome==='conflict')result.conflicts++;
      else if(['imported','updated','skipped'].includes(row.outcome))result[row.outcome]++;
      else result.errors.push(item.kind+' '+item.sourceId+': Unknown sync result.');
    });
    progress(Math.min(offset+50,items.length),items.length);
  }
  return result;
}
export const xmlEscape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
export function agentPlist({node,script,folder,logs}){
  return '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>'+[
    '<key>Label</key><string>com.a1vip.skybox-sync</string>',
    '<key>ProgramArguments</key><array><string>'+xmlEscape(node)+'</string><string>'+xmlEscape(script)+'</string></array>',
    '<key>StartInterval</key><integer>300</integer><key>RunAtLoad</key><true/>',
    '<key>WatchPaths</key><array><string>'+xmlEscape(folder)+'</string></array>',
    '<key>StandardOutPath</key><string>'+xmlEscape(join(logs,'sync.log'))+'</string>',
    '<key>StandardErrorPath</key><string>'+xmlEscape(join(logs,'error.log'))+'</string>'
  ].join('\n')+'</dict></plist>\n';
}
