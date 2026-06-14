/* ════════════════════════════════════════════════════════════
   PathFinder — Firebase sync layer (free Spark plan)

   Local-first: localStorage (PFStore) stays the synchronous
   source of truth the UI reads. This module mirrors it:

   · Every PFStore write  →  users/{uid}/kv/{key}   (debounced)
   · On sign-in           →  pull remote keys, merge "newer wins"
   · Leads & consultation requests additionally go to create-only
     inbox collections (inbox_leads / inbox_consultations) so the
     platform owner receives them in the Firebase console even
     from users who never sign in (anonymous auth).

   It also exposes window.PFCloud — the read API the in-app admin
   panel (app.html#admin) uses to view leads, consultations and
   user records. Those reads are gated by Firestore rules to the
   single admin email in firebase-config.js, so ordinary visitors
   can never read them.

   If firebase-config.js exports null, this module does nothing,
   window.PFCloud stays undefined, and the site runs purely on
   localStorage.
   ════════════════════════════════════════════════════════════ */

const cfg = window.PF_FIREBASE_CONFIG;
const ADMIN_EMAIL = window.PF_ADMIN_EMAIL || 'admin@pathfinder.app';

if (cfg && cfg.apiKey) {
  const [{ initializeApp },
         { getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword,
           signInAnonymously, onAuthStateChanged, signOut },
         { getFirestore, doc, setDoc, getDoc, getDocs, updateDoc, collection,
           collectionGroup, addDoc, serverTimestamp }] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
  ]);

  const app  = initializeApp(cfg);
  const auth = getAuth(app);
  const db   = getFirestore(app);

  const isAdminUser = (u) => !!u && u.email === ADMIN_EMAIL;

  let user = null;
  const dirty = new Map();          // key → value, awaiting flush
  let flushTimer = null;

  /* ── inbox: leads + consultation requests (create-only) ── */
  const SYNCED_KEY = 'pathfinder.v1.__inboxSynced';
  const syncedIds = () => { try { return new Set(JSON.parse(localStorage.getItem(SYNCED_KEY)) || []); } catch { return new Set(); } };
  const markSynced = (id) => { try { const s = syncedIds(); s.add(id); localStorage.setItem(SYNCED_KEY, JSON.stringify([...s])); } catch {} };

  async function ensureAuth() {
    if (auth.currentUser) return auth.currentUser;
    try { return (await signInAnonymously(auth)).user; } catch { return null; }
  }

  async function pushInbox(col, items, idOf) {
    const seen = syncedIds();
    const pending = items.filter(item => !seen.has(idOf(item)));
    if (!pending.length) return;        // nothing new → don't even authenticate
    const u = await ensureAuth();
    if (!u) return;
    for (const item of pending) {
      const id = idOf(item);
      try {
        await addDoc(collection(db, col), { ...item, uid: u.uid, ts: serverTimestamp() });
        markSynced(id);
      } catch (e) { console.warn('PathFinder sync: inbox push failed', e); }
    }
  }

  /* ── kv mirror: users/{uid}/kv/{key} = { v: json, t: epochMs } ── */
  function scheduleFlush() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 1500);
  }

  async function flush() {
    if (!user || user.isAnonymous || isAdminUser(user) || !dirty.size) return;
    const meta = PFStore.getMeta();
    for (const [key, value] of dirty) {
      try {
        await setDoc(doc(db, 'users', user.uid, 'kv', key),
          { v: JSON.stringify(value), t: meta[key] || Date.now() });
        dirty.delete(key);
      } catch (e) { console.warn('PathFinder sync: write failed', e); }
    }
    setSyncState();
  }

  async function pullAndMerge() {
    if (!user || user.isAnonymous || isAdminUser(user)) return;
    try {
      const snap = await getDocs(collection(db, 'users', user.uid, 'kv'));
      const meta = PFStore.getMeta();
      let changed = false;
      snap.forEach(d => {
        const { v, t } = d.data();
        const localT = meta[d.id] || 0;
        if (t > localT) {
          try { PFStore.applyRemote(d.id, JSON.parse(v), t); changed = true; } catch {}
        } else if (localT > t) {
          dirty.set(d.id, PFStore.get(d.id));
        }
      });
      // push local keys the remote has never seen
      const remoteKeys = new Set(); snap.forEach(d => remoteKeys.add(d.id));
      Object.keys(meta).forEach(k => { if (!remoteKeys.has(k) && !k.startsWith('__')) dirty.set(k, PFStore.get(k)); });
      if (dirty.size) flush();
      if (changed) window.dispatchEvent(new HashChangeEvent('hashchange'));  // re-render current view
    } catch (e) { console.warn('PathFinder sync: pull failed', e); }
  }

  /* ── subscribe to local writes ── */
  PFStore.onChange((key, value) => {
    if (key.startsWith('__')) return;
    if (isAdminUser(user)) return;     // admin session never mirrors device data
    if (key === 'leads' && Array.isArray(value)) pushInbox('inbox_leads', value, l => l.email + '|' + l.at);
    if (key === 'consultations' && Array.isArray(value)) pushInbox('inbox_consultations', value, c => c.id);
    dirty.set(key, value);
    scheduleFlush();
  });

  /* ── auth UI (app.html sidebar; absent on index.html) ── */
  const slot = document.getElementById('auth-slot');
  const stateEl = document.getElementById('sync-state');

  function setSyncState() {
    if (stateEl) stateEl.textContent = (user && !user.isAnonymous && !isAdminUser(user)) ? 'Synced to cloud' : 'Data stays on device';
  }

  function paintAuth() {
    if (!slot) return;
    if (isAdminUser(user)) {
      slot.innerHTML = `
        <div class="faint" style="font-family:var(--font-mono);font-size:10px;letter-spacing:.06em;margin-bottom:8px">ADMIN SESSION</div>
        <button class="btn btn-ghost btn-sm" id="pf-signout">Sign out</button>`;
      slot.querySelector('#pf-signout').onclick = () => signOut(auth);
    } else if (user && !user.isAnonymous) {
      slot.innerHTML = `
        <div class="faint" style="font-family:var(--font-mono);font-size:10px;letter-spacing:.06em;margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${user.email || ''}">
          ${user.displayName || user.email || 'Signed in'}</div>
        <button class="btn btn-ghost btn-sm" id="pf-signout">Sign out</button>`;
      slot.querySelector('#pf-signout').onclick = () => signOut(auth);
    } else {
      slot.innerHTML = `<button class="btn btn-ghost btn-sm" id="pf-signin">
        <span class="material-symbols-outlined" style="font-size:15px">cloud_sync</span> Sign in to sync</button>`;
      slot.querySelector('#pf-signin').onclick = async () => {
        try { await signInWithPopup(auth, new GoogleAuthProvider()); }
        catch (e) { console.warn('PathFinder: sign-in cancelled/failed', e); }
      };
    }
    setSyncState();
  }

  /* ── admin read API consumed by app.js (#admin view) ── */
  const adminListeners = [];
  function requireAdmin() {
    if (!isAdminUser(auth.currentUser)) throw new Error('Not signed in as admin');
  }

  window.PFCloud = {
    ready: true,
    adminEmail: ADMIN_EMAIL,
    isAdmin: () => isAdminUser(auth.currentUser),
    onAdminState: (fn) => { adminListeners.push(fn); fn(isAdminUser(auth.currentUser)); },

    async signInAdmin(password) {
      // The "client-side password gate": the typed password IS the
      // Firebase password, so reads are enforced by rules, not JS.
      await signInWithEmailAndPassword(auth, ADMIN_EMAIL, password);
      return true;
    },
    signOutAdmin: () => signOut(auth),

    async fetchLeads() {
      requireAdmin();
      const snap = await getDocs(collection(db, 'inbox_leads'));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    },
    async fetchConsultations() {
      requireAdmin();
      const snap = await getDocs(collection(db, 'inbox_consultations'));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    },
    async updateConsultStatus(docId, status) {
      requireAdmin();
      await updateDoc(doc(db, 'inbox_consultations', docId), { status });
    },
    async fetchUsers() {
      requireAdmin();
      // One collectionGroup query returns every user's kv docs; we
      // regroup them by owner uid client-side. Reads = total kv docs,
      // incurred only when an admin actually opens the Users tab.
      const snap = await getDocs(collectionGroup(db, 'kv'));
      const byUser = new Map();
      snap.forEach(d => {
        const uid = d.ref.parent.parent.id;
        if (!byUser.has(uid)) byUser.set(uid, { uid, data: {}, updatedAt: 0 });
        const rec = byUser.get(uid);
        const { v, t } = d.data();
        try { rec.data[d.id] = JSON.parse(v); } catch { rec.data[d.id] = v; }
        if (t > rec.updatedAt) rec.updatedAt = t;
      });
      return [...byUser.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    },
  };

  onAuthStateChanged(auth, u => {
    user = u;
    paintAuth();
    adminListeners.forEach(fn => { try { fn(isAdminUser(u)); } catch {} });
    if (u && !u.isAnonymous && !isAdminUser(u)) pullAndMerge();
  });

  paintAuth();

  // catch any leads/consultations queued before this module loaded
  pushInbox('inbox_leads', PFStore.get('leads', []), l => l.email + '|' + l.at);
  pushInbox('inbox_consultations', PFStore.get('consultations', []), c => c.id);
}
