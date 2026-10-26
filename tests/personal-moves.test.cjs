const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function dragHarness(admin=false){
 const calls=[],root={A1Data:{authenticated:()=>true,isAdmin:()=>admin},A1Activity:{moveButton:async(...args)=>calls.push(['personal',...args])}};
 const context={window:root,document:{addEventListener(){}},manageableSections:[{id:'main'},{id:'luxury'},{id:'domains'}],sectionGrid:()=>({querySelectorAll:()=>[]}),confirm:()=>true,alert:message=>{throw Error(message);},showSection:id=>calls.push(['section',id]),fetchRemoteConfig:async()=>{calls.push(['shared-fetch']);return {added:{},removed:{}};},mergeStates:(_,r)=>r,loadState:()=>({}),saveState(){},applyState(){},broadcastRefresh(){},syncRemote:async()=>calls.push(['shared-save'])};
 vm.runInNewContext(fs.readFileSync('button-moves.js','utf8'),context);
 return {moves:root.A1ButtonMoves,calls};
}
const item={from:'main',label:'Example',url:'https://example.com/',key:'source-key'};
test('regular-user drag saves only personal preferences and never writes shared defaults',async()=>{
 const h=dragHarness();await h.moves.move(item,'luxury');assert.equal(h.calls[0][0],'personal');assert.equal(h.calls[0][2],'luxury');assert.equal(h.calls.some(c=>c[0].startsWith('shared')),false);
});
test('regular users cannot drop links into admin-only categories',async()=>{
 const h=dragHarness();await h.moves.move(item,'domains');assert.equal(h.calls.length,0);
});
test('admin moves still save the shared layout',async()=>{
 const h=dragHarness(true);await h.moves.move(item,'luxury');assert.equal(h.calls.some(c=>c[0]==='shared-save'),true);assert.equal(h.calls.some(c=>c[0]==='personal'),false);
});
test('moving an admin personal link does not publish that link as a shared default',async()=>{
 const h=dragHarness(true);await h.moves.move({...item,personal:true},'luxury');assert.equal(h.calls[0][0],'personal');assert.equal(h.calls.some(c=>c[0].startsWith('shared')),false);
});
function preferenceHarness(){
 let preferences={hidden_buttons:[],added_links:[]};
 const root={addEventListener(){}};
 const data={authenticated:()=>true,account:()=>({email:'user1@a1vip.invalid'}),fetchPreferences:async()=>structuredClone(preferences),savePreferences:async state=>preferences=structuredClone(state)};
 vm.runInNewContext(fs.readFileSync('a1-activity.js','utf8'),{window:root,A1Data:data,URL,document:{addEventListener(){},querySelectorAll:()=>[],querySelector:()=>null},console,sessionStorage:{getItem(){}},setInterval(){},clearInterval(){}});
 return {activity:root.A1Activity,prefs:()=>preferences};
}
test('a personal move persists the source hide and destination, including after moving back',async()=>{
 const h=preferenceHarness();await h.activity.moveButton(item,'luxury');
 assert.deepEqual([...h.prefs().hidden_buttons],['source-key']);assert.equal(h.prefs().added_links[0].section,'luxury');
 await h.activity.moveButton({...item,from:'luxury',personal:true},'main');
 assert.equal(h.prefs().added_links.length,1);assert.equal(h.prefs().added_links[0].section,'main');assert.equal(h.prefs().added_links[0].url,item.url);
});
test('personal move rejects admin categories and non-web actions before saving',async()=>{
 const h=preferenceHarness();await assert.rejects(h.activity.moveButton(item,'domains'),/Unsupported/);await assert.rejects(h.activity.moveButton({...item,url:'javascript:alert(1)'},'luxury'),/Unsupported/);assert.equal(h.prefs().added_links.length,0);
});
