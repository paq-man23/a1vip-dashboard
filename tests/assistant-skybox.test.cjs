const {test}=require('node:test'),assert=require('node:assert/strict'),api=require('../assistant-skybox.js');
test('read-only lookup parameters obey the official Skybox contract and future-date inventory default',async()=>{
 const {buildRequest}=await import('../supabase/functions/a1-ticket-ui/contract.mjs');
 for(const section of ['inventory','invoices','purchases','customers','vendors'])for(const query of ['Dolphins','123'])for(const parameters of api.parameters({section,query})){
  const r=buildRequest({operation:section==='inventory'?'inventorySearch':section+'Search',parameters},'123');assert.equal(r.method,'GET');
  if(section==='inventory')assert.match(parameters.eventDateFrom,/^\d{4}-\d{2}-\d{2}T00:00:00$/);
 }
});
test('invoice lookup searches both customers and performers, deduplicates results, and pages without writes',async()=>{
 const calls=[],data={isAdmin:()=>true,canAccess:()=>true,ticketRequest:async body=>{calls.push(body);return {data:{rows:[{id:777}],rowCount:30}};}};
 const r=await api.search({section:'invoices',query:'Dolphins',page:1},data);assert.equal(r.rows.length,1);assert.equal(r.hasMore,true);assert.deepEqual(calls.map(c=>c.parameters.pageNumber),[2,2]);assert.equal(calls[0].parameters.displayName,'Dolphins');assert.equal(calls[1].parameters.performer,'Dolphins');assert.ok(calls.every(c=>c.action==='read'));
});
test('staff use only their permitted snapshot and cannot request live invoices',async()=>{
 let calls=0;const data={isAdmin:()=>false,canAccess:()=>true,skyboxRequest:async()=>{calls++;return {rows:[{id:1}],total:70};},ticketRequest:()=>{throw Error('must not call');}};
 assert.equal((await api.search({section:'inventory',query:'Dolphins'},data)).snapshot,true);assert.equal(calls,1);
 await assert.rejects(api.search({section:'invoices',query:'123'},data),/administrator/);
 await assert.rejects(api.search({section:'inventory',query:'Dolphins'},{...data,canAccess:()=>false}),/not enabled/);
 assert.throws(()=>api.parameters({section:'arbitrary',query:'x'}),/Choose/);
});

test('inventory keywords find names containing Dolphins and preserve paging and exact ID lookup',async()=>{
 const calls=[],data={isAdmin:()=>true,canAccess:()=>true,ticketRequest:async body=>{calls.push(body);return {data:{rows:body.parameters.eventKeywords?.includes('Dolphins')?[{id:777,event:{name:'New York Jets at Miami Dolphins'}}]:[],rowCount:18}};}};
 const r=await api.search({section:'inventory',query:'Dolphins'},data);assert.equal(r.rows[0].id,777);assert.equal(r.hasMore,true);assert.equal('event' in calls[0].parameters,false);
 await api.search({section:'inventory',query:'Dolphins',page:1},data);assert.equal(calls[1].parameters.pageNumber,2);assert.deepEqual(calls[1].parameters.eventKeywords,['Dolphins']);
 const exact=api.parameters({section:'inventory',query:'777'})[0];assert.deepEqual(exact.inventoryId,[777]);assert.equal('eventKeywords' in exact,false);
});
