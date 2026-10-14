const {test}=require('node:test'),assert=require('node:assert/strict'),H=require('../a1-history.js');
test('Skybox invoice and purchase IDs do not advance new A1 document numbering',()=>{
 const legacy=[{id:'inv-skybox-invoice-152847721',number:'152847721'},{id:'inv-skybox-purchase-395477290',number:'SB-PO-395477290'}];
 assert.equal(H.nextNumber(legacy),4100);assert.equal(H.nextNumber([...legacy,{id:'inv-a1',number:'4107'}]),4108);assert.equal(H.nextNumber([{id:'inv-custom',number:'2026-100'}]),4100);
});
test('history filters by year and sorts newest or oldest without mutating originals',()=>{
 const items=[{id:'a',number:'4100',createdDate:'2025-12-31',clientCompany:'Example'},{id:'b',number:'4101',createdDate:'2026-01-01'},{id:'c',number:'4102',createdDate:'2026-03-01'},{id:'d',number:'4103',createdDate:''}];
 assert.deepEqual(H.years(items),['2026','2025','Unknown']);assert.deepEqual(H.filter(items,'','2026').map(i=>i.id),['c','b']);assert.deepEqual(H.filter(items,'','2026','oldest').map(i=>i.id),['b','c']);assert.deepEqual(H.filter(items,'Example').map(i=>i.id),['a']);assert.deepEqual(H.filter(items).map(i=>i.id),['c','b','a','d']);assert.equal(items[0].id,'a');
});
