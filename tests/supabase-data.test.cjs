const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function harness({ member = true, failSave = false, recoverySession = false, initialMarker = null, documentRows = [], contactRows = [], conflictRows = [], importResults = [] } = {}) {
  let callback, savedArgs, loginArgs, resetArgs, updateArgs;
  const calls = [], filters = [];
  const rows = [{ id: 'inv-one', version: 3, document: { id: 'inv-one', number: '4100', clientCompany: 'A1' } }];
  const client = {
    auth: {
      onAuthStateChange: fn => { callback = fn; },
      resetPasswordForEmail: async (email, options) => { resetArgs = { email, options }; return {}; },
      updateUser: async args => { updateArgs = args; return {}; },
      getSession: async () => { if (recoverySession) callback('PASSWORD_RECOVERY', { user: { id: 'staff' } }); return { data: { session: {} } }; },
      getUser: async () => ({ data: { user: { id: 'staff', email: 'staff@example.com' } } }),
      signInWithPassword: async args => { loginArgs = args; return { data: { user: { id: 'staff', email: args.email } } }; },
      signOut: async () => { callback('SIGNED_OUT'); return {}; }
    },
    from: table => {
      const query = { select() { if (this.deleting) return Promise.resolve({ data: [{id:'deleted'}] }); return this; }, delete() { this.deleting = true; return this; }, eq(key, value) { filters.push([key,value]); return this; }, order() { return this; },
        maybeSingle: async () => ({ data: member ? { user_id: 'staff' } : null }),
        range: async () => ({ data: table === 'a1_invoices' ? rows : table === 'a1_skybox_contacts' ? contactRows : table === 'a1_documents' ? documentRows : table === 'a1_import_conflicts' ? conflictRows : [] }) };
      return query;
    },
    rpc: async (name, args) => {
      savedArgs = args; calls.push({ name, args });
      if (name === 'a1_import_skybox_batch') return {data:args.p_items.map(() => ({outcome:'imported'}))};
      if (name === 'a1_import_document') { const result = importResults.shift(); return result?.error ? { error: { message: result.error } } : { data: result || { outcome: 'imported' } }; }
      return failSave ? { error: { message: 'stale edit' } } : { data: { id: args.p_document.id, document: args.p_document, version: 4 } };
    }
  };
  const storage = new Map();
  const session = new Map();
  if (initialMarker) session.set('a1vip-password-recovery', initialMarker);
  const window = { A1_SUPABASE_CONFIG: { url: 'https://test.supabase.co', publishableKey: 'public', adminAliases: { JAW: 'jaw@a1eei.com', JV: 'vollario@mac.com' }, passwordResetRedirect: 'https://a1dash.a1eei.com/reset-password.html' },
    supabase: { createClient: () => client }, dispatchEvent() {} };
  vm.runInNewContext(fs.readFileSync('a1-data.js','utf8'), { window, Event: class { constructor(type) { this.type = type; } }, sessionStorage: { getItem: key => session.get(key), setItem: (key, value) => session.set(key, value), removeItem: key => session.delete(key) }, localStorage: { getItem: key => storage.get(key) } });
  return { data: window.A1Data, storage, args: () => savedArgs, loginArgs: () => loginArgs, resetArgs: () => resetArgs, updateArgs: () => updateArgs, authEvent: (event, value) => callback(event, value), calls, filters, session, window };
}
test('approved staff restore invoice history; callers cannot mutate the cache', async () => {
  const { data } = harness(); await data.restore();
  assert.equal(data.authenticated(), true);
  const invoice = data.invoices()[0]; invoice.number = 'bad';
  assert.equal(data.invoices()[0].number, '4100');
});
test('unapproved accounts cannot read or save invoices', async () => {
  const { data } = harness({ member: false });
  await assert.rejects(data.login('other@example.com','password'), /not been approved/);
  assert.equal(data.authenticated(), false);
  await assert.rejects(data.save({ id: 'inv-new' }), /Sign in/);
});
test('failed cloud save preserves history and sends the expected version', async () => {
  const { data, args } = harness({ failSave: true }); await data.restore();
  await assert.rejects(data.save({ id: 'inv-one', number: '4200' }), /stale edit/);
  assert.equal(args().p_expected_version, 3);
  assert.equal(data.invoices()[0].number, '4100');
});
test('new save updates in-memory history only after cloud success', async () => {
  const { data, args } = harness(); await data.restore();
  await data.save({ id: 'inv-new', number: '4101' });
  assert.equal(args().p_expected_version, null);
  assert.equal(data.invoices()[0].number, '4101');
});
test('sign out drops loaded invoices and blocks subsequent saves', async () => {
  const { data } = harness(); await data.restore(); await data.logout();
  assert.equal(data.invoices().length, 0);
  await assert.rejects(data.save({ id: 'inv-new' }), /Sign in/);
});
test('legacy import reports conflicts and preserves the original browser backup', async () => {
  const { data, storage, calls } = harness({ importResults: [{outcome:'conflict'}, {outcome:'imported'}] }); await data.restore();
  const legacy = JSON.stringify([{ id: 'inv-one', number: 'OLD' }, { id: 'inv-new', number: '4101' }]);
  storage.set('a1vip-invoices-v1', legacy);
  const summary = await data.migrateLegacy();
  assert.equal(summary.imported, 1); assert.equal(summary.conflicts, 1);
  assert.equal(calls.filter(call => call.name === 'a1_import_document').length, 2);
  assert.equal(storage.get('a1vip-invoices-v1'), legacy);
});
test('missing configuration fails closed', async () => {
  const window = { A1_SUPABASE_CONFIG: {} };
  vm.runInNewContext(fs.readFileSync('a1-data.js','utf8'), { window });
  await assert.rejects(window.A1Data.restore(), /not configured/);
  assert.equal(window.A1Data.authenticated(), false);
});

