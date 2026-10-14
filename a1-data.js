/* Supabase-backed A1 staff invoices. No invoice/password data is cached locally. */
(() => {
  let client, user, ready = false;
  let recoveryUserId = null;
  const RECOVERY_KEY = 'a1vip-password-recovery';
  try { recoveryUserId = sessionStorage.getItem(RECOVERY_KEY) || null; } catch {}
  function endRecovery() {
    recoveryUserId = null;
    try { sessionStorage.removeItem(RECOVERY_KEY); } catch {}
  }
  function beginRecovery(id) {
    recoveryUserId = id;
    ready = false; invoices = []; presets = {}; versions.clear();
    try { sessionStorage.setItem(RECOVERY_KEY, id); } catch {}
    window.dispatchEvent(new Event('a1-password-recovery'));
  }
  let invoices = [], presets = {}, versions = new Map();
  const copy = value => JSON.parse(JSON.stringify(value));
  const check = result => { if (result.error) throw new Error(result.error.message); return result.data; };
  function connect() {
    if (client) return client;
    const config = window.A1_SUPABASE_CONFIG || {};
    if (!config.url || !config.publishableKey || !window.supabase) {
      throw new Error('Supabase is not configured yet. Contact the dashboard administrator.');
    }
    client = window.supabase.createClient(config.url, config.publishableKey);
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && session?.user?.id) beginRecovery(session.user.id);
      if (event === 'SIGNED_OUT') { endRecovery(); clear(); window.dispatchEvent(new Event('a1-signed-out')); }
    });
    return client;
  }
  function clear() { user = null; ready = false; invoices = []; presets = {}; versions.clear(); }
  function requireReady() {
    if (!user || !ready || recoveryUserId) throw new Error('Sign in and load Supabase invoices before saving.');
    return client;
  }
  async function refresh() {
    if (recoveryUserId) throw new Error('Choose your new password before accessing invoices.');
    if (!user) throw new Error('Please sign in first.');
    const identity = user.id;
    const member = check(await client.from('a1_staff').select('user_id').eq('user_id', identity).maybeSingle());
    if (!member) { clear(); throw new Error('This account has not been approved for the A1 Dashboard.'); }
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const page = check(await client.from('a1_invoices').select('id,document,version').order('id').range(offset, offset + 499));
      rows.push(...page);
      if (page.length < 500) break;
    }
    const values = [];
    for (let offset = 0; ; offset += 500) {
      const page = check(await client.from('a1_invoice_presets').select('category,value').order('category').order('value').range(offset, offset + 499));
      values.push(...page);
      if (page.length < 500) break;
    }
    if (user?.id !== identity || recoveryUserId) throw new Error('Session changed. Sign in again.');
    invoices = rows.map(row => row.document);
    versions = new Map(rows.map(row => [row.id, row.version]));
    presets = {};
    for (const row of values) (presets[row.category] ||= []).push(row.value);
    ready = true;
  }
  async function restore() {
    clear();
    const c = connect();
    const session = check(await c.auth.getSession());
    if (!session.session) { endRecovery(); return false; }
    const data = check(await c.auth.getUser());
    if (!data.user) return false;
    user = data.user;
    if (recoveryUserId === user.id) { beginRecovery(user.id); return false; }
    endRecovery();
    await refresh();
    return true;
  }
  function loginEmail(identifier) {
    const config = window.A1_SUPABASE_CONFIG || {};
    let email = String(identifier || '').trim();
    if (!email.includes('@')) {
      const aliases = config.adminAliases || { [config.adminUsername || 'JAW']: config.adminEmail };
      const entry = Object.entries(aliases).find(([username]) => username.toLowerCase() === email.toLowerCase());
      if (!entry) throw new Error('Invalid username or password.');
      if (!entry[1]) throw new Error('This Supabase account still needs to be configured.');
      email = entry[1];
    }
    return email;
  }
  async function login(identifier, password) {
    if (recoveryUserId) throw new Error('Finish resetting your password or cancel the reset first.');
    clear();
    const email = loginEmail(identifier);
    const data = check(await connect().auth.signInWithPassword({ email, password }));
    user = data.user;
    try { await refresh(); } catch (error) { await client.auth.signOut(); clear(); throw error; }
  }
  async function save(document, presetValues = {}) {
    const c = requireReady(), identity = user.id;
    const row = check(await c.rpc('a1_save_invoice', {
      p_document: document,
      p_expected_version: versions.get(document.id) ?? null,
      p_presets: presetValues
    }));
    if (user?.id !== identity) throw new Error('Session changed. Reload invoices to check the save.');
    versions.set(row.id, row.version);
    invoices = [row.document, ...invoices.filter(item => item.id !== row.id)];
    for (const [category, values] of Object.entries(presetValues)) {
      const merged = new Set([...(presets[category] || []), ...values]);
      presets[category] = [...merged];
    }
  }
  async function remove(id) {
    const c = requireReady(), identity = user.id;
    const version = versions.get(id);
    if (version == null) throw new Error('Refresh history before deleting this invoice.');
    const rows = check(await c.from('a1_invoices').delete().eq('id', id).eq('version', version).select('id'));
    if (!rows.length) throw new Error('Invoice changed on another device. Refresh history before deleting.');
    if (user?.id !== identity) return;
    versions.delete(id); invoices = invoices.filter(item => item.id !== id);
  }
  async function updateAccount(currentPassword, password) {
    requireReady();
    check(await client.auth.signInWithPassword({ email: user.email, password: currentPassword }));
    check(await client.auth.updateUser({ password }));
  }
  async function finishPasswordReset(password) {
    if (!recoveryUserId) throw new Error('Open a valid password reset link first.');
    const c = connect();
    const data = check(await c.auth.getUser());
    if (!data.user || data.user.id !== recoveryUserId) throw new Error('Your reset link has expired. Request a new one.');
    check(await c.auth.updateUser({ password }));
    endRecovery(); clear();
    // A sign-out failure must not report a successfully changed password as failed.
    const result = await c.auth.signOut({ scope: 'local' });
    window.dispatchEvent(new Event('a1-signed-out'));
    return { signOutFailed: !!result.error };
  }
  async function requestPasswordReset(identifier) {
    const email = user && ready ? user.email : loginEmail(identifier);
    const redirectTo = window.A1_SUPABASE_CONFIG?.passwordResetRedirect;
    if (!redirectTo) throw new Error('Password reset is not configured yet.');
    check(await connect().auth.resetPasswordForEmail(email, { redirectTo }));
  }
  async function migrateLegacy() {
    requireReady();
    const legacy = JSON.parse(localStorage.getItem('a1vip-invoices-v1') || '[]');
    const legacyPresets = JSON.parse(localStorage.getItem('a1vip-invoice-presets-v1') || '{}');
    if (!Array.isArray(legacy)) throw new Error('Local invoice history is invalid.');
    let count = 0;
    for (const invoice of legacy) {
      // Never overwrite a shared invoice with an old browser copy.
      if (versions.has(invoice.id)) continue;
      await save(invoice, legacyPresets); count++;
    }
    return count;
  }
  window.A1Data = {
    restore, login, refresh, save, remove, updateAccount, finishPasswordReset, requestPasswordReset, migrateLegacy,
    invoices: () => copy(invoices), presets: () => copy(presets),
    logout: async () => { const c = connect(); check(await c.auth.signOut()); endRecovery(); clear(); },
    recovering: () => !!recoveryUserId,
    authenticated: () => !!user && ready && !recoveryUserId
  };
})();
