const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),{fit,dimensions}=require('../assistant-position.js');
test('Al starts compact and clamps the character and bubble to the screen',()=>{
 assert.deepEqual(dimensions(undefined,undefined,1200,800),{width:300,height:220});
 assert.deepEqual(dimensions(999,999,360,500),{width:344,height:476});
 assert.deepEqual(fit(-20,900,72,80,360,500),{x:8,y:412});
});
test('character movement and bubble size persist only for the current account',()=>{
 let email='user1@example.invalid',captured=false,suppressed=false,grip;const events={},storage=new Map(),handlers={};
 const launcher={style:{},getBoundingClientRect(){return {left:parseFloat(this.style.left)||600,top:parseFloat(this.style.top)||500,width:72,height:80};},addEventListener:(name,fn)=>handlers[name]=fn,setPointerCapture(){captured=true;},hasPointerCapture:()=>captured,releasePointerCapture(){captured=false;}};
 const panel={querySelector:()=>null,hidden:false,style:{setProperty(){}},classList:{toggle(){}},append(node){grip=node;}};
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
test('replies grow the bubble, keep the beginning visible and show a scroll cue for overflow',()=>{
 const elements=[];const log={scrollHeight:1100,scrollTop:0,offsetTop:40,get clientHeight(){return (parseFloat(panel.style.height)||220)-80;},addEventListener(name,fn){this[name]=fn;},scrollBy({top}){this.scrollTop+=top;this.scroll();}};
 const panel={hidden:false,style:{setProperty(){}},get offsetHeight(){return parseFloat(this.style.height)||220;},querySelector:s=>s==='.copilot-log'?log:{offsetHeight:48},classList:{toggle(){}},append(n){elements.push(n);}};
 const launcher={style:{},getBoundingClientRect:()=>({left:1000,top:700,width:72,height:80}),addEventListener(){}};
 const root={A1Data:{account:()=>null},addEventListener(){}};
 vm.runInNewContext(fs.readFileSync('assistant-position.js','utf8'),{window:root,innerWidth:1200,innerHeight:800,localStorage:{},document:{body:{classList:{remove(){}}},createElement:()=>({style:{},setAttribute(){},addEventListener(name,fn){this[name]=fn;}})}});
 const controller=root.A1AssistantPosition.init(launcher,panel),reply={isConnected:true,textContent:'A long answer '.repeat(50),offsetHeight:300,offsetTop:400,previousElementSibling:null};
 controller.fitReply(reply);assert.ok(parseFloat(panel.style.height)>220);assert.equal(log.scrollTop,354);assert.equal(elements[0].hidden,false);
 log.scrollTop=1100;log.scroll();assert.equal(elements[0].hidden,true);
 reply.offsetHeight=1600;controller.fitReply(reply);assert.ok(parseFloat(panel.style.height)<=600);assert.equal(elements[0].hidden,false);
});
test('multi-card search sizes the whole answer, keeps its beginning and preserves user scrolling during later results',()=>{
 const elements=[],frames=[];
 const log={scrollHeight:1400,scrollTop:0,get clientHeight(){return parseFloat(panel.style.height)-80;},getBoundingClientRect:()=>({top:100}),addEventListener(name,fn){this[name]=fn;},scrollBy({top}){this.scrollTop+=top;}};
 const panel={hidden:false,style:{setProperty(){}},get offsetHeight(){return parseFloat(this.style.height)||220;},querySelector:s=>s==='.copilot-log'?log:{offsetHeight:48},classList:{toggle(){}},append(n){elements.push(n);}};
 const launcher={style:{},getBoundingClientRect:()=>({left:1000,top:700,width:72,height:80}),addEventListener(){}};
 const root={A1Data:{account:()=>null},addEventListener(){},requestAnimationFrame:fn=>frames.push(fn)};
 vm.runInNewContext(fs.readFileSync('assistant-position.js','utf8'),{window:root,innerWidth:1200,innerHeight:800,localStorage:{},document:{body:{classList:{remove(){}}},createElement:()=>({style:{},setAttribute(){},addEventListener(name,fn){this[name]=fn;}})}});
 const controller=root.A1AssistantPosition.init(launcher,panel);
 function card(y,height,user=false,previous=null){return {isConnected:true,textContent:'Result',offsetHeight:height,previousElementSibling:previous,classList:{contains:()=>user},getBoundingClientRect:()=>({top:100+y-log.scrollTop})};}
 const question=card(100,40,true),summary=card(150,40,false,question),first=card(200,180,false,summary),last=card(390,180,false,first);
 controller.fitReply(summary);controller.fitReply(first);controller.fitReply(last);while(frames.length)frames.shift()();
 assert.equal(panel.style.height,'574px');assert.equal(log.scrollTop,94);assert.equal(elements[0].hidden,false);
 const later=card(580,180,false,last);controller.fitReply(later);while(frames.length)frames.shift()();
 assert.equal(panel.style.height,'600px');assert.equal(log.scrollTop,144,'overflow begins at the answer summary rather than the last card');
 log.wheel();log.scrollTop=300;const more=card(770,180,false,later);controller.fitReply(more);while(frames.length)frames.shift()();assert.equal(log.scrollTop,300,'late results do not pull the user away from reading');
 const nextQuestion=card(1000,40,true,more),nextAnswer=card(1050,50,false,nextQuestion);controller.fitReply(nextAnswer);while(frames.length)frames.shift()();assert.equal(log.scrollTop,994,'a new question resets the answer anchor');
});
