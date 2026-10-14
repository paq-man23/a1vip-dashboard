const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
for (const [kind, label] of [['letter','Letter'],['itinerary','Itinerary']]) {
  test(label + ' save uses the editor version and reports a cloud failure without marking it saved', async () => {
    const html = fs.readFileSync('index.html','utf8');
    const script = html.slice(html.indexOf('    async function save' + label + '(){'),html.indexOf('    function export' + label + 'File'));
    const alerts = [], calls = [];
    const context = { alert: text => alerts.push(text), A1Data: {
      saveDocument: async (...args) => { calls.push(args); throw new Error('Cloud save failed'); }, version: () => 5
    } };
    context['current' + label + 'Id'] = 'old-editor';
    context['current' + label + 'Version'] = 2;
    context['collect' + label + 'FromForm'] = () => ({id:kind==='letter'?'letter-a':'itin-a'});
    context['refresh' + label + 'Preview'] = () => {};
    context['render' + label + 'History'] = () => {};
    vm.runInNewContext(script,context);
    await context['save' + label]();
    assert.equal(calls[0][2],2);
    assert.equal(context['current' + label + 'Id'],'old-editor');
    assert.match(alerts[0],/was not saved: Cloud save failed/);
  });
}
test('renaming a letter advances a matching editor version without blessing an older draft', async () => {
  const html = fs.readFileSync('index.html','utf8');
  const script = html.slice(html.indexOf('    async function renameLetter(id){'),html.indexOf('    async function clearLetterHistory(){'));
  for (const baseVersion of [1,2]) {
    let version = 2;
    const context = { prompt: () => 'Renamed', alert() {}, currentLetterId:'letter-a', currentLetterVersion:baseVersion, currentLetterSavedName:'',
      loadLetters: () => [{id:'letter-a',savedName:'Original'}], renderLetterHistory() {},
      A1Data: { version: () => version, saveDocument: async () => { version = 3; } } };
    vm.runInNewContext(script,context); await context.renameLetter('letter-a');
    assert.equal(context.currentLetterVersion,baseVersion===2 ? 3 : 1);
  }
});
