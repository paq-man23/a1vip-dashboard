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
    setTimeout, clearTimeout,
    A1Data: { login: async () => {}, documents: () => [], version: () => 1, conflicts: () => [], recovering: () => recovery, restore: async () => false,
      finishPasswordReset: async password => { assert.equal(password, 'new-password'); updated = true; recovery = false; return {}; } },
    document: { body: { classList: { add: value => classes.add(value), remove: value => classes.delete(value) } }, getElementById: node, addEventListener() {} },
    window: { addEventListener: (event, fn) => events.set(event, fn) },
    localStorage: { removeItem() {} }, refreshInvoiceDatalists() {}, renderInvoiceHistory() {}, renderInvoicePresets() {}, renderLetterHistory() {}, renderItineraryHistory() {}, startNewInvoice() {}, startNewLetter() {}, startNewItinerary() {},
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

test('login displays progress immediately while startup is pending and reports failure', async () => {
  const { context, node } = ui();
  let rejectStartup;
  context.pendingStartup = new Promise((_, reject) => { rejectStartup = reject; });
  vm.runInContext('authReady = pendingStartup', context);
  const attempt = context.handleLogin();
  assert.equal(node('loginButton').disabled, true);
  assert.equal(node('loginError').textContent, 'Checking sign-in…');
  rejectStartup(new Error('Startup failed'));
  await attempt;
  assert.equal(node('loginButton').disabled, false);
  assert.equal(node('loginError').textContent, 'Startup failed');
});
test('missing or stale login files show an actionable error', async () => {
  for (const missing of [true, false]) {
    const { context, node } = ui();
    if (missing) delete context.A1Data;
    else delete context.A1Data.documents;
    await context.initializeAuth();
    assert.match(node('loginError').textContent, missing ? /Login code could not load/ : /Login files are out of date/);
    await context.handleLogin();
    assert.equal(node('loginButton').disabled, false);
    assert.match(node('loginError').textContent, missing ? /Login code could not load/ : /Login files are out of date/);
  }
});
test('startup timeout unlocks the login button and provides recovery steps', async () => {
  const { context, node } = ui();
  context.pendingStartup = new Promise(() => {});
  vm.runInContext('authReady = pendingStartup', context);
  context.setTimeout = callback => { queueMicrotask(callback); return 1; };
  context.clearTimeout = () => {};
  await context.handleLogin();
  assert.equal(node('loginButton').disabled, false);
  assert.match(node('loginError').textContent, /startup timed out/);
});

test('saved-session loading hides credential fields and announces that the user is already signed in',()=>{
 const {context,node,events}=ui();context.A1Data.recovering=()=>false;context.showLogin(true);assert.equal(node('normalLoginPanel').style.display,'none');assert.equal(node('sessionLoadingPanel').style.display,'block');events.get('a1-restoring-session')();assert.match(node('sessionLoadingMessage').textContent,/Already signed in/);
});
test('restore failure returns to the login form with a visible error',async()=>{
 const {context,node}=ui();context.A1Data.recovering=()=>false;context.A1Data.restore=async()=>{throw Error('Connection failed');};await context.initializeAuth();assert.equal(node('normalLoginPanel').style.display,'block');assert.equal(node('sessionLoadingPanel').style.display,'none');assert.equal(node('loginError').textContent,'Connection failed');
});
