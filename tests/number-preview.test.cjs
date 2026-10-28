const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
function harness(){
 const nodes={invNumber:{value:'',placeholder:''},invNumberHint:{hidden:true},invType:{value:'invoice-ticket'}};
 const requests=[];const context={document:{getElementById:id=>nodes[id]},currentInvoiceAutoNumber:true,currentInvoiceId:'draft-one',A1Data:{previewDocumentNumber:type=>new Promise((resolve,reject)=>requests.push({type,resolve,reject}))}};
 vm.createContext(context);vm.runInContext(html.slice(html.indexOf('    let invoiceNumberPreviewRequest=0;'),html.indexOf('    function setInvoiceToForm(invoice){')),context);
 return {nodes,requests,context,refresh:()=>context.refreshInvoiceNumberPreview()};
}
test('next number displays without converting the draft to a saved number',async()=>{
 const h=harness(),p=h.refresh();h.requests[0].resolve('4145');await p;
 assert.equal(h.nodes.invNumber.value,'4145');assert.equal(h.nodes.invNumberHint.hidden,false);assert.equal(h.context.currentInvoiceAutoNumber,true);
 assert.match(html,/number: currentInvoiceAutoNumber\?'':/);
 assert.match(html,/if\(!currentInvoiceAutoNumber\)setFieldValue\('invNumber', invoice.number\)/);
});
test('switching series rejects a late invoice preview',async()=>{
 const h=harness(),a=h.refresh();h.nodes.invType.value='po-ticket';const b=h.refresh();
 h.requests[1].resolve('3100');await b;h.requests[0].resolve('4145');await a;
 assert.equal(h.nodes.invNumber.value,'3100');assert.equal(h.requests[1].type,'po-ticket');
});
test('saving or opening another document rejects an outstanding preview',async()=>{
 const h=harness(),a=h.refresh();h.context.currentInvoiceAutoNumber=false;h.nodes.invNumber.value='4146';await h.refresh();h.requests[0].resolve('4145');await a;
 assert.equal(h.nodes.invNumber.value,'4146');assert.equal(h.nodes.invNumberHint.hidden,true);
});
test('preview failure leaves saving available',async()=>{
 const h=harness(),a=h.refresh();h.requests[0].reject(new Error('offline'));await a;
 assert.equal(h.nodes.invNumber.placeholder,'Assigned when saved');assert.equal(h.context.currentInvoiceAutoNumber,true);
});
