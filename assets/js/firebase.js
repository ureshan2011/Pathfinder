/* ════════════════════════════════════════════════════════════
   PathFinder — Firebase sync layer (free Spark plan)

   Cloud-first for EVERY visitor. On load, anyone without a session
   is signed in anonymously (a persistent uid), so their data lives
   in Firestore — not just on the device. localStorage (PFStore)
   remains only as a synchronous read cache so the UI stays instant
   and works offline; Firestore is the durable system of record.

   · Every PFStore write  →  users/{uid}/kv/{key}   (debounced)
   · On load / sign-in    →  pull remote keys, merge "newer wins"
   · Anonymous → named     →  the anon account is LINKED in place on
     Google / email sign-in, so a student's data is upgraded, never
     orphaned, when they decide to sign in across devices.
   · Leads & consultation requests additionally go to create-only
     inbox collections (inbox_leads / inbox_consultations) so the
     platform owner receives them in the Firebase console.

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
         { getAuth, GoogleAuthProvider, EmailAuthProvider, signInWithPopup, signInWithEmailAndPassword,
           createUserWithEmailAndPassword, linkWithPopup, linkWithCredential,
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
    // Sync for every signed-in visitor (incl. anonymous); only the admin
    // session is excluded so it never mirrors a device's student data.
    if (!user || isAdminUser(user) || !dirty.size) return;
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
    if (!user || isAdminUser(user)) return;
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
    if (!stateEl) return;
    if (isAdminUser(user))           stateEl.textContent = 'Admin session';
    else if (user && !user.isAnonymous) stateEl.textContent = 'Synced to cloud';
    else if (user)                   stateEl.textContent = 'Saved to cloud';
    else                             stateEl.textContent = 'Connecting…';
  }

  /* Sign in with Google, upgrading the current anonymous account in place
     when there is one — so the visitor's already-synced data carries over
     to the named account instead of being orphaned under the anon uid. */
  async function googleSignIn() {
    const provider = new GoogleAuthProvider();
    const cur = auth.currentUser;
    if (cur && cur.isAnonymous) {
      try { return await linkWithPopup(cur, provider); }
      catch (e) {
        // Credential already belongs to an existing account → just sign in.
        if (e.code === 'auth/credential-already-in-use' || e.code === 'auth/email-already-in-use')
          return await signInWithPopup(auth, provider);
        throw e;
      }
    }
    return await signInWithPopup(auth, provider);
  }

  /* Email sign-up, likewise linking an anonymous session in place. */
  async function emailSignUp(email, password) {
    const cur = auth.currentUser;
    if (cur && cur.isAnonymous) {
      try { return await linkWithCredential(cur, EmailAuthProvider.credential(email, password)); }
      catch (e) {
        if (e.code === 'auth/email-already-in-use' || e.code === 'auth/credential-already-in-use')
          return await signInWithEmailAndPassword(auth, email, password);
        throw e;
      }
    }
    return await createUserWithEmailAndPassword(auth, email, password);
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
        try { await googleSignIn(); }
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
    // The single source of truth for "which dashboard does this session
    // get?". Mirrors the three login roles plus their in-between states.
    //   admin · mentor (approved) · mentor_pending · client (named) · anon
    role: () => {
      const u = auth.currentUser;
      if (!u) return 'anon';
      if (isAdminUser(u)) return 'admin';
      if (mentorProfile && mentorProfile.approved) return 'mentor';
      if (mentorProfile) return 'mentor_pending';
      if (!u.isAnonymous) return 'client';
      return 'anon';
    },
    // True once any session exists (incl. the anonymous one minted on load) —
    // i.e. when reads/writes keyed on the current uid will succeed.
    hasUser: () => !!auth.currentUser,
    currentEmail: () => auth.currentUser && auth.currentUser.email,
    onMentorState: (fn) => { mentorListeners.push(fn); fn(mentorProfile); },

    async signUpEmail(email, password) { await emailSignUp(email, password); },
    async signInEmail(email, password) { await signInWithEmailAndPassword(auth, email, password); },
    async signInGoogle() { await googleSignIn(); },
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
    // A student reports that they have paid (manual rail): flips their own
    // request's payment to 'reported'. Rules allow only this transition for
    // the owning student; the mentor/admin still confirms 'paid' afterwards.
    async reportMyPayment(id, payment) {
      const u = auth.currentUser; if (!u) throw new Error('Not signed in');
      await updateDoc(doc(db, 'mentor_requests', id), { payment, updatedAt: Date.now() });
    },

    /* ── One-time premium unlocks (`orders`) ─────────────────────────────
       A signed-in user creates an order as 'reported' (manual rail) or
       'pending' (future PayHere); the admin marks it 'paid' after verifying
       the transfer. Entitlements in the app are derived from paid orders. */
    async createOrder({ item, amountLKR, ref, method, payerTxn, status }) {
      const u = auth.currentUser;
      if (!u) throw new Error('Sign in before purchasing');
      const docRef = await addDoc(collection(db, 'orders'), {
        uid: u.uid,
        item: String(item || ''),
        amountLKR: Number(amountLKR) || 0,
        ref: ref || '',
        method: method || '',
        payerTxn: payerTxn || '',
        status: status || 'reported',
        createdAt: Date.now(),
        ts: serverTimestamp(),
      });
      return docRef.id;
    },
    // The signed-in user's own orders (for #billing + entitlement gating).
    async fetchMyOrders() {
      const u = auth.currentUser; if (!u) return [];
      const snap = await getDocs(query(collection(db, 'orders'), where('uid', '==', u.uid)));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    },
    async fetchAllOrders() {
      requireAdmin();
      const snap = await getDocs(collection(db, 'orders'));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    },
    async updateOrderAdmin(id, patch) {
      requireAdmin();
      await updateDoc(doc(db, 'orders', id), { ...patch, updatedAt: Date.now() });
    },
  };

  let authInitialised = false;
  onAuthStateChanged(auth, u => {
    user = u;
    paintAuth();
    adminListeners.forEach(fn => { try { fn(isAdminUser(u)); } catch {} });
    refreshMentorProfile();          // updates the Mentor Dashboard sidebar link
    if (u && !isAdminUser(u)) pullAndMerge();   // students (incl. anonymous) sync
    // First callback after init carries the RESTORED session (or null). Only
    // when there's genuinely no session do we mint a persistent anonymous one
    // — checking here (not eagerly) avoids creating a duplicate account on
    // every reload before Firebase has rehydrated the stored uid.
    if (!authInitialised) {
      authInitialised = true;
      if (!u) signInAnonymously(auth).catch(e => console.warn('PathFinder: anon sign-in failed', e));
    }
  });

  paintAuth();

  // catch any leads/requests queued before this module loaded
  pushInbox('inbox_leads', PFStore.get('leads', []), l => l.email + '|' + l.at);
  pushMentorRequests(PFStore.get('mentorRequests', []));
}
