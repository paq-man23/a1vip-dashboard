/* Admin account controls and category visibility; authority is checked again in Supabase. */
(() => {
 const sections=[['main','Main Links'],['luxury','Suites'],['accounts','Ticket Accounts'],['travel','Travel'],['social','Social'],['invoices','Invoices & POs'],['customers','Customers'],['vendors','Vendors'],['formLetter','Letters'],['tripItinerary','Trips']];
 let rows=[],selected=null,mode='edit',busy=false;
 const node=id=>document.getElementById(id);
 function button(label,action){const b=document.createElement('button');b.type='button';b.className='btn';b.textContent=label;b.addEventListener('click',action);return b;}
 async function load(){
  if(!A1Data.isAdmin())return;
  node('accountManagerMessage').textContent='Loading accounts…';
  try{
   const result=await A1Data.listAccounts();if(!A1Data.isAdmin())return;rows=result;
   const list=node('accountManagerList');list.replaceChildren();
   for(const row of rows){
    const card=document.createElement('div');card.className='managed-account';
    const heading=document.createElement('strong');heading.textContent=(row.is_admin?'★ ':'')+(row.username||row.email)+(row.self?' (you)':'');
    const detail=document.createElement('p');detail.textContent=(row.name?row.name+' · ':'')+row.email+' · '+(row.is_admin?'Admin':'User')+' · '+(row.enabled?'Active':'Disabled / not approved');
    const last=document.createElement('p');last.textContent='Last signed in: '+(row.last_sign_in_at?new Date(row.last_sign_in_at).toLocaleString():'Never');
    const actions=document.createElement('div');actions.className='invoice-toolbar';
    actions.append(button('Profile & Categories',()=>edit(row)),...(!row.is_admin?[button('Edit Email',()=>showEditor('email',row))]:[]),button('Assigned Links / Layout',()=>A1Activity.customize(true,row.id)),button('Set Password',()=>password(row)));
    const access=button(row.enabled?'Disable Access':'Restore Access',()=>setEnabled(row));access.disabled=row.self;actions.append(access);
    card.append(heading,detail,last,actions);list.append(card);
   }
   node('accountManagerMessage').textContent=rows.length+' accounts. Admin roles are protected; new accounts are regular users.';
  }catch(error){node('accountManagerMessage').textContent=error.message;}
 }
 function showEditor(kind,row=null){
  if(!A1Data.isAdmin())return;selected=row;mode=kind;
  node('accountEditorForm').reset();node('managedMessage').textContent='';
  node('accountEditorTitle').textContent=kind==='create'?'Add User':kind==='password'?'Set Password — '+(row.username||row.email):kind==='email'?'Edit Email — '+(row.username||row.email):'Account & Category Access';
  node('managedUsername').value=row?.username||'';node('managedName').value=row?.name||'';node('managedEmail').value=row?.email||'';
  node('managedUsername').readOnly=!!row?.is_admin;node('managedEmail').readOnly=!!row?.is_admin||kind==='password';node('managedEmail').required=kind==='email'||(kind==='edit'&&!row?.is_admin);
  node('managedUsername').required=kind==='create'||kind==='edit';node('managedPassword').required=kind==='create'||kind==='password';
  for(const id of ['managedUsername','managedName','managedEmail'])node(id).closest('label').hidden=kind==='password'||(kind==='email'&&id!=='managedEmail');
  node('managedPasswordLabel').hidden=kind==='edit'||kind==='email';node('managedCategories').hidden=kind==='password'||kind==='email'||!!row?.is_admin;
  node('managedRole').textContent=row?.is_admin?'Administrator — full access. Only JAW and JV have this role.':'Regular user — choose allowed categories below.';
  const list=node('managedCategoryList');list.replaceChildren();
  for(const [id,label] of sections){const l=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=id;input.checked=!row||row.allowed_sections===null||row.allowed_sections===undefined||row.allowed_sections.includes(id);l.append(input,document.createTextNode(' '+label));list.append(l);}
  node('managedSave').disabled=false;node('accountEditor').showModal();
 }
 function create(){showEditor('create');}function edit(row){showEditor('edit',row);}function password(row){showEditor('password',row);}
 async function save(event){
  event.preventDefault();if(busy||!A1Data.isAdmin())return;busy=true;node('managedSave').disabled=true;node('managedMessage').textContent='Saving…';
  try{
   const allowed=[...node('managedCategoryList').querySelectorAll('input:checked')].map(i=>i.value);
   if(mode==='email'){
    await A1Data.accountAction({action:'email',id:selected.id,email:node('managedEmail').value});
   }else if(mode==='password'){
    await A1Data.accountAction({action:'password',id:selected.id,password:node('managedPassword').value});
   }else if(mode==='create'){
    await A1Data.accountAction({action:'create',username:node('managedUsername').value,name:node('managedName').value,email:node('managedEmail').value,password:node('managedPassword').value,sections:allowed});
   }else{
    const email=node('managedEmail').value.trim().toLowerCase();
    if(!selected.is_admin&&email!==selected.email.toLowerCase())await A1Data.accountAction({action:'email',id:selected.id,email});
    if(node('managedUsername').value!==selected.username||node('managedName').value!==(selected.name||''))await A1Data.accountAction({action:'edit',id:selected.id,username:node('managedUsername').value,name:node('managedName').value});
    const previous=selected.allowed_sections??sections.map(([id])=>id);
    if(!selected.is_admin&&(allowed.length!==previous.length||allowed.some(id=>!previous.includes(id)))){
     const current=await A1Data.accountPermissions(selected.id);
     await A1Data.setAccountAccess(selected.id,allowed,current.blocked_links||[]);
    }
   }
   node('managedPassword').value='';node('accountEditor').close();await load();
  }catch(error){node('managedMessage').textContent=error.message;}
  finally{busy=false;node('managedSave').disabled=false;}
 }
 async function setEnabled(row){
  if(busy||!A1Data.isAdmin()||row.self)return;
  if(!confirm((row.enabled?'Disable':'Restore')+' dashboard access for '+(row.username||row.email)+'?'))return;
  busy=true;try{await A1Data.accountAction({action:row.enabled?'disable':'enable',id:row.id});await load();}catch(error){node('accountManagerMessage').textContent=error.message;}finally{busy=false;}
 }
 function applyAccess(){
  if(!A1Data.authenticated())return;
  for(const button of document.querySelectorAll('[data-category]'))button.classList.toggle('a1-category-denied',!A1Data.canAccess(button.dataset.category));
  for(const section of document.querySelectorAll('.section')){
   const allowed=A1Data.canAccess(section.id);section.classList.toggle('a1-category-denied',!allowed);
   if(!allowed&&section.style.display==='block'){
    section.style.display='none';const first=sections.find(([id])=>A1Data.canAccess(id));if(first)window.showSection(first[0]);
   }
  }
  const empty=node('noCategoriesAssigned');if(empty)empty.hidden=sections.some(([id])=>A1Data.canAccess(id));
  const denied=new Set(A1Data.isAdmin()?[]:A1Data.blockedLinks());
  for(const b of document.querySelectorAll('.grid[data-section]>.btn'))b.classList.toggle('a1-admin-link-denied',denied.has(A1Activity.buttonKey(b))||A1Data.linkBlocked?.(b.dataset.url)||!A1Data.canAccess(b.closest('.grid').dataset.section));
 }
 document.addEventListener('DOMContentLoaded',()=>{
  window.addEventListener('a1-signed-out',()=>{rows=[];node('accountManagerList')?.replaceChildren();node('accountEditor')?.close();if(node('managedPassword'))node('managedPassword').value='';});
 });
 window.A1Accounts={load,create,save,applyAccess,sections};
})();
