/* Internal season-ticket holder directory. Records are persisted in Supabase, never localStorage. */
(function(root){
 const fields=[['holderName','Holder name','text',true],['company','Company'],['email','Email','email'],['phone','Phone','tel'],['preferredContact','Preferred contact',['','Email','Phone','Text']],['venue','Venue / arena','text',true],['team','Team / artist'],['event','Event / series'],['city','City'],['state','State / region'],['season','Season / year'],['ticketType','Ticket type',['Standard','Premium','Suite','Parking']],['section','Section / suite'],['row','Row'],['seats','Seat numbers'],['quantity','Number of tickets','number'],['status','Willingness to sell',['Ask first','Open to offers','Not selling','Archived']],['lastContact','Last contacted','date'],['nextFollowUp','Next follow-up','date'],['notes','Notes','textarea']];
 const normalize=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 function filter(rows,query='',status='active',type=''){
  const terms=normalize(query).split(/\s+/).filter(Boolean);
  return rows.filter(r=>{const d=r.document;return (status==='all'||status==='active'&&d.status!=='Archived'||d.status===status)&&(!type||d.ticketType===type)&&terms.every(t=>normalize(fields.map(([key])=>d[key]).join(' ')).includes(t));}).sort((a,b)=>String(a.document.holderName).localeCompare(String(b.document.holderName),undefined,{sensitivity:'base'})||String(a.id).localeCompare(String(b.id)));
 }
 function validate(d){
  if(!d.holderName?.trim()||!d.venue?.trim())throw Error('Enter the holder name and venue.');
  if(!d.team?.trim()&&!d.event?.trim())throw Error('Enter a team, artist, event, or series.');
  if(!d.email?.trim()&&!d.phone?.trim())throw Error('Enter a phone number or email so you can reach this holder.');
  if(d.quantity&&!/^[1-9][0-9]{0,4}$/.test(d.quantity))throw Error('Number of tickets must be a whole number between 1 and 99999.');
  return d;
 }
 const api={filter,validate};if(typeof module!=='undefined'&&module.exports){module.exports=api;return;}
 const $=id=>document.getElementById(id),el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 let rows=[],epoch=0,owner=null,page=1,size=25,query='',status='active',type='',dirty=false,saving=false,loading=false;
 const allowed=()=>A1Data.authenticated()&&A1Data.canAccess('seasonTickets');
 const current=t=>t===epoch&&allowed()&&owner===A1Data.account()?.email;
 function button(text,fn,cls='btn'){const b=el('button',text,cls);b.type='button';b.onclick=fn;return b;}
 function clear(){epoch++;rows=[];owner=null;dirty=false;saving=false;query='';status='active';type='';page=1;const dialog=$('seasonHolderDialog');if(dialog?.open)dialog.close();dialog?.remove();$('seasonTickets')?.replaceChildren();}
 function mayLeave(){return !dirty||confirm('Discard unsaved ticket-holder changes?');}
 function build(){
  const target=$('seasonTickets');target.replaceChildren();const shell=el('div',undefined,'season-shell');
  const header=el('div',undefined,'season-heading');const text=el('div');text.append(el('span','YOUR HOLDER NETWORK','season-eyebrow'),el('h2','Season Tickets'),el('p','Find the right holder when you need tickets for a team, venue, or event.'));header.append(text,button('+ Add ticket holder',()=>edit(), 'btn season-primary'));shell.append(header);
  const toolbar=el('form',undefined,'season-toolbar');toolbar.id='seasonSearchForm';
  const label=el('label','Search holders'),search=el('input');search.type='search';search.name='query';search.value=query;search.placeholder='Team, venue, name, event, city, or seats';search.maxLength=200;label.append(search);toolbar.append(label);
  const stateLabel=el('label','Availability'),state=el('select');state.name='status';for(const [value,label]of [['active','All active holders'],['Open to offers','Open to offers'],['Ask first','Ask first'],['Not selling','Not selling'],['Archived','Archived'],['all','All including archived']])state.append(new Option(label,value));state.value=status;stateLabel.append(state);toolbar.append(stateLabel);
  const typeLabel=el('label','Ticket type'),types=el('select');types.name='ticketType';for(const value of ['','Standard','Premium','Suite','Parking'])types.append(new Option(value||'All ticket types',value));types.value=type;typeLabel.append(types);toolbar.append(typeLabel);
  toolbar.append(button('Search',()=>toolbar.requestSubmit(),'btn season-primary'),button('Clear',()=>{query='';status='active';type='';page=1;search.value='';state.value=status;types.value='';render();}),button('Refresh',()=>open()));
  toolbar.onsubmit=e=>{e.preventDefault();query=search.value;status=state.value;type=types.value;page=1;render();};
  search.oninput=()=>{query=search.value;page=1;render();};for(const n of [state,types])n.onchange=()=>{status=state.value;type=types.value;page=1;render();};shell.append(toolbar);
  const message=el('p','','season-message');message.id='seasonMessage';message.setAttribute('role','status');shell.append(message);
  const summary=el('div',undefined,'season-summary');summary.id='seasonSummary';shell.append(summary);
  const list=el('div',undefined,'season-cards');list.id='seasonHolderList';shell.append(list);
  const pager=el('div',undefined,'season-pager');pager.id='seasonPages';shell.append(pager);target.append(shell);
 }
 async function open(){
  if(!allowed()||saving||!mayLeave())return;dirty=false;loading=true;const token=++epoch;owner=A1Data.account()?.email;build();$('seasonMessage').textContent='Loading ticket holders…';
  try{const result=await A1Data.fetchSeasonHolders();if(!current(token))return;rows=result;render();$('seasonMessage').textContent='Shared ticket-holder directory · Saved to your dashboard.';}
  catch(e){if(current(token))$('seasonMessage').textContent='Could not load ticket holders: '+e.message;}finally{if(current(token))loading=false;}
 }
 function render(){
  if(!allowed()||!$('seasonHolderList'))return;const matching=filter(rows,query,status,type),pages=Math.max(1,Math.ceil(matching.length/size));page=Math.min(page,pages);
  const summary=$('seasonSummary');summary.replaceChildren(el('strong',matching.length+' matching holdings'),el('span',new Set(matching.map(r=>normalize(r.document.venue))).size+' venues'),el('span',matching.filter(r=>r.document.status==='Open to offers').length+' open to offers'));
  const list=$('seasonHolderList');list.replaceChildren();
  if(!matching.length){const empty=el('div',undefined,'season-empty');empty.append(el('h3',rows.length?'No matching holders':'Build your season-ticket network'),el('p',rows.length?'Try a different team, venue, name, or availability filter.':'Add a holder and their tickets so you can find them when an opportunity comes up.'));if(!rows.length)empty.append(button('Add your first ticket holder',()=>edit(),'btn season-primary'));list.append(empty);}
  for(const row of matching.slice((page-1)*size,page*size)){
   const d=row.document,card=el('article',undefined,'season-card');card.dataset.holderId=row.id;const top=el('div',undefined,'season-card-top');top.append(el('h3',d.holderName),el('span',d.status,'season-status'+(d.status==='Open to offers'?' is-open':'')));card.append(top,el('p',d.company||'Season-ticket holder','season-muted'),el('h4',d.venue),el('p',[d.team,d.event].filter(Boolean).join(' · ')),el('p',[d.city,d.state,d.season].filter(Boolean).join(' · '),'season-muted'));
   const seats=el('div',undefined,'season-seats');for(const [name,value]of [['Type',d.ticketType],['Section',d.section],['Row',d.row],['Seats',d.seats],['Tickets',d.quantity]])if(value){const item=el('div');item.append(el('small',name),el('strong',value));seats.append(item);}card.append(seats);
   if(d.phone)card.append(el('p',d.phone,'season-contact'));if(d.email)card.append(el('p',d.email,'season-contact'));
   if(d.preferredContact)card.append(el('small','Prefers '+d.preferredContact,'season-muted'));
   if(d.nextFollowUp)card.append(el('p','Follow up: '+d.nextFollowUp,'season-followup'));if(d.lastContact)card.append(el('small','Last contacted: '+d.lastContact,'season-muted'));
   if(d.notes)card.append(el('p',d.notes,'season-notes'));
   const actions=el('div',undefined,'season-card-actions');actions.append(button('View / Edit holder',()=>edit(row),'btn season-primary'));
   if(d.phone){const a=el('a','Call','btn');a.href='tel:'+d.phone.replace(/[^+0-9*#,;]/g,'');actions.append(a);}if(d.email){const a=el('a','Email','btn');a.href='mailto:'+encodeURIComponent(d.email);actions.append(a);}card.append(actions);list.append(card);
  }
  const pager=$('seasonPages');pager.replaceChildren(el('span',`Page ${page} of ${pages} · ${matching.length} holdings`));
  const prev=button('Previous',()=>{page--;render();}),next=button('Next',()=>{page++;render();});prev.disabled=page<=1;next.disabled=page>=pages;pager.append(prev,next);
  const label=el('label','Rows per page'),select=el('select');select.setAttribute('aria-label','Season ticket rows per page');for(const n of [10,25,50,100])select.append(new Option(String(n),String(n)));select.value=String(size);select.onchange=()=>{size=Number(select.value);page=1;render();};label.append(select);pager.append(label);
 }
 function edit(record){
  if(!allowed()||loading||saving||!mayLeave())return;dirty=false;const token=epoch;const original=record?.document||{status:'Ask first',ticketType:'Standard'},id=record?.id||crypto.randomUUID(),version=record?.version||0;
  $('seasonHolderDialog')?.remove();const dialog=el('dialog',undefined,'season-dialog');dialog.id='seasonHolderDialog';dialog.setAttribute('aria-labelledby','seasonHolderTitle');
  const heading=el('div',undefined,'season-dialog-heading'),title=el('h2',record?'Edit ticket holder':'Add ticket holder');title.id='seasonHolderTitle';heading.append(title,button('×',()=>{if(!saving&&mayLeave()){dirty=false;dialog.close();}}));heading.lastChild.setAttribute('aria-label','Close holder form');dialog.append(heading,el('p','One entry per ticket holding. Add another entry for a different venue, season, or seat location.','season-muted'));
  const form=el('form',undefined,'season-form');form.id='seasonHolderForm';
  for(const [key,text,type='text',required=false]of fields){const label=el('label',text+(required?' *':'')),input=el(Array.isArray(type)?'select':type==='textarea'?'textarea':'input');input.name=key;
   if(Array.isArray(type))for(const v of type)input.append(new Option(v||'No preference',v));else if(type!=='textarea')input.type=type;
   input.value=original[key]||'';input.required=required;input.maxLength=key==='notes'?5000:500;if(type==='number'){input.min='1';input.max='99999';input.step='1';}if(type==='textarea'){label.className='season-wide';input.rows=3;}label.append(input);form.append(label);
  }
  const hint=el('p','Include a team or event and at least one phone number or email. Saving this form does not contact the holder.','season-wide season-muted');form.append(hint);
  const message=el('p','','season-wide season-message');message.setAttribute('role','status');form.append(message);
  const footer=el('div',undefined,'season-wide season-form-actions'),save=el('button','Save ticket holder','btn season-primary');save.type='submit';footer.append(save,button('Cancel',()=>{if(!saving&&mayLeave()){dirty=false;dialog.close();}}));form.append(footer);dialog.append(form);document.body.append(dialog);
  form.oninput=()=>{dirty=true;};dialog.addEventListener('cancel',event=>{if(saving||!mayLeave())event.preventDefault();else dirty=false;});
  form.onsubmit=async event=>{
   event.preventDefault();if(saving||!current(token)||!form.reportValidity())return;
   try{const values=validate(Object.fromEntries(fields.map(([key])=>[key,form.elements.namedItem(key).value.trim()])));saving=true;save.disabled=true;message.textContent='Saving…';
    const result=await A1Data.saveSeasonHolder(id,values,version);if(!current(token))return;rows=[...rows.filter(r=>r.id!==id),result];dirty=false;dialog.close();render();$('seasonMessage').textContent='Ticket holder saved.';
   }catch(e){if(current(token))message.textContent='Could not save: '+e.message;}finally{if(current(token)){saving=false;save.disabled=false;}}
  };
  dialog.showModal();form.elements.namedItem('holderName').focus();
 }
 root.A1SeasonTickets={open,clear,filter,validate};root.addEventListener('a1-signed-out',clear);root.addEventListener('a1-access-changed',()=>{const visible=$('seasonTickets')?.style.display==='block';clear();if(visible&&allowed())open();});
})(typeof window==='undefined'?globalThis:window);
