const {test}=require('node:test'),assert=require('node:assert/strict');
async function load(){return import('../supabase/functions/a1-assistant/ticketmaster.mjs');}
const fixture={id:'event-1',name:'Knicks vs Bulls',url:'https://www.ticketmaster.com/event/event-1',dates:{start:{localDate:'2026-12-01',localTime:'19:30:00'},timezone:'America/New_York',status:{code:'onsale'}},_embedded:{venues:[{name:'Madison Square Garden',city:{name:'New York'},state:{stateCode:'NY'}}]},priceRanges:[{min:150,max:600,currency:'USD',type:'standard'}]};
test('Discovery sends only bounded event filters to a fixed endpoint and strips all raw response metadata',async()=>{
 const {discoverEvents}=await load();let requested;
 const result=await discoverEvents({query:'Knicks',city:'New York',startDate:'2026-12-01',endDate:'2026-12-01',page:1,records:'private',url:'https://evil.invalid'},{env:()=> 'ticket-secret',now:()=>new Date('2026-11-04T19:00:00Z'),fetchImpl:async(url,options)=>{requested=new URL(url);assert.equal(options.redirect,'error');return new Response(JSON.stringify({_embedded:{events:[fixture]},page:{totalElements:15,totalPages:2},_links:{self:{href:url}},internal:'secret-metadata'}));}});
 assert.equal(requested.origin,'https://app.ticketmaster.com');assert.equal(requested.searchParams.get('localStartDateTime'),'2026-12-01T00:00:00,2026-12-01T23:59:59');assert.equal(requested.searchParams.get('apikey'),'ticket-secret');assert.equal(result.events[0].venue,'Madison Square Garden');assert.equal(result.events[0].priceRanges[0].min,150);assert.equal(result.hasMore,false);assert.doesNotMatch(JSON.stringify(result),/ticket-secret|private|secret-metadata/);
});
test('bad dates, reversed ranges, excessive paging and empty queries are rejected before external calls',async()=>{
 const {filters}=await load();for(const input of [{query:''},{query:'a',startDate:'2026-02-30'},{query:'a',startDate:'2026-99-01'},{query:'a',startDate:'2026-12-02',endDate:'2026-12-01'},{query:'a',page:100},{query:'a'.repeat(121)}])assert.throws(()=>filters(input));
});
test('TBA time and absent price are preserved rather than replaced with false data; unsafe links are omitted',async()=>{
 const {normalizeEvent}=await load();const e=normalizeEvent({...fixture,url:'javascript:alert(1)',priceRanges:undefined,dates:{start:{localTime:'03:30:00',dateTBA:true},status:{code:'postponed'}}});assert.equal(e.date,'');assert.equal(e.time,'');assert.deepEqual(e.priceRanges,[]);assert.equal(e.status,'postponed');assert.equal(e.url,'');
 const price=normalizeEvent({...fixture,priceRanges:[{min:null,max:100,currency:'USD'},{min:100,max:50,currency:'USD'}]});assert.deepEqual(price.priceRanges,[]);
});
test('upstream errors and timeouts do not reveal API URLs or keys',async()=>{
 const {discoverEvents}=await load();for(const status of [401,429,500])await assert.rejects(()=>discoverEvents({query:'Knicks'},{env:()=> 'ticket-secret',fetchImpl:async()=>new Response('{}',{status})}),error=>!/ticket-secret|https:/.test(error.message));await assert.rejects(()=>discoverEvents({query:'Knicks'},{env:()=> 'ticket-secret',fetchImpl:async()=>{throw new Error('https://example.invalid?apikey=ticket-secret');}}),/could not be reached/);
});

test('pasted whitespace is removed but embedded labels/quotes are rejected without exposing the saved value',async()=>{
 const {discoverEvents}=await load();let sent;
 await discoverEvents({query:'Knicks'},{env:()=> ' \n ticket-secret \r\n',fetchImpl:async url=>{sent=new URL(url).searchParams.get('apikey');return new Response('{}');}});assert.equal(sent,'ticket-secret');
 for(const key of ['TICKETMASTER_API_KEY=ticket-secret','"ticket-secret"','ticket secret'])await assert.rejects(()=>discoverEvents({query:'Knicks'},{env:()=>key,fetchImpl:async()=>{throw Error('should not call');}}),error=>/extra text/.test(error.message)&&!error.message.includes(key));
});
test('403 access refusal is distinguished from a recognized invalid-key fault without exposing provider text',async()=>{
 const {discoverEvents}=await load();
 await assert.rejects(()=>discoverEvents({query:'Knicks'},{env:()=> 'ticket-secret',fetchImpl:async()=>new Response('<html>private-provider-details ticket-secret</html>',{status:403})}),error=>/server request \(HTTP 403\)/.test(error.message)&&!/ticket-secret|private-provider/.test(error.message));
 await assert.rejects(()=>discoverEvents({query:'Knicks'},{env:()=> 'ticket-secret',fetchImpl:async()=>new Response(JSON.stringify({fault:{detail:{errorcode:'oauth.v2.InvalidApiKey'},faultstring:'ticket-secret'}}),{status:403})}),/authentication failed/);
 await assert.rejects(()=>discoverEvents({query:'Knicks'},{env:()=> 'ticket-secret',fetchImpl:async()=>new Response(JSON.stringify({fault:{detail:{errorcode:'oauth.v2.InvalidAPICallAsNoApiProductMatchFound'}}}),{status:403})}),/not authorized for the Discovery API/);
});

test('artist/location shorthand separates Florida and state abbreviations from performer keywords',async()=>{
 const {filters}=await load();
 for(const query of ['Olivia Rodrigo Florida','Olivia Rodrigo in Florida','Olivia Rodrigo FL']){const search=filters({query});assert.equal(search.query,'Olivia Rodrigo');assert.equal(search.stateCode,'FL');assert.equal(search.countryCode,'US');assert.equal(search.city,'');assert.equal(search.locationLabel,'Florida');}
 const cityField=filters({query:'Olivia Rodrigo',city:'Florida'});assert.equal(cityField.stateCode,'FL');assert.equal(cityField.city,'');
 const miami=filters({query:'Olivia Rodrigo Miami'});assert.equal(miami.query,'Olivia Rodrigo');assert.equal(miami.city,'Miami');
 const nyc=filters({query:'Knicks NYC'});assert.equal(nyc.query,'Knicks');assert.equal(nyc.city,'New York');
 assert.equal(filters({query:'Florida Georgia Line'}).query,'Florida Georgia Line');
});
test('Discovery sends an actual Florida state filter and explicit widening clears only the selected scope',async()=>{
 const {discoverEvents,filters}=await load();let requested;
 await discoverEvents({query:'Olivia Rodrigo Florida',anyDate:true},{env:()=> 'ticket-secret',fetchImpl:async url=>{requested=new URL(url);return new Response('{}');}});
 assert.equal(requested.searchParams.get('keyword'),'Olivia Rodrigo');assert.equal(requested.searchParams.get('stateCode'),'FL');assert.equal(requested.searchParams.get('countryCode'),'US');assert.equal(requested.searchParams.has('city'),false);
 const wide=filters({query:'Olivia Rodrigo',stateCode:'FL',countryCode:'US',anyLocation:true,startDate:'2027-03-01',endDate:'2027-03-31'});assert.equal(wide.stateCode,'');assert.equal(wide.startDate,'2027-03-01');
 const dates=filters({query:'Olivia Rodrigo',stateCode:'FL',startDate:'2027-03-01',anyDate:true});assert.equal(dates.stateCode,'FL');assert.equal(dates.startDate,'');
});
