/* Standalone vault: no dashboard assistant, analytics, third-party scripts,
   secret caching, automatic filling, or secrets in URLs. */
(() => {
 'use strict';
 if(window.top!==window.self){document.body.replaceChildren();return;}
 const $=id=>document.getElementById(id),config=window.A1_SUPABASE_CONFIG;
 const client=window.supabase.createClient(config.url,config.publishableKey,{auth:{autoRefreshToken:false,detectSessionInUrl:false}});
 let unlockToken='',expires=0,epoch=0,permissions=null,items=[],editing=null,shared=null,revealTimer,expiryTimer,busy=false;
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
 function panel(name){for(const id of ['items','access','audit'])$(id+'Panel').hidden=id!==name;}
 async function load(){items=await request('list');render();}
 function render(){
  const query=$('search').value.toLowerCase();$('items').replaceChildren();
  const visible=items.filter(i=>[i.label,i.site_host,i.last_four].some(v=>String(v).toLowerCase().includes(query)));
  if(!visible.length)$('items').append(text('p',items.length?'No matching entries.':'No entries have been assigned to you yet.'));
  for(const i of visible){
   const card=text('article','');card.className='card';card.append(text('h3',i.label),text('p',i.kind==='login'?i.site_host:'Company card •••• '+i.last_four));
   const actions=text('div','');actions.className='toolbar';actions.append(button('Reveal',()=>reveal(i)));
   if(permissions.can_edit)actions.append(button('Edit',()=>edit(i)),button('Delete',async()=>{if(confirm('Permanently delete '+i.label+'?')){await request('delete',{id:i.id,version:i.version});await load();}}));
   if(permissions.admin)actions.append(button('Share',()=>share(i)));
   card.append(actions);$('items').append(card);
  }
 }
 async function reveal(item){
  const result=await request('reveal',{id:item.id});clearReveal();const d=result.details;$('revealTitle').textContent=result.label;
  const fields=result.kind==='login'?[['Website',d.url],['Username',d.username],['Password',d.password],['Notes',d.notes]]:[['Cardholder',d.cardholder],['Card number',d.number],['Expiration',d.expiry],['Billing address',d.billing],['Notes',d.notes]];
  for(const [label,value] of fields){
   if(!value)continue;const row=text('div','');row.append(text('strong',label));const p=text('p',value);p.className='secret';row.append(p,button('Copy '+label.toLowerCase(),async()=>{await navigator.clipboard.writeText(value);say('Copied '+label.toLowerCase()+'.');}));$('revealDetails').append(row);
  }
  if(result.kind==='login'){
   try{const url=new URL(d.url);if(url.protocol==='https:'&&!url.username&&!url.password){const a=text('a','Open website');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';$('revealDetails').append(a);}}catch{}
  }
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
  $('entryUrl').required=result.kind==='login';$('entryPassword').required=result.kind==='login';
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
 $('unlockForm').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;busy=true;$('unlockButton').disabled=true;
  try{
   const password=$('unlockPassword').value;$('unlockPassword').value='';
   const result=await request('unlock',{password},true);unlockToken=result.unlock_token;expires=Date.parse(result.expires_at);expiryTimer=setTimeout(lock,Math.max(0,expires-Date.now()));
   permissions=await request('status',{},true);$('locked').hidden=true;$('content').hidden=false;$('lock').hidden=false;
   $('accessTab').hidden=!permissions.admin;$('auditTab').hidden=!permissions.admin;
   $('addLogin').hidden=!(permissions.can_edit&&permissions.passwords);$('addCard').hidden=!(permissions.can_edit&&permissions.cards);
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
 document.addEventListener('visibilitychange',()=>{if(document.hidden)lock();});
 window.addEventListener('pagehide',()=>{lock(false);});
 window.addEventListener('blur',()=>{if(unlockToken)lock();});
 client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'||event==='PASSWORD_RECOVERY'){lock();permissions=null;$('locked').hidden=true;say('Sign in to the dashboard again.');}});
 void checkAccess();
})();
