/* Standalone vault: no dashboard assistant, analytics, third-party scripts,
   secret caching, automatic filling, or secrets in URLs. */
(() => {
 'use strict';
 if(window.top!==window.self){document.body.replaceChildren();return;}
 const $=id=>document.getElementById(id),config=window.A1_SUPABASE_CONFIG;
 const client=window.supabase.createClient(config.url,config.publishableKey,{auth:{autoRefreshToken:false,detectSessionInUrl:false}});
 let unlockToken='',expires=0,epoch=0,permissions=null,items=[],editing=null,shared=null,revealTimer,expiryTimer,busy=false;
 let importSheets=[],importRows=[],importBatch='',importEpoch=0,filePickerPending=false,pickerTimer;
 const say=message=>{$('status').textContent=message;};
 async function request(action,body={},permitLocked=false){
  const generation=epoch;
  if(!permitLocked&&(!unlockToken||Date.now()>=expires)){lock();throw new Error('Vault is locked. Enter your dashboard password again.');}
  const {data:{session}}=await client.auth.getSession();
  if(!session)throw new Error('Sign in to the dashboard again.');
  const response=await fetch(config.url+'/functions/v1/a1-secure-vault',{method:'POST',cache:'no-store',signal:AbortSignal.timeout(20000),headers:{apikey:config.publishableKey,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({action,...body,...(!permitLocked?{unlock_token:unlockToken}:{})})});
  const result=await response.json();
  if(generation!==epoch)throw new Error('Vault is locked.');
  if(!response.ok){if(response.status===403||response.status===401)lock();throw new Error(result.error||'The vault request failed.');}
  return result;
 }
 function clearReveal(){clearTimeout(revealTimer);$('reveal').close();$('revealDetails').replaceChildren();$('revealTitle').textContent='';}
 function clearEditor(){ $('editor').close();$('entryForm').reset();$('entryPassword').type='password';$('entryNumber').type='password';editing=null;$('editorMessage').textContent='';}
 function lock(notify=true){
  const wasOpen=!!unlockToken;unlockToken='';expires=0;epoch++;clearTimeout(expiryTimer);clearReveal();clearEditor();$('sharing').close();shared=null;
  clearImport();clearTimeout(pickerTimer);filePickerPending=false;
  items=[];$('items').replaceChildren();$('accounts').replaceChildren();$('audit').replaceChildren();$('shareAccounts').replaceChildren();
  $('unlockPassword').value='';$('content').hidden=true;$('lock').hidden=true;$('locked').hidden=!permissions||!(permissions.passwords||permissions.cards);say('Vault locked.');
  if(notify&&wasOpen)void request('lock',{},true).catch(()=>{});
 }
 async function checkAccess(){
  try{permissions=await request('status',{},true);$('locked').hidden=!(permissions.passwords||permissions.cards);say($('locked').hidden?'Vault access has not been granted. Ask an administrator.':'Your dashboard password unlocks only the entries assigned to you.');}
  catch(error){say(error.message);$('locked').hidden=true;}
 }
 function button(label,fn){const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',()=>Promise.resolve().then(fn).catch(error=>say(error.message)));return b;}
 function text(tag,value){const n=document.createElement(tag);n.textContent=value;return n;}
 function panel(name){for(const id of ['items','access','audit']){$(id+'Panel').hidden=id!==name;$(id+'Tab').classList.toggle('is-active',id===name);$(id+'Tab').setAttribute('aria-pressed',String(id===name));}}
 async function load(){items=await request('list');render();}
 function render(){
  const query=$('search').value.toLowerCase();$('items').replaceChildren();
  const visible=items.filter(i=>[i.label,i.site_host,i.last_four].some(v=>String(v).toLowerCase().includes(query)));
  if(!visible.length)$('items').append(text('p',items.length?'No matching entries.':'No entries have been assigned to you yet.'));
  for(const i of visible){
   const card=text('article','');card.className='card';card.append(text('h3',i.label),text('p',i.kind==='login'?(i.site_host||'Site login'):'Company card •••• '+i.last_four));
   const actions=text('div','');actions.className='toolbar';actions.append(button('Reveal',()=>reveal(i)));
   if(permissions.can_edit)actions.append(button('Edit',()=>edit(i)),button('Delete',async()=>{if(confirm('Permanently delete '+i.label+'?')){await request('delete',{id:i.id,version:i.version});await load();}}));
   if(permissions.admin)actions.append(button('Share',()=>share(i)));
   card.append(actions);$('items').append(card);
  }
 }
 async function reveal(item){
  const result=await request('reveal',{id:item.id});clearReveal();const d=result.details;$('revealTitle').textContent=result.label;
  A1VaultDetails.render($('revealDetails'),result.kind,d,{copy:async(value,label)=>{await navigator.clipboard.writeText(value);say('Copied '+label.toLowerCase()+'.');},onError:error=>say(error.message)});
  $('reveal').showModal();revealTimer=setTimeout(clearReveal,30000);
 }
 async function siteOptions(){
  const select=$('siteLinks');select.replaceChildren(new Option('Choose a site link (optional)',''));
  try{
   const {data,error}=await client.from('a1_button_layout').select('state').eq('id',true).single();if(error)return;
   const seen=new Set();
   function walk(value){if(!value||typeof value!=='object')return;if(typeof value.url==='string'&&/^https:\/\//.test(value.url)&&!seen.has(value.url)){seen.add(value.url);select.add(new Option(String(value.label||value.name||value.url),value.url));}for(const v of Object.values(value))if(typeof v==='object')walk(v);}
   walk(data?.state);
  }catch{}
 }
 async function edit(item=null,kind='login'){
  clearEditor();const result=item?await request('edit',{id:item.id}):{kind,label:'',details:{}};
  editing={id:result.id||null,kind:result.kind,version:result.version};
  $('editorTitle').textContent=result.id?'Edit '+result.label:result.kind==='login'?'Add site login':'Add company card';$('entryLabel').value=result.label;
  const d=result.details;$('loginFields').hidden=result.kind!=='login';$('cardFields').hidden=result.kind!=='card';
  for(const [id,key] of [['entryUrl','url'],['entryUsername','username'],['entryPassword','password'],['entryCardholder','cardholder'],['entryNumber','number'],['entryExpiry','expiry'],['entryBilling','billing'],['entryNotes','notes']])$(id).value=d[key]||'';
  $('entryUrl').required=false;$('entryPassword').required=result.kind==='login';
  for(const id of ['entryCardholder','entryNumber','entryExpiry'])$(id).required=result.kind==='card';
  $('editor').showModal();if(result.kind==='login')void siteOptions();
 }
 async function save(event){
  event.preventDefault();if(busy||!editing)return;busy=true;$('saveEntry').disabled=true;
  try{
   const details=editing.kind==='login'?{url:$('entryUrl').value.trim(),username:$('entryUsername').value,password:$('entryPassword').value,notes:$('entryNotes').value}:{cardholder:$('entryCardholder').value,number:$('entryNumber').value,expiry:$('entryExpiry').value,billing:$('entryBilling').value,notes:$('entryNotes').value};
   await request('save',{...editing,label:$('entryLabel').value.trim(),details});clearEditor();await load();say('Entry saved. Use Share to grant access to other accounts.');
  }catch(error){if(unlockToken)$('editorMessage').textContent=error.message;else say(error.message);}
  finally{busy=false;$('saveEntry').disabled=false;}
 }
 async function accounts(){
  const rows=await request('accounts');$('accounts').replaceChildren();
  for(const row of rows){
   const card=text('div','');card.className='account';card.append(text('h3',row.name+(row.admin?' — Administrator':'')));
   if(row.admin){card.append(text('p','Full vault access. Administrator role is unchanged.'));$('accounts').append(card);continue;}
   const controls={};
   for(const [key,label] of [['passwords','Site passwords'],['cards','Company cards'],['can_edit','Add, edit, and delete assigned entries']]){const l=text('label',''),input=document.createElement('input');input.type='checkbox';input.checked=row[key];l.className='check';l.append(input,document.createTextNode(label));controls[key]=input;card.append(l);}
   card.append(button('Save permissions',async()=>{await request('permissions',{user_id:row.id,...Object.fromEntries(Object.entries(controls).map(([k,i])=>[k,i.checked]))});say('Vault permissions updated. Administrator privileges are unchanged.');}));
   if(new URL(location.href).searchParams.get('account')===row.id){card.id='selectedAccount';setTimeout(()=>card.scrollIntoView({block:'center'}),0);}
   $('accounts').append(card);
  }
 }
 async function share(item){
  const [rows,grants]=await Promise.all([request('accounts'),request('grants',{id:item.id})]);shared=item;$('sharingTitle').textContent='Share '+item.label;$('shareAccounts').replaceChildren();$('sharingMessage').textContent='';
  for(const row of rows.filter(r=>!r.admin)){
   const l=text('label',''),input=document.createElement('input');input.type='checkbox';input.value=row.id;input.checked=grants.includes(row.id);l.className='check';
   const allowed=item.kind==='login'?row.passwords:row.cards;l.append(input,document.createTextNode(row.name+(allowed?'':' (category permission also required)')));$('shareAccounts').append(l);
  }
  $('sharing').showModal();
 }
 async function audit(){
  const rows=await request('audit');$('audit').replaceChildren();for(const row of rows){const n=text('div',new Date(row.created_at).toLocaleString()+' · '+row.actor+' · '+row.action+(row.item_id?' · Entry '+row.item_id:''));n.className='event';$('audit').append(n);}
 }
 function clearImport(){
  importEpoch++;
  for(const row of importRows)row.password='';
  for(const sheet of importSheets)for(const row of sheet.rows)for(const cell of row.cells)if(cell)cell.value='';
  importSheets=[];importRows=[];importBatch='';$('importFile').value='';$('importPreview').replaceChildren();$('importSheet').replaceChildren();$('importMessage').textContent='';$('confirmImport').disabled=true;$('importDialog').close();
 }
 const importFields={label:'importLabelColumn',username:'importUsernameColumn',password:'importPasswordColumn',url:'importUrlColumn',notes:'importNotesColumn'};
 function importMapping(){return Object.fromEntries(Object.entries(importFields).map(([key,id])=>[key,Number($(id).value)]));}
 function configureImportSheet(){
  const sheet=importSheets[Number($('importSheet').value)];if(!sheet)return;
  const detected=A1VaultImport.detect(sheet);$('importHeaders').checked=detected.headers;
  for(const [key,id] of Object.entries(importFields)){
   const select=$(id);select.replaceChildren(new Option('Not included','-1'));
   for(let col=0;col<sheet.columns;col++){let n=col+1,label='';while(n){n--;label=String.fromCharCode(65+n%26)+label;n=Math.floor(n/26);}select.add(new Option('Column '+label,String(col)));}
   select.value=String(detected.mapping[key]);
  }
 }
 function importSelected(){return importRows.filter(row=>row.checked&&!row.issues.length&&(!row.existing||row.keepSeparate));}
 function importConflicts(rows){const groups=new Map();for(const row of rows)if(!row.keepSeparate){const key=A1VaultImport.identity(row);groups.set(key,(groups.get(key)||0)+1);}return [...groups.values()].some(n=>n>1);}
 function refreshImportSelection(){
  const groups=new Map();for(const row of importRows){const key=A1VaultImport.identity(row);groups.set(key,(groups.get(key)||0)+1);}
  for(const row of importRows){
   row.duplicate=groups.get(A1VaultImport.identity(row))>1;
   row.issues=[...row.sourceIssues,...A1VaultImport.validate(row)];
   if(row.issues.length||row.existing&&!row.keepSeparate){row.checked=false;row.check.checked=false;}
   row.check.disabled=!!row.issues.length||row.existing&&!row.keepSeparate;
   row.separateCheck.hidden=!(row.existing||row.duplicate);row.separateCheck.disabled=!!row.issues.length;
   row.status.textContent=row.issues.length?row.issues.join('. '):row.keepSeparate?'A separate login will be added':row.existing?'Already in vault — kept unchanged':row.duplicate?'Repeated site/account — select one or keep separately':row.url?'Ready':'Ready — add website link later';
  }
  const selected=importSelected(),duplicateSelected=importConflicts(selected);
  $('confirmImport').disabled=busy||!selected.length||selected.length>200||duplicateSelected;
  $('confirmImport').textContent='Import '+selected.length+' selected login'+(selected.length===1?'':'s');
  $('importMessage').textContent=duplicateSelected?'For repeated site/accounts, select one version or check Keep separately for the additional login.':selected.length>200?'Select at most 200 rows per import.':importRows.length+' rows. '+selected.length+' selected. Passwords are masked.';
 }
 async function previewImport(){
  if(!permissions?.admin||!unlockToken)return;
  const sheet=importSheets[Number($('importSheet').value)];if(!sheet)return;
  const generation=++importEpoch;
  for(const row of importRows)row.password='';importRows=[];$('importPreview').replaceChildren();$('confirmImport').disabled=true;
  try{
   const rows=A1VaultImport.preview(sheet,importMapping(),$('importHeaders').checked);importBatch=crypto.randomUUID();
   const checkable=rows.filter(row=>!row.issues.length).slice(0,200);
   const check=checkable.length?await request('preview_import',{entries:checkable.map(row=>({row:row.row,label:row.label,username:row.username}))}):{existing_rows:[]};
   if(generation!==importEpoch||!unlockToken){for(const row of rows)row.password='';return;}
   const table=text('table',''),head=text('thead',''),heading=text('tr','');for(const label of ['Import','Excel row','Site / account name','Username / email','Password','Website URL','Keep separately','Review'])heading.append(text('th',label));head.append(heading);table.append(head);const body=text('tbody','');
   importRows=rows;
   for(const row of rows){
    const tr=text('tr',''),checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.setAttribute('aria-label','Import Excel row '+row.row);
    row.existing=check.existing_rows.includes(row.row);row.checked=!row.issues.length&&!row.duplicate&&!row.existing;checkbox.checked=row.checked;row.check=checkbox;
    row.sourceIssues=row.issues.filter(x=>/Formula|formatting|Boolean|Excel error/.test(x));
    const choose=text('td','');choose.append(checkbox);tr.append(choose,text('td',row.row));
    for(const key of ['label','username']){const td=text('td','');if(key==='label'){const input=document.createElement('input');input.value=row[key];input.maxLength=120;input.setAttribute('aria-label','Site name for Excel row '+row.row);input.addEventListener('input',()=>{row.label=input.value.trim();row.existing=false;refreshImportSelection();});td.append(input);}else td.textContent=row[key];tr.append(td);}
    tr.append(text('td',row.password?'••••••••':'Missing'));const urlCell=text('td',''),url=document.createElement('input');url.type='url';url.value=row.url;url.placeholder='Add later';url.maxLength=2000;url.setAttribute('aria-label','Website URL for Excel row '+row.row);url.addEventListener('input',()=>{row.url=url.value.trim();refreshImportSelection();});urlCell.append(url);tr.append(urlCell);
    const separateCell=text('td',''),separate=document.createElement('input');separate.type='checkbox';separate.setAttribute('aria-label','Keep Excel row '+row.row+' as a separate login');row.separateCheck=separate;separate.addEventListener('change',()=>{row.keepSeparate=separate.checked;row.checked=separate.checked;checkbox.checked=row.checked;refreshImportSelection();});separateCell.append(separate);tr.append(separateCell);
    row.status=text('td','');tr.append(row.status);checkbox.addEventListener('change',()=>{row.checked=checkbox.checked;refreshImportSelection();});body.append(tr);
   }
   table.append(body);$('importPreview').append(table);refreshImportSelection();
  }catch(error){if(generation===importEpoch)$('importMessage').textContent=error.message;}
 }
 async function chooseImportFile(){
  clearTimeout(pickerTimer);filePickerPending=false;
  const file=$('importFile').files?.[0];if(!file||!permissions?.admin||!unlockToken)return;
  const generation=epoch;
  try{
   if(!/\.xlsx$/i.test(file.name)||file.size>A1VaultImport.MAX_FILE)throw new Error('Choose an .xlsx workbook smaller than 5 MB.');
   const bytes=new Uint8Array(await file.arrayBuffer());if(generation!==epoch){bytes.fill(0);return;}
   let sheets;try{sheets=A1VaultImport.readXlsx(bytes,window.fflate,DOMParser);}finally{bytes.fill(0);}
   clearImport();importSheets=sheets;
   for(let i=0;i<sheets.length;i++)$('importSheet').add(new Option(sheets[i].name+(sheets[i].hidden?' (hidden sheet)':''),String(i)));
   $('importSheet').value=String(Math.max(0,sheets.findIndex(s=>!s.hidden&&s.rows.length)));
   configureImportSheet();$('importDialog').showModal();await previewImport();
  }catch(error){clearImport();say(error.message);}
 }
 async function commitImport(){
  if(busy||!permissions?.admin||!unlockToken)return;
  const selected=importSelected();if(!selected.length||selected.length>200||importConflicts(selected))return;
  const entries=selected.map(row=>({row:row.row,label:row.label.trim(),username:row.username.trim(),password:row.password,url:row.url,notes:row.notes,keep_separate:!!row.keepSeparate}));busy=true;for(const control of $('importDialog').querySelectorAll('input,select,button'))control.disabled=true;
  try{
   const result=await request('import_logins',{batch_id:importBatch,entries});clearImport();await load();say('Imported '+result.created+' logins. '+result.skipped+' existing entries kept unchanged. All administrators can see the imported entries.');
  }catch(error){if(unlockToken)$('importMessage').textContent=error.message;else say(error.message);}
  finally{for(const row of entries)row.password='';busy=false;for(const control of $('importDialog').querySelectorAll('input,select,button'))control.disabled=false;if(importRows.length)refreshImportSelection();}
 }
 $('unlockForm').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;busy=true;$('unlockButton').disabled=true;
  try{
   const password=$('unlockPassword').value;$('unlockPassword').value='';
   const result=await request('unlock',{password},true);unlockToken=result.unlock_token;expires=Date.parse(result.expires_at);expiryTimer=setTimeout(lock,Math.max(0,expires-Date.now()));
   permissions=await request('status',{},true);$('locked').hidden=true;$('content').hidden=false;$('lock').hidden=false;
   $('accessTab').hidden=!permissions.admin;$('auditTab').hidden=!permissions.admin;
   $('addLogin').hidden=!(permissions.can_edit&&permissions.passwords);$('addCard').hidden=!(permissions.can_edit&&permissions.cards);
   $('importExcel').hidden=!permissions.admin;
   panel('items');await load();say('Vault unlocked for five minutes.');
   if(permissions.admin&&new URL(location.href).searchParams.has('account')){panel('access');await accounts();}
  }catch(error){lock();say(error.message);}finally{busy=false;$('unlockButton').disabled=false;}
 });
 $('lock').addEventListener('click',()=>lock());$('entryForm').addEventListener('submit',save);$('search').addEventListener('input',render);
 $('addLogin').addEventListener('click',()=>edit().catch(e=>say(e.message)));$('addCard').addEventListener('click',()=>edit(null,'card').catch(e=>say(e.message)));
 $('cancelEditor').addEventListener('click',clearEditor);$('editor').addEventListener('cancel',e=>{e.preventDefault();clearEditor();});
 $('closeReveal').addEventListener('click',clearReveal);$('reveal').addEventListener('cancel',e=>{e.preventDefault();clearReveal();});
 $('showPassword').addEventListener('change',()=>$('entryPassword').type=$('showPassword').checked?'text':'password');
 $('siteLinks').addEventListener('change',()=>{if($('siteLinks').value){$('entryUrl').value=$('siteLinks').value;if(!$('entryLabel').value)$('entryLabel').value=$('siteLinks').selectedOptions[0].textContent;}});
 $('cancelSharing').addEventListener('click',()=>{$('sharing').close();shared=null;});
 $('sharingForm').addEventListener('submit',async e=>{e.preventDefault();if(!shared||busy)return;busy=true;try{await request('grants',{id:shared.id,users:[...$('shareAccounts').querySelectorAll('input:checked')].map(i=>i.value)});$('sharing').close();shared=null;say('Entry sharing updated.');}catch(error){$('sharingMessage').textContent=error.message;}finally{busy=false;}});
 $('itemsTab').addEventListener('click',()=>panel('items'));
 $('accessTab').addEventListener('click',()=>{panel('access');accounts().catch(e=>say(e.message));});
 $('auditTab').addEventListener('click',()=>{panel('audit');audit().catch(e=>say(e.message));});
 $('importExcel').addEventListener('click',event=>{if(!permissions?.admin||!unlockToken)return;if(event.isTrusted){filePickerPending=true;clearTimeout(pickerTimer);pickerTimer=setTimeout(()=>{filePickerPending=false;if(unlockToken)lock();},60000);}$('importFile').click();});
 $('importFile').addEventListener('change',chooseImportFile);$('importFile').addEventListener('cancel',()=>{filePickerPending=false;clearTimeout(pickerTimer);});
 window.addEventListener('focus',()=>{if(filePickerPending)setTimeout(()=>{filePickerPending=false;clearTimeout(pickerTimer);},0);});
 $('importSheet').addEventListener('change',()=>{configureImportSheet();void previewImport();});
 for(const id of [...Object.values(importFields),'importHeaders'])$(id).addEventListener('change',()=>{for(const row of importRows)row.password='';importRows=[];importBatch='';importEpoch++;$('importPreview').replaceChildren();$('confirmImport').disabled=true;$('importMessage').textContent='Columns changed. Click Preview rows to review the mapping.';});
 $('rebuildImport').addEventListener('click',()=>void previewImport());$('confirmImport').addEventListener('click',()=>void commitImport());$('cancelImport').addEventListener('click',clearImport);$('importDialog').addEventListener('cancel',event=>{event.preventDefault();clearImport();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)lock();});
 window.addEventListener('pagehide',()=>{lock(false);});
 window.addEventListener('blur',()=>{if(unlockToken&&!filePickerPending)lock();});
 client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'||event==='PASSWORD_RECOVERY'){lock();permissions=null;$('locked').hidden=true;say('Sign in to the dashboard again.');}});
 void checkAccess();
})();
