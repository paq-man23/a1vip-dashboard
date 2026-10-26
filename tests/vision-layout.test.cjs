const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('Vision layout preference persists and does not activate tablet layout',()=>{
 const html=fs.readFileSync('index.html','utf8'),start=html.lastIndexOf('(function(){');
 const classes=new Map(),events=[],listeners={},storage=new Map([['a1-dashboard-layout','vision']]);
 const picker={value:'',addEventListener:(name,fn)=>listeners[name]=fn};
 vm.runInNewContext(html.slice(start,html.indexOf('</script>',start)),{document:{getElementById:()=>picker,body:{classList:{toggle:(key,value)=>classes.set(key,value)}}},window:{matchMedia:()=>({matches:true,addEventListener(){}}),dispatchEvent:e=>events.push(e)},navigator:{userAgent:'Safari'},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},Event:class{constructor(type){this.type=type;}}});
 assert.equal(picker.value,'vision');assert.equal(classes.get('a1-vision'),true);assert.equal(classes.get('a1-duo'),false);
 picker.value='auto';listeners.change();assert.equal(classes.get('a1-vision'),false);assert.equal(storage.get('a1-dashboard-layout'),'auto');
});
test('move controls consume link activation only while move mode is enabled',async()=>{
 const listeners={},events={},classes=new Set(['a1-vision']);let moved;
 const node=()=>({children:[],textContent:'',classList:{},setAttribute(){},append(...items){this.children.push(...items);},prepend(item){this.children.unshift(item);},replaceChildren(){this.children=[];},addEventListener(name,fn){(this.events||={})[name]=fn;},showModal(){this.open=true;},close(){this.open=false;},focus(){}});
 const main=node(),body=node();body.classList={contains:k=>classes.has(k),add:k=>classes.add(k),remove:k=>classes.delete(k)};
 const button={isConnected:true,focus(){}};
 const data={authenticated:()=>true,isAdmin:()=>false};
 const root={A1Data:data,A1ButtonMoves:{source:()=>({from:'main',label:'Example',url:'https://example.com'}),destinations:()=>[{id:'main',label:'Main'},{id:'luxury',label:'Suites'}],move:async(item,to)=>moved=to},addEventListener:(name,fn)=>events[name]=fn};
 vm.runInNewContext(fs.readFileSync('vision-layout.js','utf8'),{window:root,A1Data:data,document:{body,createElement:node,querySelector:()=>main,addEventListener:(name,fn)=>{(listeners[name]||=[]).push(fn);}}});
 listeners.DOMContentLoaded[0]();const toolbar=main.children[0],toggle=toolbar.children[2],dialog=body.children[0];
 let prevented=0;const event={target:{closest:()=>button},preventDefault(){prevented++;},stopImmediatePropagation(){}};
 listeners.click[0](event);assert.equal(prevented,0);
 toggle.onclick();listeners.click[0](event);assert.equal(prevented,1);assert.equal(dialog.open,true);
 const choices=dialog.children[2];assert.equal(choices.children.length,1);await choices.children[0].onclick();assert.equal(moved,'luxury');assert.equal(classes.has('vision-moving'),false);
 events['a1-signed-out']();assert.equal(dialog.open,false);
});
