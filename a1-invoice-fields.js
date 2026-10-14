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
  const api={fields,enrich};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.A1InvoiceFields=api;
})(typeof window==='undefined'?globalThis:window);
