import {filters} from './ticketmaster.mjs';
const text=(v,max=200)=>typeof v==='string'?v.slice(0,max):'';
const amount=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
function publicUrl(value){try{const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||!(u.hostname==='seatgeek.com'||u.hostname.endsWith('.seatgeek.com'))||[...u.searchParams.keys()].some(k=>/secret|token|client_id/i.test(k)))return '';u.protocol='https:';return u.href;}catch{return '';}}
export function normalizeSeatGeekEvent(event){
 const venue=event.venue||{},local=text(event.datetime_local,40),validDate=/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}/.test(local),dateTBA=!!event.date_tbd||!!event.datetime_tbd,timeTBA=!!event.time_tbd||dateTBA;
 const stats=event.stats||{},count=Number.isSafeInteger(stats.listing_count)&&stats.listing_count>=0?stats.listing_count:null;
 const currency=text(event.currency||stats.currency,3).toUpperCase();
 return {id:String(event.id??'').slice(0,80),name:text(event.title||event.short_title),url:publicUrl(event.url),date:dateTBA||!validDate?'':local.slice(0,10),time:timeTBA||!validDate?'':local.slice(11,19),dateTBA,timeTBA,timezone:text(venue.timezone,80),status:event.is_cancelled?'cancelled':'',venue:text(venue.name),city:text(venue.city,80),state:text(venue.state,10),country:text(venue.country,2),performers:(Array.isArray(event.performers)?event.performers:[]).slice(0,12).map(p=>text(p.name)).filter(Boolean),priceRanges:[],priceSummary:{lowest:count===0?null:amount(stats.lowest_price),average:count===0?null:amount(stats.average_price),highest:count===0?null:amount(stats.highest_price),currency:/^[A-Z]{3}$/.test(currency)?currency:'',listingCount:count}};
}
export async function discoverSeatGeekEvents(input,{env,fetchImpl=fetch,now=()=>new Date()}){
 const search=filters(input),id=String(env('SEATGEEK_CLIENT_ID')||'').trim(),secret=String(env('SEATGEEK_CLIENT_SECRET')||'').trim();
 if(!id)return {configured:false,source:'SeatGeek',error:'SeatGeek is not connected. Add SEATGEEK_CLIENT_ID in Supabase Edge Function secrets.'};
 if(!/^[\x21-\x7e]+$/.test(id)||id.includes(':')||!/^([\x21-\x7e]*)$/.test(secret))throw new Error('SeatGeek credentials contain extra formatting. Paste only the developer credential values.');
 const url=new URL('https://api.seatgeek.com/2/events');
 for(const [k,v] of Object.entries({q:search.query,per_page:'10',page:String(search.page+1),sort:'datetime_local.asc'}))url.searchParams.set(k,v);
 if(search.city)url.searchParams.set('venue.city',search.city);
 if(search.stateCode)url.searchParams.set('venue.state',search.stateCode);
 if(search.countryCode)url.searchParams.set('venue.country',search.countryCode);
 if(search.startDate)url.searchParams.set('datetime_local.gte',search.startDate+'T00:00:00');
 if(search.endDate)url.searchParams.set('datetime_local.lte',search.endDate+'T23:59:59');
 if(!search.startDate&&!search.endDate)url.searchParams.set('datetime_utc.gte',now().toISOString().replace(/\.\d{3}Z$/,'Z'));
 let response;try{response=await fetchImpl(url.href,{headers:{Accept:'application/json',Authorization:'Basic '+btoa(id+':'+secret)},signal:AbortSignal.timeout(12000),redirect:'error'});}catch{throw new Error('SeatGeek could not be reached. Please try again shortly.');}
 if(!response.ok)throw new Error(response.status===401||response.status===403?'SeatGeek refused API access. Check the developer credentials and API access granted to your app.':response.status===429?'SeatGeek’s request limit has been reached. Please try again later.':'SeatGeek event search is temporarily unavailable.');
 let body;try{body=await response.json();}catch{throw new Error('SeatGeek returned an unreadable response.');}
 if(!body||!Array.isArray(body.events))throw new Error('SeatGeek returned an unexpected response.');
 const total=Number.isSafeInteger(body.meta?.total)&&body.meta.total>=0?body.meta.total:body.events.length;
 return {configured:true,source:'SeatGeek',checkedAt:now().toISOString(),search,events:body.events.slice(0,10).map(normalizeSeatGeekEvent),total,hasMore:search.page<99&&(search.page+1)*10<total};
}
