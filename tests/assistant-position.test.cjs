const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),{fit,dimensions}=require('../assistant-position.js');
test('Al starts compact and clamps the character and bubble to the screen',()=>{
 assert.deepEqual(dimensions(undefined,undefined,1200,800),{width:300,height:220});
 assert.deepEqual(dimensions(999,999,360,500),{width:344,height:476});
 assert.deepEqual(fit(-20,900,72,80,360,500),{x:8,y:412});
});
test('character movement and bubble size persist only for the current account',()=>{
 let email='user1@example.invalid',captured=false,suppressed=false,grip;const events={},storage=new Map(),handlers={};
 const launcher={style:{},getBoundingClientRect(){return {left:parseFloat(this.style.left)||600,top:parseFloat(this.style.top)||500,width:72,height:80};},addEventListener:(name,fn)=>handlers[name]=fn,setPointerCapture(){captured=true;},hasPointerCapture:()=>captured,releasePointerCapture(){captured=false;}};
 const panel={hidden:false,style:{setProperty(){}},classList:{toggle(){}},append(node){grip=node;}};
 const root={A1Data:{account:()=>({email}),authenticated:()=>true},addEventListener:(name,fn)=>events[name]=fn};
 vm.runInNewContext(fs.readFileSync('assistant-position.js','utf8'),{window:root,innerWidth:1200,innerHeight:800,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},setTimeout(){},document:{body:{classList:{remove(){}}},createElement:()=>({setAttribute(){},addEventListener(name,fn){this[name]=fn;}})}});
 const controller=root.A1AssistantPosition.init(launcher,panel);
 handlers.pointerdown({button:0,pointerId:1,clientX:1000,clientY:500});handlers.pointermove({pointerId:1,clientX:100,clientY:200,preventDefault(){}});handlers.pointerup({pointerId:1});
 assert.equal(storage.size,1);const movedLeft=launcher.style.left;
 handlers.click({preventDefault(){},stopImmediatePropagation(){suppressed=true;}});assert.equal(suppressed,true);
 grip.keydown({key:'ArrowRight',preventDefault(){}});assert.equal(panel.style.width,'320px');
 email='user2@example.invalid';controller.restore();assert.equal(panel.style.width,'300px');assert.notEqual(launcher.style.left,movedLeft);
 email='user1@example.invalid';controller.restore();assert.equal(panel.style.width,'320px');assert.equal(launcher.style.left,movedLeft);
});
