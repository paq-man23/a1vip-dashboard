/* Seat Sniper searches outside ticket providers; Admin retains Skybox sync controls. */
(() => {
 const $=id=>document.getElementById(id),node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 let epoch=0,busy=false;
 function request(body){if(typeof A1Data.skyboxRequest!=='function')throw new Error('The dashboard update is incomplete. Click Refresh App, then reopen Admin.');return A1Data.skyboxRequest(body);}
 function message(value){$('seatSniperMessage').textContent=value;}
 function syncMessage(value){$('skyboxSyncMessage').textContent=value;}
 async function status(){
  $('skyboxConnectionPanel').hidden=!A1Data.isAdmin();if(!A1Data.isAdmin())return;
  try{const r=await request({action:'status'});if(!A1Data.authenticated())return;
   $('skyboxConnectionSummary').textContent=r.configured?`Skybox account ${r.accountId} · ${r.enabled?'Automatic sync enabled':'Paused'}${r.running?' · Sync running':''}`:'Skybox is not connected. Enter your Account ID and both tokens below.';
   const wrap=$('skyboxApiProgress');wrap.replaceChildren();
   for(const s of r.resources||[]){const card=node('div');card.className='invoice-history-card';card.append(node('strong',({customer:'Customers',vendor:'Vendors',invoice:'Invoices',purchase:'Purchase Orders',inventory:'Inventory'})[s.kind]),node('p',`Last completed: ${s.completed_at?new Date(s.completed_at).toLocaleString():'Not yet'} · Page ${s.page+1} · ${s.total??'—'} source records`),node('p',`${s.imported} added · ${s.updated} updated · ${s.conflicts} need review · ${s.errors} errors`));if(s.message)card.append(node('p',s.message));wrap.append(card);}
  }catch(error){$('skyboxConnectionSummary').textContent=error.message;}
 }
 async function configure(event){event.preventDefault();if(busy)return;busy=true;syncMessage('Checking Skybox access for all five record types…');
  const fields=['skyboxAccountId','skyboxApplicationToken','skyboxApiToken'];
  try{await request({action:'configure',accountId:$(fields[0]).value.trim(),applicationToken:$(fields[1]).value.trim(),apiToken:$(fields[2]).value.trim()});syncMessage('Connected. Automatic sync is enabled. Initial history imports continue in pages.');}
  catch(error){syncMessage(error.message);}finally{$(fields[1]).value='';$(fields[2]).value='';busy=false;await status();}
 }
 async function sync(){if(busy)return;busy=true;syncMessage('Syncing the next Skybox pages…');try{const r=await request({action:'sync'});syncMessage(r.results?.some(x=>x.error||x.errors)?'Some records could not sync. See each record type’s status below.':r.message);}catch(error){syncMessage(error.message);}finally{busy=false;await status();}}
 async function pause(action='pause'){if(busy)return;try{await request({action});syncMessage(action==='resume'?'Automatic sync resumed.':'Automatic sync paused. Saved dashboard records remain available.');await status();}catch(error){syncMessage(error.message);}}
 async function events(event){event.preventDefault();const query=$('seatSniperQuery').value.trim();if(!query){message('Enter an artist, team, or event to search.');return;}message('');const current=++epoch,wrap=$('seatSniperEvents');wrap.replaceChildren(node('p','Searching Ticketmaster and SeatGeek…'));
  try{const response=await A1Data.assistantRequest({action:'events',query,stateCode:$('seatSniperState').value.trim(),startDate:$('seatSniperFrom').value,endDate:$('seatSniperTo').value,page:0});if(current!==epoch)return;
   const r=response.events;wrap.replaceChildren();if(!r?.events?.length)wrap.append(node('p',r?.message||'No external events found. Try an artist/team and location.'));
   for(const provider of r?.providers||[])if(provider.status==='error'||provider.status==='unconfigured')wrap.append(node('p',provider.name+': '+provider.message));
   for(const e of r?.events||[]){const c=node('div');c.className='invoice-history-card';c.append(node('strong',e.name),node('p',[e.date,e.time,e.venue,e.city,e.state].filter(Boolean).join(' · ')));
    for(const o of e.offers||[]){if(!/^https:\/\//.test(o.url||''))continue;const link=node('a','Open '+o.source);link.className='btn';link.href=o.url;link.target='_blank';link.rel='noopener noreferrer';link.onclick=ev=>{if(A1Data.linkBlocked(o.url)){ev.preventDefault();message('This link is restricted by your administrator.');}};if(/ticketmaster\./i.test(new URL(o.url).hostname))link.onclick=ev=>{ev.preventDefault();if(A1Data.linkBlocked(o.url)){message('This link is restricted by your administrator.');return;}window.open(o.url,'_blank','popup=yes,width=1120,height=820,noopener,noreferrer');};c.append(link);}
    wrap.append(c);
   }
  }catch(error){if(current===epoch)wrap.replaceChildren(node('p',error.message));}
 }
 function clearSearch(){epoch++;$('seatSniperSearch').reset();$('seatSniperEvents').replaceChildren(node('p','Enter an artist, team, or event to search Ticketmaster and SeatGeek.'));message('');}
 async function open(){/* Search only on explicit submission. */}
 window.A1SeatSniper={open,status,configure,sync,pause,events,clearSearch};
 window.addEventListener('a1-signed-out',()=>{epoch++;for(const id of ['skyboxApplicationToken','skyboxApiToken','skyboxAccountId','seatSniperQuery'])$(id).value='';for(const id of ['seatSniperEvents','skyboxApiProgress'])$(id).replaceChildren();message('');syncMessage('');$('skyboxConnectionSummary').textContent='';});
})();
