const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function harness({permissions=['main','customers','invoices'],pause,voice=false,links=[],contactRows,withTab=false,username='',ai,invoiceRows=[],popupAllowed=true}={}){
 const listeners={},events={},loads=[],opened=[];let authenticated=true,aborted=0,recognizer;
 function node(tag='div'){
  return {tag,children:[],hidden:false,value:'',textContent:'',dataset:{},attributes:{},classList:{contains:()=>false,toggle(){},add(){},remove(){}},setAttribute(k,v){this.attributes[k]=v;},append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);}},replaceChildren(){this.children=[];},get firstElementChild(){return this.children[0];},remove(){this.parent.children=this.parent.children.filter(x=>x!==this);},focus(){},addEventListener(k,v){this[k]=v;}};
 }
 const tab=withTab?node('button'):null;const body=node(),data={linkBlocked:()=>false,authenticated:()=>authenticated,canAccess:id=>authenticated&&permissions.includes(id),isAdmin:()=>false,account:()=>({email:'user@example.invalid',username}),loadSection:async id=>{loads.push(id);if(pause)await pause;},contacts:()=>contactRows||[{kind:'customer',id:'j',displayName:'Jane Smith',email:'jane@example.invalid'}],invoices:()=>invoiceRows,documents:()=>[]};
 if(ai)data.assistantRequest=ai;
 const root={A1AssistantRecords:require('../assistant-records.js'),A1AssistantActions:require('../assistant-actions.js'),A1AssistantCore:require('../assistant-core.js'),addEventListener:(k,v)=>events[k]=v};
 const popups=[];root.open=(url,target,features)=>{const popup=popupAllowed?{opener:'dashboard'}:null;popups.push({url,target,features,popup});return popup;};
 if(voice)root.SpeechRecognition=class{constructor(){recognizer=this;}start(){}abort(){aborted++;}};
 const buttons=links.map(row=>{const classes=new Set(row.hidden?['a1-personally-hidden']:[]);return {...row,isConnected:true,dataset:{label:row.label,url:row.url||'https://example.com'},classList:{contains:k=>classes.has(k),add:k=>classes.add(k),remove:k=>classes.delete(k)},closest:()=>({dataset:{section:row.section}}),scrollIntoView(){},focus(){},getBoundingClientRect:()=>({left:100}),parentElement:null};});
 const document={body,createElement:node,addEventListener:(k,v)=>listeners[k]=v,getElementById:id=>id==='a1AssistantTab'?tab:null,querySelectorAll:selector=>selector.includes('grid[data-section]')?buttons:[]};
 vm.runInNewContext(fs.readFileSync('a1-assistant.js','utf8'),{window:root,A1Data:data,document,console,URL,showSection:id=>opened.push(id)});listeners.DOMContentLoaded();
 const launcher=body.children[0],panel=body.children[1],log=panel.children[2],status=panel.children[3],form=panel.children[4],input=form.children[0],mic=form.children[1].children[0];
 launcher.onclick();
 return {panel,launcher,tab,log,status,input,mic,loads,opened,buttons,popups,get recognizer(){return recognizer;},aborted:()=>aborted,submit:async text=>{input.value=text;await form.onsubmit({preventDefault(){}});},signout:()=>{authenticated=false;events['a1-signed-out']();},text:()=>log.children.map(x=>x.textContent).join(' ')};
}
test('Al searches permitted contacts without writing data',async()=>{
 const h=harness();await h.submit('find customer Jane');assert.deepEqual(h.loads,['customers']);assert.match(h.text(),/Jane Smith/);assert.match(h.text(),/matching contact/);
});
test('Al never loads a category the account cannot access',async()=>{
 const h=harness({permissions:['main']});await h.submit('find customer Jane');assert.deepEqual(h.loads,[]);assert.match(h.text(),/not enabled/);assert.doesNotMatch(h.text(),/jane@example/);
});
test('signout clears chat and rejects in-flight contact search results',async()=>{
 let release;const pause=new Promise(r=>release=r),h=harness({pause});const pending=h.submit('find customer Jane');h.signout();release();await pending;assert.equal(h.log.children.length,0);assert.equal(h.panel.hidden,true);assert.equal(h.input.value,'');
});
test('browser speech stays off until explicitly enabled',()=>{
 const h=harness({voice:true});assert.equal(h.mic.hidden,true);h.mic.onclick();assert.equal(h.recognizer,undefined);assert.match(h.status.textContent,/disabled/);assert.deepEqual(h.loads,[]);
});
test('Yankees search navigates to the ticket button, reports suites and finds contacts by notes',async()=>{
 const h=harness({permissions:['main','accounts','luxury','customers'],links:[{label:'Yankee Suites',section:'luxury'},{label:'Yankees Ticketmaster Account',section:'accounts'},{label:'Yankees Hidden',section:'main',hidden:true}],contactRows:[{kind:'customer',id:'j',displayName:'Jane Smith',notes:'Yankees season tickets'}]});
 await h.submit('Yankees');assert.deepEqual(h.opened,['accounts']);assert.equal(h.buttons[1].classList.contains('al-found-link'),true);assert.match(h.text(),/Jane Smith/);assert.match(h.text(),/under Suites/);assert.doesNotMatch(h.text(),/Yankees Hidden/);
});
test('global link search excludes denied categories while searching all allowed categories',async()=>{
 const h=harness({permissions:['luxury'],links:[{label:'Yankees',section:'accounts'},{label:'Yankees Suites',section:'luxury'}]});
 await h.submit('find Yankees');assert.deepEqual(h.opened,['luxury']);assert.deepEqual(h.loads,[]);assert.match(h.text(),/under Suites/);assert.doesNotMatch(h.text(),/Ticket Accounts/);
});

