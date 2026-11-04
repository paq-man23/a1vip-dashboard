const {test}=require('node:test'),assert=require('node:assert/strict'),zip=require('fflate'),{DOMParser}=require('@xmldom/xmldom');
const core=require('../vault-import.js');
function workbook(sheet,{rels='',strings='',styles=''}={}){
 const files={'xl/workbook.xml':'<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Fixture" sheetId="1" r:id="rId1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>','xl/worksheets/sheet1.xml':sheet};
 if(rels)files['xl/worksheets/_rels/sheet1.xml.rels']=rels;if(strings)files['xl/sharedStrings.xml']=strings;if(styles)files['xl/styles.xml']=styles;
 return zip.zipSync(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,zip.strToU8(v)])));
}
const c=(ref,value)=>`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${value}</t></is></c>`;
test('recognizes account/password/unlabelled-site layout and preserves exact password whitespace',()=>{
 const bytes=workbook('<worksheet><sheetData><row r="1">'+c('A1','ACCOUNT')+c('B1','ACCOUNT #/PASSWORD')+'</row><row r="2">'+c('A2','fixture@example.invalid')+c('B2','  synthetic password  ')+c('C2','Fixture tickets')+'</row></sheetData></worksheet>');
 const sheet=core.readXlsx(bytes,zip,DOMParser)[0],d=core.detect(sheet),rows=core.preview(sheet,d.mapping,d.headers);
 assert.deepEqual(d.mapping,{label:2,username:0,password:1,url:-1,notes:-1});assert.equal(rows.length,1);assert.equal(rows[0].password,'  synthetic password  ');assert.equal(rows[0].url,'');assert.deepEqual(rows[0].issues,[]);
});
test('ignores mailto and credential-bearing hyperlinks and does not evaluate formulas',()=>{
 const bytes=workbook('<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData><row r="1">'+c('A1','Site')+c('B1','Username')+c('C1','Password')+'</row><row r="2">'+c('A2','Fixture')+c('B2','fixture@example.invalid')+'<c r="C2"><f>HYPERLINK("https://evil.invalid","secret")</f><v>cached</v></c></row></sheetData><hyperlinks><hyperlink ref="B2" r:id="mail"/><hyperlink ref="A2" r:id="credential"/></hyperlinks></worksheet>',{rels:'<Relationships><Relationship Id="mail" Type="x/hyperlink" Target="mailto:fixture@example.invalid"/><Relationship Id="credential" Type="x/hyperlink" Target="https://user:password@example.invalid"/></Relationships>'});
 const sheet=core.readXlsx(bytes,zip,DOMParser)[0],d=core.detect(sheet),rows=core.preview(sheet,d.mapping,d.headers);assert.equal(rows[0].url,'');assert.ok(rows[0].issues.some(x=>/Formula/.test(x)));
});
test('flags all duplicate site/account rows even when their passwords differ',()=>{
 const sheet={columns:3,rows:[{number:1,cells:['Site','Username','Password'].map(value=>({value}))},{number:7,cells:['Fixture','FixtureUser','synthetic-one'].map(value=>({value}))},{number:21,cells:[' fixture ','FixtureUser','synthetic-two'].map(value=>({value}))}]};
 const rows=core.preview(sheet,{label:0,username:1,password:2,url:-1,notes:-1},true);assert.deepEqual(rows.map(r=>r.duplicate),[true,true]);assert.deepEqual(rows.map(r=>r.row),[7,21]);
});
test('column three differentiates sites/accounts that share the same email or password',()=>{
 const cell=value=>({value});const sheet={columns:3,rows:[{number:1,cells:['ACCOUNT','ACCOUNT #/PASSWORD',''].map(cell)},{number:2,cells:['shared@example.invalid','synthetic','Site account A'].map(cell)},{number:3,cells:['shared@example.invalid','synthetic','Site account B'].map(cell)},{number:4,cells:['another@example.invalid','synthetic','Site account A'].map(cell)}]};
 const d=core.detect(sheet),rows=core.preview(sheet,d.mapping,d.headers);assert.deepEqual(rows.map(r=>r.label),['Site account A','Site account B','Site account A']);assert.ok(rows.every(r=>!r.duplicate));assert.equal(new Set(rows.map(core.identity)).size,3);
});
test('usernames that differ in case remain distinct logins',()=>{
 assert.notEqual(core.identity({label:'Fixture site',username:'MemberA'}),core.identity({label:'Fixture site',username:'membera'}));
});
test('honors zero-padding for numeric passwords without guessing date or currency formatting',()=>{
 const bytes=workbook('<worksheet><sheetData><row r="1">'+c('A1','Site')+c('B1','Username')+c('C1','Password')+'</row><row r="2">'+c('A2','Fixture')+c('B2','fixture')+'<c r="C2" s="1"><v>123</v></c></row></sheetData></worksheet>',{styles:'<styleSheet><numFmts><numFmt numFmtId="164" formatCode="000000"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>'});
 const sheet=core.readXlsx(bytes,zip,DOMParser)[0],rows=core.preview(sheet,{label:0,username:1,password:2,url:-1,notes:-1},true);assert.equal(rows[0].password,'000123');assert.deepEqual(rows[0].issues,[]);
});
test('requires distinct mapped columns, bounds ZIP expansion, and rejects unsafe XML',()=>{
 assert.throws(()=>core.preview({rows:[]},{label:0,username:0,password:1,url:-1,notes:-1}),/different column/);
 assert.throws(()=>core.readXlsx(new Uint8Array(),{unzipSync:(b,{filter})=>filter({name:'xl/workbook.xml',originalSize:21_000_000})},DOMParser),/size limit/);
 assert.throws(()=>core.readXlsx(workbook('<!DOCTYPE worksheet [<!ENTITY x "unsafe">]><worksheet/>'),zip,DOMParser),/Unsupported workbook XML/);
});
test('treats empty passwords, invalid URLs, and missing labels as incomplete without trimming the secret',()=>{
 assert.deepEqual(core.validate({label:'',username:'fixture',password:'',url:'javascript:alert(1)',notes:''}),['Site name is missing','Password is missing','Use an HTTPS URL without embedded credentials']);
 assert.deepEqual(core.validate({label:'Fixture',username:'fixture',password:' ',url:'',notes:''}),[]);
});
