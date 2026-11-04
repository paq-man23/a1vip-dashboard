/* Al: conversational planning plus permission-checked dashboard actions. */
(() => {
 const core=window.A1AssistantCore;
 let panel,log,input,send,mic,launcher,status,recognition,waiting=null,busy=false,epoch=0,owner=null,placement,aiTab,voicePending=false;
 let conversation=[],modeNote,voiceEnabled=false,voiceToggle;
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const allowed=id=>A1Data.authenticated()&&A1Data.canAccess(id);
 function requireAccess(id){if(!allowed(id))throw new Error('That section is not enabled for your account.');}
 function valid(token){return epoch===token&&A1Data.authenticated()&&owner===A1Data.account()?.email;}
 function stopVoice(){if(recognition){recognition.onresult=null;recognition.onend=null;recognition.onerror=null;try{recognition.abort();}catch{}recognition=null;}mic?.setAttribute('aria-pressed','false');}
 function close(){document.body.classList.remove('al-chat-open');stopVoice();panel.hidden=true;launcher.hidden=false;launcher.setAttribute('aria-expanded','false');aiTab?.setAttribute('aria-expanded','false');aiTab?.classList.remove('is-active');(aiTab||launcher).focus();}
 function clear(){document.body.classList.remove('al-chat-open');document.querySelectorAll('.al-found-link').forEach(n=>n.classList.remove('al-found-link'));epoch++;conversation=[];voiceEnabled=false;if(voiceToggle)voiceToggle.checked=false;if(mic)mic.hidden=true;waiting=null;busy=false;owner=null;stopVoice();if(log)log.replaceChildren();voicePending=false;if(input)input.value='';if(status)status.textContent='';if(panel)panel.hidden=true;if(launcher){launcher.hidden=false;launcher.setAttribute('aria-expanded','false');}aiTab?.setAttribute('aria-expanded','false');aiTab?.classList.remove('is-active');if(send)send.disabled=false;}
 function message(text,user=false){const n=el('div',text,user?'copilot-message is-user':'copilot-message');log.append(n);while(log.children.length>60)log.firstElementChild.remove();if(!user)placement?.fitReply(n);else log.scrollTop=log.scrollHeight;return n;}
 function action(parent,label,fn){const token=epoch;const b=el('button',label,'copilot-action');b.type='button';b.onclick=async()=>{
  if(!valid(token)){message('Your account access changed. Start a new request.');return;}
  if(busy)return;busy=true;send.disabled=true;
  try{await fn(token);}catch(error){if(valid(token))message(error.message);}finally{if(valid(token)){busy=false;send.disabled=false;}}
 };parent.append(b);placement?.fitReply(parent);return b;}
 async function load(section,token,force=false){requireAccess(section);status.textContent='Loading '+(core.sections.find(s=>s[0]===section)?.[1]||section)+'…';await A1Data.loadSection(section,force);if(!valid(token))throw new Error('Session changed.');requireAccess(section);status.textContent='';}
 function go(id){requireAccess(id);showSection(id);}
 function greet(){waiting=null;const account=A1Data.account(),name=account?.username||account?.name;message((name&&name!==account.email?'Hi '+name+', I’m Al!':'Hi, I’m Al!')+' I’m here if you need a hand.');}
 function help(){
  waiting=null;const examples=['“Yankees” — find matching links and related contacts'];
  if(allowed('customers'))examples.push('“find customer Jane Smith”');
  if(allowed('vendors'))examples.push('“find vendor Acme”');
  if(allowed('invoices'))examples.push('“find invoice 4100” or “create an invoice for Acme”');
  if(allowed('invoices'))examples.push('“summary 2026 invoices” — totals and balances', '“who bought Olivia Rodrigo tickets?” — search event invoices');
  examples.push('“find events Knicks” — upcoming Ticketmaster events', '“When is Olivia Rodrigo playing in New York?”');
  if(allowed('tripItinerary'))examples.push('“find trip Florida”');
  if(allowed('main'))examples.push('“add button for example.com in main”');
  message('Here are a few things you can ask me:\n'+examples.join('\n'));
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
  const rows=core.matches(A1Data.contacts().filter(c=>permitted.includes(c.kind)),request.query,['displayName','name','firstName','lastName','company','email','phone','phone2','id'],{voice:request.voice});
  if(request.voice&&core.matches(rows,request.query,['displayName','name','firstName','lastName','company','email','phone','phone2','id']).length<rows.length)message('I found similar-sounding names as well as exact matches. Please choose the right contact; these are separate records.');
  message(rows.length?rows.length+' matching contact'+(rows.length===1?'':'s')+(rows.length>12?' · showing the first 12. Add more of the name to narrow your search.':'.'):'No matching contacts. Try a first name, last name, company, email, or phone number.');
  for(const c of rows.slice(0,12)){
   const card=message([c.displayName||c.company||c.name,c.kind,c.company,c.email,c.phone].filter(Boolean).join(' · '));
   action(card,'Open Contact',async t=>{const section=c.kind==='vendor'?'vendors':'customers';await load(section,t);go(section);refreshCloudViews();A1Contacts.open(c.kind,c);});
   if(allowed('invoices'))action(card,request.type==='draft'?'Use This Contact':'Start '+(c.kind==='vendor'?'Purchase Order':'Invoice'),t=>draft(c,request.type==='draft'?request.purchase:c.kind==='vendor',t));
  }
 }
 async function records(request,token){
  const section={invoice:'invoices',trip:'tripItinerary',letter:'formLetter'}[request.type];await load(section,token);
  const rows=request.type==='invoice'?A1Data.invoices():A1Data.documents(request.type==='trip'?'itinerary':'letter');
  const fields=request.type==='invoice'?['number','savedName','clientCompany','clientContact','createdDate']:request.type==='trip'?['savedName','eventName','talent','eventLocation','arrivalDate','eventDate']:['savedName','to','toEmail','subject','date'];
  const found=request.type==='invoice'&&window.A1AssistantRecords?window.A1AssistantRecords.filter(rows,request):core.matches(rows,request.query,fields,{voice:request.voice});message(found.length?found.length+' matching record'+(found.length===1?'':'s')+(found.length>12?' · showing the first 12. Narrow your search for more.':'.'):'No matching saved records. Try a number, name, company, or date.');
  for(const record of found.slice(0,12)){
   const card=message([request.type==='invoice'?'#'+record.number:record.savedName,record.clientCompany||record.eventName||record.subject,record.clientContact,record.status,record.createdDate||record.eventDate||record.date].filter(Boolean).join(' · ')||'Saved record');
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
 async function globalSearch(query,token,voice=false){
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
  const contacts=core.matches(A1Data.contacts().filter(c=>kinds.includes(c.kind)),query,['displayName','name','firstName','lastName','company','email','phone','phone2','notes','tags','type'],{voice});
  if(voice&&core.matches(contacts,query,['displayName','name','firstName','lastName','company','email','phone','phone2','notes','tags','type']).length<contacts.length)message('I also checked similar-sounding names. Please choose the correct contact; I haven’t combined any records.');
  message(contacts.length?'I also found '+contacts.length+' related customer / vendor contact'+(contacts.length===1?'':'s')+(contacts.length>12?' · showing 12.':'.'):'No related contacts matched in your available customer / vendor sections.');
  for(const contact of contacts.slice(0,12)){
   const card=message([contact.displayName||contact.company||contact.name,contact.kind,contact.company,contact.email,contact.phone].filter(Boolean).join(' · '));
   action(card,'Open Contact',async t=>{const section=contact.kind==='customer'?'customers':'vendors';await load(section,t);go(section);refreshCloudViews();A1Contacts.open(contact.kind,contact);});
   if(allowed('invoices'))action(card,'Start '+(contact.kind==='vendor'?'Purchase Order':'Invoice'),t=>draft(contact,contact.kind==='vendor',t));
  }
 }
 function existingButtons(item){
  const address=value=>{try{const u=new URL(value);return u.hostname.toLowerCase().replace(/^www\./,'')+u.pathname.replace(/\/+$/,'')+u.search;}catch{return '';}};
  const key=address(item.url);
  return [...document.querySelectorAll('.grid[data-section]>.btn')].filter(linkAvailable).filter(b=>
   (key&&address(b.dataset.url)===key)||core.normalize(b.dataset.label||b.textContent)===core.normalize(item.label));
 }
 function showExistingButton(item){
  const found=existingButtons(item);if(!found.length)return false;
  waiting=null;
  const category=locate(found[0]);
  message('That button already exists. I found '+(found[0].dataset.label||found[0].textContent.trim())+' in '+category+' and highlighted it. No duplicate was added.');
  if(found.length>1){const card=message('I also found these existing buttons:');for(const button of found.slice(1,12))action(card,(button.dataset.label||button.textContent.trim())+' · Show & Highlight',()=>locate(button));}
  return true;
 }
 function proposeButton(request){
  const item=window.A1AssistantActions.proposal(request);
  if(showExistingButton(item))return;
  requireAccess(item.section);
  if(A1Data.linkBlocked(item.url))throw new Error('This link is restricted by your administrator.');
  const category=core.sections.find(s=>s[0]===item.section)?.[1]||item.section;
  const card=message('Add this button?\nLabel: '+item.label+'\nWebsite: '+item.url+'\nCategory: '+category+'\n'+(A1Data.isAdmin()?'This adds a shared dashboard button.':'This adds a button to your personal layout.'));
  action(card,'Add Button',async token=>{
   if(card.dataset.saved)return;
   if(showExistingButton(item)){card.dataset.saved='true';return;}
   const saved=await window.A1AssistantActions.add({...request,label:item.label},{data:A1Data,
    exists:entry=>[...document.querySelectorAll('.grid[data-section]>.btn')].some(b=>b.closest('.grid').dataset.section===entry.section&&!b.classList.contains('a1-personally-hidden')&&(core.normalize(b.dataset.label||b.textContent)===core.normalize(entry.label)||b.dataset.url===entry.url)),
    local:()=>loadState(),apply:state=>{saveState(state);applyState(state);broadcastRefresh();},refreshPersonal:()=>A1Activity.loadButtons()});
   if(!valid(token))return;card.dataset.saved='true';go(saved.section);const found=[...document.querySelectorAll('.grid[data-section]>.btn')].find(b=>b.closest('.grid').dataset.section===saved.section&&core.normalize(b.dataset.label||b.textContent)===core.normalize(saved.label));if(found)locate(found);
   message('Added '+saved.label+' to '+category+'.');
  });
 }
 const linkCategories=[['main','Main Links'],['luxury','Suites'],['accounts','Ticket Accounts'],['travel','Travel'],['social','Social'],['privatejet','Private Jet'],['luxhomes','Luxury Homes'],['yachts','Yachts'],['domains','Domains']];
 function startButton(request){
  if(!linkCategories.some(([id])=>allowed(id)))throw new Error('Your administrator has not enabled a link category for your account.');
  waiting={type:'buttonWizard',website:'',category:request.category||''};
  if(request.website){continueButton(request.website);return;}
  message('Sure — what website should the new button open? Paste its address, such as example.com.');
 }
 function continueButton(text){
  const draft=waiting;
  if(!draft.website){
   let item;try{item=window.A1AssistantActions.proposal({website:text,category:'main'});}catch(error){message(error.message+' What website should I use?');return;}
   if(showExistingButton(item))return;
   draft.website=item.url;
   if(!draft.category){message('Got it. Which category should I put it in? '+linkCategories.filter(([id])=>allowed(id)).map(([,label])=>label).join(', ')+'.');return;}
  }else draft.category=text.replace(/^["“]|["”]$/g,'').trim();
  try{const request={website:draft.website,category:draft.category};const item=window.A1AssistantActions.proposal(request);requireAccess(item.section);proposeButton(request);waiting=null;}
  catch(error){draft.category='';message(error.message+' Choose an enabled category for this button.');}
 }
 async function summarize(request,token){
  await load('invoices',token,true);
  const rows=window.A1AssistantRecords.filter(A1Data.invoices(),request),result=window.A1AssistantRecords.summary(rows);
  const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
  const lines=['Saved document summary'+(request.year?' · '+request.year:'')+(request.query?' · '+request.query:''),rows.length+' matching records.'];
  for(const [key,label] of [['invoice','Invoices'],['po','Purchase orders']]){const r=result[key];if(r.count)lines.push(label+': '+r.count+' · Total '+money(r.total)+' · Balance '+money(r.balance));}
  if(result.void)lines.push(result.void+' void records excluded from totals.');
  lines.push('Balances reflect saved payment/credit adjustments. Invoices and POs are shown separately.');
  const card=message(lines.join('\n'));action(card,'Show Matching Records',t=>records({...request,type:'invoice'},t));waiting={...request,type:'summary'};
 }
 async function events(request,token){
  if(!request.query){waiting={type:'events',query:''};message('Which artist, team, event or venue should I look up? You can also give me a city and date.');return;}
  status.textContent='Searching Ticketmaster events…';
  const result=request.eventResults||(await A1Data.assistantRequest({action:'events',query:request.query,city:request.city||'',stateCode:request.stateCode||'',countryCode:request.countryCode||'',startDate:request.startDate||'',endDate:request.endDate||'',anyDate:request.anyDate===true,anyLocation:request.anyLocation===true,refine:request.refine===true,page:request.page||0}))?.events;
  if(!valid(token))return;
  if(!result?.configured){message(result?.error||'Ticketmaster event discovery is not configured yet.');return;}
  const rows=result.events||[],search=result.search||request;
  waiting={...search,type:'events',refining:result.needsRefinement===true};delete waiting.eventResults;
  if(result.needsRefinement){
   const locationMissing=result.missing?.includes('location');
   const info=message(locationMissing?'I’ll look up '+search.query+'. Which city or state would you like? You can also give me a month, such as “Miami in March 2027”.':'I’ll look up '+search.query+(search.locationLabel?' in '+search.locationLabel:'')+'. Which month or dates would you like? Include the year if needed, or choose Any Month.');
   if(locationMissing)action(info,'Any Location',t=>events({...search,city:'',stateCode:'',countryCode:'',anyLocation:true,refine:true,page:0},t));
   else action(info,'Any Month',t=>events({...search,startDate:'',endDate:'',anyDate:true,refine:true,page:0},t));
   return;
  }
  const scope=[search.query,search.locationLabel||search.city||search.stateCode||(search.anyLocation?'any location':''),[search.startDate,search.endDate&&search.endDate!==search.startDate?search.endDate:''].filter(Boolean).join(' to ')||(search.anyDate?'any month':'upcoming')].filter(Boolean).join(' · ');
  message(scope+'\nTicketmaster Discovery · '+(result.total??rows.length)+' matching events'+(result.total>rows.length?' · showing '+rows.length:'')+'\nChecked '+new Date(result.checkedAt).toLocaleString('en-US',{timeZone:'America/New_York'})+' Eastern.');
  if(!rows.length){
   const info=message('No matching '+search.query+' events were returned'+(search.locationLabel?' in '+search.locationLabel:'')+(search.startDate||search.endDate?' for those dates':' among upcoming events')+' in Ticketmaster’s catalog. Try a different month or location.');
   if(search.city||search.stateCode||search.countryCode)action(info,'Search All Locations',t=>events({...search,city:'',stateCode:'',countryCode:'',anyLocation:true,page:0},t));
   if(search.startDate||search.endDate)action(info,'Search Any Month',t=>events({...search,startDate:'',endDate:'',anyDate:true,page:0},t));
  }
  for(const event of rows){
   const parts=[event.name,event.dateTBA?'Date to be announced':event.date||'Date unavailable'];
   if(event.time)parts.push(event.time+(event.timezone?' · '+event.timezone:''));else parts.push('Time to be announced');
   parts.push([event.venue,event.city,event.state].filter(Boolean).join(' · '));
   if(event.status)parts.push('Event status: '+event.status);
   if(event.priceRanges?.length){for(const range of event.priceRanges){const money=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:range.currency}).format(v);parts.push('Published event price range: '+money(range.min)+'–'+money(range.max)+' '+range.currency);}}
   else parts.push('Ticketmaster did not supply a price range.');
   const card=message(parts.filter(Boolean).join('\n'));
   if(event.url){
    const ticketmaster=/\/\/(?:[^/]+\.)?ticketmaster\./i.test(event.url);
    if(ticketmaster)action(card,'Open Ticketmaster',()=>{
     if(A1Data.linkBlocked(event.url))throw new Error('This link is restricted by your administrator.');
     // The user's current browser opens this window. In Safari this uses Safari's
     // cookie session; it does not sign out, clear cookies, or invoke Shortcuts.
     const popup=window.open(event.url,'_blank','popup=yes,scrollbars=yes,resizable=yes,width=1200,height=800');
     if(popup){popup.opener=null;return;}
     const info=message('The popup was blocked. Allow popups for the A1 Dashboard in your browser settings, or copy the event link.');
     action(info,'Copy Event Link',async()=>{if(!window.navigator?.clipboard?.writeText)throw new Error('Clipboard access is unavailable. Event address: '+event.url);await window.navigator.clipboard.writeText(event.url);message('Event link copied.');});
    });
    else {const link=el('a','View event / tickets','copilot-action');link.href=event.url;link.target='_blank';link.rel='noopener noreferrer';card.append(link);placement?.fitReply(card);}
   }
  }
  if(rows.length)message('Published ranges are event-level information, not current section/row prices or a quote for seats together. Fees and availability must be checked on the ticket page.');
  if(result.hasMore){const card=message('More matching events are available.');action(card,'Next 10 Events',t=>events({...search,page:(search.page||0)+1},t));}
 }
 async function plan(text,token){
  if(!A1Data.assistantRequest)return null;
  status.textContent='Al is thinking…';
  let result;
  try{result=await A1Data.assistantRequest({message:text,history:conversation.slice(-6),...(waiting?.type==='events'&&waiting.query?{eventContext:{query:waiting.query,city:waiting.city||'',stateCode:waiting.stateCode||'',countryCode:waiting.countryCode||'',startDate:waiting.startDate||'',endDate:waiting.endDate||'',anyDate:waiting.anyDate===true,anyLocation:waiting.anyLocation===true}}:{})});}
  catch(error){if(!valid(token))return null;return {type:'answer',reply:error.message+' You can still use commands such as “find customer Jane” or “summary 2026 invoices”.'};}
  if(!valid(token))return null;
  if(result?.configured===false){if(modeNote)modeNote.textContent='Dashboard mode · Live AI needs an OpenAI API key. Search, summaries, drafts and guidance are ready.';message(result.error||'Live AI is not configured yet. Dashboard commands are still available.');return null;}
  if(!result?.plan)return null;
  if(modeNote)modeNote.textContent='AI connected · Chat, search, summaries and reviewed actions';
  return {...result.plan,eventResults:result.events};
 }
 async function ask(text,voice=false){
  text=String(text||'').trim().slice(0,600);if(!text||!A1Data.authenticated())return;
  const token=epoch;message(text,true);let request=core.intent(text);
  if(request.type==='events'&&/\b(?:in|on|this|next|from|between|tomorrow|tonight)\b/i.test(request.query))request={type:'unknown',query:text};
  if((request.type==='unknown'||request.type==='help'||request.type==='global')&&waiting?.type!=='buttonWizard'){
   const proposed=await plan(text,token);if(!valid(token))return;
   if(proposed){request=proposed;if(request.type==='answer'){conversation.push(text);conversation=conversation.slice(-6);message(request.reply);return;}}
  }
  conversation.push(text);conversation=conversation.slice(-6);
  if(request.type==='events'){await events(request,token);return;}
  if(request.type==='summary'){await summarize(request,token);return;}

  if(request.type==='startButton'){startButton(request);return;}
  if(waiting?.type==='buttonWizard'&&request.type==='unknown'){continueButton(text);return;}
  if(request.type==='guide'){waiting=null;message(core.guidance(request.topic,{admin:A1Data.isAdmin(),canAccess:allowed,vision:document.body.classList.contains('a1-vision')}));return;}
  if(request.type==='greeting'){greet();return;}
  if(request.type==='addButton'){waiting=null;proposeButton(request);return;}
  if(request.type==='cancel'){waiting=null;message('Cancelled. No changes were saved.');return;}
  if(request.type==='unknown'&&waiting&&waiting.type!=='buttonWizard')request={...waiting,query:text};
  if(request.type==='events'){await events(request,token);return;}
  if(request.type==='unknown'&&/^(?:add|create|make|move|remove|delete|rename|change|update)\b/i.test(text)){message('I can help you add or move a button, or prepare an invoice. Tell me which task you want help with—for example, “add a button” or “how do I move a button?”');return;}
  request.voice=voice;
  if(request.type==='help'){help();return;}
  if(request.type==='unknown')request={type:'global',query:request.query,voice};
  if(request.type==='navigate'){go(request.section);message('Opened '+core.sections.find(s=>s[0]===request.section)[1]+'.');return;}
  if(!request.query){waiting=request;message(request.type==='draft'?'Which customer or company should I use? Enter a name, or choose a blank draft.':'What name, number, company, or keyword should I search for?');if(request.type==='draft'){const card=message('You can also fill in the customer yourself.');action(card,'Start Blank Draft',t=>draft(null,request.purchase,t));}return;}
  waiting=request;
  if(request.type==='draft'){requireAccess('invoices');await contacts({...request,kind:request.purchase?'vendor':'customer'},token);}
  else if(request.type==='contact')await contacts(request,token);
  else if(['link','global'].includes(request.type))await globalSearch(request.query,token,voice);
  else await records(request,token);
 }
 async function submit(event){event.preventDefault();if(busy)return;const text=input.value,voice=voicePending;voicePending=false;input.value='';busy=true;send.disabled=true;const token=epoch;try{await ask(text,voice);}catch(error){if(valid(token))message('I couldn’t finish that request: '+error.message);}finally{if(valid(token)){status.textContent='';busy=false;send.disabled=false;input.focus();}}}
 function voice(){
  if(!voiceEnabled){status.textContent='Voice input is disabled. Enable it in Al settings first.';return;}
  if(busy)return;if(recognition){stopVoice();status.textContent='Voice input stopped.';return;}
  const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;if(!Speech)return;
  const token=epoch;recognition=new Speech();recognition.lang='en-US';recognition.interimResults=false;recognition.continuous=false;
  recognition.onresult=event=>{if(!valid(token)||panel.hidden)return;input.value=event.results[0][0].transcript.slice(0,600);voicePending=true;status.textContent='Review your words, then choose Send.';input.focus();};
  recognition.onerror=()=>{if(valid(token))status.textContent='Voice input could not start. Check microphone permission or type your message.';stopVoice();};
  recognition.onend=()=>{recognition=null;mic.setAttribute('aria-pressed','false');};
  mic.setAttribute('aria-pressed','true');status.textContent='Listening… tap the microphone to stop.';
  try{recognition.start();}catch{stopVoice();status.textContent='Voice input is unavailable. Please type your message.';}
 }

 function init(){
  launcher=el('button',undefined,'copilot-launcher');launcher.type='button';launcher.setAttribute('aria-label','Open Al dashboard assistant');launcher.setAttribute('aria-controls','a1Copilot');launcher.setAttribute('aria-expanded','false');
  const image=el('img');image.src='./assets/al-ticket.png';image.alt='';image.setAttribute('aria-hidden','true');launcher.append(image);document.body.append(launcher);
  panel=el('section',undefined,'copilot-panel');panel.id='a1Copilot';panel.hidden=true;panel.setAttribute('role','region');panel.setAttribute('aria-labelledby','copilotTitle');
  const header=el('header',undefined,'copilot-header');const title=el('div');const h=el('h2','Al');h.id='copilotTitle';title.append(h);header.append(title);
  const clearButton=el('button','New Chat','copilot-small al-new-chat');clearButton.type='button';clearButton.setAttribute('aria-label','New chat — clear Al conversation');clearButton.title='Clear this conversation and start again';clearButton.onclick=()=>{clear();owner=A1Data.account()?.email;panel.hidden=false;launcher.setAttribute('aria-expanded','true');aiTab?.setAttribute('aria-expanded','true');aiTab?.classList.add('is-active');placement?.layoutPanel();greet();input.focus();};const settings=el('details',undefined,'copilot-settings');const summary=el('summary','⚙');summary.setAttribute('aria-label','Al settings');settings.append(summary);header.append(settings);
  const closeButton=el('button','×','copilot-small');closeButton.type='button';closeButton.setAttribute('aria-label','Minimize Al');closeButton.title='Minimize Al';closeButton.onclick=close;header.append(closeButton,clearButton);panel.append(header);
  modeNote=el('p','Al · Dashboard search, summaries, drafts and guidance. Natural conversation connects when AI is configured.','copilot-mode');panel.append(modeNote);
  log=el('div',undefined,'copilot-log');log.setAttribute('role','log');log.setAttribute('aria-label','Assistant conversation');log.setAttribute('aria-live','polite');panel.append(log);
  status=el('p','','copilot-status');status.setAttribute('role','status');panel.append(status);
  const form=el('form',undefined,'copilot-form');input=el('textarea');input.rows=1;input.maxLength=600;input.placeholder='Ask Al… or type Help';input.setAttribute('aria-label','Message to dashboard assistant');input.addEventListener('input',()=>voicePending=false);form.append(input);
  const controls=el('div');mic=el('button','🎙','copilot-small');mic.type='button';mic.setAttribute('aria-label','Start or stop voice input');mic.title='Dictate a message, then review and send';mic.setAttribute('aria-pressed','false');mic.onclick=voice;send=el('button','Send','copilot-send');send.type='submit';controls.append(mic,send);form.append(controls);form.onsubmit=submit;panel.append(form);
  const supported=!!(window.SpeechRecognition||window.webkitSpeechRecognition);mic.hidden=true;
  settings.append(el('p','AI receives only what you type and your last six requests. Record searches and calculations stay in the dashboard. Vault passwords and cards are excluded. Chat clears on sign-out or New Chat.','copilot-note'));
  if(supported){const label=el('label');voiceToggle=el('input');voiceToggle.type='checkbox';voiceToggle.checked=false;voiceToggle.onchange=()=>{voiceEnabled=voiceToggle.checked;mic.hidden=!voiceEnabled;if(!voiceEnabled)stopVoice();};label.append(voiceToggle,el('span','Enable voice for this chat. Your browser may send microphone audio to its speech provider. Review the transcript before Send.'));settings.append(label);}
  else settings.append(el('p','Voice input is unavailable in this browser. You can use your keyboard’s dictation.','copilot-note'));
  const checkAI=el('button','Check AI connection','copilot-small');checkAI.type='button';checkAI.onclick=async()=>{const token=epoch;checkAI.disabled=true;try{const result=await A1Data.assistantRequest({action:'status'});if(valid(token))modeNote.textContent=result.configured?'AI configured · Ticketmaster '+(result.ticketmasterConfigured?'configured':'not configured')+' · Ask a question to test access.':'Dashboard mode · Add OPENAI_API_KEY in Supabase Edge Function secrets to enable live AI.';}catch(error){if(valid(token))status.textContent=error.message;}finally{checkAI.disabled=false;}};settings.append(checkAI);

  document.body.append(panel);
  function open(){if(!A1Data.authenticated())return;if(!panel.hidden){close();return;}if(owner!==A1Data.account()?.email){clear();owner=A1Data.account()?.email;}launcher.hidden=false;panel.hidden=false;launcher.setAttribute('aria-expanded','true');aiTab?.setAttribute('aria-expanded','true');aiTab?.classList.add('is-active');placement?.layoutPanel();if(!log.children.length)greet();input.focus();}
  launcher.onclick=open;aiTab=document.getElementById('a1AssistantTab');if(aiTab)aiTab.onclick=()=>{if(!panel.hidden){close();return;}open();};
  placement=window.A1AssistantPosition?.init(launcher,panel);
  panel.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
  window.addEventListener('a1-signed-out',clear);window.addEventListener('a1-password-recovery',clear);window.addEventListener('a1-access-changed',clear);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopVoice();});
 }
 document.addEventListener('DOMContentLoaded',init);
})();
