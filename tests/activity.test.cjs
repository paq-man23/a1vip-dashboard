const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function harness(){
 let clock=1000000000,interval,loggedOut=0;
 const listeners={},storage=new Map(),calls=[];
 const message={textContent:''};
 const document={hidden:false,head:{append(){}},addEventListener:(name,fn)=>listeners[name]=fn,
  getElementById:id=>id==='loginError'?message:null,querySelectorAll:()=>[],createElement:()=>({})};
 const window={addEventListener:(name,fn)=>listeners[name]=fn};
 const A1Data={activitySession:async action=>{calls.push(action);return new Date(clock).toISOString();},logout:async reason=>{assert.equal(reason,'idle');loggedOut++;window.A1Activity.stop();},isAdmin:()=>false};
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
