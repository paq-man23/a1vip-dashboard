/* Dashboard only receives vault access flags; entry secrets stay in vault.html. */
(() => {
 let allowed=false,checking=false;
 async function refresh(){
  if(checking)return;checking=true;
  try{const flags=A1Data.authenticated()?await A1Data.vaultStatus():null;allowed=!!(flags&&(flags.passwords||flags.cards));}
  catch{allowed=false;}finally{checking=false;}
  document.querySelectorAll('[data-vault-entry]').forEach(n=>n.hidden=!allowed);
 }
 function open(account){
  if(!A1Data.authenticated())return;
  const url=new URL('./vault.html',location.href);if(account)url.searchParams.set('account',account);
  window.open(url.href,'_blank','noopener,noreferrer');
 }
 window.A1VaultEntry={open,refresh,allowed:()=>allowed};
 document.addEventListener('DOMContentLoaded',()=>{void refresh();setInterval(refresh,30000);});
 window.addEventListener('a1-signed-out',()=>{allowed=false;document.querySelectorAll('[data-vault-entry]').forEach(n=>n.hidden=true);});
 window.addEventListener('a1-access-changed',()=>void refresh());
})();
