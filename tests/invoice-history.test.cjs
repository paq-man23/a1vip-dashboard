const {test}=require('node:test'),assert=require('node:assert/strict'),H=require('../a1-history.js');
test('Skybox invoice and purchase IDs do not advance new A1 document numbering',()=>{
 const legacy=[{id:'inv-skybox-invoice-152847721',number:'152847721'},{id:'inv-skybox-purchase-395477290',number:'SB-PO-395477290'}];
 assert.equal(H.nextNumber(legacy),4100);assert.equal(H.nextNumber([...legacy,{id:'inv-a1',number:'4107'}]),4108);assert.equal(H.nextNumber([{id:'inv-custom',number:'2026-100'}]),4100);
});
test('history filters by year and sorts newest or oldest without mutating originals',()=>{
 const items=[{id:'a',number:'4100',createdDate:'2025-12-31',clientCompany:'Example'},{id:'b',number:'4101',createdDate:'2026-01-01'},{id:'c',number:'4102',createdDate:'2026-03-01'},{id:'d',number:'4103',createdDate:''}];
 assert.deepEqual(H.years(items),['2026','2025','Unknown']);assert.deepEqual(H.filter(items,'','2026').map(i=>i.id),['c','b']);assert.deepEqual(H.filter(items,'','2026','oldest').map(i=>i.id),['b','c']);assert.deepEqual(H.filter(items,'Example').map(i=>i.id),['a']);assert.deepEqual(H.filter(items).map(i=>i.id),['c','b','a','d']);assert.equal(items[0].id,'a');
});

test('origin filtering combines with year and search, including resolved Skybox copies',()=>{
 const items=[{id:'inv-skybox-invoice-1',number:'1',createdDate:'2026-01-01',clientCompany:'Example'},{id:'inv-resolved-copy',origin:'skybox',number:'2',createdDate:'2025-01-01'},{id:'inv-a1-copy',origin:'a1',skybox:{'Invoice ID':'1'},number:'4100',createdDate:'2026-01-02'}];
 assert.equal(H.filter(items,'','','newest','skybox').length,2);assert.deepEqual(H.filter(items,'Example','2026','newest','skybox').map(i=>i.id),['inv-skybox-invoice-1']);assert.deepEqual(H.filter(items,'','','newest','a1').map(i=>i.id),['inv-a1-copy']);
});

test('shared history switches between invoices and purchase orders while retaining year, source and search filters',()=>{
 const items=[{id:'invoice',type:'invoice-ticket',number:'4100',createdDate:'2026-01-01',clientCompany:'Example'},{id:'purchase',type:'po-ticket',origin:'skybox',number:'SB-PO-1',createdDate:'2026-02-01',clientCompany:'Example'},{id:'travel',type:'po-travel',number:'4101',createdDate:'2025-01-01',clientCompany:'Other'}];
 assert.equal(H.filter(items).length,3);assert.deepEqual(H.filter(items,'','','newest','','invoice').map(i=>i.id),['invoice']);assert.deepEqual(H.filter(items,'','','newest','','purchase').map(i=>i.id),['purchase','travel']);assert.deepEqual(H.filter(items,'Example','2026','newest','skybox','purchase').map(i=>i.id),['purchase']);assert.equal(H.filter(items,'Example','2026','newest','a1','purchase').length,0);
});
