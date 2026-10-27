/* Dashboard session timer, admin-only punch card, and account-specific visibility. */
(() => {
  const IDLE=20*60*1000, PREFIX='a1vip-last-activity:';
  let userId=null, last=0, sent=0, timer=null, busy=false, hidden=[], added=[], draftAdded=[], targetUser=null, view=null, lastAccessCheck=0;
  const stored=id=>{try{return Number(localStorage.getItem(PREFIX+id))||0;}catch{return 0;}};
  const remember=()=>{try{localStorage.setItem(PREFIX+userId,String(last));}catch{}};
  function stop(){clearInterval(timer);timer=null;userId=null;busy=false;hidden=[];added=[];}
  async function expire(){
    if(!userId||busy)return;
    busy=true;
    closeSite();
    try { await A1Data.logout('idle'); }
    catch { /* Logout locks the dashboard even when offline. */ }
    const message=document.getElementById('loginError');
    if(message)message.textContent='Signed out after 20 minutes of dashboard inactivity. Sign in again.';
  }
  function expired(){return !A1Data.isAdmin()&&!!userId&&Date.now()-Math.max(last,stored(userId))>=IDLE;}
  async function tick(){
    if(!userId||busy)return;
    last=Math.max(last,stored(userId));
    if(expired())return expire();
    if(Date.now()-lastAccessCheck>=30000){lastAccessCheck=Date.now();try{await A1Data.refreshAccess?.();}catch{}}
    if(!userId)return;
    // A visible page and token refreshes are not user activity.
    void flushSite();
    if(last>sent){
      busy=true;
      try{await A1Data.activitySession('activity');sent=last;}
      catch(error){if(/staff access required|Session ended/i.test(error.message)){await A1Data.logout('idle').catch(()=>{});return;}}
      finally{busy=false;}
    }
  }
  async function start(id){
    stop();userId=id;
    // Server checks the existing session before accepting a restored session.
    let checkpoint;
    try{checkpoint=await A1Data.activitySession('start');}
    catch(error){stop();throw error;}
    last=new Date(checkpoint).getTime();
    if(!Number.isFinite(last)){stop();throw new Error('Invalid activity session. Sign in again.');}
    sent=last;remember();
    timer=setInterval(tick,10000);
  }
  function input(event){
    if(!userId||event.isTrusted===false)return;
    // Check the old deadline BEFORE recording new input after sleep/backgrounding.
    if(expired()){void expire();return;}
    last=Date.now();remember();
  }
  const buttonKey=b=>JSON.stringify([b.closest('.grid[data-section]')?.dataset.section||'',(b.dataset.label||b.textContent).trim(),b.dataset.url||'']);
  const buttons=()=>[...document.querySelectorAll('.grid[data-section] > .btn')].filter(b=>!b.closest('#admin,#system,#buttonManager,#domains,#upload')&&!b.hasAttribute('data-admin-only'));
  function applyButtons(){
    document.querySelectorAll('[data-personal-link]').forEach(b=>b.remove());
    for(const link of added){
      const section=['main','luxury','accounts','travel','social','privatejet','luxhomes','yachts'].includes(link.section)?link.section:'main';
      const grid=document.querySelector('.grid[data-section="'+section+'"]');
      if(!validUrl(link.url)||typeof link.label!=='string'||!grid)continue;
      const b=document.createElement('button');b.type='button';b.className='btn';b.dataset.personalLink='1';b.dataset.label=link.label;b.dataset.url=link.url;b.textContent=link.label;
      b.addEventListener('click',()=>window.openPopup(link.url,link.label));grid.append(b);
    }
    const omitted=new Set(hidden);
    for(const b of buttons()){
      const hide=!b.dataset.personalLink&&omitted.has(buttonKey(b));
      b.classList.toggle('a1-personally-hidden',hide);
      // Own CSS property avoids clobbering the dashboard search's display filter.
    }
    window.A1ButtonMoves?.refresh();
    window.A1PrivateLinks?.refresh();
    window.A1Accounts?.applyAccess();
  }
  async function moveButton(item,to){
    if(!A1Data.authenticated())throw new Error('Please sign in first.');
    if(A1Data.canAccess&&(!A1Data.canAccess(item.from)||!A1Data.canAccess(to)))throw new Error('This category is not enabled for your account.');
    if(A1Data.linkBlocked?.(item.url)||A1Data.blockedLinks?.().includes(item.key))throw new Error('This link is restricted by your administrator.');
    if(!['main','luxury','accounts','travel','social','privatejet','luxhomes','yachts'].includes(to)||!validUrl(item.url))throw new Error('Unsupported personal link move.');
    const account=A1Data.account()?.email,choices=await A1Data.fetchPreferences();
    const nextHidden=new Set(choices.hidden_buttons);
    if(!item.personal){
      if(!item.key)throw new Error('Refresh links before moving this button.');
      nextHidden.add(item.key);
    }
    const links=choices.added_links.filter(link=>!((link.section||'main')===item.from&&link.label===item.label&&link.url===item.url));
    links.push({label:item.label,url:item.url,section:to});
    const next={hidden_buttons:[...nextHidden],added_links:links};
    if(!A1Data.authenticated()||A1Data.account()?.email!==account)throw new Error('Session changed. Sign in again.');
    await A1Data.savePreferences(next);
    if(!A1Data.authenticated()||A1Data.account()?.email!==account)return;
    hidden=next.hidden_buttons;added=next.added_links;applyButtons();
  }
  async function loadButtons(){
    if(!A1Data.authenticated())return;
    const account=A1Data.account()?.email;
    try{
      const choices=await A1Data.fetchPreferences();
      if(!A1Data.authenticated()||A1Data.account()?.email!==account)return;
      hidden=choices.hidden_buttons;added=choices.added_links;applyButtons();
    }catch(error){console.warn('Personal button preferences could not load:',error.message);}
  }
  function validUrl(raw){try{const u=new URL(raw);return ['http:','https:'].includes(u.protocol);}catch{return false;}}
  function paintChoices(choices){
    const list=document.getElementById('personalButtonList');list.replaceChildren();
    let previous='';
    const ownBlocked=new Set(!targetUser&&!A1Data.isAdmin()?A1Data.blockedLinks?.()||[]:[]);
    for(const b of buttons().filter(b=>!b.dataset.personalLink&&(!A1Data.canAccess||targetUser||A1Data.canAccess(b.closest('.grid').dataset.section))&&!ownBlocked.has(buttonKey(b))&&(targetUser||!A1Data.linkBlocked?.(b.dataset.url)))){
      const section=b.closest('.grid').dataset.section;
      if(section!==previous){const h=document.createElement('h4');h.textContent=section;list.append(h);previous=section;}
      const label=document.createElement('label');label.style.display='block';label.style.padding='6px';
      const input=document.createElement('input');input.type='checkbox';input.value=buttonKey(b);input.checked=!choices.hidden_buttons.includes(input.value)&&!(choices.blocked_links||[]).includes(input.value);
      label.append(input,document.createTextNode(' '+(b.dataset.label||b.textContent).trim()));list.append(label);
    }
    const picker=document.getElementById('personalLinkSection');picker.replaceChildren();
    for(const [id,name] of window.A1Accounts?.sections||[]){if(!['main','luxury','accounts','travel','social'].includes(id))continue;const allowed=targetUser?(!choices.allowed_sections||choices.allowed_sections.includes(id)):(!A1Data.canAccess||A1Data.canAccess(id));if(allowed)picker.add(new Option(name,id));}
    draftAdded=choices.added_links.map(x=>({...x}));paintAdded();
  }
  function paintAdded(){
    const list=document.getElementById('personalAddedList');list.replaceChildren();
    draftAdded.forEach((link,index)=>{
      const row=document.createElement('p');row.append(document.createTextNode(link.label+' · '+link.url+' '));
      const button=document.createElement('button');button.type='button';button.textContent='Remove';button.addEventListener('click',()=>{draftAdded.splice(index,1);paintAdded();});row.append(button);list.append(row);
    });
  }
  async function customize(adminMode=false,preferredUser=null){
    if(!A1Data.authenticated())return;
    targetUser=null;
    const label=document.getElementById('preferenceUserLabel');label.hidden=!adminMode;
    document.getElementById('personalButtonMessage').textContent='';
    document.getElementById('personalButtons').showModal();
    try{
      if(adminMode){
        const people=await A1Data.preferenceUsers(),select=document.getElementById('preferenceUser');select.replaceChildren();
        if(!A1Data.isAdmin())return;
        for(const person of people)select.add(new Option(person.email,person.user_id));
        if(preferredUser)select.value=preferredUser;
        targetUser=select.value;if(!targetUser)throw new Error('No approved users found.');
      }
      paintChoices(await A1Data.fetchPreferences(targetUser));
    }catch(error){document.getElementById('personalButtonMessage').textContent=error.message;}
  }
  async function changePreferenceUser(){
    if(!A1Data.isAdmin())return;
    targetUser=document.getElementById('preferenceUser').value;
    try{paintChoices(await A1Data.fetchPreferences(targetUser));}catch(error){document.getElementById('personalButtonMessage').textContent=error.message;}
  }
  function addPersonalLink(){
    const label=document.getElementById('personalLinkLabel'),url=document.getElementById('personalLinkUrl'),message=document.getElementById('personalButtonMessage');
    let address=url.value.trim();if(!/^https?:\/\//i.test(address))address='https://'+address;
    if(!targetUser&&A1Data.linkBlocked?.(address)){message.textContent='This link is restricted by your administrator.';return;}
    if(!label.value.trim()||!validUrl(address)){message.textContent='Enter a button name and a valid http or https website address.';return;}
    const section=document.getElementById('personalLinkSection').value;if(!section){message.textContent='No link categories are enabled for this account.';return;}
    draftAdded.push({label:label.value.trim(),url:address,section});label.value='';url.value='';message.textContent='Save Choices to keep this link.';paintAdded();
  }
  async function saveButtons(){
    const choices=[...document.querySelectorAll('#personalButtonList input')].filter(i=>!i.checked).map(i=>i.value);
    const account=A1Data.account()?.email;
    try{
      if(targetUser){const permissions=await A1Data.accountPermissions(targetUser);if(!permissions.admin_role)await A1Data.setAccountAccess(targetUser,permissions.allowed_sections,choices);}
      await A1Data.savePreferences({hidden_buttons:choices,added_links:draftAdded},targetUser);
      if(A1Data.account()?.email!==account)return;
      if(!targetUser){hidden=choices;added=draftAdded.map(x=>({...x}));applyButtons();}
      else await loadButtons();
      document.getElementById('personalButtons').close();
    }catch(error){document.getElementById('personalButtonMessage').textContent=error.message;}
  }
  function accountViewTime(){
    if(!view)return;
    const now=Date.now();
    if(view.visibleAt!==null)view.ms+=Math.max(0,now-view.visibleAt);
    view.visibleAt=document.hidden||!document.hasFocus()?null:now;
  }
  async function flushSite(closing=false){
    if(!view)return;
    accountViewTime();const current=view;
    if(closing){view=null;clearInterval(current.timer);}
    try{
      // Serialize start/heartbeats/close so the server never receives close first.
      const args={p_id:current.id,p_host:current.host,p_label:current.label,p_seconds:Math.floor(current.ms/1000),p_close:closing};
      current.pending=current.pending.catch(()=>{}).then(()=>A1Data.recordWebsite(args));
      await current.pending;
    }catch(error){console.warn('Website viewing time could not be saved:',error.message);}
  }
  function closeSite(){
    void flushSite(true);
    const frame=document.getElementById('websiteFrame');if(frame)frame.src='about:blank';
    document.getElementById('websiteViewer')?.close();
  }
  function openSite(url,label){
    if(!A1Data.authenticated()||!validUrl(url)||A1Data.linkBlocked?.(url))return;
    closeSite();
    const target=new URL(url);
    // Restore the original top-level app-style window, without embedding the provider.
    const features=target.hostname.toLowerCase()==='tradedesk.ticketmaster.com'?'noopener,noreferrer':
      (window.separateWindowFeatures?.()||'popup=yes,toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,width=1200,height=800')+',noopener,noreferrer';
    window.open(target.href,'_blank',features);
  }

  async function websiteHistory(){
    const output=document.getElementById('websiteHistory');if(!output||!A1Data.isAdmin())return;
    output.textContent='Loading website views…';
    try{
      const rows=await A1Data.fetchWebsiteViews();if(!A1Data.isAdmin()){output.replaceChildren();return;}
      output.replaceChildren();
      for(const row of rows){const p=document.createElement('p');p.textContent=row.display_name+' · '+row.label+' ('+row.site_host+') · '+new Date(row.started_at).toLocaleString()+' · '+duration(row.visible_seconds*1000)+' panel viewing time'+(row.ended_at?' · Closed':' · Last reported');output.append(p);}
      if(!rows.length)output.textContent='No embedded website views recorded yet.';
    }catch(error){if(A1Data.isAdmin())output.textContent=error.message;}
  }
  function duration(ms){const minutes=Math.floor(Math.max(0,ms)/60000);return Math.floor(minutes/60)+'h '+minutes%60+'m';}
  async function history(){
    const output=document.getElementById('activityHistory');
    if(!output)return;
    output.replaceChildren();
    if(!A1Data.isAdmin())return;
    void websiteHistory();
    output.textContent='Loading login history…';
    try{
      const rows=await A1Data.fetchActivity();
      if(!A1Data.isAdmin()){output.replaceChildren();return;}
      const select=document.getElementById('activityUser'),selected=select.value;
      const names=new Map(rows.map(r=>[r.user_id,r.display_name]));
      select.replaceChildren(new Option('All users',''));
      for(const [id,name] of names)select.add(new Option(name,id));select.value=selected;
      const from=document.getElementById('activityFrom').value,through=document.getElementById('activityThrough').value;
      const start=from?new Date(from+'T00:00:00').getTime():-Infinity;
      const finish=through?new Date(through+'T23:59:59.999').getTime():Infinity;
      output.replaceChildren();
      const table=document.createElement('table');table.style.width='100%';
      const head=table.createTHead().insertRow();
      for(const text of ['User','Signed in','Login location (approx.)','Login IP','Signed out / timeout','Session length','Status']){const th=document.createElement('th');th.textContent=text;head.append(th);}
      const body=table.createTBody();let total=0,count=0;
      for(const r of rows){
        const begun=new Date(r.started_at).getTime();
        if((selected&&r.user_id!==selected)||begun<start||begun>finish)continue;
        const deadline=new Date(r.last_active_at).getTime()+IDLE;
        const inferred=!r.idle_exempt&&!r.ended_at&&Date.now()>=deadline;
        const ended=r.ended_at?new Date(r.ended_at).getTime():inferred?deadline:Date.now();
        const elapsed=Math.max(0,ended-begun);total+=elapsed;count++;
        const status=r.end_reason==='idle'?'Auto logout':r.end_reason==='logout'?'Logged out':inferred?'Timeout (estimated)':'Open session';
        const tr=body.insertRow();
        for(const text of [r.display_name,new Date(begun).toLocaleString(),[r.login_city,r.login_region,r.login_country].filter(Boolean).join(', ')||(r.login_ip?(r.login_location_checked_at?'Unavailable':'Lookup pending'):'Not recorded'),r.login_ip||'—',r.ended_at||inferred?new Date(ended).toLocaleString():'—',duration(elapsed),status])tr.insertCell().textContent=text;
      }
      const summary=document.createElement('p');summary.textContent=count+' sessions · '+duration(total)+' elapsed (overlapping sessions can count twice). Login locations are IP-based estimates; VPNs and mobile networks can show another area.';
      const scroller=document.createElement('div');scroller.style.overflowX='auto';scroller.append(table);output.append(summary,scroller);
    }catch(error){if(A1Data.isAdmin())output.textContent=error.message;}
  }
  document.addEventListener('DOMContentLoaded',()=>{
    const style=document.createElement('style');style.textContent='.a1-personally-hidden{display:none!important}';document.head.append(style);
    for(const name of ['pointerdown','pointermove','keydown','scroll','touchstart'])document.addEventListener(name,input,{capture:true,passive:true});
    document.addEventListener('visibilitychange',()=>{accountViewTime();void flushSite();if(!document.hidden)void tick();});
    window.addEventListener('blur',()=>{accountViewTime();void flushSite();});
    document.getElementById('websiteViewer')?.addEventListener('cancel',event=>{event.preventDefault();closeSite();});
    document.addEventListener('click',event=>{const a=event.target.closest?.('a[href]');if(!a||a.hasAttribute('download')||!A1Data.authenticated()||A1Data.isAdmin()||!validUrl(a.href))return;event.preventDefault();event.stopImmediatePropagation();openSite(a.href,a.textContent.trim());},true);
    window.addEventListener('focus',()=>{accountViewTime();void tick();});
  });
  window.addEventListener('a1-signed-out',()=>{
    closeSite();stop();applyButtons();document.getElementById('personalButtons')?.close();
    document.getElementById('personalButtonList')?.replaceChildren();document.getElementById('activityHistory')?.replaceChildren();document.getElementById('websiteHistory')?.replaceChildren();
  });
  window.A1Activity={start,stop,expired,applyButtons,buttonKey,moveButton,loadButtons,customize,saveButtons,history,finishSite:()=>flushSite(true),openSite,closeSite,addPersonalLink,changePreferenceUser};
})();
