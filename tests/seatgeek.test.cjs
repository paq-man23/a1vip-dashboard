const {test}=require('node:test'),assert=require('node:assert/strict');
const load=()=>import('../supabase/functions/a1-assistant/seatgeek.mjs');
test('SeatGeek sends artist/location/date filters separately, translates paging, and keeps credentials out of URLs/results',async()=>{
 const {discoverSeatGeekEvents}=await load();let requested,headers;
 const r=await discoverSeatGeekEvents({query:'Olivia Rodrigo Florida',startDate:'2027-03-01',endDate:'2027-03-31',page:1},{env:k=>({SEATGEEK_CLIENT_ID:'sg-id',SEATGEEK_CLIENT_SECRET:'sg-secret'})[k],fetchImpl:async(url,options)=>{requested=new URL(url);headers=options.headers;return new Response(JSON.stringify({events:[{id:9,title:'Olivia Rodrigo',datetime_local:'2027-03-05T19:30:00',url:'https://seatgeek.com/olivia-rodrigo-tickets/event/9',venue:{name:'Arena',city:'Miami',state:'FL'},stats:{lowest_price:100,average_price:175,highest_price:300,listing_count:20}}],meta:{total:25},private:'provider-internals'}));}});
 assert.equal(requested.origin,'https://api.seatgeek.com');assert.equal(requested.searchParams.get('q'),'Olivia Rodrigo');assert.equal(requested.searchParams.get('venue.state'),'FL');assert.equal(requested.searchParams.get('venue.country'),'US');assert.equal(requested.searchParams.get('page'),'2');assert.equal(requested.searchParams.get('datetime_local.lte'),'2027-03-31T23:59:59');assert.equal(headers.Authorization,'Basic '+btoa('sg-id:sg-secret'));assert.doesNotMatch(requested.href,/sg-id|sg-secret/);assert.doesNotMatch(JSON.stringify(r),/sg-id|sg-secret|provider-internals/);assert.equal(r.events[0].priceSummary.currency,'');assert.equal(r.events[0].priceSummary.lowest,100);assert.equal(r.hasMore,true);
});
test('missing prices, no inventory and TBD times are not fabricated into a quote',async()=>{
 const {normalizeSeatGeekEvent}=await load();const r=normalizeSeatGeekEvent({id:1,title:'Test',datetime_local:'2027-03-05T03:30:00',time_tbd:true,stats:{lowest_price:100,listing_count:0},url:'javascript:alert(1)'});assert.equal(r.time,'');assert.equal(r.priceSummary.lowest,null);assert.equal(r.priceSummary.average,null);assert.equal(r.url,'');
});
test('SeatGeek missing credentials and provider errors produce safe, explicit messages',async()=>{
 const {discoverSeatGeekEvents}=await load();const empty=await discoverSeatGeekEvents({query:'Knicks'},{env:()=>'',fetchImpl:()=>{throw Error('must not call');}});assert.equal(empty.configured,false);
 for(const status of [401,403,429,500])await assert.rejects(()=>discoverSeatGeekEvents({query:'Knicks'},{env:k=>k==='SEATGEEK_CLIENT_ID'?'sg-id':'',fetchImpl:async()=>new Response('sg-secret',{status})}),e=>!/sg-secret|https:/.test(e.message));
});
