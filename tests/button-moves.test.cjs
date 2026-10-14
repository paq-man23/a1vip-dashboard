const {test}=require('node:test'),assert=require('node:assert/strict'),M=require('../button-moves');
const move={from:'main',to:'luxury',label:'Example Link',url:'https://example.invalid/#tickets'};
test('a move preserves the URL, removes custom source copies and records a source tombstone without mutating the original',()=>{
 const state={added:{main:[{label:move.label,url:move.url}]},removed:{}};const next=M.moveState(state,move);assert.equal(next.added.main.length,0);assert.deepEqual(next.added.luxury,[{label:move.label,url:move.url}]);assert.deepEqual(next.removed.main,[move.label]);assert.equal(state.added.main.length,1);
});
test('pending moves survive stale remote data and destination tombstones until the server acknowledges them',()=>{
 const next=M.moveState({added:{},removed:{}},move);const stale={added:{main:[{label:move.label,url:move.url}]},removed:{luxury:[move.label]}};
 const merged={...next,added:stale.added,removed:stale.removed};const result=M.reconcile(merged,stale);assert.equal(result.added.main.length,0);assert.equal(result.added.luxury[0].url,move.url);assert.equal(result.removed.luxury.length,0);assert.equal(result.pendingMoves.length,1);
 const ack={added:{luxury:[{label:move.label,url:move.url}]},removed:{main:[move.label]}};assert.equal(M.reconcile(result,ack).pendingMoves.length,0);
});
test('moving a link back clears its old destination tombstone and retains only its latest pending receipt',()=>{
 const first=M.moveState({added:{},removed:{}},move);const back=M.moveState(first,{...move,from:'luxury',to:'main'});assert.equal(back.pendingMoves.length,1);assert.equal(back.removed.main.length,0);assert.equal(back.added.main[0].url,move.url);assert.equal(back.added.luxury.length,0);
});
test('invalid moves cannot silently remove a button',()=>{assert.throws(()=>M.moveState({added:{},removed:{}},{...move,to:'main'}),/Invalid/);assert.throws(()=>M.moveState({added:{},removed:{}},{...move,url:''}),/Invalid/);});
