/* Deterministic filtering; customer records never enter the model request. */
(function(root){
 const text=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 function filter(rows,request){
  const terms=text(request.query).trim().split(/\s+/).filter(Boolean);
  return rows.filter(row=>{
   if(request.year&&!String(row.createdDate||'').startsWith(request.year))return false;
   if(request.documentType==='po'&&!String(row.type).startsWith('po-'))return false;
   if(request.documentType==='invoice'&&!String(row.type).startsWith('invoice-'))return false;
   const voided=text(row.status)==='void';
   if(request.payment==='void'&&!voided)return false;
   if(request.payment&&request.payment!=='void'&&voided)return false;
   if(request.payment==='outstanding'&&!(totals(row).balance>0.005))return false;
   if(request.payment==='paid'&&Math.abs(totals(row).balance)>0.005)return false;
   const hay=text([row.number,row.savedName,row.clientCompany,row.clientContact,row.createdDate,...(row.lines||[]).flatMap(l=>[l.eventName,l.venue,l.description,l.lineDate,l.location])].filter(Boolean).join(' '));
   return terms.every(term=>hay.includes(term));
  });
 }
 function totals(row){
  const n=value=>{const result=Number(value||0);if(!Number.isFinite(result))throw new Error('A saved document contains an invalid amount. Open and review it before calculating a summary.');return result;};
  const total=(row.lines||[]).reduce((sum,l)=>sum+n(l.qty)*n(l.unitCost)*(text(l.lineType)==='hotel'?n(l.rooms??1):1),0)+n(row.tax)+n(row.shipping);
  const credit=n(row.credit??row.other)+n(row.amountPaid);
  return {total,balance:total-credit};
 }
 function summary(rows){
  const result={invoice:{count:0,total:0,balance:0},po:{count:0,total:0,balance:0},void:0};
  for(const row of rows){if(text(row.status)==='void'){result.void++;continue;}const key=String(row.type).startsWith('po-')?'po':'invoice',t=totals(row);result[key].count++;result[key].total+=t.total;result[key].balance+=t.balance;}
  return result;
 }
 const api={filter,totals,summary};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.A1AssistantRecords=api;
})(typeof window==='undefined'?globalThis:window);
