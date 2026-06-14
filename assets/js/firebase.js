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
           createUserWithEmailAndPassword,
           signInAnonymously, onAuthStateChanged, signOut },
         { getFirestore, doc, setDoc, getDoc, getDocs, updateDoc, collection,
           collectionGroup, addDoc, serverTimestamp, query, where, runTransaction }] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
  ]);

  const app  = initializeApp(cfg);
  const auth = getAuth(app);
  const db   = getFirestore(app);

  const isAdminUser = (u) => !!u && u.email === ADMIN_EMAIL;

  let user = null;
  let mentorProfile = null;         // mentors/{uid} doc data, or null
  const mentorListeners = [];
  const dirty = new Map();          // key → value, awaiting flush
  let flushTimer = null;

  function notifyMentorState() {
    mentorListeners.forEach(fn => { try { fn(mentorProfile); } catch {} });
  }

  // Load (or clear) the signed-in user's mentor profile and notify the UI.
  async function refreshMentorProfile() {
    if (!user || user.isAnonymous) { mentorProfile = null; notifyMentorState(); return; }
    try {
      const snap = await getDoc(doc(db, 'mentors', user.uid));
      mentorProfile = snap.exists() ? { uid: user.uid, ...snap.data() } : null;
    } catch { mentorProfile = null; }
    notifyMentorState();
  }

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

  /* Mentor requests land in the shared `mentor_requests` queue. Unlike the
     old inbox, each doc is created at its LOCAL id (mr_*) so mentors and the
     student can later read/update the same record. studentUid is stamped
     with the real (or anonymous) uid so the owner can read it back. */
  async function pushMentorRequests(items) {
    const seen = syncedIds();
    const pending = items.filter(r => !seen.has('mreq:' + r.id) && r.status === 'open');
    if (!pending.length) return;
    const u = await ensureAuth();
    if (!u) return;
    for (const r of pending) {
      try {
        const { id, ...rest } = r;
        await setDoc(doc(db, 'mentor_requests', id),
          { ...rest, studentUid: u.uid, ts: serverTimestamp() });
        markSynced('mreq:' + id);
      } catch (e) { console.warn('PathFinder sync: mentor request push failed', e); }
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
    if (key === 'mentorRequests' && Array.isArray(value)) pushMentorRequests(value);
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

    /* ── Mentor accounts & dashboard ─────────────────────────────────── */
    // Identity helpers — mirror isAdmin(). isMentor() is true only for an
    // APPROVED mentor; hasMentorProfile() is true the moment they apply.
    isMentor: () => !!(mentorProfile && mentorProfile.approved),
    hasMentorProfile: () => !!mentorProfile,
    getMentorProfile: () => mentorProfile,
    isSignedIn: () => !!(auth.currentUser && !auth.currentUser.isAnonymous),
    currentEmail: () => auth.currentUser && auth.currentUser.email,
    onMentorState: (fn) => { mentorListeners.push(fn); fn(mentorProfile); },

    async signUpEmail(email, password) { await createUserWithEmailAndPassword(auth, email, password); },
    async signInEmail(email, password) { await signInWithEmailAndPassword(auth, email, password); },
    async signInGoogle() { await signInWithPopup(auth, new GoogleAuthProvider()); },
    signOutUser: () => signOut(auth),

    // Create the mentors/{uid} profile (approved:false → pending review).
    async applyAsMentor(profile) {
      const u = auth.currentUser;
      if (!u || u.isAnonymous) throw new Error('Sign in before applying');
      await setDoc(doc(db, 'mentors', u.uid), {
        displayName: profile.displayName || (u.displayName || u.email || 'Mentor'),
        fields: Array.isArray(profile.fields) ? profile.fields : [],
        city: profile.city || '',
        bio: profile.bio || '',
        langs: profile.langs || '',
        availability: profile.availability || '',
        approved: false,
        active: true,
        createdAt: serverTimestamp(),
      });
      await refreshMentorProfile();
      return mentorProfile;
    },
    // Mentor edits their own descriptive fields / availability toggle.
    async saveMentorProfile(patch) {
      const u = auth.currentUser;
      if (!u) throw new Error('Not signed in');
      const allowed = {};
      ['displayName','fields','city','bio','langs','availability','active']
        .forEach(k => { if (k in patch) allowed[k] = patch[k]; });
      await updateDoc(doc(db, 'mentors', u.uid), allowed);
      await refreshMentorProfile();
      return mentorProfile;
    },

    // The open queue any approved+active mentor can claim from.
    async fetchOpenRequests() {
      const snap = await getDocs(query(collection(db, 'mentor_requests'), where('status', '==', 'open')));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    },
    // The requests this mentor has already claimed (any status).
    async fetchMyClaimedRequests() {
      const u = auth.currentUser; if (!u) return [];
      const snap = await getDocs(query(collection(db, 'mentor_requests'), where('mentorId', '==', u.uid)));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },
    // Atomic claim — only succeeds while the request is still open/unclaimed,
    // so two mentors can never claim the same request (first-come wins).
    async claimRequest(id) {
      const u = auth.currentUser; if (!u) throw new Error('Not signed in');
      const ref = doc(db, 'mentor_requests', id);
      await runTransaction(db, async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('Request no longer exists');
        const d = snap.data();
        if (d.status !== 'open' || d.mentorId) throw new Error('Already claimed');
        tx.update(ref, { status: 'claimed', mentorId: u.uid, updatedAt: Date.now() });
      });
    },
    // Mentor updates a request they own (status, intro, payment fields).
    async updateRequest(id, patch) {
      await updateDoc(doc(db, 'mentor_requests', id), { ...patch, updatedAt: Date.now() });
    },
    // A signed-in student's own requests (for the "My requests" tab).
    async fetchMyRequests() {
      const u = auth.currentUser; if (!u) return [];
      const snap = await getDocs(query(collection(db, 'mentor_requests'), where('studentUid', '==', u.uid)));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    },

    /* ── Admin: mentor approval + all requests ───────────────────────── */
    async fetchMentors() {
      requireAdmin();
      const snap = await getDocs(collection(db, 'mentors'));
      return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    },
    async setMentorFlag(uid, patch) {
      requireAdmin();
      const allowed = {};
      if ('approved' in patch) allowed.approved = patch.approved;
      if ('active' in patch) allowed.active = patch.active;
      await updateDoc(doc(db, 'mentors', uid), allowed);
    },
    async fetchAllRequests() {
      requireAdmin();
      const snap = await getDocs(collection(db, 'mentor_requests'));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    },
    async updateRequestAdmin(id, patch) {
      requireAdmin();
      await updateDoc(doc(db, 'mentor_requests', id), { ...patch, updatedAt: Date.now() });
    },
  };

  onAuthStateChanged(auth, u => {
    user = u;
    paintAuth();
    adminListeners.forEach(fn => { try { fn(isAdminUser(u)); } catch {} });
    refreshMentorProfile();          // updates the Mentor Dashboard sidebar link
    if (u && !u.isAnonymous && !isAdminUser(u)) pullAndMerge();
  });

  paintAuth();

  // catch any leads/requests queued before this module loaded
  pushInbox('inbox_leads', PFStore.get('leads', []), l => l.email + '|' + l.at);
  pushMentorRequests(PFStore.get('mentorRequests', []));
}
