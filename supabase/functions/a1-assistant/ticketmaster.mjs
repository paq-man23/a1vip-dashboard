// Public event discovery only. No purchases, account data or live seat inventory.
const safeText=(value,max=200)=>typeof value==='string'?value.slice(0,max):'';
const usStates={AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming'};
const cities={nyc:'New York','new york city':'New York',miami:'Miami',orlando:'Orlando',tampa:'Tampa','fort lauderdale':'Fort Lauderdale',jacksonville:'Jacksonville','west palm beach':'West Palm Beach','boca raton':'Boca Raton',tallahassee:'Tallahassee',boston:'Boston',chicago:'Chicago','las vegas':'Las Vegas','los angeles':'Los Angeles',atlanta:'Atlanta',dallas:'Dallas',austin:'Austin'};
const stateCode=value=>Object.keys(usStates).find(code=>code===value.toUpperCase()||usStates[code].toLowerCase()===value.toLowerCase())||'';
export function locationOnly(value){
 const clean=safeText(value).trim().replace(/^(?:in|near|around)\s+/i,'').replace(/\s+(?:instead|please)$/i,'').trim();
 const state=stateCode(clean);if(state&&clean.toLowerCase()!=='new york')return {city:'',stateCode:state,countryCode:'US'};
 const city=cities[clean.toLowerCase()]||(clean.toLowerCase()==='new york'?'New York':'');
 return city?{city,stateCode:'',countryCode:''}:null;
}
function splitLocation(query){
 const suffixes=[...Object.values(usStates),...Object.keys(cities)].sort((a,b)=>b.length-a.length);
 for(const suffix of suffixes){if(query.toLowerCase().endsWith(' '+suffix.toLowerCase())){const rest=query.slice(0,-suffix.length).replace(/(?:\s+in|\s+near|,)\s*$/i,'').trim();if(rest)return {query:rest,...(locationOnly(suffix)||{})};}}
 const short=query.match(/^(.+?)(?:\s+in\s+|,\s*|\s+)([A-Z]{2})$/);if(short&&usStates[short[2]])return {query:short[1].trim(),city:'',stateCode:short[2],countryCode:'US'};
 return {query};
}
function date(value){
 if(!value)return '';if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(value)||(!Number.isFinite(new Date(value+'T00:00:00Z').valueOf())||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value))throw new Error('Use a valid event date in YYYY-MM-DD format.');return value;
}
export function filters(input){
 if(!input||typeof input!=='object')throw new Error('Enter an artist, team, event or venue to search.');
 const rawQuery=safeText(input.query,121).trim(),rawCity=safeText(input.city,81).trim();
 if(!rawQuery||rawQuery.length>120||rawCity.length>80)throw new Error('Enter an event search of 120 characters or fewer.');
 const split=splitLocation(rawQuery);
 const query=split.query;
 let city=rawCity||split.city||'',state=safeText(input.stateCode,50).trim()||split.stateCode||'',country=safeText(input.countryCode,3).trim().toUpperCase()||split.countryCode||'';
 const cityLocation=locationOnly(city);if(cityLocation?.stateCode){state=state||cityLocation.stateCode;country=country||cityLocation.countryCode;city='';}else if(cityLocation?.city)city=cityLocation.city;
 if(state){state=stateCode(state)||state.toUpperCase();if(!/^[A-Z]{2}$/.test(state))throw new Error('Choose a valid two-letter state or province code.');if(!country&&usStates[state])country='US';}
 if(country&&!/^[A-Z]{2}$/.test(country))throw new Error('Choose a valid two-letter country code.');
 const anyLocation=input.anyLocation===true;if(anyLocation){city='';state='';country='';}
 const startDate=input.anyDate===true?'':date(input.startDate),endDate=input.anyDate===true?'':date(input.endDate),page=input.page??0;
 if(startDate&&endDate&&startDate>endDate)throw new Error('The end date must be on or after the start date.');
 if(!Number.isInteger(page)||page<0||page>99)throw new Error('Narrow your search by date or city to see more events.');
 const locationLabel=[city,(country==='US'?usStates[state]:state)||state,country&&country!=='US'?country:''].filter(Boolean).join(', ');
 return {query,city,stateCode:state,countryCode:country,startDate,endDate,page,anyDate:input.anyDate===true,anyLocation,locationLabel};
}
function publicUrl(value){try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return '';const hosts=['ticketmaster.com','ticketmaster.ca','ticketmaster.co.uk','ticketmaster.ie','ticketmaster.de','ticketmaster.fr','ticketmaster.es','ticketmaster.nl','ticketmaster.se','ticketmaster.no','ticketmaster.dk','ticketmaster.fi','ticketmaster.be','ticketmaster.at','ticketmaster.ch','ticketmaster.com.au','ticketmaster.co.nz','ticketmaster.com.mx','livenation.com','ticketweb.com','universe.com','frontgatetickets.com'];if(!hosts.some(host=>url.hostname===host||url.hostname.endsWith('.'+host)))return '';if([...url.searchParams.keys()].some(k=>/apikey|secret|token/i.test(k)))return '';url.protocol='https:';return url.href;}catch{return '';}}
export function normalizeEvent(event){
 const venue=event._embedded?.venues?.[0]||{},start=event.dates?.start||{};
 const ranges=(Array.isArray(event.priceRanges)?event.priceRanges:[]).filter(p=>Number.isFinite(p.min)&&Number.isFinite(p.max)&&p.min>=0&&p.max>=p.min&&/^[A-Z]{3}$/.test(p.currency)).slice(0,3).map(p=>({min:p.min,max:p.max,currency:p.currency,type:safeText(p.type,40)}));
 return {id:safeText(event.id,80),name:safeText(event.name),url:publicUrl(event.url),date:start.dateTBA||start.dateTBD?'':safeText(start.localDate,10),time:start.timeTBA||start.noSpecificTime||start.dateTBA||start.dateTBD?'':safeText(start.localTime,8),dateTBA:!!(start.dateTBA||start.dateTBD),timeTBA:!!(start.timeTBA||start.noSpecificTime),timezone:safeText(event.dates?.timezone||venue.timezone,80),status:safeText(event.dates?.status?.code,30),venue:safeText(venue.name),city:safeText(venue.city?.name,80),state:safeText(venue.state?.stateCode,10),priceRanges:ranges};
}
export async function discoverEvents(input,{env,fetchImpl=fetch,now=()=>new Date()}){
 const search=filters(input),key=String(env('TICKETMASTER_API_KEY')||'').trim();
 if(!key)return {configured:false,error:'Ticketmaster Discovery is not configured. An administrator needs to add TICKETMASTER_API_KEY in Supabase Edge Function secrets.'};
 if(/[\s\"']/.test(key)||key.includes('=')||key.includes('://'))throw new Error('The saved Ticketmaster key contains extra text or formatting. Replace TICKETMASTER_API_KEY with only the Consumer Key value from Ticketmaster.');
 const url=new URL('https://app.ticketmaster.com/discovery/v2/events.json');
 for(const [k,v] of Object.entries({apikey:key,keyword:search.query,size:'10',page:String(search.page),sort:'date,asc',includeTest:'no'}))url.searchParams.set(k,v);
 if(search.city)url.searchParams.set('city',search.city);
 if(search.stateCode)url.searchParams.set('stateCode',search.stateCode);
 if(search.countryCode)url.searchParams.set('countryCode',search.countryCode);
 if(search.startDate||search.endDate)url.searchParams.set('localStartDateTime',(search.startDate||'2000-01-01')+'T00:00:00,'+(search.endDate||'2099-12-31')+'T23:59:59');
 else url.searchParams.set('startDateTime',now().toISOString().replace(/\.\d{3}Z$/,'Z'));
 let response;try{response=await fetchImpl(url.href,{signal:AbortSignal.timeout(12000),headers:{Accept:'application/json'},redirect:'error'});}catch{throw new Error('Ticketmaster could not be reached. Please try again shortly.');}
 if(!response.ok){
  // Classify only recognized provider faults. Never echo raw bodies, URLs or credentials.
  let invalidKey=false,productAccess=false;
  try{const body=await response.json(),code=body?.fault?.detail?.errorcode;invalidKey=code==='oauth.v2.InvalidApiKey'||code==='oauth.v2.FailedToResolveAPIKey';productAccess=code==='oauth.v2.InvalidAPICallAsNoApiProductMatchFound';}catch{}
  if(invalidKey||response.status===401)throw new Error('Ticketmaster authentication failed (HTTP '+response.status+'). Replace the Supabase TICKETMASTER_API_KEY value with the Consumer Key, not the Consumer Secret, then retry.');
  if(productAccess)throw new Error('Ticketmaster says this key is not authorized for the Discovery API (HTTP '+response.status+'). Confirm Public APIs are enabled for this exact developer app.');
  if(response.status===403)throw new Error('Ticketmaster refused the server request (HTTP 403). This does not confirm the key is invalid. Test the same Consumer Key in Ticketmaster’s API Explorer to distinguish key access from a server restriction.');
  throw new Error(response.status===429?'Ticketmaster’s request limit has been reached. Please try again later.':'Ticketmaster event search is temporarily unavailable (HTTP '+response.status+').');
 }
 let body;try{body=await response.json();}catch{throw new Error('Ticketmaster returned an unreadable response. Please try again.');}
 if(!body||typeof body!=='object')throw new Error('Ticketmaster returned an unreadable response. Please try again.');
 const events=(Array.isArray(body._embedded?.events)?body._embedded.events:[]).slice(0,10).map(normalizeEvent);
 return {configured:true,source:'Ticketmaster Discovery',checkedAt:now().toISOString(),search,events,total:Number.isSafeInteger(body.page?.totalElements)?body.page.totalElements:events.length,hasMore:search.page<99&&Number.isSafeInteger(body.page?.totalPages)&&search.page+1<body.page.totalPages};
}
