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

   If firebase-config.js exports null, this module does nothing
   and the site runs purely on localStorage.
   ════════════════════════════════════════════════════════════ */

const cfg = window.PF_FIREBASE_CONFIG;

if (cfg && cfg.apiKey) {
  const [{ initializeApp },
         { getAuth, GoogleAuthProvider, signInWithPopup, signInAnonymously, onAuthStateChanged, signOut },
         { getFirestore, doc, setDoc, getDocs, collection, addDoc, serverTimestamp }] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
  ]);

  const app  = initializeApp(cfg);
  const auth = getAuth(app);
  const db   = getFirestore(app);

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
    const u = await ensureAuth();
    if (!u) return;
    const seen = syncedIds();
    for (const item of items) {
      const id = idOf(item);
      if (seen.has(id)) continue;
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
    if (!user || user.isAnonymous || !dirty.size) return;
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
    if (!user || user.isAnonymous) return;
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
    if (key === 'leads' && Array.isArray(value)) pushInbox('inbox_leads', value, l => l.email + '|' + l.at);
    if (key === 'consultations' && Array.isArray(value)) pushInbox('inbox_consultations', value, c => c.id);
    dirty.set(key, value);
    scheduleFlush();
  });

  /* ── auth UI (app.html sidebar; absent on index.html) ── */
  const slot = document.getElementById('auth-slot');
  const stateEl = document.getElementById('sync-state');

  function setSyncState() {
    if (stateEl) stateEl.textContent = (user && !user.isAnonymous) ? 'Synced to cloud' : 'Data stays on device';
  }

  function paintAuth() {
    if (!slot) return;
    if (user && !user.isAnonymous) {
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

  onAuthStateChanged(auth, u => {
    user = u;
    paintAuth();
    if (u && !u.isAnonymous) pullAndMerge();
  });

  paintAuth();

  // catch any leads/consultations queued before this module loaded
  pushInbox('inbox_leads', PFStore.get('leads', []), l => l.email + '|' + l.at);
  pushInbox('inbox_consultations', PFStore.get('consultations', []), c => c.id);
}
