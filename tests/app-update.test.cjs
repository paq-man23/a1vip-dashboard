const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function events(target={}){
 const handlers=new Map();
 target.addEventListener=(name,fn)=>{const list=handlers.get(name)||[];list.push(fn);handlers.set(name,list);};
 target.emit=async name=>{for(const fn of handlers.get(name)||[])await fn();};
 return target;
}
function worker(){return events({state:'installed',messages:[],postMessage(message){this.messages.push(message);}});}
async function ui(){
 const waiting=worker(),reg=events({waiting,installing:null,update:async()=>{}}),sw=events({register:async()=>reg});
 let reloads=0;const timers=[],children=[];
 const document={body:{appendChild:node=>children.push(node)},createElement:()=>{
  const parts={};
  return {style:{},querySelector:selector=>parts[selector]||=( {disabled:false,textContent:''}),remove(){const i=children.indexOf(this);if(i!==-1)children.splice(i,1);}};
 }};
 const window=events({location:{reload:()=>reloads++}});
 const html=fs.readFileSync('index.html','utf8'),start=html.indexOf("    if ('serviceWorker' in navigator) {");
 vm.runInNewContext(html.slice(start,html.indexOf('  </script>',start)),{window,navigator:{serviceWorker:sw},document,console,setInterval(){},setTimeout:fn=>{timers.push(fn);return fn;},clearTimeout:fn=>{const i=timers.indexOf(fn);if(i!==-1)timers.splice(i,1);}});
 await window.emit('load');
 const button=()=>children[0].querySelector('#a1vip-update');
 const message=()=>children[0].querySelector('[role="status"]').textContent;
 return {waiting,reg,sw,children,button,message,reloads:()=>reloads,timers};
}
test('regular-user update works without any admin or account API',async()=>{
 const h=await ui();h.button().onclick();assert.equal(h.button().disabled,true);assert.equal(h.button().textContent,'Updating…');assert.equal(h.waiting.messages[0].type,'SKIP_WAITING');
 await h.sw.emit('controllerchange');assert.equal(h.reloads(),1);
});
test('activation reloads even if the browser omits controllerchange, and only once',async()=>{
 const h=await ui();h.button().onclick();h.waiting.state='activated';await h.waiting.emit('statechange');await h.sw.emit('controllerchange');assert.equal(h.reloads(),1);
});
test('duplicate update notifications retain one banner and use the latest waiting worker',async()=>{
 const h=await ui(),newWorker=worker();h.reg.waiting=newWorker;h.reg.installing=newWorker;
 await h.reg.emit('updatefound');await newWorker.emit('statechange');assert.equal(h.children.length,1);
 h.button().onclick();assert.equal(newWorker.messages.length,1);assert.equal(h.waiting.messages.length,0);
});
test('a previously activated stale prompt reloads rather than messaging a dead worker',async()=>{
 const h=await ui();h.reg.waiting=null;h.waiting.state='activated';h.button().onclick();assert.equal(h.reloads(),1);assert.equal(h.waiting.messages.length,0);
});
test('stalled activation provides a working Reload now button',async()=>{
 const h=await ui();h.button().onclick();h.timers[0]();assert.match(h.message(),/longer than expected/);assert.equal(h.button().disabled,false);assert.equal(h.button().textContent,'Reload now');h.button().onclick();assert.equal(h.reloads(),1);
});
test('postMessage failure displays recovery instead of silently doing nothing',async()=>{
 const h=await ui();h.waiting.postMessage=()=>{throw Error('worker gone');};h.button().onclick();assert.match(h.message(),/could not start/);assert.equal(h.button().disabled,false);h.button().onclick();assert.equal(h.reloads(),1);
});
test('updates in another tab do not reload unsaved work before the user accepts',async()=>{
 const h=await ui();await h.sw.emit('controllerchange');assert.equal(h.reloads(),0);
});
test('worker keeps the activation request alive until skipWaiting settles',()=>{
 const handlers=new Map();const activation=Promise.resolve();
 const self={registration:{scope:'https://example.com/'},location:{origin:'https://example.com'},addEventListener:(n,fn)=>handlers.set(n,fn),skipWaiting:()=>activation};
 vm.runInNewContext(fs.readFileSync('sw.v4.js','utf8'),{self,URL});let held;
 handlers.get('message')({data:{type:'SKIP_WAITING'},waitUntil:p=>held=p});assert.equal(held,activation);
});
