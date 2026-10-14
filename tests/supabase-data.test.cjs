const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function harness({ member = true, failSave = false } = {}) {
  let callback, savedArgs, loginArgs, resetArgs, updateArgs;
  const rows = [{ id: 'inv-one', version: 3, document: { id: 'inv-one', number: '4100', clientCompany: 'A1' } }];
  const client = {
    auth: {
      onAuthStateChange: fn => { callback = fn; },
      resetPasswordForEmail: async (email, options) => { resetArgs = { email, options }; return {}; },
      updateUser: async args => { updateArgs = args; return {}; },
      getSession: async () => ({ data: { session: {} } }),
      getUser: async () => ({ data: { user: { id: 'staff', email: 'staff@example.com' } } }),
      signInWithPassword: async args => { loginArgs = args; return { data: { user: { id: 'staff', email: args.email } } }; },
      signOut: async () => { callback('SIGNED_OUT'); return {}; }
    },
    from: table => {
      const query = { select() { return this; }, eq() { return this; }, order() { return this; },
        maybeSingle: async () => ({ data: member ? { user_id: 'staff' } : null }),
        range: async () => ({ data: table === 'a1_invoices' ? rows : [] }) };
      return query;
    },
    rpc: async (name, args) => {
      savedArgs = args;
      return failSave ? { error: { message: 'stale edit' } } : { data: { id: args.p_document.id, document: args.p_document, version: 4 } };
    }
  };
  const storage = new Map();
  const window = { A1_SUPABASE_CONFIG: { url: 'https://test.supabase.co', publishableKey: 'public', adminUsername: 'JAW', adminEmail: 'jaw@a1eei.com', passwordResetRedirect: 'https://a1dash.a1eei.com/reset-password.html' },
    supabase: { createClient: () => client }, dispatchEvent() {} };
  vm.runInNewContext(fs.readFileSync('a1-data.js','utf8'), { window, Event: class {}, localStorage: { getItem: key => storage.get(key) } });
  return { data: window.A1Data, storage, args: () => savedArgs, loginArgs: () => loginArgs, resetArgs: () => resetArgs, updateArgs: () => updateArgs, window };
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
test('legacy migration skips existing IDs and retains original browser backup', async () => {
  const { data, storage, args } = harness(); await data.restore();
  const legacy = JSON.stringify([{ id: 'inv-one', number: 'OLD' }, { id: 'inv-new', number: '4101' }]);
  storage.set('a1vip-invoices-v1', legacy);
  assert.equal(await data.migrateLegacy(), 1);
  assert.equal(data.invoices().find(item => item.id === 'inv-one').number, '4100');
  assert.equal(args().p_expected_version, null);
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
  window.A1_SUPABASE_CONFIG.adminEmail = '';
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
