const {test}=require('node:test'),assert=require('node:assert/strict'),{intent,matches,normalize,rankLinks,guidance}=require('../assistant-core.js');
test('guide recognizes customer lookup and keeps the actual name',()=>{
 assert.deepEqual(intent('Look up a customer named Jane Smith'),{type:'contact',kind:'customer',query:'Jane Smith'});
 assert.deepEqual(intent('find vendor Acme LLC'),{type:'contact',kind:'vendor',query:'Acme LLC'});
});
test('invoice creation is routed to a draft with an explicit contact choice',()=>{
 assert.deepEqual(intent('create an invoice for Jane Smith'),{type:'draft',purchase:false,query:'Jane Smith'});
 assert.deepEqual(intent('start a purchase order with Acme'),{type:'draft',purchase:true,query:'Acme'});
 assert.equal(intent('create invoice').query,'');
});
test('search intents distinguish records, links and navigation',()=>{
 for(const [query,type] of [['find invoice 4100','invoice'],['find trip Florida','trip'],['find letter Jane','letter'],['find link Skybox','link']])assert.equal(intent(query).type,type);
 assert.deepEqual(intent('open Manage Accounts'),{type:'navigate',section:'manageAccounts'});
 assert.equal(intent('delete all invoices').type,'unknown');assert.equal(intent('cancel').type,'cancel');
});
test('contact matching handles accents, case, multiword names, phones and empty data',()=>{
 const rows=[{firstName:'José',lastName:'Smith',phone:'5551234'},{firstName:'Jane',lastName:'Smith'},{firstName:null}];
 assert.equal(matches(rows,'JOSE smith',['firstName','lastName']).length,1);
 assert.equal(matches(rows,'555',['phone']).length,1);assert.equal(matches(rows,'unmatched',['firstName']).length,0);
 assert.equal(normalize('  José  SMITH '),'jose smith');
});

test('global search ranks exact ticket accounts before other matching links',()=>{
 assert.deepEqual(intent('find Yankees'),{type:'global',query:'Yankees'});
 assert.equal(rankLinks([{label:'Yankees Suites',section:'luxury'},{label:'Yankees',section:'accounts'}],'Yankees')[0].section,'accounts');
});

test('instruction questions route to specific guides before search or draft actions',()=>{
 for(const [text,topic] of [['how do I move buttons?','move'],['how do I add a button?','add'],['what is in each section?','sections'],['describe suites','section:luxury'],['how do I create an invoice?','invoices']])assert.deepEqual(intent(text),{type:'guide',topic});
 assert.equal(intent('find customer Whatley').type,'contact');
 assert.match(guidance('move',{admin:false}),/only your own layout/);assert.match(guidance('move',{admin:true}),/shared layout/);
 assert.doesNotMatch(guidance('sections',{canAccess:id=>['main','customers'].includes(id)}),/Administrator|Vendors/);
});
test('voice search offers Sonia and Sonya without merging identities or widening typed searches',()=>{
 const rows=[{id:1,name:'Sonia Green'},{id:2,name:'Sonya Green'},{id:3,name:'Sonya Brown'}];
 assert.deepEqual(matches(rows,'Sonia Green',['name'],{voice:true}).map(r=>r.id),[1,2]);
 assert.deepEqual(matches(rows,'Sonia Green',['name']).map(r=>r.id),[1]);
});

test('voice phonetics generalizes across names while preserving typed exact matches',()=>{
 for(const [first,second] of [['Sonia','Sonya'],['John','Jon'],['Sara','Sarah'],['Steven','Stephen'],['Brian','Bryan'],['Catherine','Katherine'],['Sean','Shawn']]){
  const rows=[{id:1,firstName:first},{id:2,firstName:second}];assert.equal(matches(rows,first,['firstName'],{voice:true}).length,2,first+' / '+second);
 }
 const rows=[{firstName:'John',notes:'Sonia'}];assert.equal(matches(rows,'Sonya',['firstName','notes'],{voice:true}).length,0);
});
