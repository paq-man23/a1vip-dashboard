const {test}=require('node:test'),assert=require('node:assert/strict');
const {mapsFor,comparisonsFor}=require('../venue-links.js');
test('venue map directory uses exact venue identity and labels each layout',()=>{
 assert.match(mapsFor({venue:{name:'Hard Rock Stadium',state:'FL'}})[0].url,/miamidolphins\.io-media\.com/);
 assert.equal(mapsFor({venue:'Madison Square Garden',state:'NY'}).length,2);assert.equal(mapsFor({venue:'Yankee Stadium'})[0].layout,'Baseball');assert.equal(mapsFor({venue:'Citi Field'})[0].source,'3D Digital Venue');
 assert.deepEqual(mapsFor({venue:'Unknown stadium'}),[]);assert.deepEqual(mapsFor({venue:{name:'Hard Rock Stadium',state:'NY'}}),[]);assert.deepEqual(mapsFor({venue:'Madison Square Garden Theater'}),[]);
});
test('comparison links prefer direct provider events and encode public searches when no event match exists',()=>{
 const event={name:'Dolphins & Bills',offers:[{source:'Ticketmaster Discovery',url:'https://www.ticketmaster.com/event/fixture'},{source:'SeatGeek',url:'https://seatgeek.com/fixture'}]};const links=comparisonsFor(event);assert.deepEqual(links.map(x=>x.scope),['event','event']);assert.equal(links[1].url,event.offers[1].url);
 const search=comparisonsFor({name:'Dolphins & Bills'});assert.equal(new URL(search[0].url).searchParams.get('q'),'Dolphins & Bills');assert.equal(new URL(search[1].url).searchParams.get('search'),'Dolphins & Bills');assert.deepEqual(search.map(x=>x.scope),['search','search']);
});
test('unsafe provider destinations and embedded credentials cannot become direct comparison links',()=>{
 for(const url of ['javascript:alert(1)','https://seatgeek.com.evil.invalid/fixture','https://secret@seatgeek.com/fixture','https://seatgeek.com/fixture?client_id=secret','https://www.ticketmaster.com/event/fixture?api_key=secret']){const links=comparisonsFor({name:'Fixture',offers:[{url}]});assert.ok(links.every(x=>x.scope==='search'));assert.ok(links.every(x=>!x.url.includes('secret')));}
});
