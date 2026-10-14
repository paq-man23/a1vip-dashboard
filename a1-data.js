/* Supabase-backed A1 staff invoices. No invoice/password data is cached locally. */
(() => {
  let client, user, ready = false, admin = false;
  let recoveryUserId = null;
  const RECOVERY_KEY = 'a1vip-password-recovery';
  try { recoveryUserId = sessionStorage.getItem(RECOVERY_KEY) || null; } catch {}
  function endRecovery() {
    recoveryUserId = null;
    try { sessionStorage.removeItem(RECOVERY_KEY); } catch {}
  }
  function beginRecovery(id) {
    recoveryUserId = id;
    ready = false; admin=false; invoices = []; presets = {}; versions.clear();
    documents = { letter: [], itinerary: [] }; documentVersions.clear(); conflicts = []; contacts = []; contactVersions.clear();
    try { sessionStorage.setItem(RECOVERY_KEY, id); } catch {}
    window.dispatchEvent(new Event('a1-password-recovery'));
  }
  let invoices = [], presets = {}, versions = new Map();
  let contacts = [], contactVersions = new Map();
  let documents = { letter: [], itinerary: [] }, documentVersions = new Map(), conflicts = [];
  const copy = value => JSON.parse(JSON.stringify(value));
  const check = result => { if (result.error) throw new Error(result.error.message); return result.data; };
  async function networkFetch(input, options = {}) {
    const controller = new AbortController();
    const externalSignal = options.signal;
    let timedOut = false;
    const onAbort = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    else externalSignal?.addEventListener('abort', onAbort, { once:true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
    try { return await fetch(input, { ...options, signal:controller.signal }); }
    catch(error) {
      if (timedOut) throw new Error('The login/data connection timed out. Check your internet connection and try again.');
      throw error;
    } finally { clearTimeout(timer); externalSignal?.removeEventListener('abort', onAbort); }
  }
  function connect() {
    if (client) return client;
    const config = window.A1_SUPABASE_CONFIG || {};
    if (!config.url || !config.publishableKey) {
      throw new Error('Supabase is not configured yet. Contact the dashboard administrator.');
    }
    if (!window.supabase?.createClient) throw new Error('The login service could not load. Check your internet connection and reload this page.');
    client = window.supabase.createClient(config.url, config.publishableKey, { global: { fetch:networkFetch } });
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && session?.user?.id) beginRecovery(session.user.id);
      if (event === 'SIGNED_OUT') { endRecovery(); clear(); window.dispatchEvent(new Event('a1-signed-out')); }
    });
    return client;
  }
  function clear() { user = null; ready = false; admin=false; invoices = []; presets = {}; versions.clear();
    documents = { letter: [], itinerary: [] }; documentVersions.clear(); conflicts = []; contacts = []; contactVersions.clear(); }
  function requireReady() {
    if (!user || !ready || recoveryUserId) throw new Error('Sign in and load Supabase invoices before saving.');
    return client;
  }
  async function refresh() {
    if (recoveryUserId) throw new Error('Choose your new password before accessing invoices.');
    if (!user) throw new Error('Please sign in first.');
    const identity = user.id;
    const member = check(await client.from('a1_staff').select('user_id,is_admin').eq('user_id', identity).maybeSingle());
    if (!member) { clear(); throw new Error('This account has not been approved for the A1 Dashboard.'); }
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const page = check(await client.from('a1_invoice_history').select('id,document,version,origin').order('id').range(offset, offset + 499));
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
    const contactRows = [];
    for (const kind of ['customer','vendor']) for (let offset = 0; ; offset += 500) {
      const page = check(await client.from('a1_contacts').select('document,version').eq('kind',kind).order('id').range(offset,offset+499));
      contactRows.push(...page);
      if (page.length < 500) break;
    }
    if (user?.id !== identity || recoveryUserId) throw new Error('Session changed. Sign in again.');
    admin = member.is_admin===true;
    contacts = contactRows.map(row=>row.document);
    contactVersions = new Map(contactRows.map(row=>[row.document.kind+':'+row.document.id,row.version||0]));
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
    window.dispatchEvent(new Event('a1-restoring-session'));
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
    const version=expectedVersion === undefined ? (versions.get(document.id) ?? null) : expectedVersion;
    const autoCreate=version===null && document.autoNumber===true;
    const args={p_document:document,p_presets:presetValues};
    if(!autoCreate)args.p_expected_version=version;
    const row=check(await c.rpc(autoCreate?'a1_save_dashboard_invoice':'a1_save_invoice',args));
    if (user?.id !== identity) throw new Error('Session changed. Reload invoices to check the save.');
    versions.set(row.id, row.version);
    invoices = [row.document, ...invoices.filter(item => item.id !== row.id)];
    for (const [category, values] of Object.entries(presetValues)) {
      const merged = new Set([...(presets[category] || []), ...values]);
      presets[category] = [...merged];
    }
    return copy(row.document);
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
  function requireAdmin(){requireReady();if(!admin)throw new Error('Administrator access required');return client;}
  async function resolveConflict(hash, invoiceId) {
    requireAdmin();
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
    requireAdmin();
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
  async function importSkybox(items, progress = () => {}) {
    const c = requireAdmin(), identity = user.id;
    const result = { imported:0, skipped:0, conflicts:0, changed:0, errors:[] };
    for (let offset=0;offset<items.length;offset+=50) {
      if (user?.id !== identity || recoveryUserId) throw new Error('Session changed. Sign in again before importing.');
      const batch=items.slice(offset,offset+50);
      if(batch.some(item=>item.error))throw new Error('Fix blocked preview records before importing.');
      const rows=check(await c.rpc('a1_import_skybox_batch',{p_items:batch.map(({kind,sourceId,record,document,presets})=>({kind,sourceId,record,document,presets}))}));
      if(!Array.isArray(rows)||rows.length!==batch.length)throw new Error('Import response was incomplete. Refresh and retry the same files.');
      rows.forEach((row,index)=>{
        const item=batch[index];
        if (row.outcome === 'conflict') result.conflicts++;
        else if (row.outcome === 'changed') { result.changed++; result.errors.push(item.kind+' '+item.sourceId+': '+row.reason); }
        else if (row.outcome === 'error') result.errors.push(item.kind+' '+item.sourceId+': '+row.reason);
        else if (row.outcome === 'skipped') result.skipped++;
        else if(row.outcome==='imported')result.imported++;
        else result.errors.push(item.kind+' '+item.sourceId+': Unknown import result. Refresh and retry.');
      });
      progress(Math.min(offset+50,items.length),items.length);
    }
    await refresh(); return result;
  }
  async function saveContact(kind,id,patch,expectedVersion){
    const c=requireReady(),identity=user.id;
    const row=check(await c.rpc('a1_save_contact',{p_kind:kind,p_id:id,p_patch:patch,p_expected_version:expectedVersion}));
    if(user?.id!==identity||recoveryUserId)throw new Error('Session changed. Refresh contacts to check the save.');
    contacts=[row.document,...contacts.filter(item=>item.kind!==kind||item.id!==id)];
    contactVersions.set(kind+':'+id,row.version);
    return copy(row.document);
  }
  async function uploadContactPhoto(kind,id,blob){
    const c=requireReady();
    if(!['customer','vendor'].includes(kind)||!/^([0-9]+|[a-f0-9-]{36})$/.test(id)||blob.type!=='image/jpeg'||blob.size>524288)throw new Error('Invalid contact photo.');
    const path=kind+'/'+id+'/'+crypto.randomUUID()+'.jpg';
    check(await c.storage.from('a1-contact-photos').upload(path,blob,{contentType:'image/jpeg',upsert:false}));return path;
  }
  async function contactPhotoUrl(path){
    const c=requireReady();if(!path)return '';
    const data=check(await c.storage.from('a1-contact-photos').createSignedUrl(path,600));return data.signedUrl;
  }
  async function removeContactPhoto(path){
    if(path)check(await requireReady().storage.from('a1-contact-photos').remove([path]));
  }
  async function fetchButtonLayout(){
    const row=check(await requireReady().from('a1_button_layout').select('state,version').eq('id',true).single());
    return {...copy(row.state),cloudVersion:row.version};
  }
  async function saveButtonLayout(state){
    const c=requireAdmin();
    if(!Number.isSafeInteger(state.cloudVersion))throw new Error('Refresh links before saving.');
    const row=check(await c.rpc('a1_save_button_layout',{p_state:{added:state.added||{},removed:state.removed||{}},p_expected_version:state.cloudVersion}));
    return {...copy(row.state),cloudVersion:row.version};
  }
  window.A1Data = {
    fetchButtonLayout,saveButtonLayout,
    fetchSyncRuns: async () => { const c=requireAdmin(); return check(await c.from('a1_skybox_sync_runs').select('machine_label,started_at,finished_at,status,summary').order('started_at',{ascending:false}).limit(5)); },
    isAdmin: () => !!user && ready && admin && !recoveryUserId,
    importSkybox, contacts: () => copy(contacts), saveContact, uploadContactPhoto, contactPhotoUrl, removeContactPhoto,
    contactVersion: (kind,id) => contactVersions.get(kind+':'+id) ?? 0,
    restore, login, refresh, save, remove, updateAccount, finishPasswordReset, requestPasswordReset, migrateLegacy, migrateAll, importRecords, browserBackup, saveDocument, removeDocument, resolveConflict,
    invoices: () => copy(invoices), presets: () => copy(presets),
    version: (kind, id) => kind === 'invoice' ? (versions.get(id) ?? null) : (documentVersions.get(kind + ':' + id) ?? null),
    documents: kind => { validKind(kind); return copy(documents[kind]); },
    conflicts: () => copy(conflicts),
    logout: async () => { const c = connect(); check(await c.auth.signOut()); endRecovery(); clear(); },
    recovering: () => !!recoveryUserId,
    account: () => {
      if(!user||!ready||recoveryUserId)return null;
      const email=user.email||'';
      const alias=Object.entries(window.A1_SUPABASE_CONFIG?.adminAliases||{}).find(([,address])=>String(address).toLowerCase()===email.toLowerCase());
      return {name:alias?.[0]||user.user_metadata?.display_name||user.user_metadata?.full_name||email,email};
    },
    authenticated: () => !!user && ready && !recoveryUserId
  };
})();
