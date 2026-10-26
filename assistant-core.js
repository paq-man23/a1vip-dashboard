/* Guided task routing. No model, external data transfer, or automatic writes. */
(function(root){
 const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
 const sections=[['main','Main Links'],['luxury','Suites'],['accounts','Ticket Accounts'],['travel','Travel'],['social','Social'],['invoices','Invoices & POs'],['customers','Customers'],['vendors','Vendors'],['formLetter','Letters'],['tripItinerary','Trips'],['admin','Admin'],['manageAccounts','Manage Accounts']];
 function intent(text){
  const raw=String(text||'').trim().replace(/[.!?]+$/,'');
  let m;
  if(/^(hi|hello|hey|good morning|good afternoon|good evening)(?:[ ,]+al)?$/i.test(raw))return {type:'greeting'};
  if((m=raw.match(/^(?:please\s+)?add\s+(?:a\s+)?button(?:\s+(?:called|named)\s+["“]([^"”]+)["”])?\s+for\s+(.+?)\s+(?:in|to)\s+["“]?([^"”]+?)["”]?$/i)))return {type:'addButton',label:m[1]||'',website:m[2].replace(/^["“]|["”]$/g,''),category:m[3].trim()};
  if(/^(cancel|stop|reset|start over)$/i.test(raw))return {type:'cancel'};
  if((m=raw.match(/(?:create|make|start|new|prepare)\s+(?:a\s+|an\s+)?(?:new\s+)?(invoice|purchase order|po)(?:\s+(?:for|with)\s+(.+))?$/i)))return {type:'draft',purchase:!/^invoice$/i.test(m[1]),query:(m[2]||'').trim()};
  if((m=raw.match(/^(?:(?:find|search(?: for)?|look\s*up|show(?: me)?)\s+)?(?:a\s+|the\s+)?(customers?|vendors?|contacts?|invoices?|purchase orders?|trips?|itinerar(?:y|ies)|letters?|links?)\s*(?:named\s+|called\s+|for\s+|#\s*)?(.*)$/i))){
   const word=m[1].toLowerCase();return {type:/customer|vendor|contact/.test(word)?'contact':/invoice|purchase/.test(word)?'invoice':/trip|itinerar/.test(word)?'trip':/letter/.test(word)?'letter':'link',kind:/vendor/.test(word)?'vendor':/customer/.test(word)?'customer':null,query:m[2].trim()};
  }
  if((m=raw.match(/^(?:open|go to|take me to)\s+(.+)$/i))){const key=normalize(m[1]);const section=sections.find(([id,label])=>[normalize(id),normalize(label)].includes(key));if(section)return {type:'navigate',section:section[0]};}
  if(/help|how (do|can)|what can|guide|walk me/i.test(raw))return {type:'help',query:raw};
  if((m=raw.match(/^(?:find|search(?: for)?|look\s*up|where (?:is|are)|where can I find)\s+(.+)$/i)))return {type:'global',query:m[1].trim()};
  return {type:'unknown',query:raw};
 }
 function searchText(value){return normalize(value).replace(/\b[a-z]{5,}\b/g,word=>word.endsWith('s')&&!word.endsWith('ss')?word.slice(0,-1):word);}
 function matches(rows,query,fields){const terms=searchText(query).split(' ').filter(Boolean);return rows.filter(row=>{const hay=searchText(fields.map(key=>row[key]).filter(v=>v!=null).join(' '));return terms.every(term=>hay.includes(term));});}
 function rankLinks(rows,query){
  const key=normalize(query);return matches(rows,query,['label']).sort((a,b)=>{
   const score=row=>(normalize(row.label)===key?100:normalize(row.label).startsWith(key)?30:0)+(row.section==='accounts'?10:0);
   return score(b)-score(a)||a.label.localeCompare(b.label);
  });
 }
 const api={normalize,intent,matches,rankLinks,sections};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.A1AssistantCore=api;
})(typeof window==='undefined'?globalThis:window);
