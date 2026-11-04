/* Stateless rendering only. Secret values live in the supplied DOM until the
   vault clears it; this module never caches, logs, or sends credentials. */
(function(root){
 function render(container,kind,details,{copy,onError=()=>{}}={}){
  container.replaceChildren();
  const fields=kind==='login'?[['Website','url'],['Username','username'],['Password','password'],['Notes','notes']]:[['Cardholder','cardholder'],['Card number','number'],['Expiration','expiry'],['Billing address','billing'],['Notes','notes']];
  for(const [label,key] of fields){
   const value=details[key];if(!value)continue;
   const row=document.createElement('div');row.className='vault-field';
   const heading=document.createElement('strong');heading.className='field-label';heading.textContent=label;
   const content=document.createElement('p');content.className='secret field-value';content.textContent=value;
   const button=document.createElement('button');button.type='button';button.className='field-copy';button.textContent='Copy '+label.toLowerCase();
   button.addEventListener('click',()=>Promise.resolve().then(()=>copy?.(value,label)).catch(onError));
   row.append(heading,content,button);container.append(row);
  }
  if(kind==='login'){
   try{const url=new URL(details.url);if(url.protocol==='https:'&&!url.username&&!url.password){const link=document.createElement('a');link.className='button-link open-website';link.textContent='Open website';link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';container.append(link);}}catch{}
  }
 }
 root.A1VaultDetails={render};
})(window);
