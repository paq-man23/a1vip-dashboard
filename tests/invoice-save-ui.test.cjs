const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function ui(save){
 const html=fs.readFileSync('index.html','utf8');const script=html.slice(html.indexOf('    async function saveInvoice(){'),html.indexOf('    function exportInvoiceFile(){'));
 const fields=new Map(),alerts=[];const context={invoiceSaveInFlight:false,currentInvoiceId:'inv-draft',currentInvoiceVersion:null,currentInvoiceAutoNumber:true,currentInvoiceSnapshot:{},currentImportConflictHash:null,
 collectInvoiceFromForm:()=>({id:'inv-draft',autoNumber:true,number:'',lines:[]}),loadInvoices:()=>[],loadInvoicePresets:()=>({clientCompanies:[],clientContacts:[],clientEmails:[],clientPhones:[],terms:[],paymentTypes:[],deliveryMethods:[],eventNames:[],venues:[]}),addUnique(){},A1Data:{save,version:()=>1},setFieldValue:(id,value)=>fields.set(id,value),document:{getElementById:()=>({})},refreshCloudViews(){},refreshInvoicePreview(){},alert:text=>alerts.push(text)};
 vm.runInNewContext(script,context);return {context,fields,alerts};
}
test('the saved DB number replaces the draft placeholder and is retained for subsequent edits',async()=>{
 const {context,fields}=ui(async()=>({id:'inv-draft',number:'4100',autoNumber:false,numberAssignedByDB:true,origin:'a1'}));await context.saveInvoice();assert.equal(fields.get('invNumber'),'4100');assert.equal(context.currentInvoiceAutoNumber,false);assert.equal(context.currentInvoiceVersion,1);assert.equal(context.invoiceSaveInFlight,false);
});
test('a delayed save cannot assign its number to a different newly opened draft',async()=>{
 let finish;const pending=new Promise(resolve=>finish=resolve);const {context,fields}=ui(()=>pending);const action=context.saveInvoice();context.currentInvoiceId='inv-next-draft';finish({id:'inv-draft',number:'4100'});await action;assert.equal(fields.has('invNumber'),false);assert.equal(context.currentInvoiceId,'inv-next-draft');assert.equal(context.invoiceSaveInFlight,false);
});
test('failed saves leave the draft without a permanent number',async()=>{
 const {context,fields,alerts}=ui(async()=>{throw new Error('Connection failed');});await context.saveInvoice();assert.equal(fields.has('invNumber'),false);assert.equal(context.currentInvoiceAutoNumber,true);assert.match(alerts[0],/was not saved/);assert.equal(context.invoiceSaveInFlight,false);
});
