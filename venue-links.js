/* Verified hosted venue maps and public ticket-comparison links. No API keys. */
(function(root){
 const normalize=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 const directory=[
  {names:['Hard Rock Stadium'],state:'FL',maps:[{label:'Interactive venue map · Football',url:'https://miamidolphins.io-media.com/web/index.html',source:'Miami Dolphins',layout:'Football',verifiedFrom:'https://www.miamidolphins.com/tickets/'}]},
  {names:['Madison Square Garden'],state:'NY',maps:[{label:'Interactive venue map · Basketball',url:'https://www.msg.com/madison-square-garden/seating/msg-knicks',source:'MSG',layout:'Basketball',verifiedFrom:'https://www.msg.com/madison-square-garden/seating/msg-knicks'},{label:'Interactive venue map · Hockey',url:'https://www.msg.com/madison-square-garden/seating/msg-rangers',source:'MSG',layout:'Hockey',verifiedFrom:'https://www.msg.com/madison-square-garden/seating/msg-rangers'}]},
  {names:['Yankee Stadium'],state:'NY',maps:[{label:'Interactive venue map · Baseball',url:'https://yankees.io-media.com/',source:'New York Yankees',layout:'Baseball',verifiedFrom:'https://www.mlb.com/yankees/tickets/season-tickets/holders'}]},
  {names:['Citi Field'],state:'NY',maps:[{label:'Interactive venue map · Baseball',url:'https://mlb.venues.3ddigitalvenue.com/newyork-mets',source:'3D Digital Venue',layout:'Baseball',verifiedFrom:'https://mlb.venues.3ddigitalvenue.com/newyork-mets'}]}
 ];
 const tmHosts=['ticketmaster.com','ticketmaster.ca','ticketmaster.co.uk','ticketmaster.ie','ticketmaster.de','ticketmaster.fr','ticketmaster.es','ticketmaster.nl','ticketmaster.se','ticketmaster.no','ticketmaster.dk','ticketmaster.fi','ticketmaster.be','ticketmaster.at','ticketmaster.ch','ticketmaster.com.au','ticketmaster.co.nz','ticketmaster.com.mx'];
 function safeProviderUrl(value,provider){try{const u=new URL(value),hosts=provider==='SeatGeek'?['seatgeek.com']:tmHosts;if(u.protocol!=='https:'||u.username||u.password||!hosts.some(h=>u.hostname===h||u.hostname.endsWith('.'+h))||[...u.searchParams.keys()].some(k=>/api[_-]?key|secret|token|client[_-]?id|password/i.test(k)))return null;return u.href;}catch{return null;}}
 function mapsFor(event={}){
  const venue=typeof event.venue==='object'&&event.venue?event.venue:{name:event.venue||event.venueName||'',state:event.state};
  const found=directory.find(v=>v.names.some(n=>normalize(n)===normalize(venue.name))&&(!venue.state||normalize(venue.state)===normalize(v.state)));
  return found?found.maps.map(m=>({...m})):[];
 }
 function comparisonsFor(event={}){
  const query=String(event.name||event.eventName||(typeof event.venue==='string'?event.venue:event.venue?.name)||'').trim().slice(0,200);
  const offers=[...(event.offers||[]),{url:event.url}];
  return ['Ticketmaster','SeatGeek'].map(provider=>{
   const direct=offers.map(o=>safeProviderUrl(o.url,provider)).find(Boolean);
   const search=new URL(provider==='Ticketmaster'?'https://www.ticketmaster.com/search':'https://seatgeek.com/search');search.searchParams.set(provider==='Ticketmaster'?'q':'search',query);
   return {provider,label:provider+' tickets & map',url:direct||search.href,scope:direct?'event':'search'};
  });
 }
 const api={mapsFor,comparisonsFor};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.A1VenueLinks=api;
})(typeof window!=='undefined'?window:this);