test('closing the speech bubble keeps Al visible and AI icon reopens the conversation',async()=>{
 const h=harness({withTab:true});await h.submit('find customer Jane');const before=h.text();
 h.panel.children[0].children[2].onclick();assert.equal(h.panel.hidden,true);assert.equal(h.launcher.hidden,false);assert.equal(h.tab.attributes['aria-expanded'],'false');
 h.tab.onclick();assert.equal(h.panel.hidden,false);assert.equal(h.launcher.hidden,false);assert.equal(h.text(),before);assert.equal(h.tab.attributes['aria-expanded'],'true');
});

test('Al welcomes the user conversationally and shows examples on Help',async()=>{
 const h=harness();assert.match(h.text(),/Hi, I’m Al/);assert.equal(h.log.children[0].children.length,0);assert.doesNotMatch(h.text(),/examples/);assert.doesNotMatch(h.text(),/Your dashboard flight/);
 await h.submit('help');assert.match(h.text(),/create an invoice/);assert.equal(h.log.children.at(-1).children.length,0);await h.submit('hello Al');assert.match(h.log.children.at(-1).textContent,/Hi, I’m Al/);
});

test('greeting uses the current username and does not substitute another account',async()=>{
 const h=harness({username:'JV'});assert.match(h.text(),/Hi JV, I’m Al!/);await h.submit('hi');assert.match(h.log.children.at(-1).textContent,/Hi JV/);assert.doesNotMatch(h.text(),/Hi JAW/);
});
test('add-button command shows a proposal without saving until the action is selected',async()=>{
 const h=harness();await h.submit('add button for example.com in main');assert.match(h.text(),/Add this button/);assert.match(h.text(),/personal layout/);assert.equal(h.opened.length,0);
});

