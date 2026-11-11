const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function harness(admin=false){
 let clock=1000000000,interval,loggedOut=0;
 const listeners={},storage=new Map(),calls=[];
 const message={textContent:''};
 const document={hidden:false,head:{append(){}},addEventListener:(name,fn)=>listeners[name]=fn,
  getElementById:id=>id==='loginError'?message:null,querySelectorAll:()=>[],createElement:()=>({})};
 const window={addEventListener:(name,fn)=>listeners[name]=fn};
 const A1Data={activitySession:async action=>{calls.push(action);return new Date(clock).toISOString();},logout:async reason=>{assert.equal(reason,'idle');loggedOut++;window.A1Activity.stop();},isAdmin:()=>admin};
 class FakeDate extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 vm.runInNewContext(fs.readFileSync('a1-activity.js','utf8'),{window,document,A1Data,Date:FakeDate,console,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},setInterval:fn=>{interval=fn;return 1;},clearInterval(){}});
 listeners.DOMContentLoaded();
 return {activity:window.A1Activity,calls,listeners,advance:ms=>clock+=ms,tick:()=>interval(),loggedOut:()=>loggedOut,message,storage};
}
test('an unattended dashboard expires at 20 minutes; a visible page is not activity',async()=>{
 const h=harness();await h.activity.start('user');h.advance(20*60*1000);await h.tick();assert.equal(h.loggedOut(),1);assert.deepEqual(h.calls,['start']);
});
test('input extends the dashboard session and sends one activity heartbeat',async()=>{
 const h=harness();await h.activity.start('user');h.advance(19*60*1000);h.listeners.pointerdown({isTrusted:true});await h.tick();h.advance(2*60*1000);await h.tick();assert.equal(h.loggedOut(),0);assert.deepEqual(h.calls,['start','activity']);
});
test('the first input after sleep cannot revive an expired dashboard',async()=>{
 const h=harness();await h.activity.start('user');h.advance(21*60*1000);h.listeners.keydown({isTrusted:true});await Promise.resolve();assert.equal(h.loggedOut(),1);assert.deepEqual(h.calls,['start']);
});
test('synthetic activity cannot extend the dashboard timer',async()=>{
 const h=harness();await h.activity.start('user');h.advance(19*60*1000);h.listeners.pointermove({isTrusted:false});h.advance(60*1000);await h.tick();assert.equal(h.loggedOut(),1);
});
for(const admin of [true,false])test(`${admin?'admin':'regular user'} website links use the correct window`,()=>{
 const html=fs.readFileSync('index.html','utf8');
 const source=html.slice(html.indexOf('    function openPopup(url, label){'),html.indexOf('\n\nfunction copyDescription'));
 let embedded=null,popped=null;
 const context={A1Data:{authenticated:()=>true,isAdmin:()=>admin},A1Activity:{openSite:(...args)=>embedded=args},isVideoUrl:()=>false,isFullBrowserUrl:()=>false,openSeparateWindow:url=>popped=url};
 vm.runInNewContext(source+';openPopup("https://example.com","Example")',context);
 assert.equal(popped,admin?'https://example.com':null);
 assert.equal(embedded?.[0]||null,admin?null:'https://example.com');
});

