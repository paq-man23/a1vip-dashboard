const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('Edit Email saves only the email and never writes existing category selections or layouts',async()=>{
 const nodes=new Map(),writes=[];const row={id:'fixture',username:'user1',email:'old@example.invalid',enabled:true,is_admin:false,allowed_sections:['main'],blocked_links:['saved-block']};
 function make(){return {children:[],value:'',textContent:'',append(...n){this.children.push(...n);},replaceChildren(){this.children=[];},addEventListener(e,fn){this[e]=fn;},closest(){return this.label||=(make());},querySelectorAll(){return this.children.flatMap(x=>x.children).filter(x=>x.checked);},reset(){},showModal(){this.open=true;},close(){this.open=false;}};}
 const get=id=>{if(!nodes.has(id))nodes.set(id,make());return nodes.get(id);};
 const window={addEventListener(){}};const data={isAdmin:()=>true,listAccounts:async()=>[row],accountAction:async action=>writes.push(action),setAccountAccess:async()=>{throw new Error('Email edit changed category access');}};
 vm.runInNewContext(fs.readFileSync('a1-accounts.js','utf8'),{window,A1Data:data,document:{getElementById:get,createElement:make,createTextNode:t=>({textContent:t}),addEventListener(){}},console});
 await window.A1Accounts.load();const actions=get('accountManagerList').children[0].children[3];actions.children.find(n=>n.textContent==='Edit Email').click();
 assert.equal(get('managedEmail').readOnly,false);assert.equal(get('managedCategories').hidden,true);assert.equal(get('managedUsername').closest().hidden,true);
 get('managedEmail').value='new@example.invalid';await window.A1Accounts.save({preventDefault(){}});
 assert.deepEqual(JSON.parse(JSON.stringify(writes)),[{action:'email',id:'fixture',email:'new@example.invalid'}]);assert.deepEqual(row.allowed_sections,['main']);assert.deepEqual(row.blocked_links,['saved-block']);assert.equal(get('accountEditor').open,false);
});
