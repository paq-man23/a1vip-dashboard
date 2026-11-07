export const kinds=['sale','hold','price','listing'];
export const id=value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw Error('Invalid Skybox ID');return n;};
const money=value=>{const n=Number(value);if(!Number.isFinite(n)||n<0||n>1000000||Math.abs(n*100-Math.round(n*100))>0.00001)throw Error('Enter a valid price with at most two decimal places');return n;};
export function safeInventory(inventory,tickets,event,accountId,now=Date.now()){
 if(String(inventory.accountId)!==String(accountId)||id(inventory.eventId)!==id(event.id))throw Error('Skybox inventory account or event mismatch');
 const eventDate=String(event.date||'');const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 if(!/^\d{4}-\d{2}-\d{2}/.test(eventDate)||eventDate.slice(0,10)<today||(/[zZ]|[+-]\d\d:\d\d$/.test(eventDate)&&Date.parse(eventDate)<=now))throw Error('This event has passed or has no verified event date');
 if(!Array.isArray(tickets)||!Number.isSafeInteger(inventory.quantity)||inventory.quantity<1)throw Error('Skybox did not return usable ticket availability');
 const safe=tickets.map(t=>{if(String(t.accountId)!==String(accountId)||id(t.inventoryId)!==id(inventory.id))throw Error('Ticket account or inventory mismatch');return {id:id(t.id),seat:Number.isSafeInteger(t.seatNumber)?t.seatNumber:null,status:String(t.status),invoiceLineId:t.invoiceLineId||null};});
 if(new Set(safe.map(t=>t.id)).size!==safe.length)throw Error('Duplicate ticket IDs returned');
 return {id:id(inventory.id),eventId:id(event.id),eventName:String(event.name||''),eventDate,venue:String(event.venue?.name||''),section:String(inventory.section||''),row:String(inventory.row||''),quantity:inventory.quantity,status:String(inventory.status),version:inventory.version??null,lastUpdate:String(inventory.lastUpdate||''),listPrice:inventory.listPrice==null?null:money(inventory.listPrice),currency:inventory.listPriceCurrencyCode||'USD',broadcast:!!inventory.broadcast,splitType:String(inventory.splitType||'DEFAULT'),customSplit:String(inventory.customSplit||''),tickets:safe};
}
export async function fingerprint(snapshot){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(snapshot))))).map(x=>x.toString(16).padStart(2,'0')).join('');}
export function intentFor(input,snapshot,customer,now=Date.now()){
 if(!kinds.includes(input.kind))throw Error('Unsupported inventory action');
 if(snapshot.currency!=='USD')throw Error('Trading currently supports USD listings only');
 if(snapshot.status!=='AVAILABLE')throw Error('Inventory is held or unavailable. Resolve the hold in Skybox before creating a sale');
 const intent={};
 if(['sale','hold'].includes(input.kind)){
  const selected=(input.ticketIds||[]).map(id);
  if(!selected.length||new Set(selected).size!==selected.length||selected.length>snapshot.quantity)throw Error('Choose the exact available tickets');
  for(const n of selected)if(!snapshot.tickets.some(t=>t.id===n&&t.status==='AVAILABLE'&&!t.invoiceLineId))throw Error('A selected ticket is no longer available');
  const remaining=snapshot.quantity-selected.length;
  if(remaining>0&&(snapshot.splitType==='DEFAULT'||(snapshot.splitType==='NEVERLEAVEONE'&&remaining===1)||(snapshot.splitType==='CUSTOM'&&!snapshot.customSplit.split(',').map(Number).includes(selected.length))))throw Error('This ticket quantity violates the listing split policy; choose all tickets or use Skybox');
  intent.ticketIds=selected.sort((a,b)=>a-b);
  if(!customer||String(customer.accountId)!==String(input.accountId)||id(customer.id)!==id(input.customerId)||customer.deleted)throw Error('Choose an active Skybox customer');
  intent.customer={id:id(customer.id),displayName:String(customer.displayName||''),name:[customer.firstName,customer.lastName].filter(Boolean).join(' '),company:String(customer.company||''),email:String(customer.email||''),phone:String(customer.address?.phone1||'')};
 }
 if(input.kind==='sale')intent.unitPrice=money(input.unitPrice);
 if(input.kind==='hold'){
  const seats=intent.ticketIds.map(n=>snapshot.tickets.find(t=>t.id===n).seat).sort((a,b)=>a-b);
  if(seats.some(n=>!Number.isSafeInteger(n)||n<1)||seats.some((n,i)=>i&&n!==seats[i-1]+1))throw Error('Holds require consecutive numeric seat numbers');
  const minutes=Number(input.minutes);if(!Number.isInteger(minutes)||minutes<1||minutes>30)throw Error('Choose a hold duration from 1 to 30 minutes');
  intent.lowSeat=seats[0];intent.expiryDate=new Date(now+minutes*60000).toISOString();
 }
 if(input.kind==='price')intent.unitPrice=money(input.unitPrice);
 if(input.kind==='listing'){if(typeof input.broadcast!=='boolean')throw Error('Choose a listing state');intent.broadcast=input.broadcast;}
 return intent;
}
export function providerPayload(order,inventory,accountId){
 const ref='A1-'+order.id,i=order.intent;
 if(order.kind==='sale')return {method:'POST',path:'/invoices',body:{accountId:id(accountId),customerId:i.customer.id,currencyCode:'USD',externalRef:ref,paymentStatus:'UNPAID',lines:[{accountId:id(accountId),lineItemType:'INVENTORY',lineType:'INVOICE',itemIds:i.ticketIds,quantity:i.ticketIds.length,amount:Math.round(i.unitPrice*i.ticketIds.length*100)/100}]}};
 if(order.kind==='hold')return {method:'POST',path:'/holds',body:{inventoryId:id(order.inventory_id),customerId:i.customer.id,quantity:i.ticketIds.length,lowSeat:i.lowSeat,expiryDate:i.expiryDate,externalRef:ref}};
 if(order.kind==='listing')return {method:'PUT',path:'/inventory/bulk-update',body:{inventoryIds:[id(order.inventory_id)],broadcast:i.broadcast}};
 // Full object update preserves provider settings. Ticket files/barcodes are never returned to the UI or logged.
 const body=structuredClone(inventory);body.listPrice=i.unitPrice;
 for(const k of ['filesUploaded','barCodesEntered','externalTicketIdEntered','transferUrlEntered','ticketsMerged','ticketsSplit'])delete body[k];
 return {method:'PUT',path:'/inventory/'+id(order.inventory_id),body};
}
export function verifySale(order,invoice,accountId){
 if(String(invoice.accountId)!==String(accountId)||invoice.externalRef!=='A1-'+order.id||Number(invoice.customerId)!==order.intent.customer.id)throw Error('Skybox invoice does not match the confirmed sale');
 const lines=(invoice.lines||[]).filter(l=>l.lineItemType==='INVENTORY'&&!l.cancelled);
 const ids=lines.flatMap(l=>l.itemIds||[]).map(id).sort((a,b)=>a-b);
 if(JSON.stringify(ids)!==JSON.stringify(order.intent.ticketIds)||lines.some(l=>l.cancelled))throw Error('Skybox invoice ticket IDs do not match the confirmed selection');
 if(!['UNPAID','PARTIAL','PAID'].includes(invoice.paymentStatus))throw Error('Skybox invoice payment state requires reconciliation');
 if((invoice.lines||[]).some(l=>!l.cancelled&&l.lineItemType!=='INVENTORY'))throw Error('Skybox added unexpected invoice lines; review the invoice');
 const total=lines.reduce((n,l)=>n+Number(l.amount),0),expected=order.intent.unitPrice*order.intent.ticketIds.length;
 const balance=Number(invoice.outstandingBalance);
 if(invoice.outstandingBalance==null||!Number.isFinite(balance)||balance<0||balance>expected+.005||(invoice.paymentStatus==='UNPAID'&&Math.abs(balance-expected)>.005)||(invoice.paymentStatus==='PAID'&&balance!==0)||(invoice.paymentStatus==='PARTIAL'&&(balance<=0||balance>=expected)))throw Error('Skybox invoice balance requires reconciliation');
 if(!Number.isFinite(total)||Math.abs(total-expected)>.005||Number(invoice.taxAmount||0)!==0||Number(invoice.shippingAmount||0)!==0||Number(invoice.otherAmount||0)!==0)throw Error('Skybox invoice total requires reconciliation');
 return expected;
}
export function invoiceDocument(order,invoice,accountId){
 const total=verifySale(order,invoice,accountId),s=order.snapshot,c=order.intent.customer,source=String(id(invoice.id));
 const document={id:'inv-skybox-invoice-'+source,number:source,origin:'skybox',type:'invoice-ticket',savedName:'Skybox Invoice '+source,createdDate:String(invoice.createdDate||new Date().toISOString()).slice(0,10),status:({UNPAID:'Unpaid',PAID:'Paid',PARTIAL:'Partially Paid'})[invoice.paymentStatus],clientCompany:c.company||c.displayName,clientContact:c.name||c.displayName,clientEmail:c.email,clientPhone:c.phone,credit:Math.round((total-Number(invoice.outstandingBalance))*100)/100,tax:0,shipping:0,lines:[{lineType:'Tickets',eventName:s.eventName,venue:s.venue,lineDate:s.eventDate.slice(0,10),section:s.section,row:s.row,seats:order.intent.ticketIds.map(n=>s.tickets.find(t=>t.id===n).seat).filter(n=>n!==null).join(', '),qty:order.intent.ticketIds.length,unitCost:order.intent.unitPrice}],externalReference:'A1-'+order.id,skybox:{invoiceId:source,tradeId:order.id}};
 return {document,record:{'Invoice ID':source,api:{total,balance:Number(invoice.outstandingBalance),externalRef:'A1-'+order.id}}};
}
export function verifyHold(order,hold,accountId,now=Date.now()){
 if(String(hold?.accountId)!==String(accountId)||Number(hold.inventoryId)!==Number(order.inventory_id)||hold.externalRef!=='A1-'+order.id||Number(hold.quantity)!==order.intent.ticketIds.length||Number(hold.customerId)!==order.intent.customer.id||Date.parse(hold.expiryDate)<=now||Math.abs(Date.parse(hold.expiryDate)-Date.parse(order.intent.expiryDate))>1000)throw Error('Hold details require reconciliation');
 const raw=String(hold.seats||'').replace(/\s/g,'');if(!/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(raw))throw Error('Held seat numbers require reconciliation');
 const seats=[];for(const part of raw.split(',')){const [low,high=low]=part.split('-').map(Number);if(high<low||high-low>1000)throw Error('Invalid held seat range');for(let n=low;n<=high;n++)seats.push(n);}
 const selected=order.intent.ticketIds.map(n=>order.snapshot.tickets.find(t=>t.id===n).seat).sort((a,b)=>a-b);
 if(JSON.stringify(seats.sort((a,b)=>a-b))!==JSON.stringify(selected))throw Error('Held seats do not match the confirmed selection');
}
