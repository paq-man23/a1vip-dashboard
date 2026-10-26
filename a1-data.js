/* Supabase-backed A1 staff invoices. No invoice/password data is cached locally. */
(() => {
  let client, user, ready = false, admin = false;
  let accountAccess={allowed_sections:null,blocked_links:[],display_name:''};
  let recoveryUserId = null;
  const RECOVERY_KEY = 'a1vip-password-recovery';
  try { recoveryUserId = sessionStorage.getItem(RECOVERY_KEY) || null; } catch {}
  function endRecovery() {
    recoveryUserId = null;
    try { sessionStorage.removeItem(RECOVERY_KEY); } catch {}
  }
  function beginRecovery(id) {
    resetSharedData();
    recoveryUserId = id;
    ready = false; admin=false;
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
  function clear() { resetSharedData(); user = null; ready = false; admin=false; }
  function requireReady() {
    if(window.A1Activity?.expired())throw new Error('Session ended after inactivity. Sign in again.');
    if (!user || !ready || recoveryUserId) throw new Error('Sign in and load Supabase invoices before saving.');
    return client;
  }
  // Shared records stay in memory only for this signed-in session.
  let dataEpoch = 0;
  const loadedResources = new Set(), pendingResources = new Map();
  function resetSharedData() {
    dataEpoch++; loadedResources.clear(); pendingResources.clear();
    invoices=[]; presets={}; versions.clear(); contacts=[]; contactVersions.clear();
    documents={letter:[],itinerary:[]}; documentVersions.clear(); conflicts=[];
  }
  const resourceSection={invoices:'invoices',letter:'formLetter',itinerary:'tripItinerary',customer:'customers',vendor:'vendors',conflicts:'admin'};
  async function readPages(table,columns,filter,orders) {
    const rows=[];
    for(let offset=0;;offset+=500){
      let query=client.from(table).select(columns);
      if(filter)query=query.eq(...filter);
      for(const field of orders)query=query.order(field);
      const page=check(await query.range(offset,offset+499));rows.push(...page);
      if(page.length<500)return rows;
    }
  }
  async function loadResource(resource,force=false) {
    requireReady();
    if(!canAccess(resourceSection[resource]))return;
    if(pendingResources.has(resource))return pendingResources.get(resource);
    if(!force&&loadedResources.has(resource))return;
    const identity=user.id, epoch=dataEpoch;
    const task=(async()=>{
      let rows,values;
      if(resource==='invoices'){
        [rows,values]=await Promise.all([
          readPages('a1_invoice_history','id,document,version,origin',null,['id']),
          readPages('a1_invoice_presets','category,value',null,['category','value'])
        ]);
      }else if(resource==='conflicts')rows=await readPages('a1_import_conflicts','kind,source_hash,document,reason',null,['kind','source_hash']);
      else if(['customer','vendor'].includes(resource))rows=await readPages('a1_contacts','document,version',['kind',resource],['id']);
      else rows=await readPages('a1_documents','kind,id,document,version',['kind',resource],['id']);
      if(user?.id!==identity||epoch!==dataEpoch||recoveryUserId)throw new Error('Session changed. Open the section again.');
      requireReady();
      if(resource==='invoices'){
        invoices=rows.map(row=>row.document);versions=new Map(rows.map(row=>[row.id,row.version]));presets={};
        for(const row of values)(presets[row.category]||=[]).push(row.value);
      }else if(resource==='conflicts')conflicts=rows;
      else if(['customer','vendor'].includes(resource)){
        contacts=[...contacts.filter(row=>row.kind!==resource),...rows.map(row=>row.document)];
        for(const key of contactVersions.keys())if(key.startsWith(resource+':'))contactVersions.delete(key);
        for(const row of rows)contactVersions.set(resource+':'+row.document.id,row.version||0);
      }else{
        documents[resource]=rows.map(row=>row.document);
        for(const key of documentVersions.keys())if(key.startsWith(resource+':'))documentVersions.delete(key);
        for(const row of rows)documentVersions.set(resource+':'+row.id,row.version);
      }
      loadedResources.add(resource);
    })();
    pendingResources.set(resource,task);
    try{await task;}finally{if(pendingResources.get(resource)===task)pendingResources.delete(resource);}
  }
  async function loadSection(section,force=false) {
    requireReady();
    if(!canAccess(section))throw new Error('Your administrator has not enabled this category.');
    const resources={invoices:['invoices','customer','vendor'],purchases:['invoices','customer','vendor'],formLetter:['letter','customer','vendor'],tripItinerary:['itinerary','customer','vendor'],customers:['customer'],vendors:['vendor'],admin:['conflicts','customer','vendor']}[section]||[];
    await Promise.all(resources.map(resource=>loadResource(resource,force)));
  }
  async function refresh(mode='all') {
    if (recoveryUserId) throw new Error('Choose your new password before accessing invoices.');
    if (!user) throw new Error('Please sign in first.');
    const identity=user.id,epoch=dataEpoch;
    const member=check(await client.from('a1_staff').select('user_id,is_admin').eq('user_id',identity).maybeSingle());
    if(user?.id!==identity||epoch!==dataEpoch)throw new Error('Session changed. Sign in again.');
    if(!member){clear();throw new Error('This account has not been approved for the A1 Dashboard.');}
    const profile=check(await client.from('a1_account_profiles').select('allowed_sections,blocked_links,display_name').eq('user_id',identity).maybeSingle());
    if(user?.id!==identity||epoch!==dataEpoch||recoveryUserId)throw new Error('Session changed. Sign in again.');
    const next={allowed_sections:profile?.allowed_sections||null,blocked_links:profile?.blocked_links||[],display_name:profile?.display_name||''};
    if(JSON.stringify(next)!==JSON.stringify(accountAccess)||admin!==(member.is_admin===true))resetSharedData();
    accountAccess=next;admin=member.is_admin===true;ready=true;
    if(mode!=='auth')await Promise.all(Object.keys(resourceSection).map(resource=>loadResource(resource,true)));
  }
  async function restore() {
    clear();
    const c = connect(), restoreEpoch=dataEpoch;
    const session = check(await c.auth.getSession());
    if(recoveryUserId)return false;
    if(restoreEpoch!==dataEpoch)throw new Error('Sign-in check cancelled. Try again.');
    if (!session.session) { endRecovery(); return false; }
    const data = check(await c.auth.getUser());
    if(recoveryUserId)return false;
    if(restoreEpoch!==dataEpoch)throw new Error('Sign-in check cancelled. Try again.');
    if (!data.user) return false;
    user = data.user;
    if (recoveryUserId === user.id) { beginRecovery(user.id); return false; }
    endRecovery();
    window.dispatchEvent(new Event('a1-restoring-session'));
    await window.A1Activity?.start(user.id);
    await refresh('auth');
    return true;
  }
  function loginEmail(identifier) {
    const config = window.A1_SUPABASE_CONFIG || {};
    let email = String(identifier || '').trim();
    if (!email.includes('@')) {
      const aliases = { ...(config.adminAliases || { [config.adminUsername || 'JAW']: config.adminEmail }), ...(config.userAliases || {}) };
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
    let email;
    try{email=loginEmail(identifier);}catch(error){
      if(error.message!=='Invalid username or password.')throw error;
      const result=await connect().functions.invoke('a1-account-management',{body:{action:'login',username:String(identifier).trim(),password}});
      if(result.error||!result.data?.session)throw new Error('Invalid username or password.');
      const data=check(await client.auth.setSession({access_token:result.data.session.access_token,refresh_token:result.data.session.refresh_token}));
      user=data.user;
      try{await window.A1Activity?.start(user.id);await refresh('auth');}catch(error){await client.auth.signOut({scope:'local'});clear();throw error;}
      return;
    }
    const data = check(await connect().auth.signInWithPassword({ email, password }));
    user = data.user;
    try { await window.A1Activity?.start(user.id); await refresh('auth'); } catch (error) { await client.auth.signOut(); clear(); throw error; }
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
    await window.A1Activity?.start(user.id);
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
  function canAccess(section){
    if(!user||!ready||recoveryUserId)return false;
    if(admin||section==='account')return true;
    const aliases={privatejet:'travel',luxhomes:'travel',yachts:'travel',purchases:'invoices'};
    const id=aliases[section]||section;
    if(['admin','manageAccounts','system','upload','buttonManager','domains'].includes(id))return false;
    return accountAccess.allowed_sections===null||accountAccess.allowed_sections.includes(id);
  }
  function linkBlocked(url){
    if(admin)return false;
    const normalize=value=>{try{return new URL(String(value)).href;}catch{return String(value);}};
    return accountAccess.blocked_links.some(key=>{try{return normalize(JSON.parse(key)[2])===normalize(url);}catch{return false;}});
  }
  async function refreshAccess(){
    if(!user||!ready)return;
    const identity=user.id;
    const member=check(await client.from('a1_staff').select('user_id,is_admin').eq('user_id',identity).maybeSingle());
    if(!member){await window.A1Data.logout('idle');return;}
    const profile=check(await client.from('a1_account_profiles').select('allowed_sections,blocked_links,display_name').eq('user_id',identity).maybeSingle());
    if(user?.id!==identity)return;
    const next={allowed_sections:profile?.allowed_sections||null,blocked_links:profile?.blocked_links||[],display_name:profile?.display_name||''};
    if(JSON.stringify(next)!==JSON.stringify(accountAccess)||admin!==(member.is_admin===true)){
      await refresh('auth');window.dispatchEvent(new Event('a1-access-changed'));
    }
  }
  async function accountAction(body){
    const c=requireAdmin(),result=await c.functions.invoke('a1-account-management',{body});
    if(result.error){
      let message=result.error.message;
      try{const data=await result.error.context?.json();message=data?.error||message;}catch{}
      throw new Error(message||'Account operation failed.');
    }
    if(result.data?.error)throw new Error(result.data.error);
    return result.data;
  }
  window.A1Data = {
    cancelRestore:()=>{window.A1Activity?.stop();clear();},
    loadSection, canAccess, refreshAccess, linkBlocked, blockedLinks:()=>copy(accountAccess.blocked_links),
    listAccounts:async()=>check(await requireAdmin().rpc('a1_list_accounts')),
    accountAction,
    accountPermissions:async id=>check(await requireAdmin().from('a1_account_profiles').select('allowed_sections,blocked_links,admin_role').eq('user_id',id).single()),
    setAccountAccess:async(id,sections,blocked)=>check(await requireAdmin().rpc('a1_set_account_access',{p_user_id:id,p_sections:sections,p_blocked:blocked})),
    fetchButtonLayout,saveButtonLayout,
    activitySession: async action => check(await connect().rpc('a1_activity_session', {p_action:action})),
    fetchActivity: async () => check(await requireAdmin().from('a1_activity_sessions').select('id,user_id,display_name,started_at,last_active_at,ended_at,end_reason').order('started_at',{ascending:false}).limit(500)),
    recordWebsite: async args => check(await connect().rpc('a1_website_view',args)),
    fetchWebsiteViews: async () => check(await requireAdmin().from('a1_website_views').select('id,display_name,site_host,label,started_at,ended_at,visible_seconds').order('started_at',{ascending:false}).limit(500)),
    preferenceUsers: async () => {const rows=check(await requireAdmin().rpc('a1_list_accounts'));return rows.map(row=>({user_id:row.id,email:row.email}));},
    fetchPreferences: async target => { const c=target?requireAdmin():requireReady(); const row=check(await c.from('a1_user_preferences').select('hidden_buttons,added_links').eq('user_id',target||user.id).maybeSingle()); const profile=target?check(await c.from('a1_account_profiles').select('blocked_links,allowed_sections').eq('user_id',target).single()):accountAccess;return {hidden_buttons:row?.hidden_buttons||[],added_links:row?.added_links||[],blocked_links:profile?.blocked_links||[],allowed_sections:profile?.allowed_sections||null}; },
    savePreferences: async (state,target) => { const c=target?requireAdmin():requireReady(); check(await c.from('a1_user_preferences').upsert({user_id:target||user.id,hidden_buttons:state.hidden_buttons,added_links:state.added_links})); },
    fetchSyncRuns: async () => { const c=requireAdmin(); return check(await c.from('a1_skybox_sync_runs').select('machine_label,started_at,finished_at,status,summary').order('started_at',{ascending:false}).limit(5)); },
    isAdmin: () => !!user && ready && admin && !recoveryUserId,
    importSkybox, contacts: () => copy(contacts), saveContact, uploadContactPhoto, contactPhotoUrl, removeContactPhoto,
    contactVersion: (kind,id) => contactVersions.get(kind+':'+id) ?? 0,
    restore, login, refresh, save, remove, updateAccount, finishPasswordReset, requestPasswordReset, migrateLegacy, migrateAll, importRecords, browserBackup, saveDocument, removeDocument, resolveConflict,
    invoices: () => copy(invoices), presets: () => copy(presets),
    version: (kind, id) => kind === 'invoice' ? (versions.get(id) ?? null) : (documentVersions.get(kind + ':' + id) ?? null),
    documents: kind => { validKind(kind); return copy(documents[kind]); },
    conflicts: () => copy(conflicts),
    logout: async (reason = 'logout') => {
      const c=connect();
      try { await window.A1Activity?.finishSite?.(); if(user&&!recoveryUserId) await c.rpc('a1_activity_session',{p_action:reason==='idle'?'idle':'logout'}); }
      finally {
        // Lock and drop loaded data even if the network cannot revoke the session.
        // A persisted expired timer also prevents restoring it after a reload.
        window.A1Activity?.stop(); endRecovery(); clear();
        window.dispatchEvent(new Event('a1-signed-out'));
        check(await c.auth.signOut({scope:'local'}));
      }
    },
    recovering: () => !!recoveryUserId,
    account: () => {
      if(!user||!ready||recoveryUserId)return null;
      const email=user.email||'';
      const alias=Object.entries(window.A1_SUPABASE_CONFIG?.adminAliases||{}).find(([,address])=>String(address).toLowerCase()===email.toLowerCase());
      return {name:alias?.[0]||accountAccess.display_name||user.user_metadata?.display_name||user.user_metadata?.full_name||email,email};
    },
    authenticated: () => !!user && ready && !recoveryUserId
  };
})();