test('JAW stays the visible username and resolves to the configured Auth account', async () => {
  const { data, loginArgs } = harness();
  await data.login('JAW', 'password');
  assert.equal(loginArgs().email, 'jaw@a1eei.com');
  assert.equal(data.authenticated(), true);
});
test('an unconfigured JAW account cannot bypass authentication', async () => {
  const { data, window } = harness();
  window.A1_SUPABASE_CONFIG.adminAliases.JAW = '';
  await assert.rejects(data.login('JAW', 'password'), /still needs to be configured/);
  assert.equal(data.authenticated(), false);
});

test('forgot-password resolves JAW and uses the configured recovery page', async () => {
  const { data, resetArgs } = harness();
  await data.requestPasswordReset('JAW');
  assert.equal(resetArgs().email, 'jaw@a1eei.com');
  assert.equal(resetArgs().options.redirectTo, 'https://a1dash.a1eei.com/reset-password.html');
});
test('signed-in reset requests use the current account rather than caller input', async () => {
  const { data, resetArgs } = harness(); await data.restore();
  await data.requestPasswordReset('someone-else@example.com');
  assert.equal(resetArgs().email, 'staff@example.com');
});
test('password changes reauthenticate and update the password without changing email', async () => {
  const { data, loginArgs, updateArgs } = harness(); await data.restore();
  await data.updateAccount('current-password', 'new-password');
  assert.equal(loginArgs().email, 'staff@example.com');
  assert.equal(loginArgs().password, 'current-password');
  assert.equal(updateArgs().password, 'new-password');
  assert.equal(updateArgs().email, undefined);
});

test('JV resolves to its own Auth account, including lowercase input', async () => {
  const { data, loginArgs } = harness();
  await data.login('jv', 'password');
  assert.equal(loginArgs().email, 'vollario@mac.com');
});
test('unknown usernames cannot authenticate through an admin alias', async () => {
  const { data } = harness();
  await assert.rejects(data.login('other-admin', 'password'), /Invalid username/);
  assert.equal(data.authenticated(), false);
});

test('an emailed recovery session does not restore ordinary dashboard access', async () => {
  const { data } = harness({ recoverySession: true });
  assert.equal(await data.restore(), false);
  assert.equal(data.recovering(), true);
  assert.equal(data.authenticated(), false);
  assert.equal(data.invoices().length, 0);
  await assert.rejects(data.save({ id: 'inv-new' }), /Sign in/);
  await assert.rejects(data.refresh(), /Choose your new password/);
});
test('recovery arriving in an already signed-in page clears invoice access', async () => {
  const { data, authEvent } = harness(); await data.restore();
  authEvent('PASSWORD_RECOVERY', { user: { id: 'staff' } });
  assert.equal(data.authenticated(), false);
  assert.equal(data.invoices().length, 0);
});
test('reloading a pending recovery stays in password reset mode', async () => {
  const { data } = harness({ initialMarker: 'staff' });
  assert.equal(await data.restore(), false);
  assert.equal(data.recovering(), true);
});
test('the new password is submitted and recovery is cleared after success', async () => {
  const { data, updateArgs, session } = harness({ recoverySession: true }); await data.restore();
  await data.finishPasswordReset('replacement-password');
  assert.equal(updateArgs().password, 'replacement-password');
  assert.equal(data.recovering(), false);
  assert.equal(data.authenticated(), false);
  assert.equal(session.has('a1vip-password-recovery'), false);
});
test('ordinary sessions cannot invoke recovery password updates', async () => {
  const { data } = harness(); await data.restore();
  await assert.rejects(data.finishPasswordReset('replacement-password'), /valid password reset link/);
});

