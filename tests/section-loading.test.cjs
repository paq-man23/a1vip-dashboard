const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function setup(load){
  const source=fs.readFileSync('index.html','utf8');
  const start=source.indexOf('    async function loadSectionData(');
  const end=source.indexOf('// URLs that should open',start);
  const content={inert:false};
  const section={children:[content],querySelector(){return this.status;},prepend(el){this.status=el;this.children.unshift(el);}};
  let renders=0;
  const context={A1Data:{authenticated:()=>true,loadSection:load},refreshCloudViews:()=>renders++,document:{getElementById:()=>section,createElement:()=>({textContent:'',setAttribute(){},append(button){this.button=button;}})}};
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  return {run:context.loadSectionData,section,content,renders:()=>renders};
}
test('section editor is blocked until shared records arrive and then rendered',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve);
  const ui=setup(()=>gate);const pending=ui.run('customers');
  assert.equal(ui.content.inert,true);assert.match(ui.section.status.textContent,/Loading/);
  release();await pending;
  assert.equal(ui.content.inert,false);assert.equal(ui.renders(),1);assert.equal(ui.section.status.textContent,'');
});
test('failed section load offers a usable retry while keeping unloaded editors blocked',async()=>{
  let fail=true;const ui=setup(async()=>{if(fail)throw new Error('Offline');});
  await ui.run('invoices');assert.equal(ui.content.inert,true);assert.match(ui.section.status.textContent,/Offline/);
  fail=false;await ui.section.status.button.onclick();assert.equal(ui.content.inert,false);assert.equal(ui.renders(),1);
});
