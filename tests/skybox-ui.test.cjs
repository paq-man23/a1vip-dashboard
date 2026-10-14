const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const S=require('../skybox-import');
function ui(contacts=[]){
 const nodes=new Map();class Node{constructor(){this.dataset={};this.value='';this.children=[];this.disabled=false;this.style={};this.files=[];this.listeners={};}setAttribute(key,value){this[key]=value;}insertBefore(child,before){this.children.splice(this.children.indexOf(before),0,child);child.parentNode=this;}append(...values){this.children.push(...values);for(const value of values)if(value&&typeof value==='object')value.parentNode=this;}replaceChildren(...values){this.children=values;}addEventListener(event,handler){this.listeners[event]=handler;}click(){}}
 const node=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);};let imports=0;
 const window={addEventListener(){}};
 vm.runInNewContext(fs.readFileSync('skybox-ui.js','utf8'),{window,document:{getElementById:node,createElement:()=>new Node(),querySelector:node,querySelectorAll:()=>Array.from(nodes.values()).filter(n=>n.isPicker)},A1Skybox:S,A1Data:{contacts:()=>contacts,importSkybox:async()=>{imports++;return {imported:1,skipped:0,conflicts:0,changed:0,errors:[]};}},refreshInvoicePreview(){},refreshLetterPreview(){},refreshItineraryPreview(){},money:value=>'$'+value,confirm:()=>false});
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

const savedContact={kind:'vendor',id:'123',displayName:'Example Vendor',name:'Contact Name',company:'Example Company',email:'contact@example.invalid',phone:'111',phone2:'222',address:'Street\nCity'};
test('letter picker fills recipient and email without touching the letter body',()=>{
 const {api,node}=ui([savedContact]);node('letterContactPicker').value='vendor:123';node('letterBody').value='Existing letter';api.choose('letter');
 assert.equal(node('letterTo').value,'Contact Name');assert.equal(node('letterToEmail').value,'contact@example.invalid');assert.equal(node('letterBody').value,'Existing letter');
});
test('trip pickers add multiple contacts without duplicating or erasing existing details',()=>{
 const {api,node}=ui([savedContact]);node('itinOtherContactInfo').value='Existing travel notes';
 for(let i=0;i<2;i++){node('itineraryContactPicker').value='vendor:123';api.choose('itinerary');}
 assert.equal(node('itinEventContacts').value,'Contact Name (Example Company)');assert.match(node('itinContactPhones').value,/111 \/ 222/);assert.match(node('itinOtherContactInfo').value,/Existing travel notes/);assert.match(node('itinOtherContactInfo').value,/contact@example.invalid/);
 node('itineraryTalentPicker').value='vendor:123';api.choose('talent');assert.equal(node('itinTalent').value,'Contact Name');
});
test('booking vendor selection preserves reservations and appends contact details once',()=>{
 const {api,node}=ui([savedContact]);const picker={value:'vendor:123'};
 const notes=node('[data-car-line="0"][data-field="notes"]');notes.value='Existing pickup notes';api.chooseBooking(picker,'car',0);api.chooseBooking(picker,'car',0);
 assert.equal(node('[data-car-line="0"][data-field="company"]').value,'Example Company');assert.equal(notes.value.split('\n').length,2);assert.match(notes.value,/Existing pickup notes/);assert.match(notes.value,/contact@example.invalid/);
});
test('all pickers use shared contacts and booking pickers restrict choices to vendors',()=>{
 const {api,node}=ui([savedContact,{...savedContact,kind:'customer',id:'456'}]);
 const all=node('all');all.isPicker=true;const vendors=node('vendors');vendors.isPicker=true;vendors.dataset.contactKind='vendor';api.populatePickers();
 assert.equal(all.children.length,3);assert.equal(vendors.children.length,2);assert.equal(vendors.children[1].label,'Vendors');
});
test('invoice vendor selection fills vendor fields without replacing the customer',()=>{
 const {api,node}=ui([savedContact]);node('invoiceVendorPicker').value='vendor:123';node('invClientCompany').value='Invoice customer';api.choose('vendor');assert.equal(node('invVendor').value,'Example Vendor');assert.equal(node('invVendorId').value,'123');assert.equal(node('invClientCompany').value,'Invoice customer');
});

test('pickers group by contact role and type, sort names, and search without changing the selected identity',()=>{
 const contacts=[
 {kind:'customer',id:'3',displayName:'zeta',type:'Retail'},
 {kind:'vendor',id:'8',displayName:'Vendor',type:'Marketplace'},
 {kind:'customer',id:'2',displayName:'Alpha',type:'Retail',email:'alpha@example.invalid'},
 {kind:'customer',id:'1',displayName:'Alpha',type:'retail',email:'other@example.invalid'},
 {kind:'customer',id:'4',displayName:'Business',type:'Corporate'}];
 const {api,node}=ui(contacts);const picker=node('all');picker.isPicker=true;node('parent').append(picker);
 api.populatePickers();assert.deepEqual(picker.children.slice(1).map(g=>g.label),['Customers — Corporate','Customers — retail','Vendors — Marketplace']);
 assert.deepEqual(picker.children[2].children.map(o=>o.value),['customer:1','customer:2','customer:3']);
 const search=picker._contactSearch;assert.equal(search.type,'search');assert.match(search['aria-label'],/Search saved/);
 picker.value='customer:3';search.value='alpha@example';search.listeners.input();
 assert.equal(picker.value,'customer:3');assert.deepEqual(picker.children[1].children.map(o=>o.value),['customer:2','customer:3']);
 assert.equal(node('invClientCompany').value,'','searching must not fill invoice fields');
 api.populatePickers();assert.equal(node('parent').children.length,2,'refresh must not duplicate search inputs');assert.equal(search.value,'alpha@example');
 picker.value='';search.value='no such contact';search.listeners.input();assert.equal(picker.children[1].textContent,'No matching contacts');assert.equal(picker.children[1].disabled,true);
 search.value='marketplace';search.listeners.input();assert.equal(picker.children[1].label,'Vendors — Marketplace');
});
test('vendor-only searches cannot expose customer matches and directories sort by name',()=>{
 const {api,node}=ui([{kind:'customer',id:'1',displayName:'Alpha',type:'Retail'},{kind:'vendor',id:'2',displayName:'zeta'},{kind:'vendor',id:'3',displayName:'Beta'}]);
 const picker=node('vendors');picker.isPicker=true;picker.dataset.contactKind='vendor';node('parent').append(picker);api.populatePickers();
 assert.deepEqual(picker.children[1].children.map(o=>o.value),['vendor:3','vendor:2']);picker._contactSearch.value='Alpha';picker._contactSearch.listeners.input();assert.equal(picker.children.length,2);assert.equal(picker.children[1].textContent,'No matching contacts');
 api.directory('vendor');const cards=node('vendorDirectory').children.filter(n=>n.className==='invoice-history-card');assert.match(cards[0].children[0].textContent,/Beta/);assert.match(cards[1].children[0].textContent,/zeta/);
});
