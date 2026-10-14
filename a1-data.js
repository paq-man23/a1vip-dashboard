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
    documents = { letter: [], itinerary: [] }; documentVersions.clear(); conflicts = [];
    try { sessionStorage.setItem(RECOVERY_KEY, id); } catch {}
    window.dispatchEvent(new Event('a1-password-recovery'));
  }
  let invoices = [], presets = {}, versions = new Map();
  let documents = { letter: [], itinerary: [] }, documentVersions = new Map(), conflicts = [];
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
  function clear() { user = null; ready = false; invoices = []; presets = {}; versions.clear();
    documents = { letter: [], itinerary: [] }; documentVersions.clear(); conflicts = []; }
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
    const docRows = [], conflictRows = [];
    for (let offset = 0; ; offset += 500) {
      const page = check(await client.from('a1_documents').select('kind,id,document,version').order('kind').order('id').range(offset, offset + 499));
      docRows.push(...page);
      if (page.length < 500) break;
    }
    for (let offset = 0; ; offset += 500) {
      const page = check(await client.from('a1_import_conflicts').select('kind,source_hash,document,reason').order('kind').order('source_hash').range(offset, offset + 499));
      conflictRows.push(...page);
      if (page.length < 500) break;
    }
    if (user?.id !== identity || recoveryUserId) throw new Error('Session changed. Sign in again.');
    invoices = rows.map(row => row.document);
    versions = new Map(rows.map(row => [row.id, row.version]));
    presets = {};
    for (const row of values) (presets[row.category] ||= []).push(row.value);
    documents = { letter: [], itinerary: [] };
    documentVersions = new Map();
    for (const row of docRows) {
      documents[row.kind].push(row.document);
      documentVersions.set(row.kind + ':' + row.id, row.version);
    }
    conflicts = conflictRows;
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
  async function save(document, presetValues = {}, expectedVersion = undefined) {
    const c = requireReady(), identity = user.id;
    const row = check(await c.rpc('a1_save_invoice', {
      p_document: document,
      p_expected_version: expectedVersion === undefined ? (versions.get(document.id) ?? null) : expectedVersion,
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
  function validKind(kind) {
    if (!['letter','itinerary'].includes(kind)) throw new Error('Unsupported document type.');
  }
  async function saveDocument(kind, document, expectedVersion = undefined) {
    validKind(kind);
    const c = requireReady(), identity = user.id;
    const row = check(await c.rpc('a1_save_document', {
      p_kind: kind, p_document: document,
      p_expected_version: expectedVersion === undefined ? (documentVersions.get(kind + ':' + document.id) ?? null) : expectedVersion
    }));
    if (user?.id !== identity) throw new Error('Session changed. Refresh history to check the save.');
    documentVersions.set(kind + ':' + row.id, row.version);
    documents[kind] = [row.document, ...documents[kind].filter(item => item.id !== row.id)];
  }
  async function removeDocument(kind, id) {
    validKind(kind);
    const c = requireReady(), identity = user.id;
    const version = documentVersions.get(kind + ':' + id);
    if (version == null) throw new Error('Refresh history before deleting this document.');
    const rows = check(await c.from('a1_documents').delete().eq('kind', kind).eq('id', id).eq('version', version).select('id'));
    if (!rows.length) throw new Error('Document changed on another device. Refresh history before deleting.');
    if (user?.id !== identity) return;
    documentVersions.delete(kind + ':' + id);
    documents[kind] = documents[kind].filter(item => item.id !== id);
  }
  async function resolveConflict(hash, invoiceId) {
    check(await requireReady().rpc('a1_resolve_import_conflict', { p_source_hash: hash, p_imported_id: invoiceId }));
    conflicts = conflicts.filter(item => item.source_hash !== hash);
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
  const LOCAL_KEYS = { invoice: 'a1vip-invoices-v1', letter: 'a1vip-form-letters-v1', itinerary: 'a1vip-itineraries-v1' };
  function browserBackup() {
    const payload = { invoice: [], letter: [], itinerary: [], presets: {} };
    for (const [kind, key] of Object.entries(LOCAL_KEYS)) {
      const records = JSON.parse(localStorage.getItem(key) || '[]');
      if (!Array.isArray(records)) throw new Error('This browser’s ' + kind + ' history is invalid.');
      payload[kind] = records;
    }
    payload.presets = JSON.parse(localStorage.getItem('a1vip-invoice-presets-v1') || '{}');
    return payload;
  }
  const report = () => ({ imported: 0, skipped: 0, conflicts: 0, copied: 0, errors: [] });
  async function importRecords(kind, records, presetValues = {}) {
    if (!['invoice','letter','itinerary'].includes(kind) || !Array.isArray(records)) throw new Error('Invalid import document type or history.');
    const c = requireReady(), identity = user.id, summary = report();
    for (const document of records) {
      if (user?.id !== identity || recoveryUserId) throw new Error('Session changed. Earlier completed imports remain saved.');
      try {
        const row = check(await c.rpc('a1_import_document', { p_kind: kind, p_document: document, p_presets: kind === 'invoice' ? presetValues : {} }));
        if (!['imported','skipped','conflict'].includes(row.outcome)) throw new Error('Unexpected import response.');
        summary[row.outcome === 'conflict' ? 'conflicts' : row.outcome]++;
        if (row.copied) summary.copied++;
      } catch(error) { summary.errors.push(kind + ' ' + String(document?.number || document?.savedName || document?.id || '(unnamed)') + ': ' + error.message); }
    }
    return summary;
  }
  async function migrateAll() {
    requireReady();
    const backup = browserBackup(), summary = report();
    for (const kind of Object.keys(LOCAL_KEYS)) {
      const part = await importRecords(kind, backup[kind], backup.presets);
      for (const field of ['imported','skipped','conflicts','copied']) summary[field] += part[field];
      summary.errors.push(...part.errors);
    }
    await refresh();
    return summary;
  }
  async function migrateLegacy() {
    const backup = browserBackup();
    const result = await importRecords('invoice', backup.invoice, backup.presets);
    await refresh();
    return result;
  }
  window.A1Data = {
    restore, login, refresh, save, remove, updateAccount, finishPasswordReset, requestPasswordReset, migrateLegacy, migrateAll, importRecords, browserBackup, saveDocument, removeDocument, resolveConflict,
    invoices: () => copy(invoices), presets: () => copy(presets),
    version: (kind, id) => kind === 'invoice' ? (versions.get(id) ?? null) : (documentVersions.get(kind + ':' + id) ?? null),
    documents: kind => { validKind(kind); return copy(documents[kind]); },
    conflicts: () => copy(conflicts),
    logout: async () => { const c = connect(); check(await c.auth.signOut()); endRecovery(); clear(); },
    recovering: () => !!recoveryUserId,
    authenticated: () => !!user && ready && !recoveryUserId
  };
})();
