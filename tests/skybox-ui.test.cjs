const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const S=require('../skybox-import');
function ui(){
 const nodes=new Map();class Node{constructor(){this.value='';this.children=[];this.disabled=false;this.style={};this.files=[];}append(...values){this.children.push(...values);}replaceChildren(...values){this.children=values;}addEventListener(){}click(){}}
 const node=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);};let imports=0;
 const window={addEventListener(){}};
 vm.runInNewContext(fs.readFileSync('skybox-ui.js','utf8'),{window,document:{getElementById:node,createElement:()=>new Node()},A1Skybox:S,A1Data:{contacts:()=>[],importSkybox:async()=>{imports++;return {imported:1,skipped:0,conflicts:0,changed:0,errors:[]};}},money:value=>'$'+value,confirm:()=>false});
 return {api:window.A1SkyboxUI,node,imports:()=>imports};
}
test('file selection previews source rows even when the input is reset; preview never writes data',async()=>{
 const {api,node,imports}=ui();const file={name:'customers.csv',size:100,text:async()=> 'Customer ID,Display Name,Email,First Name,Last Name,Company\n123,<script>alert(1)</script>,person@example.invalid,First,Last,Company'};
 const input=node('skyboxFile');input.files=[file];
 Object.defineProperty(input,'value',{set(){this.files=[];},get(){return '';}});
 await api.read({target:input});assert.equal(node('skyboxCommit').disabled,false);assert.match(node('skyboxMessage').textContent,/Nothing has been saved/);assert.equal(imports(),0);
 await api.commit();assert.equal(imports(),0,'declining confirmation must not import');assert.ok(node('skyboxPreview').children.length>0);
});
test('invalid export headings block import and display a useful error',async()=>{
 const {api,node,imports}=ui();await api.read({target:{files:[{name:'bad.csv',size:10,text:async()=> 'Wrong,Headings\n1,2'}]}});
 assert.equal(node('skyboxCommit').disabled,true);assert.match(node('skyboxMessage').textContent,/does not match/);assert.equal(imports(),0);
});
