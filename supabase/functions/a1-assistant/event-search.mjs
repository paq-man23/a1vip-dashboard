import {filters,discoverEvents} from './ticketmaster.mjs';
import {discoverSeatGeekEvents} from './seatgeek.mjs';
const normalized=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
function sameEvent(a,b){
 if(!a.date||!b.date||!a.time||!b.time||!a.venue||!b.venue||!a.city||!b.city)return false;
 if(a.date!==b.date||a.time.slice(0,5)!==b.time.slice(0,5)||normalized(a.venue)!==normalized(b.venue)||normalized(a.city)!==normalized(b.city))return false;
 if(a.country&&b.country&&a.country!==b.country||a.state&&b.state&&a.state!==b.state)return false;
 const titleA=normalized(a.name),titleB=normalized(b.name);
 if(titleA!==titleB&&/\b(?:vip|package|parking|upgrade|afterparty|meet and greet|insurance|merchandise)\b/.test(titleA+' '+titleB))return false;
 const artists=e=>(e.performers||[]).map(normalized).filter(Boolean).sort().join('|');
 return normalized(a.name)===normalized(b.name)||!!artists(a)&&artists(a)===artists(b);
}
export function mergeEvents(results){
 const merged=[];
 for(const result of results)for(const event of result.events){
  const offer={source:result.source,eventId:event.id,url:event.url||'',seatMapUrl:event.seatMapUrl||'',seatMapSource:event.seatMapSource||'',priceRanges:event.priceRanges||[],priceSummary:event.priceSummary||null,status:event.status||'',checkedAt:result.checkedAt};
  const match=merged.find(other=>!other.offers.some(o=>o.source===offer.source)&&sameEvent(other,event));
  if(match){match.offers.push(offer);if(!match.seatMapUrl&&offer.seatMapUrl){match.seatMapUrl=offer.seatMapUrl;match.seatMapSource=offer.seatMapSource;}}else merged.push({...event,offers:[offer]});
 }
 return merged.sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999')||(a.time||'99').localeCompare(b.time||'99')||a.name.localeCompare(b.name));
}
export async function searchEvents(input,options){
 const search=filters(input),names=['Ticketmaster Discovery','SeatGeek'];
 const settled=await Promise.allSettled([discoverEvents(search,options),discoverSeatGeekEvents(search,options)]);
 const success=[],providers=[];
 for(let i=0;i<settled.length;i++){
  const result=settled[i];
  if(result.status==='rejected'){providers.push({name:names[i],status:'error',message:result.reason?.message||'Provider search failed.'});continue;}
  if(!result.value.configured){providers.push({name:names[i],status:'not-configured',message:result.value.error});continue;}
  success.push(result.value);providers.push({name:names[i],status:'ok',total:result.value.total,hasMore:result.value.hasMore,checkedAt:result.value.checkedAt});
 }
 if(!success.length){
  const errors=providers.filter(p=>p.status==='error');if(errors.length)throw new Error(errors.map(p=>p.name+': '+p.message).join(' '));
  return {configured:false,error:'Connect Ticketmaster with TICKETMASTER_API_KEY or SeatGeek with SEATGEEK_CLIENT_ID in Supabase Edge Function secrets.',providers};
 }
 const events=mergeEvents(success);
 return {configured:true,source:success.map(s=>s.source).join(' + '),checkedAt:(options.now?.()||new Date()).toISOString(),search,events,total:events.length,totalIsPageCount:true,providers,hasMore:success.some(s=>s.hasMore)};
}
