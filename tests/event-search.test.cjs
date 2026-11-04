const {test}=require('node:test'),assert=require('node:assert/strict');
const base={id:'1',name:'New York Knicks vs Chicago Bulls',date:'2026-12-01',time:'19:30:00',venue:'Madison Square Garden',city:'New York',state:'NY',country:'US',performers:['New York Knicks','Chicago Bulls']};
const result=(source,events)=>({source,events,checkedAt:'2026-11-04T19:00:00Z'});
test('same event can combine source links and pricing without mixing the underlying amounts',async()=>{
 const {mergeEvents}=await import('../supabase/functions/a1-assistant/event-search.mjs');const tm={...base,url:'https://www.ticketmaster.com/event/1',priceRanges:[{min:100,max:500,currency:'USD'}]},sg={...base,id:'99',name:'Chicago Bulls at New York Knicks',url:'https://seatgeek.com/event/99',priceRanges:[],priceSummary:{lowest:120,currency:'USD'}};
 const merged=mergeEvents([result('Ticketmaster Discovery',[tm]),result('SeatGeek',[sg])]);assert.equal(merged.length,1);assert.equal(merged[0].offers.length,2);assert.equal(merged[0].offers[0].priceRanges[0].min,100);assert.equal(merged[0].offers[1].priceSummary.lowest,120);
});
test('uncertain dates, different times, different games, VIP packages and same-provider records remain separate',async()=>{
 const {mergeEvents}=await import('../supabase/functions/a1-assistant/event-search.mjs');
 for(const change of [{date:''},{time:''},{time:'20:00:00'},{date:'2026-12-02'},{name:'New York Knicks vs Boston Celtics',performers:['New York Knicks','Boston Celtics']},{name:base.name+' VIP Package'}])assert.equal(mergeEvents([result('Ticketmaster Discovery',[base]),result('SeatGeek',[{...base,...change}])]).length,2);
 assert.equal(mergeEvents([result('SeatGeek',[base,{...base,id:'2'}])]).length,2);
});
test('unconfigured SeatGeek is skipped and Ticketmaster remains usable; totals are explicitly per-page',async()=>{
 const {searchEvents}=await import('../supabase/functions/a1-assistant/event-search.mjs');let calls=0;const r=await searchEvents({query:'Knicks'},{env:k=>k==='TICKETMASTER_API_KEY'?'tm-key':'',fetchImpl:async()=>{calls++;return new Response(JSON.stringify({_embedded:{events:[]},page:{totalElements:0,totalPages:0}}));}});assert.equal(calls,1);assert.equal(r.configured,true);assert.equal(r.providers[1].status,'not-configured');assert.equal(r.totalIsPageCount,true);
});