test('admin inactivity never triggers logout, including input after sleep',async()=>{const h=harness(true);await h.activity.start('admin');h.advance(24*60*60*1000);await h.tick();h.listeners.keydown({isTrusted:true});await h.tick();assert.equal(h.loggedOut(),0);assert.equal(h.activity.expired(),false);});
test('user links restore app-style windows and only Trade Desk uses a full browser tab',()=>{
 const opened=[],records=[],events={},frame={src:''},dialog={close(){},showModal(){this.shown=true;}};let signedIn=true;
 const window={addEventListener(){},open:(...args)=>opened.push(args)},document={hasFocus:()=>true,getElementById:id=>id==='websiteFrame'?frame:id==='websiteViewer'?dialog:{textContent:''},addEventListener:(k,fn)=>events[k]=fn};
 vm.runInNewContext(fs.readFileSync('a1-activity.js','utf8'),{window,document,A1Data:{authenticated:()=>signedIn,linkBlocked:url=>url.includes('blocked.example'),recordWebsite:a=>records.push(a)},URL,console,clearInterval(){}});
 for(const url of ['https://tradedesk.ticketmaster.com/orders','https://accounts.ticketmaster.com/','https://example.com/'])window.A1Activity.openSite(url,'Website');
 assert.equal(opened.length,3);assert.equal(opened[0][0],'https://tradedesk.ticketmaster.com/orders');assert.equal(opened[1][1],'_blank');assert.equal(opened[0][2],'noopener,noreferrer');assert.match(opened[1][2],/popup=yes/);assert.match(opened[1][2],/resizable=yes/);assert.equal(dialog.shown,undefined);assert.equal(frame.src,'about:blank');assert.equal(records.length,0);
 window.A1Activity.openSite('https://blocked.example/','Blocked');window.A1Activity.openSite('javascript:alert(1)','Invalid');signedIn=false;window.A1Activity.openSite('https://example.com/','Signed out');assert.equal(opened.length,3);
});
test('full-browser exception matches Trade Desk host exactly, not arbitrary URL text',()=>{
 const html=fs.readFileSync('index.html','utf8'),source=html.slice(html.indexOf('const FULL_BROWSER_MATCH ='),html.indexOf('// Video links (local/hosted MP4)'));const c={URL};vm.runInNewContext(source+';result=[isFullBrowserUrl("https://tradedesk.ticketmaster.com/orders"),isFullBrowserUrl("https://example.com/tradedesk.ticketmaster.com"),isFullBrowserUrl("https://tradedesk.ticketmaster.com.other.example/")]',c);assert.deepEqual(Array.from(c.result),[true,false,false]);
});
test('admin Trade Desk links use a full browser tab rather than popup features',()=>{
 const html=fs.readFileSync('index.html','utf8'),source=html.slice(html.indexOf('    function openPopup(url, label){'),html.indexOf('\n\nfunction copyDescription'));const opened=[];const c={A1Data:{authenticated:()=>true,isAdmin:()=>true},window:{open:(...args)=>opened.push(args)},isVideoUrl:()=>false,isFullBrowserUrl:()=>true};vm.runInNewContext(source+';openPopup("https://tradedesk.ticketmaster.com","Trade Desk")',c);assert.deepEqual(opened,[['https://tradedesk.ticketmaster.com','_blank','noopener,noreferrer']]);
});

test('interactive-map links use native browser tabs for regular users and blocked maps stay blocked',()=>{
 const events={},opened=[],frame={src:''},viewer={close(){},addEventListener(){}};
 const document={head:{append(){}},createElement:()=>({}),getElementById:id=>id==='websiteFrame'?frame:id==='websiteViewer'?viewer:null,addEventListener:(name,fn)=>events[name]=fn};
 const window={addEventListener(){},open:(...args)=>opened.push(args)};
 const data={authenticated:()=>true,isAdmin:()=>false,linkBlocked:url=>url.includes('blocked.example')};
 vm.runInNewContext(fs.readFileSync('a1-activity.js','utf8'),{window,document,A1Data:data,URL,console,clearInterval(){}});events.DOMContentLoaded();
 function click(href,marked){let prevented=false,stopped=false;const a={href,target:'_blank',dataset:marked?{a1BrowserTab:'1'}:{},hasAttribute:()=>false,textContent:'Map'};events.click({target:{closest:()=>a},preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;}});return {prevented,stopped};}
 assert.deepEqual(click('https://miamidolphins.io-media.com/web/index.html',true),{prevented:false,stopped:false});assert.equal(opened.length,0,'Browser follows the native anchor without popup features');
 assert.deepEqual(click('https://blocked.example/map',true),{prevented:true,stopped:true});assert.equal(opened.length,0);
 assert.deepEqual(click('https://ordinary.example/',false),{prevented:true,stopped:true});assert.equal(opened.length,1);assert.match(opened[0][2],/popup=yes/);
});