test('letters and complete travel itineraries are loaded from the shared database', async () => {
  const trip = { id: 'itin-trip', hotelReservations:[{roomNumber:'123'}], rentalCars:[{company:'Example'}], flightDetails:[{flightNumber:'123'}] };
  const { data } = harness({ documentRows:[{kind:'letter',id:'letter-one',version:2,document:{id:'letter-one',body:'Saved letter'}},{kind:'itinerary',id:'itin-trip',version:3,document:trip}] });
  await data.restore();
  assert.equal(data.documents('letter')[0].body, 'Saved letter');
  assert.equal(data.documents('itinerary')[0].hotelReservations[0].roomNumber, '123');
  const copy = data.documents('itinerary'); copy[0].flightDetails[0].flightNumber = 'changed';
  assert.equal(data.documents('itinerary')[0].flightDetails[0].flightNumber, '123');
});
test('saving a shared letter uses its loaded version and a failed save preserves history', async () => {
  const { data, args } = harness({ failSave:true, documentRows:[{kind:'letter',id:'letter-one',version:2,document:{id:'letter-one',body:'Original'}}] });
  await data.restore();
  await assert.rejects(data.saveDocument('letter', {id:'letter-one',body:'Edited'}), /stale edit/);
  assert.equal(args().p_expected_version, 2);
  assert.equal(data.documents('letter')[0].body, 'Original');
});
test('document deletion includes both kind and loaded version', async () => {
  const { data, filters } = harness({ documentRows:[{kind:'itinerary',id:'itin-trip',version:4,document:{id:'itin-trip'}}] });
  await data.restore(); await data.removeDocument('itinerary','itin-trip');
  assert.ok(filters.some(([key,value]) => key==='kind' && value==='itinerary'));
  assert.ok(filters.some(([key,value]) => key==='version' && value===4));
  assert.equal(data.documents('itinerary').length, 0);
});
test('combined browser migration imports each category and continues past a failed record', async () => {
  const { data, storage, calls } = harness({ importResults:[{outcome:'imported'},{error:'Invalid record'},{outcome:'skipped'},{outcome:'imported',copied:true}] });
  await data.restore();
  storage.set('a1vip-invoices-v1',JSON.stringify([{id:'inv-a',number:'1'},{id:'inv-b',number:'2'}]));
  storage.set('a1vip-form-letters-v1',JSON.stringify([{id:'letter-a',body:'body'}]));
  storage.set('a1vip-itineraries-v1',JSON.stringify([{id:'itin-a',flightDetails:[{flightNumber:'ABC'}]}]));
  const result = await data.migrateAll();
  assert.equal(result.imported, 2); assert.equal(result.skipped, 1); assert.equal(result.copied, 1); assert.equal(result.errors.length, 1);
  assert.deepEqual(calls.map(call => call.args.p_kind), ['invoice','invoice','letter','itinerary']);
  assert.equal(calls[3].args.p_document.flightDetails[0].flightNumber, 'ABC');
  assert.ok(storage.has('a1vip-itineraries-v1'));
});
test('signout clears shared documents and imported conflicts', async () => {
  const { data } = harness({ documentRows:[{kind:'letter',id:'letter-a',version:1,document:{id:'letter-a'}}], conflictRows:[{kind:'invoice',source_hash:'abc',document:{id:'inv-a'}}] });
  await data.restore(); await data.logout();
  assert.equal(data.documents('letter').length,0); assert.equal(data.conflicts().length,0);
});
test('an editor keeps its original version even after history refreshes to a newer version', async () => {
  const { data, args } = harness({ documentRows:[{kind:'letter',id:'letter-a',version:5,document:{id:'letter-a',body:'New cloud version'}}] });
  await data.restore();
  await data.saveDocument('letter',{id:'letter-a',body:'Earlier draft'},2);
  assert.equal(args().p_expected_version,2);
});
test('an explicit new-draft version does not turn into a cloud update', async () => {
  const { data, args } = harness(); await data.restore();
  await data.save({id:'inv-one',number:'4200'}, {}, null);
  assert.equal(args().p_expected_version,null);
});

test('shared imported contacts are copied and cleared on signout', async () => {
  const {data}=harness({contactRows:[{document:{id:'123',kind:'vendor',displayName:'Example'}}]});await data.restore();
  const c=data.contacts();assert.equal(c[0].displayName,'Example');c[0].displayName='Altered';assert.equal(data.contacts()[0].displayName,'Example');
  await data.logout();assert.equal(data.contacts().length,0);await assert.rejects(data.importSkybox([]),/Sign in/);
});

test('Skybox imports use batches of 50 and report progress without importing invalid previews', async () => {
 const {data,calls}=harness();await data.restore();const items=Array.from({length:51},(_,i)=>({kind:'vendor',sourceId:String(i+1),record:{},document:{},presets:{}}));const progress=[];
 const result=await data.importSkybox(items,(done,total)=>progress.push([done,total]));assert.equal(result.imported,51);assert.deepEqual(progress,[[50,51],[51,51]]);
 assert.deepEqual(calls.filter(c=>c.name==='a1_import_skybox_batch').map(c=>c.args.p_items.length),[50,1]);
 await assert.rejects(data.importSkybox([{error:'bad data'}]),/blocked preview/);
});
