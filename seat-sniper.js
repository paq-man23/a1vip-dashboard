/* Shared Seat Sniper workspace: A1 inventory and existing event-discovery APIs. */
(() => {
 const $=id=>document.getElementById(id),node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 let page=0,epoch=0,busy=false;
 function request(body){if(typeof A1Data.skyboxRequest!=='function')throw new Error('The dashboard update is incomplete. Click Refresh App, then reopen Seat Sniper / Skybox.');return A1Data.skyboxRequest(body);}
 function message(value){$('seatSniperMessage').textContent=value;}
 async function status(){
  $('skyboxConnectionPanel').hidden=!A1Data.isAdmin();if(!A1Data.isAdmin())return;
  try{const r=await request({action:'status'});if(!A1Data.authenticated())return;
   $('skyboxConnectionSummary').textContent=r.configured?`Skybox account ${r.accountId} · ${r.enabled?'Automatic sync enabled':'Paused'}${r.running?' · Sync running':''}`:'Skybox is not connected. Enter your Account ID and both tokens below.';
   const wrap=$('skyboxApiProgress');wrap.replaceChildren();
   for(const s of r.resources||[]){const card=node('div');card.className='invoice-history-card';card.append(node('strong',({customer:'Customers',vendor:'Vendors',invoice:'Invoices',purchase:'Purchase Orders',inventory:'Inventory'})[s.kind]),node('p',`Last completed: ${s.completed_at?new Date(s.completed_at).toLocaleString():'Not yet'} · Page ${s.page+1} · ${s.total??'—'} source records`),node('p',`${s.imported} added · ${s.updated} updated · ${s.conflicts} need review · ${s.errors} errors`));if(s.message)card.append(node('p',s.message));wrap.append(card);}
  }catch(error){$('skyboxConnectionSummary').textContent=error.message;}
 }
 async function configure(event){event.preventDefault();if(busy)return;busy=true;message('Checking Skybox access for all five record types…');
  const fields=['skyboxAccountId','skyboxApplicationToken','skyboxApiToken'];
  try{await request({action:'configure',accountId:$(fields[0]).value.trim(),applicationToken:$(fields[1]).value.trim(),apiToken:$(fields[2]).value.trim()});message('Connected. Automatic sync is enabled. Initial history imports continue in pages.');}
  catch(error){message(error.message);}finally{$(fields[1]).value='';$(fields[2]).value='';busy=false;await status();}
 }
 async function sync(){if(busy)return;busy=true;message('Syncing the next Skybox pages…');try{const r=await request({action:'sync'});message(r.results?.some(x=>x.error||x.errors)?'Some records could not sync. See each record type’s status below.':r.message);await inventory();}catch(error){message(error.message);}finally{busy=false;await status();}}
 async function pause(action='pause'){if(busy)return;try{await request({action});message(action==='resume'?'Automatic sync resumed.':'Automatic sync paused. Saved dashboard records remain available.');await status();}catch(error){message(error.message);}}
 async function inventory(reset=false){if(reset)page=0;const current=++epoch,wrap=$('seatSniperInventory');wrap.replaceChildren(node('p','Loading Skybox inventory…'));
  try{const r=await request({action:'inventory',query:$('seatSniperQuery').value,page});if(current!==epoch)return;wrap.replaceChildren();
   wrap.append(node('p',`${r.total} matching listings · Last full inventory refresh: ${r.completedAt?new Date(r.completedAt).toLocaleString():'Pending first sync'}. Availability can change; verify before quoting.`));
   if(!r.rows.length)wrap.append(node('p','No synced inventory matches. Connect Skybox or refine your search.'));
   for(const i of r.rows){const c=node('div');c.className='invoice-history-card';c.append(node('strong',i.eventName||'Skybox event '+i.eventId),node('p',[i.eventDate,i.venue,i.city,i.state].filter(Boolean).join(' · ')),node('p',`Section ${i.section||'—'} · Row ${i.row||'—'} · ${i.quantity} tickets · ${i.listPrice==null?'Price unavailable':i.listPrice.toLocaleString(undefined,{style:'currency',currency:i.currency||'USD'})+' per ticket'}`),node('p',`Skybox #${i.id} · ${i.status||'Status unavailable'} · Synced ${new Date(i.syncedAt).toLocaleString()}`));if(i.publicNotes)c.append(node('p',i.publicNotes));wrap.append(c);}
   for(const [label,delta] of [['Previous',-1],['Next',1]]){const b=node('button',label);b.className='btn';b.disabled=delta<0?page===0:(page+1)*50>=r.total;b.onclick=()=>{page+=delta;inventory();};wrap.append(b);}
  }catch(error){if(current===epoch)wrap.replaceChildren(node('p',error.message));}
 }
 async function events(event){event.preventDefault();const current=epoch,wrap=$('seatSniperEvents');wrap.replaceChildren(node('p','Searching Ticketmaster and SeatGeek…'));
  try{const response=await A1Data.assistantRequest({action:'events',query:$('seatSniperQuery').value,stateCode:$('seatSniperState').value.trim(),startDate:$('seatSniperFrom').value,endDate:$('seatSniperTo').value,page:0});if(current!==epoch)return;
   const r=response.events;wrap.replaceChildren();if(!r?.events?.length)wrap.append(node('p',r?.message||'No external events found. Try an artist/team and location.'));
   for(const provider of r?.providers||[])if(provider.status==='error'||provider.status==='unconfigured')wrap.append(node('p',provider.name+': '+provider.message));
   for(const e of r?.events||[]){const c=node('div');c.className='invoice-history-card';c.append(node('strong',e.name),node('p',[e.date,e.time,e.venue,e.city,e.state].filter(Boolean).join(' · ')));
    for(const o of e.offers||[]){if(!/^https:\/\//.test(o.url||''))continue;const link=node('a','Open '+o.source);link.className='btn';link.href=o.url;link.target='_blank';link.rel='noopener noreferrer';link.onclick=ev=>{if(A1Data.linkBlocked(o.url)){ev.preventDefault();message('This link is restricted by your administrator.');}};if(/ticketmaster\./i.test(new URL(o.url).hostname))link.onclick=ev=>{ev.preventDefault();if(A1Data.linkBlocked(o.url)){message('This link is restricted by your administrator.');return;}window.open(o.url,'_blank','popup=yes,width=1120,height=820,noopener,noreferrer');};c.append(link);}
    wrap.append(c);
   }
  }catch(error){if(current===epoch)wrap.replaceChildren(node('p',error.message));}
 }
 async function open(){await Promise.all([status(),inventory()]);}
 window.A1SeatSniper={open,status,configure,sync,pause,inventory,events};
 window.addEventListener('a1-signed-out',()=>{epoch++;page=0;for(const id of ['skyboxApplicationToken','skyboxApiToken','skyboxAccountId','seatSniperQuery'])$(id).value='';for(const id of ['seatSniperInventory','seatSniperEvents','skyboxApiProgress'])$(id).replaceChildren();message('');$('skyboxConnectionSummary').textContent='';});
})();
