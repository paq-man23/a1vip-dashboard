/* Skybox review, shared contact directories, and purchase history. */
(() => {
  const $ = id => document.getElementById(id);
  let preview=[], busy=false; const pages={customer:0,vendor:0,purchase:0};
  const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  function message(text){$('skyboxMessage').textContent=text;}
  function reset(){preview=[];$('skyboxPreview').replaceChildren();$('skyboxCommit').disabled=true;$('skyboxFile').value='';message('');}
  async function read(event){
    if(busy)return;
    const selectedFiles = Array.from(event.target.files);
    reset();busy=true;$('skyboxFile').disabled=true;
    try{
      const sheets=[];
      for(const file of selectedFiles){
        if(file.size>15_000_000)throw new Error(file.name+' exceeds the 15 MB limit.');
        message('Reading '+file.name+'…');
        if(/\.xlsx$/i.test(file.name))sheets.push(...A1Skybox.xlsx(new Uint8Array(await file.arrayBuffer()),fflate,DOMParser).map(s=>({...s,name:file.name+' / '+s.name})));
        else if(/\.csv$/i.test(file.name))sheets.push(A1Skybox.table(A1Skybox.csv(await file.text()),file.name));
        else throw new Error('Use .xlsx or .csv Skybox exports.');
      }
      if(!sheets.length)throw new Error('Choose at least one export file.');
      preview=A1Skybox.preview(sheets,A1Data.contacts());
      const counts={};for(const item of preview)counts[item.kind]=(counts[item.kind]||0)+1;
      const errors=preview.filter(i=>i.error);const warnings=preview.filter(i=>i.warning);
      const wrap=$('skyboxPreview');wrap.append(node('p',Object.entries(counts).map(([kind,count])=>count+' '+kind+' records').join(' · ')));
      wrap.append(node('p',errors.length+' rows blocked; '+warnings.length+' documents have review notes.'));
      wrap.append(node('p','Invoice reports become summary invoices. Original ticket sale quantities, seating, prices, and tax breakdowns are not present. Purchase IDs use SB-PO- to keep purchase-order numbers distinct. Customer Credit remains reference information and is not applied to invoices.'));
      for(const item of preview.slice(0,30)){
        const card=node('div');card.className='invoice-history-card';
        card.append(node('strong',item.kind+' · '+(item.label||'row '+item.row)));
        if(item.total!==undefined)card.append(node('p','Original total: '+money(item.total)+' · Converted balance: '+money(item.balance)));
        if(item.error||item.warning)card.append(node('p',item.error||item.warning));
        const details=node('details');details.append(node('summary','View converted record and original fields'));
        const pre=node('pre',JSON.stringify({converted:item.document,original:item.record},null,2));pre.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;max-height:300px;overflow:auto;';details.append(pre);card.append(details);wrap.append(card);
      }
      if(preview.length>30)wrap.append(node('p','Showing the first 30 records. Download the full review to inspect every record and issue before importing.'));
      $('skyboxCommit').disabled=!!errors.length||!preview.length;
      message(errors.length?'Fix the blocked rows and select the files again. No data has been saved.':'Preview ready. Nothing has been saved yet. Review the conversion, then click Import Reviewed Records.');
    }catch(error){message(error.message);preview=[];$('skyboxCommit').disabled=true;}
    finally{busy=false;$('skyboxFile').disabled=false;}
  }
  function download(){
    if(!preview.length){message('Choose export files first.');return;}
    const blob=new Blob([JSON.stringify({format:'a1-skybox-review',version:1,records:preview},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);const a=node('a');a.href=url;a.download='skybox-import-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function commit(){
    if(busy||!preview.length||preview.some(i=>i.error))return;
    if(!confirm('Import these reviewed Skybox records into shared dashboard history? Existing documents will not be overwritten.'))return;
    busy=true;$('skyboxCommit').disabled=true;$('skyboxFile').disabled=true;
    try{
      const r=await A1Data.importSkybox(preview,(done,total)=>message('Importing '+done+' of '+total+'… Keep this page open.'));
      refreshCloudViews();render();
      message(r.imported+' imported; '+r.skipped+' already imported; '+r.conflicts+' invoice-number conflicts preserved under Admin → Imports Needing Review; '+r.changed+' changed source records require review; '+r.errors.length+' issues.\n'+r.errors.join('\n'));
    }catch(error){message('Import stopped: '+error.message+' Earlier completed records remain saved. Re-selecting and importing the same files safely skips completed records.');}
    finally{busy=false;$('skyboxCommit').disabled=false;$('skyboxFile').disabled=false;}
  }
  const compareContacts=(a,b)=>String(a.displayName||a.name||a.company||'').localeCompare(String(b.displayName||b.name||b.company||''),undefined,{sensitivity:'base',numeric:true})||String(a.id).localeCompare(String(b.id));
  const matchesContact=(c,q)=>[c.displayName,c.name,c.company,c.email,c.phone,c.phone2,c.address,c.tags,c.type,c.id].some(v=>String(v||'').toLowerCase().includes(q));
  function directory(kind){
    const wrap=$(kind+'Directory');if(!wrap)return;wrap.replaceChildren();
    const q=($(kind+'Search').value||'').toLowerCase();
    const items=A1Data.contacts().filter(c=>c.kind===kind && matchesContact(c,q)).sort(compareContacts);
    const max=Math.max(0,Math.ceil(items.length/50)-1);pages[kind]=Math.min(pages[kind],max);
    wrap.append(node('p',items.length+' '+(kind==='vendor'?'vendors':'customers')+' · Page '+(pages[kind]+1)+' of '+(max+1)));
    for(const c of items.slice(pages[kind]*50,pages[kind]*50+50)){
      const card=node('div');card.className='invoice-history-card';card.append(node('strong',c.displayName+' · Skybox #'+c.id));
      for(const value of [c.type&&'Type: '+c.type,c.name,c.company,c.email,[c.phone,c.phone2].filter(Boolean).join(' / '),c.address,c.tags&&'Tags: '+c.tags,c.credit&&'Skybox customer credit (reference only): '+c.credit])if(value){const p=node('p',value);p.style.whiteSpace='pre-wrap';card.append(p);}
      const use=node('button',kind==='vendor'?'Use in New Purchase Order':'Use in New Invoice');use.className='btn';use.addEventListener('click',()=>{startNewInvoice(kind==='vendor'?'po-ticket':'invoice-ticket');$('invType').value=kind==='vendor'?'po-ticket':'invoice-ticket';fill(c);openInvoiceMode('editor');showSection('invoices');});card.append(use);wrap.append(card);
    }
    pager(wrap,kind,max);
  }
  function pager(wrap,kind,max){
    for(const [label,delta] of [['Previous',-1],['Next',1]]){const b=node('button',label);b.className='btn';b.disabled=delta<0?pages[kind]===0:pages[kind]>=max;b.addEventListener('click',()=>{pages[kind]+=delta;kind==='purchase'?purchases():directory(kind);});wrap.append(b);}
  }
  function fill(c){
    const map={invClientCompany:c.company||c.displayName,invClientContact:c.name||c.displayName,invClientEmail:c.email,invClientPhone:c.phone,invBillingAddress:c.address,invPaymentType:c.paymentMethod||''};
    for(const [id,value] of Object.entries(map))$(id).value=value||'';
    refreshInvoicePreview();
  }
  function selected(picker){
    const [kind,id]=picker.value.split(':');
    return A1Data.contacts().find(c=>c.kind===kind&&c.id===id);
  }
  function appendLine(id,value){
    const field=$(id);if(!field||!value)return;
    const lines=field.value.split('\n').filter(Boolean);
    if(!lines.includes(value))lines.push(value);
    field.value=lines.join('\n');
  }
  function choose(target='invoice'){
    const picker=$(target==='invoice'?'sharedContactPicker':target==='vendor'?'invoiceVendorPicker':target==='letter'?'letterContactPicker':target==='talent'?'itineraryTalentPicker':'itineraryContactPicker');
    const c=selected(picker);if(!c)return;
    if(target==='invoice')fill(c);
    else if(target==='vendor'){$('invVendor').value=c.displayName;$('invVendorId').value=c.id;}
    else if(target==='letter'){
      $('letterTo').value=c.name||c.displayName;$('letterToEmail').value=c.email||'';refreshLetterPreview();
    }else if(target==='talent'){
      $('itinTalent').value=c.name||c.displayName;refreshItineraryPreview();
    }else{
      const name=c.name||c.displayName;
      const label=c.company&&c.company!==name?name+' ('+c.company+')':name;
      appendLine('itinEventContacts',label);
      const phones=[c.phone,c.phone2].filter(Boolean).join(' / ');
      if(phones)appendLine('itinContactPhones',label+': '+phones);
      const other=[c.email,c.address?.replaceAll('\n',', ')].filter(Boolean).join(' · ');
      if(other)appendLine('itinOtherContactInfo',label+': '+other);
      picker.value='';refreshItineraryPreview();
    }
  }
  function chooseBooking(picker,kind,index){
    const c=selected(picker);if(!c)return;
    const selectors={hotel:['hotel','hotelLocation'],car:['car','company'],flight:['flight','airline']};
    const [line,field]=selectors[kind]||[];if(!line)return;
    const name=document.querySelector(`[data-${line}-line="${index}"][data-field="${field}"]`);
    if(name)name.value=c.company||c.displayName;
    const notes=document.querySelector(`[data-${line}-line="${index}"][data-field="notes"]`);
    const contact=[c.name,c.email,c.phone,c.phone2].filter(Boolean).join(' · ');
    if(notes&&contact&&!notes.value.split('\n').includes(contact))notes.value=[notes.value,contact].filter(Boolean).join('\n');
    refreshItineraryPreview();
  }
  function updatePicker(picker){
    const selectedValue=picker.value;
    const query=(picker._contactSearch?.value||'').trim().toLowerCase();
    picker.replaceChildren();
    const placeholder=node('option',picker.dataset.contactKind==='vendor'?'Choose a saved vendor…':'Choose a saved customer or vendor…');placeholder.value='';picker.append(placeholder);
    let matches=0;
    for(const kind of ['customer','vendor']){
      if(picker.dataset.contactKind&&picker.dataset.contactKind!==kind)continue;
      const groups=new Map();
      for(const c of A1Data.contacts().filter(c=>c.kind===kind).sort(compareContacts)){
        const match=matchesContact(c,query);
        if(!match&&kind+':'+c.id!==selectedValue)continue;
        if(match)matches++;
        const type=String(c.type||'').trim();
        const key=type.toLowerCase();
        if(!groups.has(key)){const group=node('optgroup');group.label=(kind==='vendor'?'Vendors':'Customers')+(type?' — '+type:'');groups.set(key,group);}
        const option=node('option',c.displayName+' · '+(c.name||c.email||'')+' · #'+c.id);
        option.value=kind+':'+c.id;groups.get(key).append(option);
      }
      for(const [,group] of [...groups].sort(([a],[b])=>a.localeCompare(b,undefined,{sensitivity:'base'})))picker.append(group);
    }
    if(!matches){const empty=node('option','No matching contacts');empty.value='';empty.disabled=true;picker.append(empty);}
    picker.value=selectedValue;
  }
  function populatePickers(){
    for(const picker of document.querySelectorAll('[data-contact-picker]')){
      if(!picker._contactSearch&&picker.parentNode){
        const search=node('input');search.type='search';search.className='contact-picker-search';
        const label=picker.dataset.contactKind==='vendor'?'Search saved vendors':'Search saved customers and vendors';
        search.placeholder=label+' by name, company, email, or type…';search.setAttribute('aria-label',label);
        search.style.cssText='width:100%;box-sizing:border-box;margin-bottom:6px;';
        search.addEventListener('input',()=>updatePicker(picker));
        picker.parentNode.insertBefore(search,picker);picker._contactSearch=search;
      }
      updatePicker(picker);
    }
  }
  function purchases(){
    const wrap=$('purchaseDirectory');if(!wrap)return;wrap.replaceChildren();
    const q=($('purchaseSearch').value||'').toLowerCase();
    const items=loadInvoices().filter(i=>isPurchaseOrderType(i.type)&&[i.number,i.clientCompany,i.clientContact,i.status,i.externalReference].some(v=>String(v||'').toLowerCase().includes(q)));
    const max=Math.max(0,Math.ceil(items.length/50)-1);pages.purchase=Math.min(pages.purchase,max);wrap.append(node('p',items.length+' purchase orders · Page '+(pages.purchase+1)+' of '+(max+1)));
    for(const i of items.slice(pages.purchase*50,pages.purchase*50+50)){
      const card=node('div');card.className='invoice-history-card';card.append(node('strong',i.number+' · '+i.clientCompany));card.append(node('p',i.status+' · Outstanding balance: '+money(invoiceBalance(i))));const open=node('button','Open Purchase Order');open.className='btn';open.addEventListener('click',()=>loadInvoiceFromHistory(i.id));card.append(open);wrap.append(card);
    }pager(wrap,'purchase',max);
  }
  async function refreshSyncStatus(){
    const wrap=$('skyboxSyncStatus');if(!wrap||typeof A1Data.fetchSyncRuns!=='function')return;
    try{
      const rows=await A1Data.fetchSyncRuns();wrap.replaceChildren();
      if(!rows.length){wrap.append(node('p','No Mac sync runs have reported yet. Download the helper and install it on the Mac holding the export folder.'));return;}
      for(const row of rows){
        const r=row.summary||{};const card=node('div');card.className='invoice-history-card';
        card.append(node('strong',row.machine_label+' · '+row.status));
        card.append(node('p',new Date(row.started_at).toLocaleString()));
        card.append(node('p',r.message||`${r.imported||0} new · ${r.updated||0} updated · ${r.skipped||0} unchanged · ${r.conflicts||0} need review · ${(r.errors||[]).length} errors`));
        if(r.errors?.length){const details=node('details');details.append(node('summary','Show sync errors'),node('p',r.errors.join('\n')));card.append(details);}wrap.append(card);
      }
    }catch(error){wrap.replaceChildren(node('p','Sync status could not load: '+error.message));}
  }
  function render(){
    if(typeof A1Data==='undefined'||typeof A1Data.contacts!=='function')return;
    directory('customer');directory('vendor');purchases();
    populatePickers();
    if(typeof A1Data.authenticated==='function' && A1Data.authenticated())refreshSyncStatus();
  }
  window.A1SkyboxUI={read,commit,download,render,refreshSyncStatus,choose,chooseBooking,populatePickers,directory,purchases};
  window.addEventListener('a1-signed-out',reset);
})();
