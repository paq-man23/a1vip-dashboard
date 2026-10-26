const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function harness({permissions=['main','customers','invoices'],pause,voice=false,links=[],contactRows}={}){
 const listeners={},events={},loads=[],opened=[];let authenticated=true,aborted=0,recognizer;
 function node(tag='div'){
  return {tag,children:[],hidden:false,value:'',textContent:'',attributes:{},classList:{contains:()=>false,toggle(){}},setAttribute(k,v){this.attributes[k]=v;},append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);}},replaceChildren(){this.children=[];},get firstElementChild(){return this.children[0];},remove(){this.parent.children=this.parent.children.filter(x=>x!==this);},focus(){},addEventListener(k,v){this[k]=v;}};
 }
 const body=node(),data={linkBlocked:()=>false,authenticated:()=>authenticated,canAccess:id=>authenticated&&permissions.includes(id),account:()=>({email:'user@example.invalid'}),loadSection:async id=>{loads.push(id);if(pause)await pause;},contacts:()=>contactRows||[{kind:'customer',id:'j',displayName:'Jane Smith',email:'jane@example.invalid'}],invoices:()=>[],documents:()=>[]};
 const root={A1AssistantCore:require('../assistant-core.js'),addEventListener:(k,v)=>events[k]=v};
 if(voice)root.SpeechRecognition=class{constructor(){recognizer=this;}start(){}abort(){aborted++;}};
 const buttons=links.map(row=>{const classes=new Set(row.hidden?['a1-personally-hidden']:[]);return {...row,isConnected:true,dataset:{label:row.label,url:'https://example.com'},classList:{contains:k=>classes.has(k),add:k=>classes.add(k),remove:k=>classes.delete(k)},closest:()=>({dataset:{section:row.section}}),scrollIntoView(){},focus(){},getBoundingClientRect:()=>({left:100}),parentElement:null};});
 const document={body,createElement:node,addEventListener:(k,v)=>listeners[k]=v,getElementById:()=>null,querySelectorAll:selector=>selector.includes('grid[data-section]')?buttons:[]};
 vm.runInNewContext(fs.readFileSync('a1-assistant.js','utf8'),{window:root,A1Data:data,document,console,showSection:id=>opened.push(id)});listeners.DOMContentLoaded();
 const launcher=body.children[0],panel=body.children[1],log=panel.children[2],status=panel.children[3],form=panel.children[4],input=form.children[0],mic=form.children[1].children[0];
 launcher.onclick();
 return {panel,launcher,log,status,input,mic,loads,opened,buttons,get recognizer(){return recognizer;},aborted:()=>aborted,submit:async text=>{input.value=text;await form.onsubmit({preventDefault(){}});},signout:()=>{authenticated=false;events['a1-signed-out']();},text:()=>log.children.map(x=>x.textContent).join(' ')};
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
test('voice transcription fills the composer without running actions and stops on logout',()=>{
 const h=harness({voice:true});h.mic.onclick();h.recognizer.onresult({results:[[{transcript:'create invoice for Jane'}]]});assert.equal(h.input.value,'create invoice for Jane');assert.deepEqual(h.loads,[]);h.signout();assert.equal(h.aborted(),1);assert.equal(h.input.value,'');
});

test('Yankees search navigates to the ticket button, reports suites and finds contacts by notes',async()=>{
 const h=harness({permissions:['main','accounts','luxury','customers'],links:[{label:'Yankee Suites',section:'luxury'},{label:'Yankees Ticketmaster Account',section:'accounts'},{label:'Yankees Hidden',section:'main',hidden:true}],contactRows:[{kind:'customer',id:'j',displayName:'Jane Smith',notes:'Yankees season tickets'}]});
 await h.submit('Yankees');assert.deepEqual(h.opened,['accounts']);assert.equal(h.buttons[1].classList.contains('al-found-link'),true);assert.match(h.text(),/Jane Smith/);assert.match(h.text(),/under Suites/);assert.doesNotMatch(h.text(),/Yankees Hidden/);
});
test('global link search excludes denied categories while searching all allowed categories',async()=>{
 const h=harness({permissions:['luxury'],links:[{label:'Yankees',section:'accounts'},{label:'Yankees Suites',section:'luxury'}]});
 await h.submit('find Yankees');assert.deepEqual(h.opened,['luxury']);assert.deepEqual(h.loads,[]);assert.match(h.text(),/under Suites/);assert.doesNotMatch(h.text(),/Ticket Accounts/);
});
