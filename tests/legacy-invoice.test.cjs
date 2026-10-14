const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const html = fs.readFileSync('index.html','utf8');
const script = html.slice(html.indexOf('    function normalizeSavedInvoice('),html.indexOf('    function loadInvoices(){'));
const context = {
  parseNum: value => Number(value) || 0,
  invoiceLineTypeDefault: type => type.includes('travel') ? 'Travel / Transportation' : 'Tickets',
  invoiceLineBase: () => ({qty:1,unitCost:0}),
};
vm.runInNewContext(script,context);
test('older travel invoice types, extra charges, and payments retain their original balance', () => {
  const original = {type:'travel',lines:[{qty:2,unitCost:250}],tax:20,shipping:10,other:15,amountPaid:100};
  const normalized = context.normalizeSavedInvoice(original);
  const balance = normalized.lines.reduce((sum,line)=>sum+line.qty*line.unitCost,0)+normalized.tax+normalized.shipping-normalized.credit;
  assert.equal(balance,445);
  assert.equal(normalized.type,'invoice-travel');
  assert.equal(normalized.lines[0].lineType,'Travel / Transportation');
  assert.equal(context.normalizeSavedInvoice(normalized).lines.length,2);
  assert.equal(original.lines.length,1);
  assert.equal(original.other,15);
});
test('current credits and line items remain unchanged', () => {
  const normalized = context.normalizeSavedInvoice({type:'po-ticket',credit:25,lines:[{qty:1,unitCost:100,lineType:'Tickets'}]});
  assert.equal(normalized.type,'po-ticket');
  assert.equal(normalized.credit,25);
  assert.equal(normalized.lines.length,1);
});