test('Al answers how-to questions directly without loading or changing dashboard records',async()=>{
 const h=harness();await h.submit('how do I move buttons?');assert.match(h.text(),/press and hold/);assert.match(h.text(),/Confirm the move/);assert.equal(h.loads.length,0);assert.equal(h.opened.length,0);
});
test('direct search commands do not need a model request',async()=>{
 let calls=0;const h=harness({ai:async()=>{calls++;throw new Error('External call forbidden');}});await h.submit('find customer Jane');assert.equal(calls,0);assert.match(h.text(),/Jane Smith/);
});
test('internal guidance works without any AI service',async()=>{
 const h=harness();await h.submit('how do I move buttons?');assert.match(h.text(),/Confirm the move/);assert.equal(h.loads.length,0);
});
test('Add a button starts a guided website/category dialogue without contact searches',async()=>{
 const h=harness();await h.submit('Add a button');assert.match(h.text(),/what website/);assert.deepEqual(h.loads,[]);
 await h.submit('example.com');assert.match(h.text(),/Which category/);assert.deepEqual(h.loads,[]);
 await h.submit('main');assert.match(h.text(),/Add this button/);assert.match(h.text(),/https:\/\/example.com\//);assert.deepEqual(h.loads,[]);assert.equal(h.opened.length,0);
});
test('incomplete button requests keep the requested category and support cancellation',async()=>{
 const h=harness();await h.submit('add a button in main');await h.submit('example.com');assert.match(h.text(),/Add this button/);assert.deepEqual(h.loads,[]);
 await h.submit('add a button');await h.submit('cancel');assert.match(h.log.children.at(-1).textContent,/Cancelled/);
});
test('vague action requests do not load customer records as a search fallback',async()=>{
 const h=harness();await h.submit('rename a button');assert.deepEqual(h.loads,[]);assert.doesNotMatch(h.text(),/No matching dashboard/);
});

test('adding an existing website highlights its button across categories before asking for category',async()=>{
 const h=harness({permissions:['main','accounts'],links:[{label:'Yankees Ticketmaster',section:'accounts',url:'http://www.example.com/'}]});
 await h.submit('add a button');await h.submit('https://example.com');
 assert.deepEqual(h.opened,['accounts']);assert.match(h.text(),/already exists/);assert.equal(h.buttons[0].classList.contains('al-found-link'),true);assert.doesNotMatch(h.text(),/Which category|Add this button/);assert.deepEqual(h.loads,[]);
});
test('complete add request checks existing names across accessible categories',async()=>{
 const h=harness({permissions:['main','luxury'],links:[{label:'Yankees',section:'luxury',url:'https://tickets.example.org'}]});
 await h.submit('add button named "Yankees" for new.example.com in main');assert.deepEqual(h.opened,['luxury']);assert.match(h.text(),/already exists/);assert.doesNotMatch(h.text(),/Add this button/);
});
test('duplicate check excludes denied and hidden links and keeps distinct website paths',async()=>{
 const h=harness({links:[{label:'Secret',section:'accounts'},{label:'Hidden',section:'main',hidden:true},{label:'Other page',section:'main',url:'https://example.com/other'}]});
 await h.submit('add button for example.com in main');assert.match(h.text(),/Add this button/);assert.deepEqual(h.opened,[]);
});
test('confirmation rechecks buttons added since the proposal and highlights instead of writing',async()=>{
 const h=harness({links:[{label:'Existing',section:'main',url:'https://other.example.com'}]});
 await h.submit('add button for example.com in main');const card=h.log.children.at(-1);h.buttons[0].dataset.url='https://example.com/';await card.children[0].onclick();assert.match(h.text(),/already exists/);assert.deepEqual(h.opened,['main']);
});

test('visible New Chat clears history and an unfinished task while keeping Al open',async()=>{
 const h=harness();await h.submit('add a button');h.input.value='unfinished';
 const reset=h.panel.children[0].children.find(n=>n.textContent==='New Chat');assert.ok(reset);assert.match(reset.attributes['aria-label'],/clear Al conversation/);reset.onclick();
 assert.equal(h.panel.hidden,false);assert.equal(h.log.children.length,1);assert.match(h.text(),/Hi, I’m Al/);assert.equal(h.input.value,'');assert.doesNotMatch(h.text(),/what website/);
 await h.submit('example.com');assert.doesNotMatch(h.text(),/Which category/);
});
test('New Chat discards delayed results from the previous conversation',async()=>{
 let release;const pause=new Promise(r=>release=r),h=harness({pause});const pending=h.submit('find customer Jane');h.panel.children[0].children.find(n=>n.textContent==='New Chat').onclick();release();await pending;assert.equal(h.log.children.length,1);assert.doesNotMatch(h.text(),/Jane Smith/);
});

test('conversational plans search real permitted records and send only user text as history',async()=>{
 const requests=[],h=harness({ai:async body=>{requests.push(body);return {configured:true,plan:{type:'contact',kind:'customer',query:requests.length===1?'Jane':'Acme'}};}});
 await h.submit('Can you pull up Jane’s contact details for me?');assert.match(h.text(),/Jane Smith/);
 await h.submit('What about Acme instead?');assert.deepEqual(Array.from(requests[1].history),['Can you pull up Jane’s contact details for me?']);assert.doesNotMatch(JSON.stringify(requests),/jane@example/);
});
test('conversational navigation cannot open a denied category',async()=>{
 const h=harness({ai:async()=>({plan:{type:'navigate',section:'admin'}})});await h.submit('Take me to the account administration area please');assert.deepEqual(h.opened,[]);assert.match(h.text(),/not enabled/);
});
test('AI answers render as text, and a missing key preserves local searches',async()=>{
 const h=harness({ai:async()=>({plan:{type:'answer',reply:'<script>bad()</script>'}})});await h.submit('Tell me your limitations');assert.match(h.text(),/<script>/);assert.equal(h.log.children.at(-1).children.length,0);
 const fallback=harness({ai:async()=>({configured:false})});await fallback.submit('Jane');assert.match(fallback.text(),/not configured/);assert.match(fallback.text(),/Jane Smith/);
});
test('New Chat rejects delayed AI responses and clears prior user context',async()=>{
 let release;const pause=new Promise(r=>release=r),requests=[],h=harness({ai:async body=>{requests.push(body);await pause;return {plan:{type:'answer',reply:'old answer'}};}});
 const pending=h.submit('Tell me something about the dashboard');h.panel.children[0].children.find(n=>n.textContent==='New Chat').onclick();release();await pending;assert.doesNotMatch(h.text(),/old answer/);
 await h.submit('What can this dashboard do for me?');assert.deepEqual(Array.from(requests[1].history),[]);
});
test('summary commands calculate actual saved invoice totals without an AI request',async()=>{
 const h=harness({invoiceRows:[{number:'4145',type:'invoice-ticket',createdDate:'2026-01-01',lines:[{qty:2,unitCost:100}],credit:50}],ai:async()=>{throw new Error('Should not call AI');}});await h.submit('summary 2026 invoices');assert.match(h.text(),/Total \$200.00/);assert.match(h.text(),/Balance \$150.00/);
});
test('voice requires opt-in, transcribes without sending and stops on signout',()=>{
 const h=harness({voice:true}),settings=h.panel.children[0].children[1],toggle=settings.children.find(n=>n.tag==='label').children[0];
 assert.equal(h.recognizer,undefined);toggle.checked=true;toggle.onchange();assert.equal(h.mic.hidden,false);h.mic.onclick();h.recognizer.onresult({results:[[{transcript:'find customer Sonia'}]]});assert.equal(h.input.value,'find customer Sonia');assert.deepEqual(h.loads,[]);assert.match(h.status.textContent,/Review/);h.signout();assert.equal(h.aborted(),1);assert.equal(h.input.value,'');assert.equal(h.mic.hidden,true);
});

test('direct event search displays real provider details and price limitations without loading customer records',async()=>{
 const requests=[],h=harness({ai:async body=>{requests.push(body);return {events:{configured:true,source:'Ticketmaster Discovery',checkedAt:'2026-11-04T19:00:00Z',total:1,events:[{name:'Knicks vs Bulls',date:'2026-12-01',time:'19:30:00',timezone:'America/New_York',venue:'Madison Square Garden',city:'New York',status:'onsale',url:'https://www.ticketmaster.com/event/event-1',priceRanges:[{min:150,max:600,currency:'USD'}]}]}};}});
 await h.submit('find events Knicks');assert.equal(requests[0].action,'events');assert.equal(requests[0].query,'Knicks');assert.match(h.text(),/Knicks vs Bulls/);assert.match(h.text(),/Published event price range/);assert.match(h.text(),/not current section\/row prices/);assert.deepEqual(h.loads,[]);
});
test('natural event requests preserve date/city filters through model planning and do not make duplicate Discovery calls',async()=>{
 const requests=[],h=harness({ai:async body=>{requests.push(body);return {configured:true,plan:{type:'events',query:'Knicks',city:'New York',startDate:'2026-12-01',endDate:'2026-12-01'},events:{configured:true,checkedAt:'2026-11-04T19:00:00Z',total:1,events:[{name:'Knicks vs Bulls',date:'2026-12-01',priceRanges:[]}]}};}});
 await h.submit('What Knicks games are in New York on December 1?');assert.equal(requests.length,1);assert.match(h.text(),/Knicks vs Bulls/);assert.match(h.text(),/did not supply a price range/);assert.deepEqual(h.loads,[]);
});
test('missing event query asks for a team or artist; missing key never claims there are no events',async()=>{
 const requests=[],h=harness({ai:async body=>{requests.push(body);return {events:{configured:false,error:'Add TICKETMASTER_API_KEY'}};}});await h.submit('find events');assert.match(h.text(),/Which artist/);assert.equal(requests.length,0);await h.submit('Knicks');assert.equal(requests[0].action,'events');assert.match(h.text(),/TICKETMASTER_API_KEY/);assert.doesNotMatch(h.text(),/No matching events/);
});
test('clearing chat rejects a delayed Ticketmaster response',async()=>{
 let release;const pending=new Promise(r=>release=r),h=harness({ai:async()=>{await pending;return {events:{configured:true,checkedAt:'2026-11-04T19:00:00Z',events:[{name:'Old event'}]}};}});const request=h.submit('find events Knicks');h.panel.children[0].children.find(n=>n.textContent==='New Chat').onclick();release();await request;assert.doesNotMatch(h.text(),/Old event/);
});

test('Ticketmaster result opens a regular browser popup without Shortcuts or an iframe',async()=>{
 const h=harness({ai:async()=>({events:{configured:true,checkedAt:'2026-11-04T19:00:00Z',total:1,events:[{name:'Knicks event',date:'2026-12-01',url:'https://www.ticketmaster.com/event/123'}]}})});
 await h.submit('find events Knicks');const card=h.log.children.find(n=>n.textContent.includes('Knicks event'));const button=card.children.find(n=>n.textContent==='Open Ticketmaster');assert.ok(button);await button.onclick();assert.equal(h.popups.length,1);assert.equal(h.popups[0].url,'https://www.ticketmaster.com/event/123');assert.equal(h.popups[0].target,'_blank');assert.match(h.popups[0].features,/popup=yes/);assert.equal(h.popups[0].popup.opener,null);assert.deepEqual(h.loads,[]);assert.doesNotMatch(h.text(),/Shortcut|incognito/);
});
test('blocked Ticketmaster popup offers copying the link',async()=>{
 const h=harness({popupAllowed:false,ai:async()=>({events:{configured:true,checkedAt:'2026-11-04T19:00:00Z',total:1,events:[{name:'Knicks event',url:'https://www.ticketmaster.com/event/123'}]}})});await h.submit('find events Knicks');const card=h.log.children.find(n=>n.textContent.includes('Knicks event'));await card.children[0].onclick();assert.match(h.text(),/popup was blocked/);assert.equal(h.log.children.some(n=>n.children.some(c=>c.textContent==='Copy Event Link')),true);
});
test('signed-out event actions cannot open a popup',async()=>{
 const h=harness({ai:async()=>({events:{configured:true,checkedAt:'2026-11-04T19:00:00Z',total:1,events:[{name:'Knicks event',url:'https://www.ticketmaster.com/event/123'}]}})});await h.submit('find events Knicks');const card=h.log.children.find(n=>n.textContent.includes('Knicks event'));h.signout();await card.children[0].onclick();assert.equal(h.popups.length,0);
});
