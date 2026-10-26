const {test}=require('node:test'),assert=require('node:assert/strict'),{build}=require('../account-preview.js');
const link=(section,label,url)=>({section,label,url,key:JSON.stringify([section,label,url])});
test('preview combines saved personal buttons and shared buttons while honoring category and link removals',()=>{
 const shared=[link('main','Visible','https://visible.example'),link('main','Hidden','https://hidden.example'),link('luxury','No suites','https://suites.example'),link('main','Blocked','https://blocked.example'),link('privatejet','Jet','https://jet.example'),link('admin','Admin','javascript:admin()')];
 const choices={allowed_sections:['main','travel'],hidden_buttons:[shared[1].key],blocked_links:[shared[3].key],added_links:[{section:'main',label:'Personal',url:'https://personal.example'},{section:'social',label:'No social',url:'https://social.example'},{section:'travel',label:'Blocked copy',url:'https://blocked.example'}]};const before=JSON.stringify(choices),model=build(choices,shared);
 assert.deepEqual(model.sections.map(s=>s[0]),['main','travel']);assert.deepEqual(model.links.map(l=>l.label),['Visible','Jet','Personal']);assert.equal(JSON.stringify(choices),before);assert.equal(shared.length,6);
});
test('default category access excludes admin-only categories; empty selections stay empty',()=>{
 const shared=[link('domains','Admin domain','https://domain.example'),link('main','Default','https://default.example')];assert.deepEqual(build({allowed_sections:[],added_links:[]},shared),{sections:[],links:[]});assert.equal(build({allowed_sections:null},shared).links.length,1);assert.equal(build({allowed_sections:null},shared).sections.length,10);
});
test('personal moves hide originals and show the relocated button in the saved destination',()=>{
 const original=link('main','Moved','https://moved.example');const model=build({allowed_sections:['main','accounts'],hidden_buttons:[original.key],added_links:[{section:'accounts',label:'Moved',url:original.url}]},[original]);assert.deepEqual(model.links.map(l=>[l.section,l.label]),[['accounts','Moved']]);
});
