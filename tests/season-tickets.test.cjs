const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom'),api=require('../season-tickets.js');
const documentFixture={holderName:'Fixture Holder',phone:'5550100',email:'fixture@example.invalid',venue:'Hard Rock Stadium',team:'Miami Dolphins',season:'2026',section:'110',row:'A',seats:'1–4',quantity:'4',ticketType:'Standard',status:'Open to offers',notes:'Call about December games'};
function browser({allowed=true,pause,saveError}={}){
 const dom=new JSDOM('<section id="seasonTickets" style="display:block"></section>',{url:'https://a1dash.a1eei.com',runScripts:'outside-only'}),w=dom.window;let signedIn=true,rows=[{id:'11111111-1111-4111-8111-111111111111',document:{...documentFixture},version:1}],writes=[];
 w.confirm=()=>true;w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.A1Data={authenticated:()=>signedIn,canAccess:()=>allowed,account:()=>({email:'fixture@example.invalid'}),fetchSeasonHolders:async()=>{if(pause)await pause;return structuredClone(rows);},saveSeasonHolder:async(id,document,version)=>{if(saveError)throw Error(saveError);const row={id,document:structuredClone(document),version:version+1};writes.push(row);rows=[...rows.filter(r=>r.id!==id),row];return row;}};
 w.eval(fs.readFileSync('season-tickets.js','utf8'));return {w,writes,signout:()=>{signedIn=false;w.dispatchEvent(new w.Event('a1-signed-out'));},close:()=>w.close()};
}
const settle=()=>new Promise(r=>setImmediate(r));
test('holder search matches venue, team, contact and seats while hiding archives by default',()=>{
 const rows=[{id:'1',document:documentFixture},{id:'2',document:{...documentFixture,holderName:'Other',status:'Archived'}}];assert.equal(api.filter(rows,'Dolphins 110').length,1);assert.equal(api.filter(rows,'Hard Rock','all').length,2);assert.equal(api.filter(rows,'','Archived').length,1);assert.equal(api.filter(rows,'','active','Suite').length,0);
 assert.throws(()=>api.validate({...documentFixture,phone:'',email:''}),/phone number or email/);assert.throws(()=>api.validate({...documentFixture,quantity:'2.5'}),/whole number/);
});
test('directory searches and saves a holder with venue and seating details, then reloads it',async()=>{
 const {w,writes,close}=browser();await w.A1SeasonTickets.open();assert.match(w.document.body.textContent,/Miami Dolphins/);w.document.querySelector('.season-heading button').click();const f=w.document.getElementById('seasonHolderForm');
 for(const [key,v]of Object.entries({...documentFixture,holderName:'Another Holder',venue:'Madison Square Garden',team:'New York Knicks'}))f.elements.namedItem(key).value=v;
 await f.onsubmit({preventDefault(){}});assert.equal(writes.length,1);assert.match(w.document.getElementById('seasonHolderList').textContent,/Another Holder/);assert.equal(w.document.getElementById('seasonHolderDialog').open,false);
 await w.A1SeasonTickets.open();const search=w.document.querySelector('input[name="query"]');search.value='Knicks';search.dispatchEvent(new w.Event('input'));assert.equal(w.document.querySelectorAll('.season-card').length,1);assert.match(w.document.getElementById('seasonHolderList').textContent,/Another Holder/);close();
});
test('archive is a reviewed edit and stale-save errors preserve the form',async()=>{
 const {w,writes,close}=browser();await w.A1SeasonTickets.open();w.document.querySelector('.season-card-actions button').click();const form=w.document.getElementById('seasonHolderForm');form.elements.namedItem('status').value='Archived';await form.onsubmit({preventDefault(){}});assert.equal(writes[0].version,2);assert.equal(w.document.querySelectorAll('.season-card').length,0);close();
 const b=browser({saveError:'This holder changed on another device.'});await b.w.A1SeasonTickets.open();b.w.document.querySelector('.season-card-actions button').click();await b.w.document.getElementById('seasonHolderForm').onsubmit({preventDefault(){}});assert.equal(b.w.document.getElementById('seasonHolderDialog').open,true);assert.match(b.w.document.getElementById('seasonHolderForm').textContent,/changed on another device/);b.close();
});
test('signout rejects delayed directory reads and access denial never loads private data',async()=>{
 let release;const pause=new Promise(r=>release=r),b=browser({pause});const pending=b.w.A1SeasonTickets.open();b.signout();release();await pending;assert.equal(b.w.document.getElementById('seasonTickets').textContent,'');b.close();
 const denied=browser({allowed:false});await denied.w.A1SeasonTickets.open();assert.equal(denied.w.document.querySelector('input'),null);denied.close();
});
test('navigation puts Season Tickets at the top and Suites inside Ticket Accounts',()=>{
 const d=new JSDOM(fs.readFileSync('index.html','utf8')).window.document;assert.ok(d.querySelector('#categoryNavigation [data-category="seasonTickets"]'));assert.equal(d.querySelector('#categoryNavigation [data-category="luxury"]'),null);assert.ok(d.querySelector('#accounts #luxury .grid[data-section="luxury"]'));assert.equal(d.querySelector('#accounts [data-category="luxury"]'),null);assert.equal(d.querySelector('#luxury').classList.contains('section'),false);assert.ok(d.querySelector('.grid[data-section="luxury"]'));assert.equal(d.querySelectorAll('#seasonTickets').length,1);
});

