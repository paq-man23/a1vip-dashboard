/* Read-only Skybox lookups. Record data stays in the dashboard, outside model prompts. */
(function(root){
 const resources={inventory:'Inventory',invoices:'Invoices',purchases:'Purchases',customers:'Customers',vendors:'Vendors'};
 function resource(value){if(!Object.hasOwn(resources,value))throw Error('Choose inventory, invoices, purchases, customers, or vendors.');return resources[value];}
 function parameters(request,page=0){
  const group=resource(request.section),query=String(request.query||'').trim().slice(0,120),id=/^#?\d+$/.test(query)?Number(query.replace('#','')):null;
  if(id!==null&&(!Number.isSafeInteger(id)||id<=0))throw Error('Enter a valid Skybox record ID.');
  const common={limit:12,pageNumber:page+1,sortDir:group==='Inventory'?'ASC':'DESC',sortedBy:group==='Inventory'?'EVENT_DATE':group==='Vendors'?'DISPLAY_NAME':'ID'};
  if(group==='Inventory'){
   const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
   return [{...common,...(id?{inventoryId:[id]}:query?{eventKeywords:query.split(/\s+/).filter(Boolean)}:{}),eventDateFrom:(request.startDate||today)+'T00:00:00',...(request.endDate?{eventDateTo:request.endDate+'T23:59:59'}:{}),...(request.stateCode?{state:[request.stateCode]}:{})}];
  }
  if(id)return [{...common,id:[id]}];
  if(group==='Invoices'||group==='Purchases')return [{...common,displayName:query},{...common,[group==='Invoices'?'performer':'eventName']:query}];
  return [{...common,displayName:query}];
 }
 async function search(request,data){
  const group=resource(request.section);if(!data.canAccess('ticketUI'))throw Error('Ticket UI is not enabled for your account.');
  if(!data.isAdmin()){
   if(group!=='Inventory')throw Error('Live Skybox records require administrator access. Search saved dashboard invoices or contacts instead.');
   const r=await data.skyboxRequest({action:'inventory',query:String(request.query||'').slice(0,120),page:request.page||0});
   return {group,rows:r.rows||[],hasMore:((request.page||0)+1)*50<r.total,snapshot:true,checkedAt:r.completedAt};
  }
  const rows=new Map();let hasMore=false;
  for(const filters of parameters(request,request.page||0)){
   const r=await data.ticketRequest({action:'read',operation:request.section==='inventory'?'inventorySearch':request.section+'Search',parameters:filters});
   const list=Array.isArray(r.data)?r.data:r.data?.rows||[];
   for(const row of list)if(row?.id!=null)rows.set(String(row.id),row);
   hasMore ||= Number(r.data?.rowCount||0)>filters.pageNumber*filters.limit;
  }
  return {group,rows:[...rows.values()],hasMore,snapshot:false};
 }
 function importedId(record,group){return String(record.skybox?.[group==='Purchases'?'Purchase ID':'Invoice ID']||'');}
 const api={resource,parameters,search,importedId};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.A1AssistantSkybox=api;
})(typeof window==='undefined'?globalThis:window);
