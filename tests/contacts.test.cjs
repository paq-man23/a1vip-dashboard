const {test}=require('node:test'),assert=require('node:assert/strict');const C=require('../a1-contacts');
test('Rolodex indexes exact last names with company/display fallback and accented initials',()=>{
 assert.equal(C.initial({lastName:'Éclair',displayName:'Amy'}),'E');assert.equal(C.initial({company:'Zenith',displayName:'Amy'}),'Z');assert.equal(C.initial({displayName:'123 Tickets'}),'#');
});
test('Rolodex filters by role, last-name letter and multiple search terms; ties retain distinct identities',()=>{
 const rows=[{kind:'customer',id:'2',displayName:'Alex',lastName:'Zulu',phone:'555',notes:'prefers text'},{kind:'customer',id:'1',displayName:'Alex',lastName:'Baker',phone:'555'},{kind:'vendor',id:'3',displayName:'Alex',lastName:'Baker'}];
 assert.deepEqual(C.filter(rows,'customer').map(c=>c.id),['1','2']);assert.deepEqual(C.filter(rows,'customer','555 text','Z').map(c=>c.id),['2']);assert.equal(C.filter(rows,'customer','Alex','B').length,2);
});
test('contact edits submit only changed fields including deliberate blanks',()=>{
 assert.deepEqual(C.patch({phone:'111',notes:'',company:'Example'},{phone:'',notes:' Call later ',company:'Example'}),{phone:'',notes:'Call later'});
});

test('name and company searches span all letters for customers and vendors',()=>{
 for(const kind of ['customer','vendor']){
  const rows=[{kind,id:'1',firstName:'Jason',lastName:'White',company:'A1VIP'},{kind,id:'2',firstName:'Amy',lastName:'Baker',company:'Zenith'},{kind:kind==='customer'?'vendor':'customer',id:'3',firstName:'Jason',lastName:'White',company:'A1VIP'}];
  for(const query of ['jas','WHITE','vip','Jason White','White A1VIP'])assert.deepEqual(C.filter(rows,kind,query,'B').map(c=>c.id),['1']);
  assert.deepEqual(C.filter(rows,kind,'','B').map(c=>c.id),['2']);
  assert.deepEqual(C.filter(rows,kind,'   ','B').map(c=>c.id),['2']);
  assert.deepEqual(C.filter(rows,kind,'missing','B'),[]);
 }
});
