/* Original report fields stay available; internal bookkeeping is separate from the customer document. */
(function(root){
  const fields=[
    ['vendor','Vendor','invVendor'],['paymentReference','Payment Reference','invPaymentReference'],
    ['nonInventoryCosts','Non-Inventory Costs','invNonInventoryCosts'],['cogs','COGS','invCogs'],
    ['inventoryPnl','Inventory P&L','invInventoryPnl'],['inventoryTags','Inventory Tags','invInventoryTags'],
    ['ticketSales','Ticket Sales','invTicketSales'],['inventoryMargin','Inventory Margin','invInventoryMargin'],
    ['consignment','Consignment','invConsignment'],['poTags','PO Tags','invPoTags'],['internalNotes','Internal Notes','invInternalNotes']
  ];
  function enrich(invoice){
    const result={...invoice},raw=invoice.skybox||{};
    for(const [key,label] of fields)if(result[key]==null)result[key]=String(raw[label]??(key==='nonInventoryCosts'?raw['Non-Inventory Cost']:undefined)??'');
    return result;
  }
  function invoiceFromPurchaseOrder(source,base,markupPercent=30){
    if(!String(source?.type||'').startsWith('po-'))throw new Error('Choose a purchase order first.');
    const num=value=>{const n=Number(value||0);if(!Number.isFinite(n))throw new Error('Purchase order contains an invalid amount.');return n;};
    const round=value=>Math.round((value+Number.EPSILON)*100)/100;
    const markup=Number(markupPercent);if(markupPercent===''||!Number.isFinite(markup)||markup<0)throw new Error('Enter a valid markup percentage of zero or more.');
    const original=JSON.parse(JSON.stringify(source));
    const lines=(original.lines||[]).map(line=>({...line,markupBaseUnitCost:num(line.unitCost),unitCost:round(num(line.unitCost)*(1+markup/100))}));
    const cost=(original.lines||[]).reduce((sum,line)=>sum+num(line.qty)*num(line.unitCost)*(String(line.lineType||'').toLowerCase()==='hotel'?num(line.rooms??1):1),0);
    return {...base,type:source.type.replace(/^po-/,'invoice-'),lines,
      origin:'a1',autoNumber:true,number:'',numberAssignedByDB:false,savedName:'',
      credit:0,status:'Unpaid',tax:num(source.tax),shipping:num(source.shipping),
      vendorId:source.vendorId||(source.contactKind==='vendor'?source.contactId:'')||'',
      vendor:source.vendor||source.clientCompany||source.clientContact||'',cogs:String(round(cost)),
      internalNotes:'Created from purchase order #'+(source.number||'Draft')+' with '+markup+'% markup on line prices.',
      sourcePurchaseOrder:{id:source.id,number:source.number||'',markupPercent:markup,originalLines:original.lines||[]}
    };
  }
  function markupInvoice(source,percent){
    const rate=Number(percent);
    if(String(source?.type||'').startsWith('po-'))throw new Error('Use Create Invoice on purchase orders.');
    if(percent===''||!Number.isFinite(rate)||rate<=0)throw new Error('Choose a markup greater than zero.');
    const invoice=JSON.parse(JSON.stringify(source));
    invoice.lines=(invoice.lines||[]).map(line=>{
      let base=line.markupBaseUnitCost;
      // Older converted drafts did not retain a baseline on each line.
      if(base==null&&source.sourcePurchaseOrder){
        const keys=['lineType','eventName','lineDate','checkOutDate','venue','section','row','seats','description'];
        const matches=(source.sourcePurchaseOrder.originalLines||[]).filter(original=>keys.every(key=>String(original[key]||'')===String(line[key]||'')));
        const costs=[...new Set(matches.map(original=>Number(original.unitCost||0)))];
        if(costs.length>1)throw new Error('Original PO costs are ambiguous for this line. Create a fresh invoice from the PO.');
        if(costs.length===1)base=costs[0];
      }
      const cost=Number(base??line.unitCost??0),price=cost*(1+rate/100);
      if(!Number.isFinite(price))throw new Error('Enter valid line prices before applying markup.');
      return {...line,markupBaseUnitCost:cost,unitCost:Math.round((price+Number.EPSILON)*100)/100};
    });
    invoice.markupPercent=rate;
    if(invoice.sourcePurchaseOrder)invoice.sourcePurchaseOrder.markupPercent=rate;
    invoice.markupAdjustments=[...(invoice.markupAdjustments||[]),{percent:rate,originalLines:JSON.parse(JSON.stringify(source.lines||[]))}];
    return invoice;
  }
  const api={fields,enrich,invoiceFromPurchaseOrder,markupInvoice};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.A1InvoiceFields=api;
})(typeof window==='undefined'?globalThis:window);
