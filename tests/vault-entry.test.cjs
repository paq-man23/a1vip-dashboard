const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
function ui({admin=false,status=async()=>({passwords:false,cards:false})}={}){
 const dom=new JSDOM('<button data-vault-entry hidden>Secure Vault</button><button data-vault-entry hidden>Admin vault shortcut</button>',{url:'https://a1dash.a1eei.com/index.html',runScripts:'outside-only'}),w=dom.window;
 let authenticated=true,isAdmin=admin,calls=0;
 w.setInterval=()=>0;w.A1Data={authenticated:()=>authenticated,isAdmin:()=>isAdmin,vaultStatus:()=>{calls++;return status();}};
 w.eval(fs.readFileSync('vault-entry.js','utf8'));
 return {w,entry:w.A1VaultEntry,buttons:()=>[...w.document.querySelectorAll('[data-vault-entry]')],calls:()=>calls,setAuth:v=>authenticated=v,setAdmin:v=>isAdmin=v,close:()=>w.close()};
}
test('verified admins see all vault entry points without depending on another permission request',async()=>{
 const h=ui({admin:true,status:async()=>{throw new Error('Status unavailable');}});try{await h.entry.refresh();assert.ok(h.buttons().every(b=>!b.hidden));assert.equal(h.calls(),0);}finally{h.close();}
});
test('regular accounts see navigation only after a granted vault category is confirmed',async()=>{
 for(const granted of [true,false]){const h=ui({status:async()=>({passwords:granted,cards:false})});try{await h.entry.refresh();assert.ok(h.buttons().every(b=>b.hidden===!granted));}finally{h.close();}}
});
test('failed regular-account permission checks leave the navigation hidden',async()=>{
 const h=ui({status:async()=>{throw new Error('Network unavailable');}});try{await h.entry.refresh();assert.ok(h.buttons().every(b=>b.hidden));}finally{h.close();}
});
test('a late status response cannot reveal vault navigation after signout',async()=>{
 let finish;const pending=new Promise(resolve=>finish=resolve);const h=ui({status:()=>pending});try{const task=h.entry.refresh();h.setAuth(false);h.w.dispatchEvent(new h.w.Event('a1-signed-out'));finish({cards:true});await task;assert.ok(h.buttons().every(b=>b.hidden));assert.equal(h.entry.allowed(),false);}finally{h.close();}
});
test('a new administrator session is shown even while an old account check is pending',async()=>{
 let finish;const pending=new Promise(resolve=>finish=resolve);const h=ui({status:()=>pending});try{const task=h.entry.refresh();h.w.dispatchEvent(new h.w.Event('a1-signed-out'));h.setAdmin(true);h.w.dispatchEvent(new h.w.Event('a1-dashboard-ready'));assert.ok(h.buttons().every(b=>!b.hidden));finish({passwords:false,cards:false});await task;assert.ok(h.buttons().every(b=>!b.hidden));}finally{h.close();}
});
test('vault navigation has its own styling and does not capture the Admin touch shortcut',()=>{
 const html=fs.readFileSync('index.html','utf8');assert.match(html,/class="tab tab-vault" data-vault-entry/);assert.ok(html.includes('document.querySelector(\'[data-category="admin"]\')'));assert.match(html,/<button class="btn" data-vault-entry hidden onclick="A1VaultEntry.open\(\)">Secure Vault<\/button>/);
});