test('Suites-only staff keep the Ticket Accounts parent while unrelated account links stay hidden',()=>{
 const dom=new JSDOM('<button data-category="accounts"></button><section class="section" id="accounts"><div class="grid" data-section="accounts" data-section-permission="accounts"><a class="btn" data-url="https://example.invalid">Denied account</a></div><div id="luxury" data-section-permission="luxury"><div class="grid" data-section="luxury"></div></div></section>',{runScripts:'outside-only'}),w=dom.window;
 w.A1Data={authenticated:()=>true,canAccess:id=>id==='luxury',isAdmin:()=>false,blockedLinks:()=>[],linkBlocked:()=>false};w.A1Activity={buttonKey:()=>''};w.eval(fs.readFileSync('a1-accounts.js','utf8'));w.A1Accounts.applyAccess();assert.equal(w.document.querySelector('[data-category="accounts"]').classList.contains('a1-category-denied'),false);assert.equal(w.document.getElementById('accounts').classList.contains('a1-category-denied'),false);assert.equal(w.document.querySelector('.grid .btn').classList.contains('a1-admin-link-denied'),true);assert.equal(w.document.querySelector('[data-section-permission="accounts"]').classList.contains('a1-category-denied'),true);assert.equal(w.document.getElementById('luxury').classList.contains('a1-category-denied'),false);w.close();
});

test('legacy Suites navigation opens Ticket Accounts and scrolls to the inline buttons',()=>{
 const html=fs.readFileSync('index.html','utf8'),dom=new JSDOM(html,{runScripts:'outside-only'}),w=dom.window;
 let scrolled=false;w.HTMLElement.prototype.scrollIntoView=function(){if(this.id==='luxury')scrolled=true;};w.A1Data={canAccess:()=>true,isAdmin:()=>true};w.matchMedia=()=>({matches:false});w.loadSectionData=()=>{};
 const source=html.slice(html.indexOf('    function showSection('),html.indexOf('    async function loadSectionData('));w.eval(source+'\nwindow.showSection=showSection;');w.showSection('luxury');assert.equal(w.document.getElementById('accounts').style.display,'block');assert.equal(w.document.getElementById('luxury').closest('.section').id,'accounts');assert.equal(scrolled,true);assert.equal(w.document.querySelector('#categoryNavigation [data-category="accounts"]').getAttribute('aria-current'),'page');w.close();
});
