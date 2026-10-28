const {test}=require('node:test'),assert=require('node:assert/strict'),F=require('../a1-invoice-fields'),fs=require('node:fs'),vm=require('node:vm');
test('Skybox fields populate without changing existing totals or explicit edits',()=>{
 const invoice={credit:100,shipping:10,vendor:'Edited vendor',skybox:{Vendor:'Original vendor','Payment Reference':'REF','Non-Inventory Cost':'25',COGS:'900','Inventory P&L':'300','Inventory Tags':'VIP','Internal Notes':'Private','Invoice Total':'1200','Outstanding Balance':'1100'}};
 const result=F.enrich(invoice);assert.equal(result.vendor,'Edited vendor');assert.equal(result.paymentReference,'REF');assert.equal(result.nonInventoryCosts,'25');assert.equal(result.cogs,'900');assert.equal(result.internalNotes,'Private');assert.equal(result.credit,100);assert.equal(invoice.paymentReference,undefined);
});
test('invoice total stays gross while outstanding balance includes the payment adjustment',()=>{
 const html=fs.readFileSync('index.html','utf8'),a=html.indexOf('    function invoiceLineAmount('),b=html.indexOf('    function invoiceLineDetailsHtml(',a),context={parseNum:v=>Number(v)||0};vm.runInNewContext(html.slice(a,b),context);
 const invoice={lines:[{qty:1,unitCost:1175}],shipping:25,tax:0,credit:1200};assert.equal(context.invoiceTotal(invoice),1200);assert.equal(context.invoiceBalance(invoice),0);
});
test('internal report fields are outside the customer PDF preview and email template',()=>{
 const html=fs.readFileSync('index.html','utf8');const preview=html.slice(html.indexOf('    function refreshInvoicePreview(){'),html.indexOf('    function refreshInvoiceDatalists(){'));
 const email=html.slice(html.indexOf('    function emailInvoice(){'),html.indexOf('    function emailLetter(){'));
 for(const key of ['inventoryPnl','internalNotes','cogs','paymentReference']){assert.equal(preview.includes('invoice.'+key),false);assert.equal(email.includes('invoice.'+key),false);}
 assert.ok(html.indexOf('id="invoiceInternalFields"')<html.indexOf('id="invoicePreview"'));assert.match(email,/invoice.autoNumber/);
});
test('PO conversion creates a separate invoice with 30% markup and preserves the source',()=>{
 const po={id:'po-source',number:'3100',type:'po-ticket',origin:'skybox',clientCompany:'Supplier',contactKind:'vendor',contactId:'vendor-1',credit:250,status:'Paid',tax:12,shipping:15,notes:'Supplier-only notes',paymentReference:'paid-ref',skybox:{private:'report'},lines:[{qty:2,unitCost:100,section:'A',row:'2',seats:'3-4',eventName:'Example'},{qty:1,unitCost:19.99}]};
 const before=JSON.stringify(po),result=F.invoiceFromPurchaseOrder(po,{id:'inv-new',clientCompany:'',clientEmail:'',notes:'',createdDate:'2026-10-28'});
 assert.equal(result.id,'inv-new');assert.equal(result.type,'invoice-ticket');assert.equal(result.lines[0].unitCost,130);assert.equal(result.lines[1].unitCost,25.99);assert.equal(result.lines[0].qty,2);assert.equal(result.lines[0].seats,'3-4');
 assert.equal(result.autoNumber,true);assert.equal(result.number,'');assert.equal(result.origin,'a1');assert.equal(result.credit,0);assert.equal(result.status,'Unpaid');assert.equal(result.clientCompany,'');assert.equal(result.contactId,undefined);assert.equal(result.notes,'');assert.equal(result.skybox,undefined);assert.equal(result.paymentReference,undefined);assert.equal(result.tax,12);assert.equal(result.shipping,15);assert.equal(result.vendorId,'vendor-1');assert.equal(result.cogs,'219.99');assert.equal(result.sourcePurchaseOrder.number,'3100');assert.equal(JSON.stringify(po),before);
 result.lines[0].section='B';assert.equal(po.lines[0].section,'A');
});
test('travel POs retain hotel and transportation details; invoices cannot be marked up twice through conversion',()=>{
 const po={type:'po-travel',lines:[{lineType:'Hotel',lineDate:'2026-11-01',checkOutDate:'2026-11-04',qty:3,unitCost:200}]};
 const invoice=F.invoiceFromPurchaseOrder(po,{id:'new'});assert.equal(invoice.type,'invoice-travel');assert.equal(invoice.lines[0].unitCost,260);assert.equal(invoice.lines[0].checkOutDate,'2026-11-04');assert.throws(()=>F.invoiceFromPurchaseOrder(invoice,{}),/purchase order/);
 assert.throws(()=>F.invoiceFromPurchaseOrder({type:'po-ticket',lines:[{unitCost:'bad'}]},{}),/invalid amount/);
});
test('conversion action opens an unsaved invoice using the invoice series without writing the PO',()=>{
 const html=fs.readFileSync('index.html','utf8'),a=html.indexOf('    function createInvoiceFromPurchaseOrder(){'),b=html.indexOf('    function copyBillingToShipping(){',a);
 let draft,confirmed=0;const source={id:'inv-po-source',number:'3100',type:'po-ticket',lines:[{qty:2,unitCost:100}]};
 const context={document:{getElementById:()=>({value:'30'})},invoiceSaveInFlight:false,A1Data:{authenticated:()=>true,canAccess:()=>true,version:()=>1},collectInvoiceFromForm:()=>source,isPurchaseOrderType:t=>t.startsWith('po-'),confirm:()=>{confirmed++;return true;},A1InvoiceFields:F,invoiceBase:type=>({id:'inv-new',type,clientCompany:''}),setInvoiceToForm:value=>draft=value,openInvoiceMode:()=>{},setInvoiceHistoryKind:kind=>assert.equal(kind,'invoice'),showSection:()=>{},alert:message=>assert.fail(message)};
 vm.runInNewContext(html.slice(a,b),context);context.createInvoiceFromPurchaseOrder();assert.equal(confirmed,1);assert.equal(draft.type,'invoice-ticket');assert.equal(draft.autoNumber,true);assert.equal(draft.lines[0].unitCost,130);assert.equal(source.lines[0].unitCost,100);
 draft=null;context.confirm=()=>false;context.createInvoiceFromPurchaseOrder();assert.equal(draft,null);
 let notice='';context.A1Data.version=()=>null;context.alert=m=>notice=m;context.createInvoiceFromPurchaseOrder();assert.match(notice,/Save the purchase order first/);assert.equal(draft,null);
});
test('hotel totals multiply rooms by nights and nightly cost, including custom markup',()=>{
 const html=fs.readFileSync('index.html','utf8'),a=html.indexOf('    function invoiceLineAmount('),b=html.indexOf('    function invoiceLineDetailsHtml(',a),context={parseNum:v=>Number(v)||0};vm.runInNewContext(html.slice(a,b),context);
 const hotel={lineType:'Hotel',rooms:3,qty:2,unitCost:200,checkOutDate:'2026-11-04'};
 assert.equal(context.invoiceLineAmount(hotel),1200);assert.equal(context.invoiceLineAmount({...hotel,rooms:undefined}),400);
 assert.equal(context.invoiceLineAmount({lineType:'Tickets',rooms:3,qty:2,unitCost:200}),400);
 const result=F.invoiceFromPurchaseOrder({type:'po-travel',number:'3100',lines:[hotel]},{id:'new'},50);
 assert.equal(result.lines[0].rooms,3);assert.equal(result.lines[0].qty,2);assert.equal(result.lines[0].unitCost,300);assert.equal(context.invoiceSubtotal(result),1800);assert.equal(result.cogs,'1200');assert.equal(result.sourcePurchaseOrder.markupPercent,50);assert.match(result.internalNotes,/50%/);
 assert.equal(F.invoiceFromPurchaseOrder({type:'po-travel',lines:[hotel]},{},0).lines[0].unitCost,200);
 for(const invalid of ['',-1,'bad',Infinity])assert.throws(()=>F.invoiceFromPurchaseOrder({type:'po-ticket'}, {},invalid),/valid markup/);
});
test('optional invoice markup updates only line prices, preserving invoice identity and payments',()=>{
 const source={id:'inv-sale',number:'4145',type:'invoice-travel',autoNumber:false,credit:100,tax:15,shipping:20,clientCompany:'Customer',lines:[{lineType:'Hotel',rooms:3,qty:2,unitCost:100},{lineType:'Tickets',qty:2,unitCost:19.99}]};
 const before=JSON.stringify(source),marked=F.markupInvoice(source,10);
 assert.equal(marked.lines[0].unitCost,110);assert.equal(marked.lines[1].unitCost,21.99);assert.equal(marked.lines[0].rooms,3);assert.equal(marked.lines[0].qty,2);
 for(const key of ['id','number','autoNumber','credit','tax','shipping','clientCompany'])assert.equal(marked[key],source[key]);
 assert.equal(marked.markupAdjustments[0].percent,10);assert.equal(JSON.stringify(source),before);
 assert.equal(F.markupInvoice(source,45).lines[0].unitCost,145);
 for(const rate of [0,'',-1,'bad',Infinity])assert.throws(()=>F.markupInvoice(source,rate));
 assert.throws(()=>F.markupInvoice({...source,type:'po-ticket'},10),/purchase orders/);
});
test('invoice markup opens switched off and cannot apply to another editor document',()=>{
 const html=fs.readFileSync('index.html','utf8'),a=html.indexOf('    let invoiceMarkupTarget=null;'),b=html.indexOf('    function createInvoiceFromPurchaseOrder(){',a);
 const nodes={invoiceMarkupChoice:{value:'50'},invoiceMarkupCustom:{value:'40'},invoiceMarkupCustomLabel:{hidden:false},invoiceMarkupPreview:{},invoiceMarkupApply:{},invType:{value:'invoice-ticket'},invoiceMarkupDialog:{showModal(){this.open=true;}}};
 let changed=false;const context={document:{getElementById:id=>nodes[id]},currentInvoiceId:'inv-one',invoiceSaveInFlight:false,A1Data:{authenticated:()=>true,canAccess:()=>true},isPurchaseOrderType:t=>t.startsWith('po-'),A1InvoiceFields:F,collectInvoiceFromForm:()=>({type:'invoice-ticket',lines:[{qty:1,unitCost:100}]}),money:n=>'$'+n,invoiceSubtotal:i=>i.lines.reduce((s,l)=>s+l.qty*l.unitCost,0),setInvoiceToForm:()=>changed=true};
 vm.runInNewContext(html.slice(a,b),context);context.openInvoiceMarkup();assert.equal(nodes.invoiceMarkupChoice.value,'0');assert.equal(nodes.invoiceMarkupApply.disabled,true);assert.equal(changed,false);
 nodes.invoiceMarkupChoice.value='20';context.previewInvoiceMarkup();assert.equal(nodes.invoiceMarkupApply.disabled,false);assert.match(nodes.invoiceMarkupPreview.textContent,/120/);assert.equal(changed,false);
 context.currentInvoiceId='inv-two';context.applyInvoiceMarkup();assert.equal(changed,false);
 context.currentInvoiceId='inv-one';context.applyInvoiceMarkup();assert.equal(changed,true);
});
