/* Shared editable Rolodex; imported originals remain in the Skybox archive. */
(function(root){
  const fields=[['displayName','Display name'],['firstName','First name'],['lastName','Last name'],['name','Contact name'],['company','Company'],['type','Customer / vendor type'],['email','Email'],['phone','Phone'],['phone2','Second phone'],['address','Address'],['paymentMethod','Preferred payment method'],['tags','Tags'],['notes','Notes']];
  const text=v=>String(v??'');
  function sortName(c){return text(c.lastName).trim()||text(c.company||c.displayName||c.name).trim();}
  function initial(c){const ch=sortName(c).normalize('NFD').replace(/[\u0300-\u036f]/g,'').charAt(0).toUpperCase();return /^[A-Z]$/.test(ch)?ch:'#';}
  function filter(contacts,kind,query='',letter=''){
    const words=query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return contacts.filter(c=>c.kind===kind&&(!letter||initial(c)===letter)&&words.every(w=>fields.map(([k])=>text(c[k])).join(' ').toLowerCase().includes(w)||text(c.id).toLowerCase().includes(w)))
      .sort((a,b)=>sortName(a).localeCompare(sortName(b),undefined,{sensitivity:'base',numeric:true})||text(a.displayName).localeCompare(text(b.displayName),undefined,{sensitivity:'base'})||text(a.id).localeCompare(text(b.id)));
  }
  function patch(original,values){const result={};for(const [key] of fields)if(text(values[key])!==text(original[key]))result[key]=text(values[key]).trim();return result;}
  const states={customer:{letter:'',page:0},vendor:{letter:'',page:0}};
  const $=id=>document.getElementById(id);
  const el=(tag,value)=>{const n=document.createElement(tag);if(value!==undefined)n.textContent=value;return n;};
  function contacts(){return A1Data.contacts();}
  function mayLeave(state){return !state.form?.dataset.dirty||confirm('Discard unsaved changes to this contact card?');}
  function open(kind,contact,force=false){
    const state=states[kind];if(!force&&!mayLeave(state))return;
    state.original=JSON.parse(JSON.stringify(contact));state.version=A1Data.contactVersion(kind,contact.id);const loadedVersion=state.version;state.selected=contact.id;
    const wrap=$(kind+'ContactCard');if(!wrap)return;wrap.replaceChildren();
    const top=el('div');top.className='rolodex-card-heading';const photo=el('div');photo.className='rolodex-portrait';photo.append(el('span',text(contact.firstName||contact.displayName).slice(0,1).toUpperCase()));
    const image=el('img');image.alt='Contact photo';image.hidden=true;image.onerror=()=>{image.hidden=true;};photo.append(image);top.append(photo);
    const heading=el('div');heading.append(el('div',kind==='vendor'?'VENDOR':'CUSTOMER'),el('h3',contact.displayName||'New contact'),el('p',contact.type||'Shared A1 contact'));
    const actions=el('div');actions.className='rolodex-actions';
    if(contact.phone){const call=el('a','Call');call.className='btn';call.href='tel:'+text(contact.phone).replace(/[^+0-9*#,;]/g,'');actions.append(call);}
    if(contact.email){const email=el('a','Email');email.className='btn';email.href='mailto:'+encodeURIComponent(contact.email);actions.append(email);}heading.append(actions);top.append(heading);wrap.append(top);
    if(contact.photoPath)A1Data.contactPhotoUrl(contact.photoPath).then(url=>{if(url&&wrap.contains(image)){image.src=url;image.hidden=false;}}).catch(()=>{photo.title='Photo could not load. Refresh this card to retry.';});
    const form=el('form');form.className='rolodex-form';state.form=form;
    for(const [key,label] of fields){
      const lab=el('label',label);const input=el(['address','notes'].includes(key)?'textarea':'input');input.name=key;input.value=text(contact[key]);
      if(key==='email')input.type='email';else if(key==='phone'||key==='phone2')input.type='tel';else input.type='text';
      input.maxLength=key==='notes'?10000:2000;if(key==='displayName')input.required=true;
      if(['address','notes'].includes(key))lab.className='rolodex-wide';lab.append(input);form.append(lab);
    }
    const photoLabel=el('label','Contact photo');photoLabel.className='rolodex-wide';const file=el('input');file.type='file';file.accept='image/jpeg,image/png,image/webp';photoLabel.append(file);form.append(photoLabel);
    const removeLabel=el('label');const remove=el('input');remove.type='checkbox';removeLabel.append(remove,document.createTextNode(' Remove saved photo'));form.append(removeLabel);
    const status=el('p');status.className='rolodex-wide';status.setAttribute('role','status');form.append(status);
    const save=el('button','Save Contact');save.type='submit';save.className='btn';form.append(save);
    const use=el('button',kind==='vendor'?'Use in New Purchase Order':'Use in New Invoice');use.type='button';use.className='btn';
    use.addEventListener('click',()=>{if(!mayLeave(state))return;const saved=contacts().find(c=>c.kind===kind&&c.id===contact.id);if(!saved){status.textContent='Save this contact first.';return;}startNewInvoice(kind==='vendor'?'po-ticket':'invoice-ticket');A1SkyboxUI.fill(saved);const picker=$('sharedContactPicker');picker.value=kind+':'+saved.id;openInvoiceMode('editor');showSection('invoices');});form.append(use);
    form.addEventListener('input',()=>{form.dataset.dirty='true';});
    file.addEventListener('change',async()=>{
      form.dataset.dirty='true';if(!file.files[0])return;
      try{const blob=await preparePhoto(file.files[0]);if(state.form!==form)return;const url=URL.createObjectURL(blob);image.onload=()=>URL.revokeObjectURL(url);image.src=url;image.hidden=false;}
      catch(error){status.textContent=error.message;file.value='';}
    });
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(save.disabled||!form.reportValidity())return;save.disabled=true;status.textContent='Saving contact…';let uploaded='';
      try{
        const values={};for(const [key] of fields)values[key]=form.elements.namedItem(key).value;
        if(values.firstName||values.lastName){const derived=[values.firstName.trim(),values.lastName.trim()].filter(Boolean).join(' ');if(values.name===text(contact.name))values.name=derived;}
        const changes=patch(contact,values);
        if(file.files[0]){uploaded=await A1Data.uploadContactPhoto(kind,contact.id,await preparePhoto(file.files[0]));changes.photoPath=uploaded;}
        else if(remove.checked)changes.photoPath='';
        if(!Object.keys(changes).length){status.textContent='No changes to save.';return;}
        const saved=await A1Data.saveContact(kind,contact.id,changes,loadedVersion);
        form.dataset.dirty='';if(state.form===form){open(kind,saved,true);$(kind+'ContactCard').querySelector('[role="status"]').textContent='Contact saved to Supabase.';}
        directory(kind);A1SkyboxUI.populatePickers();
        if(contact.photoPath&&changes.photoPath!==undefined&&contact.photoPath!==changes.photoPath)A1Data.removeContactPhoto(contact.photoPath).catch(()=>{});
      }catch(error){if(uploaded)A1Data.removeContactPhoto(uploaded).catch(()=>{});status.textContent='Contact was not saved: '+error.message;}
      finally{save.disabled=false;}
    });wrap.append(form);
  }
  async function preparePhoto(file){
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024)throw new Error('Choose a JPG, PNG, or WebP photo up to 10 MB.');
    const bitmap=await createImageBitmap(file);try{
      const canvas=document.createElement('canvas');const scale=Math.min(1,512/Math.max(bitmap.width,bitmap.height));canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.82));if(!blob||blob.size>524288)throw new Error('This photo is too large after resizing. Choose another image.');return blob;
    }finally{bitmap.close();}
  }
  function directory(kind){
    const wrap=$(kind+'Directory');if(!wrap)return;const existingCard=$(kind+'ContactCard');const state=states[kind];wrap.replaceChildren();wrap.className='rolodex';
    const tabs=el('nav');tabs.className='rolodex-tabs';tabs.setAttribute('aria-label','Browse '+kind+' cards by last name');
    const source=contacts().filter(c=>c.kind===kind);const letters=new Set(source.map(initial));
    for(const letter of ['','ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),'#'].flat()){
      const tab=el('button',letter||'All');tab.type='button';tab.className=state.letter===letter?'active':'';tab.disabled=!!letter&&!letters.has(letter);tab.setAttribute('aria-pressed',String(state.letter===letter));
      tab.addEventListener('click',()=>{if(!mayLeave(state))return;state.letter=letter;state.page=0;state.form=null;state.selected=null;directory(kind);});tabs.append(tab);
    }wrap.append(tabs);
    const query=$(kind+'Search').value||'';const items=filter(source,kind,query,state.letter);const max=Math.max(0,Math.ceil(items.length/40)-1);state.page=Math.min(state.page,max);
    wrap.append(el('p',items.length+' '+kind+' cards · Sorted by last name, then company / display name'));
    const body=el('div');body.className='rolodex-body';const list=el('div');list.className='rolodex-index';list.setAttribute('aria-label','Matching '+kind+' contacts');
    for(const c of items.slice(state.page*40,state.page*40+40)){
      const button=el('button');button.type='button';button.dataset.contactId=c.id;button.className='rolodex-index-card'+(c.id===state.selected?' active':'');const avatar=el('span',text(c.firstName||c.displayName).slice(0,1).toUpperCase());avatar.className='contact-list-avatar';avatar.setAttribute('aria-hidden','true');const details=el('div');details.className='contact-index-details';details.append(el('strong',c.displayName),el('span',[c.name,c.company,c.type].filter(Boolean).join(' · ')),el('small','#'+c.id));button.append(avatar,details);
      button.addEventListener('click',()=>{open(kind,c);for(const b of list.children)b.classList.toggle('active',b===button&&state.selected===c.id);});list.append(button);
    }
    if(!items.length)list.append(el('p','No matching contacts. Try another name or select All.'));
    const nav=el('div');nav.className='rolodex-actions';for(const [label,delta] of [['Previous cards',-1],['Next cards',1]]){const button=el('button',label);button.className='btn';button.type='button';button.disabled=delta<0?state.page===0:state.page>=max;button.addEventListener('click',()=>{state.page+=delta;directory(kind);});nav.append(button);}list.append(nav);
    body.append(list);
    // Keep the existing form node intact while filtering, so searches never erase edits.
    let card=existingCard;if(!card){card=el('article');card.id=kind+'ContactCard';card.className='rolodex-card';}
    body.append(card);wrap.append(body);
    const current=source.find(c=>c.id===state.selected);
    if(current&&!state.form?.dataset.dirty&&JSON.stringify(current)!==JSON.stringify(state.original))open(kind,current,true);
    if(!state.selected&&items[0])open(kind,items[0],true);else if(!state.selected&&!items.length){card.replaceChildren(el('p','Add a contact or search your saved cards.'));}
    for(const button of list.querySelectorAll('.rolodex-index-card'))button.classList.toggle('active',button.dataset.contactId===state.selected);
  }
  function search(kind,reset=false){
    const input=$(kind+'Search'),state=states[kind];if(!input||!state)return;
    if(reset)input.value='';
    if(!input.value.trim())state.letter='';
    state.page=0;directory(kind);
  }
  function add(kind){const state=states[kind];if(!mayLeave(state))return;open(kind,{kind,id:crypto.randomUUID(),displayName:'',name:'',firstName:'',lastName:''},true);}
  function clear(){for(const kind of ['customer','vendor']){states[kind]={letter:'',page:0};$(kind+'Directory')?.replaceChildren();}}
  const api={fields,sortName,initial,filter,patch,directory,search,open,add,preparePhoto,clear};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else {root.A1Contacts=api;root.addEventListener('a1-signed-out',clear);}
})(typeof window!=='undefined'?window:globalThis);
