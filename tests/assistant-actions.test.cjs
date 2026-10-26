const {test}=require('node:test'),assert=require('node:assert/strict'),{proposal,add}=require('../assistant-actions.js'),{intent}=require('../assistant-core.js');
const request={website:'example.com',category:'main'};
function env(admin=false){
 let current='user@example.invalid';const writes=[],data={account:()=>({email:current}),authenticated:()=>true,isAdmin:()=>admin,canAccess:()=>true,linkBlocked:()=>false,fetchButtonLayout:async()=>({added:{},removed:{},cloudVersion:3}),saveButtonLayout:async state=>{writes.push(['shared',state]);return {...state,cloudVersion:4};},fetchPreferences:async()=>({hidden_buttons:['hidden'],added_links:[]}),savePreferences:async state=>writes.push(['personal',state])};
 return {data,writes,exists:()=>false,local:()=>({}),apply:()=>writes.push(['apply']),refreshPersonal:async()=>writes.push(['refresh']),switchAccount:()=>current='other@example.invalid'};
}
test('quoted add-button commands resolve the supplied website and category',()=>{
 const parsed=intent('add button for "example.com" in "main"');assert.equal(parsed.type,'addButton');assert.deepEqual(proposal(parsed),{label:'example.com',url:'https://example.com/',section:'main'});
 assert.equal(intent('add button called "Example" for example.com in suites').label,'Example');
});
test('unsafe protocols, embedded credentials, vague websites and unknown categories are rejected',()=>{
 for(const website of ['javascript:alert(1)','data:text/html,bad','https://user:password@example.com','a website'])assert.throws(()=>proposal({...request,website}));
 assert.throws(()=>proposal({...request,category:'invoices'}));
});
test('regular account adds only a personal link and preserves hidden choices',async()=>{
 const e=env();await add(request,e);assert.equal(e.writes[0][0],'personal');assert.deepEqual(e.writes[0][1].hidden_buttons,['hidden']);assert.equal(e.writes.some(x=>x[0]==='shared'),false);
});
test('admin addition uses the guarded shared save and current cloud version',async()=>{
 const e=env(true);await add(request,e);assert.equal(e.writes[0][0],'shared');assert.equal(e.writes[0][1].cloudVersion,3);assert.equal(e.writes[0][1].added.main[0].url,'https://example.com/');
});
test('denied category, blocked link, duplicate and changed session never write',async()=>{
 for(const variant of ['category','blocked','duplicate','session']){
  const e=env();if(variant==='category')e.data.canAccess=()=>false;if(variant==='blocked')e.data.linkBlocked=()=>true;if(variant==='duplicate')e.exists=()=>true;if(variant==='session')e.data.fetchPreferences=async()=>{e.switchAccount();return {hidden_buttons:[],added_links:[]};};
  await assert.rejects(add(request,e));assert.equal(e.writes.length,0);
 }
});
