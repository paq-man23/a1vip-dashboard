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
