// Public visual regression fixture. All values are fictional; no backend access.
const dialog=document.getElementById('reveal');
function show(){
 const long=new URLSearchParams(location.search).has('long');
 A1VaultDetails.render(document.getElementById('revealDetails'),'login',{
 username:long?'example-account-'.repeat(12)+'@example.invalid':'demo@example.invalid',
 password:long?'EXAMPLE-ONLY-'.repeat(30):'EXAMPLE-ONLY-1234',
 },{copy:()=>{}});
 dialog.showModal();
}
document.getElementById('closeReveal').onclick=()=>{dialog.close();document.getElementById('revealDetails').replaceChildren();};
document.getElementById('show').onclick=show;
show();
