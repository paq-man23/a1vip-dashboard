/* Dashboard only receives vault access flags; entry secrets stay in vault.html. */
(() => {
 let allowed=false,checking=false,epoch=0;
 function paint(){document.querySelectorAll('[data-vault-entry]').forEach(n=>n.hidden=!allowed);}
 function invalidate(){epoch++;allowed=false;checking=false;paint();}
 async function refresh(){
  if(checking)return;checking=true;
  const generation=epoch;
  try{
   // Admin membership is already verified by the dashboard. Keep navigation
   // visible even when a separate status request is temporarily unavailable;
   // the vault still verifies every unlock/read/write on the backend.
   let next=false;
   if(A1Data.authenticated()){
    if(A1Data.isAdmin?.()===true)next=true;
    else{const flags=await A1Data.vaultStatus();next=!!(flags&&(flags.passwords||flags.cards));}
   }
   if(generation!==epoch)return;
   allowed=next;
  }catch{if(generation===epoch)allowed=false;}
  finally{if(generation===epoch){checking=false;paint();}}
 }
 function open(account){
  if(!A1Data.authenticated())return;
  const url=new URL('./vault.html',location.href);if(account)url.searchParams.set('account',account);
  window.open(url.href,'_blank','noopener,noreferrer');
 }
 window.A1VaultEntry={open,refresh,allowed:()=>allowed};
 document.addEventListener('DOMContentLoaded',()=>{void refresh();setInterval(refresh,30000);});
 window.addEventListener('a1-signed-out',invalidate);
 for(const event of ['a1-access-changed','a1-dashboard-ready'])window.addEventListener(event,()=>{invalidate();void refresh();});
})();
