/* Session-only dashboard guide, explicit action buttons, optional browser dictation. */
(() => {
 const core=window.A1AssistantCore;
 let panel,log,input,send,mic,launcher,status,recognition,waiting=null,busy=false,epoch=0,owner=null,placement,aiTab;
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const allowed=id=>A1Data.authenticated()&&A1Data.canAccess(id);
 function requireAccess(id){if(!allowed(id))throw new Error('That section is not enabled for your account.');}
 function valid(token){return epoch===token&&A1Data.authenticated()&&owner===A1Data.account()?.email;}
 function stopVoice(){const old=recognition;recognition=null;if(old){old.onresult=null;old.onend=null;old.onerror=null;old.abort();}if(mic){mic.textContent='Use Microphone';mic.setAttribute('aria-pressed','false');}}
 function close(){document.body.classList.remove('al-chat-open');stopVoice();panel.hidden=true;launcher.hidden=!!aiTab;launcher.setAttribute('aria-expanded','false');aiTab?.setAttribute('aria-expanded','false');aiTab?.classList.remove('is-active');(aiTab||launcher).focus();}
 function clear(){document.body.classList.remove('al-chat-open');document.querySelectorAll('.al-found-link').forEach(n=>n.classList.remove('al-found-link'));epoch++;waiting=null;busy=false;owner=null;stopVoice();if(log)log.replaceChildren();if(input)input.value='';if(status)status.textContent='';if(panel)panel.hidden=true;if(launcher){launcher.hidden=!!aiTab;launcher.setAttribute('aria-expanded','false');}aiTab?.setAttribute('aria-expanded','false');aiTab?.classList.remove('is-active');if(send)send.disabled=false;}
 function message(text,user=false){const n=el('div',text,user?'copilot-message is-user':'copilot-message');log.append(n);while(log.children.length>60)log.firstElementChild.remove();log.scrollTop=log.scrollHeight;return n;}
 function action(parent,label,fn){const token=epoch;const b=el('button',label,'copilot-action');b.type='button';b.onclick=async()=>{
  if(!valid(token)){message('Your account access changed. Start a new request.');return;}
  if(busy)return;busy=true;send.disabled=true;
  try{await fn(token);}catch(error){if(valid(token))message(error.message);}finally{if(valid(token)){busy=false;send.disabled=false;}}
 };parent.append(b);log.scrollTop=log.scrollHeight;return b;}
 async function load(section,token){requireAccess(section);status.textContent='Loading '+(core.sections.find(s=>s[0]===section)?.[1]||section)+'…';await A1Data.loadSection(section);if(!valid(token))throw new Error('Session changed.');requireAccess(section);status.textContent='';}
 function go(id){requireAccess(id);showSection(id);}
 function greet(){waiting=null;const account=A1Data.account(),name=account?.username||account?.name;const hello=name&&name!==account.email?'Hi '+name+', I’m Al!':'Hi, I’m Al!';const card=message(hello+' What would you like help with today? Type Help and I can show you some examples of what I can help you with.');action(card,'Help · Show Examples',()=>help());}
 function help(){
  waiting=null;const card=message('I can find saved records, open a dashboard section, or walk you through a new invoice or purchase order. Search “Yankees” to find buttons across categories and related contacts. Try “add button for example.com in main”, “find customer Jane Smith”, “create an invoice for Acme”, or “find invoice 4100”.');
  for(const [label,request,section] of [['Find a Customer','find customer','customers'],['Find a Vendor','find vendor','vendors'],['Start an Invoice','create invoice','invoices'],['Find an Invoice','find invoice','invoices'],['Find a Trip','find trip','tripItinerary'],['Find a Letter','find letter','formLetter'],['Find a Link','find link','main']])if(allowed(section))action(card,label,()=>ask(request));
  const nav=message('Or choose a section and I’ll take you there:');for(const [id,label] of core.sections)if(allowed(id))action(nav,label,()=>go(id));
 }
 function focusField(id){const field=document.getElementById(id);if(field){field.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});field.focus();}}
 async function draft(contact,purchase,token){
  requireAccess('invoices');if(contact)requireAccess(contact.kind==='vendor'?'vendors':'customers');
  if(!confirm('Start a new '+(purchase?'purchase order':'invoice')+' draft'+(contact?' for '+(contact.displayName||contact.company||contact.name):'')+'? This replaces the current unsaved invoice editor.'))return;
  await load('invoices',token);if(!valid(token))return;
  startNewInvoice(purchase?'po-ticket':'invoice-ticket');if(contact)A1SkyboxUI.fill(contact);go('invoices');
  waiting=null;const card=message('Your '+(purchase?'purchase order':'invoice')+' draft is open'+(contact?' with the selected contact filled in':'')+'. Nothing has been saved. Work through these steps, then use the dashboard’s Save button after reviewing the preview.');
  for(const [label,id] of [['1 · Review customer details','invClientCompany'],['2 · Add event / items and prices','invoiceLines'],['3 · Set due date and terms','invDue'],['4 · Review the preview','invoicePreview']])action(card,label,()=>{requireAccess('invoices');go('invoices');focusField(id);});
 }
 async function contacts(request,token){
  const kinds=request.kind?[request.kind]:['customer','vendor'];
  const permitted=kinds.filter(k=>allowed(k==='vendor'?'vendors':'customers'));if(!permitted.length)throw new Error('Customer and vendor access is not enabled for your account.');
  for(const kind of permitted)await load(kind==='vendor'?'vendors':'customers',token);
  const rows=core.matches(A1Data.contacts().filter(c=>permitted.includes(c.kind)),request.query,['displayName','name','firstName','lastName','company','email','phone','phone2','id']);
  message(rows.length?rows.length+' matching contact'+(rows.length===1?'':'s')+(rows.length>12?' · showing the first 12. Add more of the name to narrow your search.':'.'):'No matching contacts. Try a first name, last name, company, email, or phone number.');
  for(const c of rows.slice(0,12)){
   const card=message([c.displayName||c.company||c.name,c.kind,c.email,c.phone].filter(Boolean).join(' · '));
   action(card,'Open Contact',async t=>{const section=c.kind==='vendor'?'vendors':'customers';await load(section,t);go(section);refreshCloudViews();A1Contacts.open(c.kind,c);});
   if(allowed('invoices'))action(card,request.type==='draft'?'Use This Contact':'Start '+(c.kind==='vendor'?'Purchase Order':'Invoice'),t=>draft(c,request.type==='draft'?request.purchase:c.kind==='vendor',t));
  }
 }
 async function records(request,token){
  const section={invoice:'invoices',trip:'tripItinerary',letter:'formLetter'}[request.type];await load(section,token);
  const rows=request.type==='invoice'?A1Data.invoices():A1Data.documents(request.type==='trip'?'itinerary':'letter');
  const fields=request.type==='invoice'?['number','savedName','clientCompany','clientContact','createdDate']:request.type==='trip'?['savedName','eventName','talent','eventLocation','arrivalDate','eventDate']:['savedName','to','toEmail','subject','date'];
  const found=core.matches(rows,request.query,fields);message(found.length?found.length+' matching record'+(found.length===1?'':'s')+(found.length>12?' · showing the first 12. Narrow your search for more.':'.'):'No matching saved records. Try a number, name, company, or date.');
  for(const record of found.slice(0,12)){
   const card=message([request.type==='invoice'?'#'+record.number:record.savedName,record.clientCompany||record.eventName||record.subject,record.createdDate||record.eventDate||record.date].filter(Boolean).join(' · ')||'Saved record');
   action(card,'Open '+(request.type==='invoice'?'Invoice / PO':request.type==='trip'?'Trip':'Letter'),()=>{
    requireAccess(section);if(!confirm('Open this saved record? This replaces the current unsaved editor for this section.'))return;
    go(section);({invoice:loadInvoiceFromHistory,trip:loadItineraryFromHistory,letter:loadLetterFromHistory})[request.type](record.id);
   });
  }
 }
 function linkAvailable(b){
  const section=b.closest('.grid')?.dataset.section;
  return b.isConnected&&allowed(section)&&!b.classList.contains('a1-personally-hidden')&&!b.classList.contains('a1-admin-link-denied')&&!A1Data.linkBlocked(b.dataset.url);
 }
 function locate(b){
  if(!linkAvailable(b))throw new Error('This link is no longer available to your account.');
  const section=b.closest('.grid').dataset.section;
  go(['privatejet','luxhomes','yachts'].includes(section)?'travel':section);
  for(let parent=b.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
  document.querySelectorAll('.al-found-link').forEach(n=>n.classList.remove('al-found-link'));
  b.classList.add('al-found-link');b.scrollIntoView({block:'center',inline:'nearest'});b.focus({preventScroll:true});
  // The dock reserves its own space, so highlighting never needs a floating overlay.
  return (core.sections.find(s=>s[0]===section)||window.manageableSections?.find(s=>s.id===section)&&[section,window.manageableSections.find(s=>s.id===section).label]||[section,section])[1];
 }
 async function globalSearch(query,token){
  waiting=null;
  const all=[...document.querySelectorAll('.grid[data-section]>.btn')].filter(linkAvailable).map(button=>({button,section:button.closest('.grid').dataset.section,label:button.dataset.label||button.textContent.trim()}));
  const found=core.rankLinks(all,query);
  if(found.length){const category=locate(found[0].button);message('I found '+found[0].label+' in '+category+' and highlighted it.');}
  else message('No matching dashboard buttons for “'+query+'”. I’ll also check your available contacts.');
  const groups=new Map();for(const row of found){if(!groups.has(row.section))groups.set(row.section,[]);groups.get(row.section).push(row);}
  for(const [section,rows] of groups){
   const name=core.sections.find(s=>s[0]===section)?.[1]||window.manageableSections?.find(s=>s.id===section)?.label||section;
   const card=message((section!==found[0]?.section?'Also found ':'Found ')+rows.length+' matching button'+(rows.length===1?'':'s')+' under '+name+(rows.length>12?' · showing 12.':'.'));
   for(const row of rows.slice(0,12))action(card,row.label+' · Show & Highlight',()=>locate(row.button));
  }
  const kinds=['customer','vendor'].filter(k=>allowed(k==='customer'?'customers':'vendors'));
  if(!kinds.length)return;
  try{for(const kind of kinds)await load(kind==='customer'?'customers':'vendors',token);}
  catch(error){if(valid(token))message('Button results are ready, but the related-contact search could not finish: '+error.message);return;}
  if(!valid(token))return;
  const contacts=core.matches(A1Data.contacts().filter(c=>kinds.includes(c.kind)),query,['displayName','name','firstName','lastName','company','email','phone','phone2','notes','tags','type']);
  message(contacts.length?'I also found '+contacts.length+' related customer / vendor contact'+(contacts.length===1?'':'s')+(contacts.length>12?' · showing 12.':'.'):'No related contacts matched in your available customer / vendor sections.');
  for(const contact of contacts.slice(0,12)){
   const card=message([contact.displayName||contact.company||contact.name,contact.kind,contact.company].filter(Boolean).join(' · '));
   action(card,'Open Contact',async t=>{const section=contact.kind==='customer'?'customers':'vendors';await load(section,t);go(section);refreshCloudViews();A1Contacts.open(contact.kind,contact);});
   if(allowed('invoices'))action(card,'Start '+(contact.kind==='vendor'?'Purchase Order':'Invoice'),t=>draft(contact,contact.kind==='vendor',t));
  }
 }
 function proposeButton(request){
  const item=window.A1AssistantActions.proposal(request);requireAccess(item.section);
  if(A1Data.linkBlocked(item.url))throw new Error('This link is restricted by your administrator.');
  const category=core.sections.find(s=>s[0]===item.section)?.[1]||item.section;
  const card=message('Add this button?\nLabel: '+item.label+'\nWebsite: '+item.url+'\nCategory: '+category+'\n'+(A1Data.isAdmin()?'This adds a shared dashboard button.':'This adds a button to your personal layout.'));
  action(card,'Add Button',async token=>{
   if(card.dataset.saved)return;
   const saved=await window.A1AssistantActions.add({...request,label:item.label},{data:A1Data,
    exists:entry=>[...document.querySelectorAll('.grid[data-section]>.btn')].some(b=>b.closest('.grid').dataset.section===entry.section&&!b.classList.contains('a1-personally-hidden')&&(core.normalize(b.dataset.label||b.textContent)===core.normalize(entry.label)||b.dataset.url===entry.url)),
    local:()=>loadState(),apply:state=>{saveState(state);applyState(state);broadcastRefresh();},refreshPersonal:()=>A1Activity.loadButtons()});
   if(!valid(token))return;card.dataset.saved='true';go(saved.section);const found=[...document.querySelectorAll('.grid[data-section]>.btn')].find(b=>b.closest('.grid').dataset.section===saved.section&&core.normalize(b.dataset.label||b.textContent)===core.normalize(saved.label));if(found)locate(found);
   message('Added '+saved.label+' to '+category+'.');
  });
 }
 async function ask(text){
  text=String(text||'').trim().slice(0,600);if(!text||!A1Data.authenticated())return;
  const token=epoch;message(text,true);let request=core.intent(text);
  if(request.type==='greeting'){greet();return;}
  if(request.type==='addButton'){waiting=null;proposeButton(request);return;}
  if(request.type==='cancel'){waiting=null;message('Cancelled. No changes were saved.');return;}
  if(request.type==='unknown'&&waiting)request={...waiting,query:text};
  if(request.type==='help'){help();return;}
  if(request.type==='unknown')request={type:'global',query:request.query};
  if(request.type==='navigate'){go(request.section);message('Opened '+core.sections.find(s=>s[0]===request.section)[1]+'.');return;}
  if(!request.query){waiting=request;message(request.type==='draft'?'Which customer or company should I use? Enter a name, or choose a blank draft.':'What name, number, company, or keyword should I search for?');if(request.type==='draft'){const card=message('You can also fill in the customer yourself.');action(card,'Start Blank Draft',t=>draft(null,request.purchase,t));}return;}
  waiting=request;
  if(request.type==='draft'){requireAccess('invoices');await contacts({...request,kind:request.purchase?'vendor':'customer'},token);}
  else if(request.type==='contact')await contacts(request,token);
  else if(['link','global'].includes(request.type))await globalSearch(request.query,token);
  else await records(request,token);
 }
 async function submit(event){event.preventDefault();if(busy)return;const text=input.value;input.value='';busy=true;send.disabled=true;const token=epoch;try{await ask(text);}catch(error){if(valid(token))message('I couldn’t finish that request: '+error.message);}finally{if(valid(token)){status.textContent='';busy=false;send.disabled=false;input.focus();}}}
 function voice(){
  if(recognition){stopVoice();status.textContent='Microphone stopped.';return;}
  const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;if(!Speech)return;
  const token=epoch;recognition=new Speech();const current=recognition;current.lang='en-US';current.continuous=false;current.interimResults=false;
  current.onresult=event=>{if(valid(token)&&recognition===current){input.value=event.results[0][0].transcript;status.textContent='Review your words, then press Send.';input.focus();}};
  current.onerror=event=>{if(valid(token))status.textContent=event.error==='not-allowed'?'Microphone permission was denied. You can still type your request.':'Voice input could not finish. Try again or type your request.';};
  current.onend=()=>{if(recognition===current){recognition=null;mic.textContent='Use Microphone';mic.setAttribute('aria-pressed','false');}};
  try{current.start();mic.textContent='Stop Microphone';mic.setAttribute('aria-pressed','true');status.textContent='Listening…';}catch{stopVoice();status.textContent='Voice input is unavailable. Type your request or use keyboard dictation.';}
 }
 function init(){
  launcher=el('button',undefined,'copilot-launcher');launcher.type='button';launcher.setAttribute('aria-label','Open Al dashboard assistant');launcher.setAttribute('aria-controls','a1Copilot');launcher.setAttribute('aria-expanded','false');
  const image=el('img');image.src='./assets/al-ticket.png';image.alt='';image.setAttribute('aria-hidden','true');launcher.append(image,el('span','Ask Al'));document.body.append(launcher);
  panel=el('section',undefined,'copilot-panel');panel.id='a1Copilot';panel.hidden=true;panel.setAttribute('role','region');panel.setAttribute('aria-labelledby','copilotTitle');
  const header=el('header',undefined,'copilot-header');const title=el('div');const h=el('h2','Al');h.id='copilotTitle';const mascot=el('img');mascot.src='./assets/al-ticket.png';mascot.alt='';mascot.className='copilot-header-mascot';title.append(mascot,h,el('p','Your dashboard assistant'));header.append(title);
  const clearButton=el('button','Clear','copilot-small');clearButton.type='button';clearButton.onclick=()=>{clear();owner=A1Data.account()?.email;document.body.classList.add('al-chat-open');panel.hidden=false;launcher.setAttribute('aria-expanded','true');aiTab?.setAttribute('aria-expanded','true');aiTab?.classList.add('is-active');placement?.layoutPanel();greet();input.focus();};header.append(clearButton);
  const closeButton=el('button','Minimize','copilot-small');closeButton.type='button';closeButton.onclick=close;header.append(closeButton);panel.append(header);
  panel.append(el('p','Guided mode · Search dashboard links and saved records, add a website button, or get step-by-step help with a draft.','copilot-mode'));
  log=el('div',undefined,'copilot-log');log.setAttribute('role','log');log.setAttribute('aria-label','Assistant conversation');log.setAttribute('aria-live','polite');panel.append(log);
  status=el('p','','copilot-status');status.setAttribute('role','status');panel.append(status);
  const form=el('form',undefined,'copilot-form');input=el('textarea');input.rows=2;input.maxLength=600;input.placeholder='Find a customer or help me create an invoice…';input.setAttribute('aria-label','Message to dashboard assistant');form.append(input);
  const controls=el('div');mic=el('button','Use Microphone','copilot-small');mic.type='button';mic.title='Voice input uses your browser’s speech service. Review the transcript before sending.';mic.setAttribute('aria-pressed','false');mic.onclick=voice;send=el('button','Send','copilot-send');send.type='submit';controls.append(mic,send);form.append(controls);form.onsubmit=submit;panel.append(form);
  const supported=!!(window.SpeechRecognition||window.webkitSpeechRecognition);mic.hidden=!supported;
  panel.append(el('p',supported?'Microphone input uses your browser’s speech service. Review the transcript before sending. Chat is cleared on sign-out.':'Type your request or use your keyboard’s dictation microphone. Chat is cleared on sign-out.','copilot-note'));
  document.body.append(panel);
  function open(){if(!A1Data.authenticated())return;if(!panel.hidden){close();return;}if(owner!==A1Data.account()?.email){clear();owner=A1Data.account()?.email;}launcher.hidden=!!aiTab;document.body.classList.add('al-chat-open');panel.hidden=false;launcher.setAttribute('aria-expanded','true');aiTab?.setAttribute('aria-expanded','true');aiTab?.classList.add('is-active');placement?.layoutPanel();if(!log.children.length)greet();input.focus();}
  launcher.onclick=open;aiTab=document.getElementById('a1AssistantTab');if(aiTab){launcher.hidden=true;}if(aiTab)aiTab.onclick=()=>{if(!panel.hidden){close();return;}open();};
  placement=window.A1AssistantPosition?.init(launcher,panel);
  panel.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
  window.addEventListener('a1-signed-out',clear);window.addEventListener('a1-password-recovery',clear);window.addEventListener('a1-access-changed',clear);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopVoice();});
 }
 document.addEventListener('DOMContentLoaded',init);
})();
