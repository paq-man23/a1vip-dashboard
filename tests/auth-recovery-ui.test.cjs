const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function ui() {
  const html = fs.readFileSync('index.html', 'utf8');
  const script = html.slice(html.indexOf('    /* ===== Supabase staff authentication ===== */'), html.indexOf('    /* ===== Seed (links) ===== */'));
  const nodes = new Map(), events = new Map(), classes = new Set();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { style: {}, value: '', textContent: '', disabled: false, addEventListener() {} });
    return nodes.get(id);
  };
  let recovery = true, updated = false;
  const context = {
    A1Data: { recovering: () => recovery, restore: async () => false,
      finishPasswordReset: async password => { assert.equal(password, 'new-password'); updated = true; recovery = false; return {}; } },
    document: { body: { classList: { add: value => classes.add(value), remove: value => classes.delete(value) } }, getElementById: node, addEventListener() {} },
    window: { addEventListener: (event, fn) => events.set(event, fn) },
    localStorage: { removeItem() {} }, refreshInvoiceDatalists() {}, renderInvoiceHistory() {}, renderInvoicePresets() {}, startNewInvoice() {},
  };
  vm.runInNewContext(script, context);
  return { context, node, events, classes, updated: () => updated };
}
test('recovery on the main dashboard displays password fields and keeps the dashboard locked', async () => {
  const { context, node, classes } = ui(); await context.initializeAuth();
  assert.equal(node('passwordRecoveryPanel').style.display, 'block');
  assert.equal(node('normalLoginPanel').style.display, 'none');
  assert.equal(classes.has('a1-locked'), true);
  context.hideLogin();
  assert.equal(node('loginScreen').style.display, 'flex');
});
test('saving a matching recovery password returns to normal login, never opens the dashboard', async () => {
  const { context, node, classes, updated } = ui(); await context.initializeAuth();
  node('recoveryPassword').value = 'new-password'; node('recoveryConfirm').value = 'new-password';
  await context.finishPasswordReset({ preventDefault() {} });
  assert.equal(updated(), true);
  assert.equal(node('normalLoginPanel').style.display, 'block');
  assert.equal(classes.has('a1-locked'), true);
  assert.match(node('loginError').textContent, /Sign in with your new password/);
});
test('mismatched passwords do not submit an update', async () => {
  const { context, node, updated } = ui();
  node('recoveryPassword').value = 'new-password'; node('recoveryConfirm').value = 'different-password';
  await context.finishPasswordReset({ preventDefault() {} });
  assert.equal(updated(), false);
  assert.match(node('recoveryMessage').textContent, /do not match/);
});
