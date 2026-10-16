const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const R=require('../a1-reports'),H=require('../a1-history');
const options={total:i=>i.total,credit:i=>i.credit||0};
const items=[{id:'a',type:'invoice-ticket',createdDate:'2026-01-01',total:100.10,credit:20.05,clientCompany:'=danger',clientContact:'White, Jason'}, {id:'b',type:'po-ticket',createdDate:'2026-01-31',total:30.20,credit:40}, {id:'c',type:'invoice-travel',createdDate:'2026-02-01',total:0.20}, {id:'d',type:'invoice-ticket',createdDate:'2026-02-03',total:900,status:'Void'}, {id:'e',type:'invoice-ticket',createdDate:'2025-12-31',total:5}, {id:'f',type:'po-travel',createdDate:'',total:7}];
test('year report separates invoices and purchases with exact cent totals and excludes voids',()=>{
 const r=R.report(H.filter(items,'','2026'),{...options,year:'2026'});
 assert.equal(r.months.length,12);assert.equal(r.excludedVoid,1);
 assert.deepEqual(r.totals.invoice,{count:2,total:10030,credit:2005,balance:8025});
 assert.deepEqual(r.totals.purchase,{count:1,total:3020,credit:4000,balance:-980});
 assert.equal(r.months[1].invoice.total,20);assert.equal(r.months[11].invoice.count,0);
});
test('month restriction, include void and unknown dates are explicit',()=>{
 const r=R.report(items,{...options,month:'02',includeVoid:true});assert.equal(r.rows.length,2);assert.equal(r.totals.invoice.total,90020);
 const all=R.report(items,options);assert.equal(all.months.at(-1).period,'Unknown');assert.equal(all.totals.purchase.count,2);
 assert.equal(R.period({createdDate:'2026-02-30'}),'Unknown');
 assert.equal(R.report([], {...options,year:'2026'}).totals.invoice.count,0);
 assert.throws(()=>R.report([{total:Infinity}],options),/invalid amount/);
});
test('CSV preserves quotes and numeric negatives while neutralizing spreadsheet formulas',()=>{
 const csv=R.csv(R.report(items,options));assert.match(csv,/'=danger/);assert.match(csv,/"White, Jason"/);assert.match(csv,/"-9.8"/);assert.equal(csv.split('\r\n').length,6);
});
test('history report renders full filtered data before pagination and exports current filters',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.ok(html.indexOf('renderInvoiceAudit(filtered,selectedYear)')<html.indexOf('filtered.slice(invoiceHistoryPage*50'));
 const start=html.indexOf('    let currentInvoiceAudit=null;'),end=html.indexOf('    function renderInvoicePresets(){',start);
 const nodes={auditReportSummary:{},auditReportMonth:{value:''},auditReportVoid:{checked:false}};
 const context={A1Reports:R,invoiceTotal:options.total,invoiceCredit:options.credit,money:n=>'$'+n.toFixed(2),escHtml:s=>s,document:{getElementById:id=>nodes[id]}};
 vm.runInNewContext(html.slice(start,end),context);context.renderInvoiceAudit(items,'2026');assert.match(nodes.auditReportSummary.innerHTML,/Period total/);assert.match(nodes.auditReportSummary.innerHTML,/Purchase orders/);
 context.renderInvoiceAudit([],'2026');assert.match(nodes.auditReportSummary.innerHTML,/0 documents in report/);
});
