const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function harness({platform='MacIntel',userAgent='Macintosh',touch=0,authenticated=true,blocked=false}={}){
 const location={href:''};let normalOpens=0,iframeOpens=0;
 const window={navigator:{platform,userAgent,maxTouchPoints:touch},location,A1Data:{authenticated:()=>authenticated,linkBlocked:()=>blocked,isAdmin:()=>false},open:()=>{normalOpens++;},A1Activity:{openSite:()=>{iframeOpens++;}},addEventListener(){}};
 const document={addEventListener(){}};vm.runInNewContext(fs.readFileSync('private-links.js','utf8'),{window,document,URL});
 return {api:window.A1PrivateLinks,location,normalOpens:()=>normalOpens,iframeOpens:()=>iframeOpens};
}
test('Al Ticketmaster links use the private shortcut for regular staff too, preserving the exact event URL',()=>{
 const h=harness(),event='https://www.ticketmaster.com/event/123?foo=a&bar=b#tickets',result=h.api.openAssistantTicketmaster(event),url=new URL(h.location.href);
 assert.equal(result.requested,true);assert.equal(url.protocol,'shortcuts:');assert.equal(url.searchParams.get('name'),'A1VIP Private Open');assert.equal(url.searchParams.get('input'),'text');assert.equal(url.searchParams.get('text'),event);assert.equal(h.normalOpens(),0);assert.equal(h.iframeOpens(),0);
});
test('unsupported platforms return instructions without opening a regular window or iframe',()=>{
 for(const options of [{platform:'Win32',userAgent:'Windows'},{platform:'MacIntel',userAgent:'Macintosh',touch:5},{platform:'iPhone',userAgent:'iPhone'}]){const h=harness(options);assert.equal(h.api.openAssistantTicketmaster('https://www.ticketmaster.com/event/123').requested,false);assert.equal(h.location.href,'');assert.equal(h.normalOpens(),0);assert.equal(h.iframeOpens(),0);}
});
test('only authenticated, permitted Ticketmaster addresses can dispatch the OS opener',()=>{
 for(const options of [{authenticated:false},{blocked:true}]){const h=harness(options);assert.throws(()=>h.api.openAssistantTicketmaster('https://www.ticketmaster.com/event/123'));assert.equal(h.location.href,'');}
 const h=harness();for(const url of ['javascript:alert(1)','https://ticketmaster.com.evil.invalid/event/1','https://user:secret@ticketmaster.com/event/1','http://ticketmaster.com/event/1','https://universe.com/event/1']){assert.equal(h.api.isTicketmasterUrl(url),false);assert.throws(()=>h.api.openAssistantTicketmaster(url));assert.equal(h.location.href,'');}
 assert.equal(h.api.isTicketmasterUrl('https://www.ticketmaster.co.uk/event/123'),true);
});
