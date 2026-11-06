// Documented Skybox API v1 summary fields; never infer missing financial values.
const text=v=>v==null?'':String(v);
const number=(v,label)=>{if(typeof v!=='number'||!Number.isFinite(v))throw Error('Missing or invalid '+label);return v;};
const id=v=>{if(!Number.isSafeInteger(v)||v<1)throw Error('Invalid Skybox ID');return String(v);};
const date=v=>{if(!v)return '';if(!/^\d{4}-\d{2}-\d{2}/.test(v))throw Error('Invalid Skybox date');return v.slice(0,10);};
export function convert(kind,r,contact={}) {
 const sourceId=id(r.id),po=kind==='purchase';
 if(kind==='customer'||kind==='vendor'){
  const a=r.address||{},name=[r.firstName,r.lastName].filter(Boolean).join(' '),displayName=text(r.displayName);
  if(!displayName)throw Error('Missing Skybox contact name');
  const document={id:sourceId,kind,displayName,name,firstName:text(r.firstName),lastName:text(r.lastName),company:text(r.company),email:text(r.email),phone:text(a.phone1),phone2:text(a.phone2),address:[a.address1,a.address2,a.city,a.state,a.postalCode,a.country].filter(Boolean).join('\n'),paymentMethod:text(r.paymentMethod),tags:text(r.tags),type:text(r.customerType||r.type),credit:text(r.creditBalance),notes:text(r.notes)};
  return {kind,sourceId,record:{[kind==='customer'?'Customer ID':'Vendor ID']:sourceId,api:document,deleted:!!r.deleted},document};
 }
 if(kind==='inventory'){
  const e=r.event||{},v=e.venue||{};
  const document={id:sourceId,eventId:text(r.eventId||e.id),eventName:text(e.name),eventDate:text(e.date),venue:text(v.name),city:text(v.city),state:text(v.state),section:text(r.section),row:text(r.row),seats:r.hideSeatNumbers?'':text(r.seatNumbers),quantity:number(r.quantity,'inventory quantity'),listPrice:r.listPrice==null?null:number(r.listPrice,'list price'),currency:text(r.listPriceCurrencyCode),status:text(r.status),inHandDate:text(r.inHandDate),updatedAt:text(r.lastUpdate),publicNotes:text(r.publicNotes)};
  return {kind,sourceId,document};
 }
 if(r.currencyCode&&r.currencyCode!=='USD')throw Error('Non-USD Skybox document requires currency review');
 const total=number(r.total,'document total'),balance=number(r.outstandingBalance,'outstanding balance'),shipping=number(r.shippingAmount??0,'shipping'),tax=number(r.taxAmount??0,'tax');
 const status=(r.paymentStatus==='VOID'||r.status==='ORDER_VOID_CANCELLED')?'Void':({PAID:'Paid',PARTIAL:'Partially Paid',UNPAID:'Unpaid'})[r.paymentStatus];
 if(!status)throw Error('Unknown Skybox payment status');
 const sourceLines=(r.lines||[]).filter(l=>!l.cancelled&&!l.delete);
 let lines=sourceLines.map(l=>{const i=l.inventory||{},e=i.event||{};const qty=number(l.quantity??1,'line quantity'),amount=number(l.amount,'line total');if(qty<=0)throw Error('Invalid Skybox line quantity');return {lineType:'Tickets',eventName:text(e.name||l.description||r.eventName||r.performer),venue:text(e.venue?.name||r.venue),lineDate:date(e.date||r.eventDate),lineTime:'',checkOutDate:'',location:'',section:text(i.section||r.section),row:text(i.row||r.row),seats:'',description:text(l.description),qty,unitCost:amount/qty};});
 if(!lines.length)lines=[{lineType:'Experience',eventName:text(r.eventName||r.performer),venue:text(r.venue),lineDate:date(r.eventDate),lineTime:'',description:'Skybox API summary; individual ticket line details were not supplied.',qty:1,unitCost:total-tax-shipping}];
 else {const sum=lines.reduce((s,l)=>s+l.qty*l.unitCost,0);const other=number(r.otherAmount??0,'other amount');if(other)lines.push({lineType:'Experience',eventName:'Other charges',description:'Skybox other amount',qty:1,unitCost:other});if(Math.abs(sum+other+shipping+tax-total)>.011)throw Error('Skybox line totals do not reconcile');}
 const document={origin:'skybox',id:'inv-skybox-'+kind+'-'+sourceId,number:po?'SB-PO-'+sourceId:sourceId,type:po?'po-ticket':'invoice-ticket',savedName:'Skybox '+(po?'PO ':'Invoice ')+sourceId,createdDate:date(r.createdDate),dueDate:date(r.dueDate),fulfillmentStatus:text(r.fulfillmentStatus),externalReference:text(r.externalRef),inHandDate:date(r.invoiceInHandDate),terms:text(r.salesTerm||r.purchaseTerm),paymentType:text(r.paymentMethod),deliveryMethod:text(r.deliveryMethod),status,clientCompany:contact.company||r.displayName||'',clientContact:contact.name||r.displayName||'',clientEmail:contact.email||'',clientPhone:contact.phone||'',billingAddress:contact.address||'',shippingAddress:'',createdBy:text(r.createdBy),tax,shipping,credit:Math.round((total-balance)*100)/100,lines,notes:text(r.publicNotes),internalNotes:text(r.internalNotes),paymentReference:text(r.paymentRef)};
 const record={[po?'Purchase ID':'Invoice ID']:sourceId,api:{...document,total,balance,customerId:r.customerId,vendorId:r.vendorId}};
 document.skybox={...record};
 return {kind,sourceId,record,document};
}
export const resources={customer:'customers',vendor:'vendors',invoice:'invoices',purchase:'purchases',inventory:'inventory'};
export function pageUrl(kind,state){
 const url=new URL('https://skybox.vividseats.com/services/'+resources[kind]);url.searchParams.set('limit','50');if(state.page>0||state.pageBase!==undefined)url.searchParams.set('pageNumber',String(state.page+(state.pageBase??1)));url.searchParams.set('sortDir',kind==='invoice'||kind==='purchase'?'DESC':'ASC');
 if(['invoice','purchase'].includes(kind)){url.searchParams.set('sortedBy','ID');if(state.since)url.searchParams.set('lastUpdateFrom',state.since);url.searchParams.set('lastUpdateTo',state.until);}
 else if(kind==='customer')url.searchParams.set('sortedBy','ID');
 else if(kind==='vendor')url.searchParams.set('sortedBy','DISPLAY_NAME');
 else {url.searchParams.set('sortedBy','EVENT_DATE');url.searchParams.set('sortedByB','ID');url.searchParams.set('sortDirB','ASC');url.searchParams.set('includeTickets','false');}
 return url;
}
export function validatePage(data,page){
 if(!Array.isArray(data?.rows)||!Number.isSafeInteger(data.rowCount)||data.rowCount<0||data.rows.length>50)throw Error('Unexpected Skybox pagination response');
 if(!data.rows.length&&page*50<data.rowCount)throw Error('Skybox pagination ended early');
 const ids=data.rows.map(r=>id(r.id));if(new Set(ids).size!==ids.length)throw Error('Duplicate Skybox IDs in page');
 return {rows:data.rows,done:(page+1)*50>=data.rowCount,total:data.rowCount};
}
