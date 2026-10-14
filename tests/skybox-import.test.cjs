const {test}=require('node:test');const assert=require('node:assert/strict');const S=require('../skybox-import.js');const {DOMParser}=require('@xmldom/xmldom');const zip=require('fflate');
const customer={'Customer ID':'123','Display Name':'A Company','Email':'first@example.invalid','First Name':'First','Last Name':'Last','Company':'A Company'};
const invoice={'Invoice ID':'456','Invoice Date':'03/10/2026 10:46 PM','Customer':'A Company','Invoice Total':'2250','Outstanding Balance':'1000','Shipping':'25','Payment Status':'Partial','Performer':'Concert','Event Date':'03/13/2026 08:00 PM'};
const purchase={'Purchase ID':'789','Purchase Date':'09/10/2026 01:31 PM','Vendor':'Vendor','Ticket Qty':'3','Ticket Cost':'100','Non-Inventory Cost':'15','Purchase Total':'115','Outstanding Balance':'0','Payment Status':'Paid','Section':'A','Row':'17'};
test('summary invoice preserves total and balance, and links only one unique customer',()=>{
 const c=S.contact('customer',customer);const p=S.document('invoice',invoice,[c]);
 assert.equal(p.invoice.lines[0].qty,1);assert.equal(p.invoice.lines[0].unitCost,2225);assert.equal(p.invoice.credit,1250);assert.equal(p.balance,1000);assert.equal(p.invoice.clientEmail,c.email);assert.equal(p.invoice.lines[0].lineTime,'20:00');assert.match(p.warning,/Summary/);
 const ambiguous=S.document('invoice',invoice,[c,{...c,id:'124'}]);assert.equal(ambiguous.invoice.clientEmail,'');assert.match(ambiguous.warning,/Multiple/);
});
test('purchase total ticket cost is not multiplied by ticket count; seating and extra costs survive',()=>{
 const p=S.document('purchase',purchase,[]);assert.equal(p.invoice.number,'SB-PO-789');assert.equal(p.invoice.lines[0].qty,3);assert.equal(p.invoice.lines[0].unitCost,100/3);assert.equal(p.invoice.lines[0].section,'A');assert.equal(p.invoice.lines[1].unitCost,15);assert.equal(p.invoice.credit,115);
 assert.throws(()=>S.document('purchase',{...purchase,'Purchase Total':'120'},[]),/do not match/);
});
test('void status and negative balances are preserved without inventing payments',()=>{
 const p=S.document('invoice',{...invoice,'Payment Status':'Void','Outstanding Balance':'-2250'},[]);assert.equal(p.invoice.status,'Void');assert.equal(p.invoice.credit,4500);assert.match(p.invoice.notes,/not an itemized payment/);assert.match(p.warning,/Negative balance/);
});
test('invalid money, dates, missing IDs, and duplicate IDs are blocked',()=>{
 for(const v of ['', 'bad', '1,2','5.555'])assert.throws(()=>S.amount(v,'Amount'));
 assert.throws(()=>S.date('02/30/2026','Date'),/invalid/);
 const p=S.preview([{kind:'invoice',name:'test',records:[invoice,invoice,{...invoice,'Invoice ID':''}]}]);assert.match(p[1].error,/Duplicate/);assert.match(p[2].error,/ID/);
});
test('CSV parser handles quoted commas, embedded newlines, and escaped quotes',()=>{
 assert.deepEqual(S.csv('Name,Note\r\n"A, B","line 1\n""line 2"""\r\n'),[['Name','Note'],['A, B','line 1\n"line 2"']]);assert.throws(()=>S.csv('"unfinished'),/unclosed/);
});
function fixture(){
 const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';const headers=Object.keys(customer);
 const cells=(row,num)=>row.map((v,i)=>'<c r="'+String.fromCharCode(65+i)+num+'" t="inlineStr"><is><t>'+v+'</t></is></c>').join('');
 return zip.zipSync(Object.fromEntries(Object.entries({
 'xl/workbook.xml':'<workbook xmlns="'+ns+'" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Customers" r:id="rId1"/></sheets></workbook>',
 'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
 'xl/worksheets/sheet1.xml':'<worksheet xmlns="'+ns+'"><sheetData><row>'+cells(headers,1)+'</row><row>'+cells(Object.values(customer),2)+'</row></sheetData></worksheet>'
 }).map(([k,v])=>[k,zip.strToU8(v)])));
}
test('XLSX reader discovers sheets and converts inline strings without changing contact IDs',()=>{
 const parsed=S.xlsx(fixture(),zip,DOMParser);assert.equal(parsed[0].kind,'customer');assert.equal(parsed[0].records[0]['Customer ID'],'123');assert.equal(S.preview(parsed)[0].document.email,customer.Email);
});
