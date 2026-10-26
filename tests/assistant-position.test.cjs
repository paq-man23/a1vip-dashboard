const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),{sanitize,effective}=require('../assistant-position.js');
test('Al uses a nonoverlapping bottom dock on narrow screens',()=>{
 assert.equal(effective('left',800),'bottom');assert.equal(effective('left',1200),'left');assert.equal(sanitize('unsafe'),'right');
});
test('drag saves a dock for only this account and suppresses accidental chat activation',()=>{
 let email='user1@example.invalid',captured=false,suppressed=false;const events={},storage=new Map(),handlers={};
 const handle={classList:{add(){},remove(){}},addEventListener:(name,fn)=>handlers[name]=fn,setPointerCapture(){captured=true;},hasPointerCapture:()=>captured,releasePointerCapture(){captured=false;}};
 const panel={querySelector:()=>({before(){}})},body={dataset:{}};
 const root={A1Data:{account:()=>({email}),authenticated:()=>true},addEventListener:(name,fn)=>events[name]=fn};
 vm.runInNewContext(fs.readFileSync('assistant-position.js','utf8'),{window:root,innerWidth:1200,innerHeight:800,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},setTimeout(){},document:{body,getElementById:()=>handle,createElement:()=>({append(){},setAttribute(){},addEventListener(){}})}});
 const controller=root.A1AssistantPosition.init(handle,panel);
 handlers.pointerdown({button:0,pointerId:1,clientX:1000,clientY:200});handlers.pointermove({pointerId:1,clientX:100,clientY:200,preventDefault(){}});handlers.pointerup({type:'pointerup',pointerId:1,clientX:100,clientY:200});
 assert.equal(body.dataset.alDock,'left');assert.equal(storage.size,1);
 handlers.click({preventDefault(){},stopImmediatePropagation(){suppressed=true;}});assert.equal(suppressed,true);
 email='user2@example.invalid';controller.restore();assert.equal(body.dataset.alDock,'right');
 email='user1@example.invalid';controller.restore();assert.equal(body.dataset.alDock,'left');
});
