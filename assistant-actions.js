/* Narrow assistant write action: reviewed HTTP(S) link additions only. */
(function(root){
 const categories={main:'main','main links':'main',suites:'luxury',luxury:'luxury','luxury suites':'luxury',accounts:'accounts','ticket accounts':'accounts','ticket section':'accounts',travel:'travel',social:'social','private jet':'privatejet',privatejet:'privatejet','luxury homes':'luxhomes',luxhomes:'luxhomes',yachts:'yachts',domains:'domains'};
 const clean=v=>String(v||'').trim();
 const normalize=v=>clean(v).toLowerCase().replace(/\s+/g,' ');
 function proposal(request){
  const section=categories[normalize(request.category)];if(!section)throw new Error('Choose a link category: Main Links, Suites, Ticket Accounts, Travel, or Social.');
  let raw=clean(request.website).replace(/^["“]|["”]$/g,'');
  if(/\s/.test(raw)||!raw)throw new Error('Please give me the website address, such as example.com or https://example.com.');
  if(!/^[a-z][a-z0-9+.-]*:/i.test(raw))raw='https://'+raw;
  let parsed;try{parsed=new URL(raw);}catch{throw new Error('That website address is invalid. Please give me a valid HTTPS website address.');}
  if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||!parsed.hostname.includes('.'))throw new Error('Use a valid HTTP or HTTPS website address without embedded login credentials.');
  const label=clean(request.label)||parsed.hostname.replace(/^www\./,'');if(label.length>120)throw new Error('Use a button label of 120 characters or fewer.');
  return {section,label,url:parsed.href};
 }
 async function add(request,env){
  const item=proposal(request),data=env.data,identity=data.account()?.email,admin=data.isAdmin();
  function check(){if(!identity||!data.authenticated()||data.account()?.email!==identity||data.isAdmin()!==admin||!data.canAccess(item.section))throw new Error('Your session or category access changed. Start this request again.');if(data.linkBlocked(item.url))throw new Error('This link is restricted by your administrator.');}
  check();
  if(env.exists(item))throw new Error('A matching button already exists in that category. No changes were made.');
  if(admin){
   const local=env.local();if(local.linkSyncFailed||local.linkNeedsMigration||local.pendingMoves?.length)throw new Error('Finish syncing your current link changes before adding a shared button.');
   const state=await data.fetchButtonLayout();check();
   if((state.added?.[item.section]||[]).some(x=>normalize(x.label)===normalize(item.label)))throw new Error('A button with this name already exists. No changes were made.');
   state.added||={};state.removed||={};(state.added[item.section]||=[]).push({label:item.label,url:item.url});
   state.removed[item.section]=(state.removed[item.section]||[]).filter(label=>normalize(label)!==normalize(item.label));
   const saved=await data.saveButtonLayout(state);check();env.apply(saved);
  }else{
   const state=await data.fetchPreferences();check();
   if(state.added_links.some(x=>x.section===item.section&&(normalize(x.label)===normalize(item.label)||x.url===item.url)))throw new Error('This personal button already exists. No changes were made.');
   await data.savePreferences({hidden_buttons:state.hidden_buttons,added_links:[...state.added_links,item]});check();await env.refreshPersonal();
  }
  return item;
 }
 const api={proposal,add};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.A1AssistantActions=api;
})(typeof window==='undefined'?globalThis:window);
