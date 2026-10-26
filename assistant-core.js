/* Guided task routing. No model, external data transfer, or automatic writes. */
(function(root){
 const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
 const sections=[['main','Main Links'],['luxury','Suites'],['accounts','Ticket Accounts'],['travel','Travel'],['social','Social'],['invoices','Invoices & POs'],['customers','Customers'],['vendors','Vendors'],['formLetter','Letters'],['tripItinerary','Trips'],['admin','Admin'],['manageAccounts','Manage Accounts']];
 const descriptions={main:'Everyday website shortcuts and your own links.',luxury:'Suite booking, premium hospitality, and suite-provider websites.',accounts:'Team ticket-account links. Admins can use private-browser shortcuts; regular users open websites inside the dashboard.',travel:'Travel websites, including private jets, luxury homes, and yachts.',social:'Social-media and communication shortcuts.',invoices:'Create and search invoices and purchase orders, manage line items, and review saved history.',customers:'Searchable customer cards with names, companies, contact details, notes, and photos.',vendors:'Supplier and vendor cards, including contact details used for purchase orders.',formLetter:'Create, preview, and save reusable letters.',tripItinerary:'Build and find itineraries with events, hotels, flights, rental cars, and contacts.',admin:'Administrator tools, login history, website panel time, imports, and shared dashboard setup.',manageAccounts:'Administrator account management, user category access, and assigned links and layouts.'};
 function guideTopic(text){
  const q=normalize(text);if(!/\b(?:how|help|explain|what|teach|guide|describe)\b|walk me|tell me about/.test(q))return null;
  if(/mov|drag|reorder/.test(q)&&/button|link/.test(q))return 'move';
  if(/add|creat|new/.test(q)&&/button|link|website/.test(q))return 'add';
  if(/hid|remov/.test(q)&&/button|link/.test(q))return 'hide';
  if(/password/.test(q))return 'password';
  if(/refresh|update/.test(q))return 'refresh';
  if(/layout|tablet|vision|duo|resize|stretch/.test(q))return 'layout';
  if(/invoice|purchase order/.test(q))return 'invoices';
  if(/customer|vendor|contact/.test(q))return 'contacts';
  if(/section|categor|what.*(?:in|is)|explain|describe|tell me about/.test(q)){
   const section=sections.find(([id,label])=>q.includes(normalize(label))||q.includes(normalize(id)));
   return section?'section:'+section[0]:'sections';
  }
  return null;
 }
 function guidance(topic,{admin=false,canAccess=()=>true,vision=false}={}){
  if(topic==='move')return 'To move a button:\n1. Open the category containing the button.\n2. On a computer, drag it onto the destination category icon. On a phone or tablet, press and hold the button, then drag it to the category. For ticket-account links, start moving after the short hold; a stationary three-second hold is the private-browser shortcut for admins.\n3. Confirm the move.\n'+(vision?'In Vision Pro layout, you can also choose Move a Button, select the link, and select its destination.\n':'')+(admin?'Admin moves update the shared layout. Personal links remain personal.':'Your moves affect only your own layout. You can move links only between categories enabled for you.');
  if(topic==='add')return 'To add a website button:\nAsk me: “add button for example.com in main”. I’ll show the address and category for you to review, then you choose Add Button.\n'+(admin?'You can also paste a website address into the top link bar and choose Add to Main, or use Admin → Button Manager. Admin additions are shared dashboard buttons.':'You can also open My Buttons, enter a label and website address, choose an enabled category, then Save Choices. Your new buttons belong to your personal layout.');
  if(topic==='hide')return 'Open My Buttons, uncheck a button you don’t want to see, then choose Save Choices. Recheck it there to show it again. Links restricted by an administrator cannot be restored by a regular user.';
  if(topic==='password')return 'Choose Change Password beside your signed-in name. Enter your current password and the new password, then save. If you cannot sign in, use Forgot Password on the login screen.';
  if(topic==='refresh')return 'Choose Refresh App beside your name to load the newest dashboard files. The Refresh History / Refresh Contacts buttons inside a section reload that section’s saved records.';
  if(topic==='layout')return 'Use the layout menu beside your name to choose Auto, Tablet · Right, or Vision Pro. The choice is remembered on this device. Drag Al to move him; drag the corner of his speech bubble to resize it.';
  if(topic==='invoices')return canAccess('invoices')?'Open Invoices & POs. Choose invoice or purchase order, start a new document, select a saved contact, add the event or items and prices, and review the preview. Use Save when you are ready. Saved documents are under History. You can also ask me “create an invoice for Acme” to prepare a draft.':'Your administrator has not enabled Invoices & POs for your account.';
  if(topic==='contacts'&&!canAccess('customers')&&!canAccess('vendors'))return 'Your administrator has not enabled Customers or Vendors for your account.';
  if(topic==='contacts')return 'Open Customers or Vendors. Search by name, company, email, or phone, or use the alphabet tabs. Select a card to view or edit it. Choose Add Customer / Add Vendor for a new card, then Save Contact. Contacts can be selected in document editors when you have access to those categories.';
  const selected=topic.startsWith('section:')?topic.slice(8):null;
  const available=sections.filter(([id])=>(!selected||selected===id)&&canAccess(id));
  if(!available.length)return 'That section has not been enabled for your account.';
  return (selected?'':'Here’s what is in your dashboard sections:\n')+available.map(([id,label])=>label+' — '+descriptions[id]).join('\n\n');
 }
 function intent(text){
  const raw=String(text||'').trim().replace(/[.!?]+$/,'');
  let m;
  const topic=guideTopic(raw);if(topic)return {type:'guide',topic};
  if(/^(hi|hello|hey|good morning|good afternoon|good evening)(?:[ ,]+al)?$/i.test(raw))return {type:'greeting'};
  if((m=raw.match(/^(?:please\s+)?add\s+(?:a\s+)?button(?:\s+(?:called|named)\s+["“]([^"”]+)["”])?\s+for\s+(.+?)\s+(?:in|to)\s+["“]?([^"”]+?)["”]?$/i)))return {type:'addButton',label:m[1]||'',website:m[2].replace(/^["“]|["”]$/g,''),category:m[3].trim()};
  if(/^(cancel|stop|reset|start over)$/i.test(raw))return {type:'cancel'};
  if((m=raw.match(/(?:create|make|start|new|prepare)\s+(?:a\s+|an\s+)?(?:new\s+)?(invoice|purchase order|po)(?:\s+(?:for|with)\s+(.+))?$/i)))return {type:'draft',purchase:!/^invoice$/i.test(m[1]),query:(m[2]||'').trim()};
  if((m=raw.match(/^(?:(?:find|search(?: for)?|look\s*up|show(?: me)?)\s+)?(?:a\s+|the\s+)?(customers?|vendors?|contacts?|invoices?|purchase orders?|trips?|itinerar(?:y|ies)|letters?|links?)\s*(?:named\s+|called\s+|for\s+|#\s*)?(.*)$/i))){
   const word=m[1].toLowerCase();return {type:/customer|vendor|contact/.test(word)?'contact':/invoice|purchase/.test(word)?'invoice':/trip|itinerar/.test(word)?'trip':/letter/.test(word)?'letter':'link',kind:/vendor/.test(word)?'vendor':/customer/.test(word)?'customer':null,query:m[2].trim()};
  }
  if((m=raw.match(/^(?:open|go to|take me to)\s+(.+)$/i))){const key=normalize(m[1]);const section=sections.find(([id,label])=>[normalize(id),normalize(label)].includes(key));if(section)return {type:'navigate',section:section[0]};}
  if(/help|how (do|can)|what can|guide|walk me/i.test(raw))return {type:'help',query:raw};
  if((m=raw.match(/^(?:find|search(?: for)?|look\s*up|where (?:is|are)|where can I find)\s+(.+)$/i)))return {type:'global',query:m[1].trim()};
  return {type:'unknown',query:raw};
 }
 function searchText(value){return normalize(value).replace(/\b[a-z]{5,}\b/g,word=>word.endsWith('s')&&!word.endsWith('ss')?word.slice(0,-1):word);}
 function phoneticName(value){
  let word=normalize(value).replace(/[^a-z]/g,'');if(word.length<3)return '';
  word=word.replace(/^kn/,'n').replace(/^wr/,'r').replace(/^wh/,'w').replace(/ph/g,'f').replace(/ck/g,'k').replace(/c(?=[eiy])/g,'s').replace(/[cq]/g,'k');
  const codes={b:1,f:1,p:1,v:1,c:2,g:2,j:2,k:2,q:2,s:2,x:2,z:2,d:3,t:3,l:4,m:5,n:5,r:6};
  let key=word[0],previous=codes[word[0]]||0;
  for(const letter of word.slice(1)){const code=codes[letter]||0;if(code&&code!==previous)key+=code;if(!['h','w'].includes(letter))previous=code;}
  return (key+'000').slice(0,4);
 }
 function matches(rows,query,fields,{voice=false}={}){
  const terms=searchText(query).split(' ').filter(Boolean);
  return rows.filter(row=>{
   const hay=searchText(fields.map(key=>row[key]).filter(v=>v!=null).join(' '));
   const names=voice?fields.filter(key=>/name|contact|talent|to$/i.test(key)&&!/(email|phone|notes|tags)/i.test(key)).flatMap(key=>normalize(row[key]||'').split(/[^a-z]+/)).filter(word=>word.length>=3):[];
   return terms.every(term=>hay.includes(term)||(voice&&/^[a-z]{3,}$/.test(term)&&names.some(name=>phoneticName(name)&&phoneticName(name)===phoneticName(term))));
  });
 }
 function rankLinks(rows,query){
  const key=normalize(query);return matches(rows,query,['label']).sort((a,b)=>{
   const score=row=>(normalize(row.label)===key?100:normalize(row.label).startsWith(key)?30:0)+(row.section==='accounts'?10:0);
   return score(b)-score(a)||a.label.localeCompare(b.label);
  });
 }
 const api={normalize,intent,matches,rankLinks,sections,guideTopic,guidance,phoneticName};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.A1AssistantCore=api;
})(typeof window==='undefined'?globalThis:window);
