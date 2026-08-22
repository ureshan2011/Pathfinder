/* ════════════════════════════════════════════════════════════
   PathFinder — Firebase sync layer (free Spark plan)

   Account required to save. Nobody is signed in on load — browsing,
   the assessment, and the roadmap preview all work with zero
   Firestore writes. The moment a visitor tries to save something
   (see requireAccount() in app.js), that action is blocked behind a
   real sign-up/sign-in first; nothing is ever written under an
   anonymous, unnamed session. localStorage (PFStore) remains the
   synchronous read cache so the UI stays instant and works offline;
   Firestore is the durable system of record once an account exists.

   · Every PFStore write  →  users/{uid}/kv/{key}   (debounced) — only
     ever fires for a real, named user; the admin session is excluded
     so it never mirrors device data.
   · On sign-in            →  pull remote keys, merge "newer wins"
   · One narrow exception: the landing page's low-friction "leave your
     email" lead capture (addLead) still lazily mints an anonymous
     session on submit — a marketing signal, not product data, and
     asking for an account there would defeat the point of it being
     the quiet, no-commitment option. Everything else goes through
     requireAccount().
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
         { getAuth, GoogleAuthProvider, EmailAuthProvider, signInWithPopup, signInWithCredential, signInWithEmailAndPassword,
           createUserWithEmailAndPassword, linkWithPopup, linkWithCredential,
           signInWithRedirect, linkWithRedirect, getRedirectResult,
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

  // Completes the googleSignIn() popup-blocked fallback: after Google sends
  // the browser back here, this resolves the pending sign-in and
  // onAuthStateChanged below fires with the now-signed-in user. Resolves to
  // null on an ordinary page load with no redirect in flight, so it's safe
  // to call unconditionally.
  getRedirectResult(auth).catch(e => console.warn('PathFinder: redirect sign-in failed', e));

  const isAdminUser = (u) => !!u && u.email === ADMIN_EMAIL;

  let user = null;
  // Flips true the first time onAuthStateChanged fires — i.e. once Firebase
  // has actually finished checking IndexedDB for a persisted session, not
  // merely once this module has loaded. window.PFCloud exists the instant
  // the SDK imports resolve, well before that persisted-session check
  // completes, so callers that only waited for `window.PFCloud` (see
  // renderAccount/mentor/admin dashboards in app.js) could read a signed-in
  // user as 'anon' on a refresh — the exact "session not saved" report.
  let authResolved = false;
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
    if (isAdminUser(user))              stateEl.textContent = 'Admin session';
    else if (user && !user.isAnonymous) stateEl.textContent = 'Synced to cloud';
    // A live anonymous session only exists here for the lead-capture form
    // (see the header comment) — everything else requires a real account.
    else if (user)                      stateEl.textContent = 'Saved to cloud';
    else                                stateEl.textContent = 'Sign in to save your work';
  }

  /* Sign in with Google, upgrading the current anonymous account in place
     when there is one — so the visitor's already-synced data carries over
     to the named account instead of being orphaned under the anon uid.

     Most returning visitors hit the "already in use" branch below (their
     Google account is already a real PathFinder account, just under a
     different anon uid than this device's current one) — reuse the
     credential the popup already produced instead of opening a second
     Google popup for the same account. */
  async function googleSignIn() {
    const provider = new GoogleAuthProvider();
    const cur = auth.currentUser;
    if (cur && cur.isAnonymous) {
      try { return await linkWithPopup(cur, provider); }
      catch (e) {
        // Popup blockers stop the popup window.open() itself, before any
        // Google account is chosen — silently killing signup with no error
        // shown. Redirect the whole tab instead; onAuthStateChanged picks
        // up the result when the browser returns from Google (see
        // getRedirectResult below). See B-05 in the bug tracker.
        if (e.code === 'auth/popup-blocked') return await linkWithRedirect(cur, provider);
        if (e.code === 'auth/credential-already-in-use') {
          const cred = GoogleAuthProvider.credentialFromError(e);
          if (cred) return await signInWithCredential(auth, cred);
        }
        if (e.code === 'auth/credential-already-in-use' || e.code === 'auth/email-already-in-use')
          return await signInWithPopup(auth, provider);
        throw e;
      }
    }
    try { return await signInWithPopup(auth, provider); }
    catch (e) {
      if (e.code === 'auth/popup-blocked') return await signInWithRedirect(auth, provider);
      throw e;
    }
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
        <button class="btn btn-quiet btn-sm" id="pf-signout">Sign out</button>`;
      slot.querySelector('#pf-signout').onclick = () => signOut(auth);
    } else if (user && !user.isAnonymous) {
      slot.innerHTML = `
        <div class="faint" style="font-family:var(--font-mono);font-size:10px;letter-spacing:.06em;margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${user.email || ''}">
          ${user.displayName || user.email || 'Signed in'}</div>
        <button class="btn btn-quiet btn-sm" id="pf-signout">Sign out</button>`;
      slot.querySelector('#pf-signout').onclick = () => signOut(auth);
    } else {
      slot.innerHTML = `<button class="btn btn-quiet btn-sm" id="pf-signin">
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

  /* ── Mentoring session records (`mentor_sessions`) ────────────────────
     The delivered-work log behind every invoice. A mentor logs one record
     per session — including the many that arrive by WhatsApp or a phone
     call and never pass through the request queue — so notes, duration,
     fee and payment state are captured once and an invoice can be
     generated from them. Every field is normalised and length-capped here
     so the shape matches what firestore.rules validates on create. */
  function normaliseSession(rec, uid, mentorName) {
    const cap = (v, n) => String(v == null ? '' : v).slice(0, n);
    return {
      mentorId: rec.mentorId || uid,
      mentorName: cap(rec.mentorName || mentorName || '', 199),
      studentName: cap(rec.studentName, 199),
      studentContact: cap(rec.studentContact, 199),
      studentUid: cap(rec.studentUid, 199),
      channel: cap(rec.channel || 'whatsapp', 40),
      topic: cap(rec.topic, 60),
      title: cap(rec.title, 199),
      date: cap(rec.date || new Date().toISOString().slice(0, 10), 20),
      durationMin: Math.max(0, Number(rec.durationMin) || 0),
      summary: cap(rec.summary, 4999),
      notes: cap(rec.notes, 4999),
      followUp: cap(rec.followUp, 4999),
      amountLKR: Math.max(0, Number(rec.amountLKR) || 0),
      paymentStatus: cap(rec.paymentStatus || 'unpaid', 20),
      method: cap(rec.method, 60),
      ref: cap(rec.ref, 80),
      payerTxn: cap(rec.payerTxn, 80),
      paidAt: rec.paidAt || null,
      requestId: cap(rec.requestId, 80),
      invoiceNo: cap(rec.invoiceNo, 40),
    };
  }

  /* Invoice numbers must be stable and quotable, and Firestore has no
     cheap counter on the free plan — so derive one from the creation
     month plus a short random tail. Collisions are vanishingly unlikely
     and would only affect the printed label, never the record itself. */
  function mintInvoiceNo() {
    const prefix = (window.PF_CONFIG && PF_CONFIG.org && PF_CONFIG.org.invoicePrefix) || 'PF';
    const d = new Date();
    const ym = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0');
    let tail = '';
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no look-alikes
    const rnd = crypto.getRandomValues(new Uint8Array(5));
    rnd.forEach(b => { tail += alphabet[b % alphabet.length]; });
    return `${prefix}-INV-M-${ym}-${tail}`;
  }

  window.PFCloud = {
    ready: true,
    // True once the first persisted-session check has completed — see the
    // authResolved comment above. Callers that gate a view on "has the
    // accounts layer loaded" should wait on this, not just on PFCloud
    // existing, or they can render 'anon' for a session that is about to
    // restore.
    authResolved: () => authResolved,
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
    // Priority requests (a Premium plan grants it) sort above everything
    // else; within each band it stays newest-first as before. Sorting here
    // rather than in a Firestore `orderBy` keeps the query on one equality
    // filter, so it needs no composite index.
    async fetchOpenRequests() {
      const snap = await getDocs(query(collection(db, 'mentor_requests'), where('status', '==', 'open')));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0)
                     || (b.at || '').localeCompare(a.at || ''));
    },
    // The public-to-signed-in-students directory (#mentors → Browse). Any
    // signed-in user may read the mentors collection (firestore.rules), so
    // this needs no admin check — only the approved+active filter an
    // ordinary visitor should see, done client-side on one equality query
    // so it needs no composite index. On-demand only (called when the
    // Browse tab opens), never on page load — see firebase-firestore skill.
    async fetchApprovedMentors() {
      const snap = await getDocs(query(collection(db, 'mentors'), where('approved', '==', true)));
      return snap.docs.map(d => ({ uid: d.id, ...d.data() })).filter(m => m.active !== false);
    },
    // The requests this mentor has already claimed (any status).
    async fetchMyClaimedRequests() {
      const u = auth.currentUser; if (!u) return [];
      const snap = await getDocs(query(collection(db, 'mentor_requests'), where('mentorId', '==', u.uid)));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },
    /* Phone / walk-in intake — someone rings or WhatsApps with no account
       at all, and whoever picks up writes them down. The record lands in
       the SAME `mentor_requests` queue as a request typed on the site, so
       from there on it moves through one lifecycle, shows on one dashboard
       and invoices through one session log. Pass `mentorId` to assign it on
       the spot (a mentor may only assign to themselves; the admin may hand
       it to anyone) or leave it empty to drop it in the open queue.

       One write. Nothing is read back — the caller already holds the record
       we just built, so the dashboard updates without a refetch. */
    async createIntakeRequest(rec) {
      const u = auth.currentUser;
      if (!u) throw new Error('Sign in first');
      const admin = isAdminUser(u);
      const mentor = !!(mentorProfile && mentorProfile.approved);
      if (!admin && !mentor) throw new Error('Only a mentor or the admin can take a call');

      const cap = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
      // 'self' lets the caller assign without having to know its own uid.
      const raw = cap(rec.mentorId, 120);
      const assignTo = raw === 'self' ? u.uid : raw;
      if (assignTo && !admin && assignTo !== u.uid)
        throw new Error('You can only take a call for yourself');

      const data = {
        name: cap(rec.name, 199),
        contact: cap(rec.contact, 199),
        topic: cap(rec.topic, 60),
        note: cap(rec.note, 1999),
        // No account behind this person — that is the whole point of intake.
        studentUid: '',
        source: cap(rec.source || 'call', 20),
        callback: cap(rec.callback, 199),
        takenBy: u.uid,
        takenByName: cap(admin ? 'Admin' : (mentorProfile && mentorProfile.displayName) || '', 199),
        status: assignTo ? 'claimed' : 'open',
        mentorId: assignTo || null,
        introDoneAt: null,
        payment: null,
        at: new Date().toISOString(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      if (!data.name) throw new Error('Write down their name');
      if (!data.contact) throw new Error('Write down a phone number or email');

      const ref = await addDoc(collection(db, 'mentor_requests'), { ...data, ts: serverTimestamp() });
      return { id: ref.id, ...data };
    },
    /* Mint the request-shaped record that lets an off-platform (WhatsApp/
       phone) session draw down a paid plan the same way a request raised
       through "Ask a mentor" does — same `redeem` field, same ledger
       everything else already reads.

       Unlike createIntakeRequest(), this names a REAL studentUid on
       create — the case firestore.rules only allows for the admin, or for
       a mentor with a verified mentor_students link to that uid (see the
       rule comment on mentor_requests.create). A mentor without that link
       gets a permission error, which is exactly right: they only ever see
       a balance to redeem against once fetchOrdersFor()/the balance strip
       proved the link exists. */
    async redeemPlanCredit({ studentUid, mentorId, name, contact }) {
      const u = auth.currentUser;
      if (!u) throw new Error('Not signed in');
      const admin = isAdminUser(u);
      const mentor = !!(mentorProfile && mentorProfile.approved);
      if (!admin && !mentor) throw new Error('Only a mentor or the admin can do this');
      const cap = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
      const data = {
        name: cap(name, 199), contact: cap(contact, 199),
        topic: '', note: 'Plan credit redeemed against an off-platform session.',
        studentUid: cap(studentUid, 199),
        source: 'call',
        callback: '',
        takenBy: u.uid,
        takenByName: admin ? 'Admin' : (mentorProfile && mentorProfile.displayName) || '',
        status: 'claimed',
        mentorId: admin ? (cap(mentorId, 120) || null) : u.uid,
        redeem: 'session',
        introDoneAt: null,
        payment: null,
        at: new Date().toISOString(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      if (!data.studentUid) throw new Error('No linked account to redeem against');
      const ref = await addDoc(collection(db, 'mentor_requests'), { ...data, ts: serverTimestamp() });
      return { id: ref.id, ...data };
    },
    // Record that this mentor has a verified relationship with a student,
    // so future visits can read that student's plan balance and redeem
    // credits for them (see the mentor_students rule). A mentor proves it
    // with `evidenceRequestId` — a request they own that already names
    // this studentUid (typically one raised by the student themselves and
    // then claimed). The admin may link any pair directly, with no
    // evidence needed — used after "Link to account" in the People tab, so
    // mentors who already served that person get visibility immediately.
    async linkMentorToStudent({ mentorId, uid, evidenceRequestId }) {
      const u = auth.currentUser;
      if (!u) throw new Error('Not signed in');
      const admin = isAdminUser(u);
      const targetMentor = admin ? (mentorId || u.uid) : u.uid;
      if (!uid) throw new Error('No account to link');
      await setDoc(doc(db, 'mentor_students', targetMentor + '_' + uid),
        { uid, evidenceRequestId: evidenceRequestId || '', linkedAt: Date.now() });
    },
    // Atomic claim — only succeeds while the request is still open/unclaimed,
    // so two mentors can never claim the same request (first-come wins).
    async claimRequest(id) {
      const u = auth.currentUser; if (!u) throw new Error('Not signed in');
      const ref = doc(db, 'mentor_requests', id);
      let studentUid = '';
      await runTransaction(db, async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('Request no longer exists');
        const d = snap.data();
        if (d.status !== 'open' || d.mentorId) throw new Error('Already claimed');
        studentUid = d.studentUid || '';
        tx.update(ref, { status: 'claimed', mentorId: u.uid, updatedAt: Date.now() });
      });
      // A real signed-in student's own request — the moment it's claimed,
      // this mentor↔student pair is evidenced (mentorId and studentUid now
      // both sit on the same doc), so record it: from here the mentor can
      // see this student's plan balance and, later, redeem a credit for an
      // off-platform session with them too. Off-platform intake never has
      // a studentUid, so this is a no-op for that case.
      if (studentUid) {
        setDoc(doc(db, 'mentor_students', u.uid + '_' + studentUid),
          { uid: studentUid, evidenceRequestId: id, linkedAt: Date.now() }).catch(() => {});
      }
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
    // A mentor's (or the admin's) look-up of one OTHER student's requests —
    // used only to work out that student's plan balance while logging an
    // off-platform session (see the known-caller balance strip). Rules
    // already let any approved mentor read the whole mentor_requests
    // collection (it's the shared claim queue), so this needs no new grant.
    // Called on demand, only when a name/contact match resolves to a uid —
    // never on page load.
    async fetchRequestsFor(uid) {
      if (!uid) return [];
      const snap = await getDocs(query(collection(db, 'mentor_requests'), where('studentUid', '==', uid)));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    /* ── Mentoring session records ───────────────────────────────────── */
    // Log a delivered session. Mentors log their own; the admin may log
    // one on a mentor's behalf by passing mentorId. Returns the stored doc
    // (with its id + minted invoice number) so the caller can invoice it
    // immediately without re-reading the collection.
    async createSession(rec) {
      const u = auth.currentUser;
      if (!u) throw new Error('Not signed in');
      if (!isAdminUser(u) && !(mentorProfile && mentorProfile.approved))
        throw new Error('Only an approved mentor can log a session');
      const data = normaliseSession(rec, u.uid, mentorProfile && mentorProfile.displayName);
      if (!data.studentName) throw new Error('Write down their name');
      if (!data.mentorId) throw new Error('Pick which mentor delivered the session');
      data.invoiceNo = data.invoiceNo || mintInvoiceNo();
      data.createdBy = u.uid;
      data.createdAt = Date.now();
      data.updatedAt = Date.now();
      // `ts` is a server sentinel, not a value — keep it out of what we
      // hand back so callers never try to read or serialise it.
      const ref = await addDoc(collection(db, 'mentor_sessions'), { ...data, ts: serverTimestamp() });
      return { id: ref.id, ...data };
    },
    // Edit a record you own (notes, fee, payment state). mentorId is never
    // part of the patch — rules reject a reassignment anyway.
    async updateSession(id, patch) {
      const clean = { ...patch };
      delete clean.mentorId; delete clean.createdBy; delete clean.createdAt; delete clean.id;
      await updateDoc(doc(db, 'mentor_sessions', id), { ...clean, updatedAt: Date.now() });
    },
    // Admin only: attach a real account to sessions that were logged before
    // the link was known — a WhatsApp/phone caller who has since signed up
    // under the same phone number. firestore.rules pins studentUid on a
    // mentor's own writes to a session (see namedStudentIsOwn()), so this is
    // the one sanctioned way an existing session's studentUid ever changes.
    async linkSessionsToAccount(sessionIds, uid) {
      requireAdmin();
      for (const id of sessionIds || []) {
        await updateDoc(doc(db, 'mentor_sessions', id), { studentUid: uid, updatedAt: Date.now() });
      }
    },
    // The signed-in mentor's own log.
    async fetchMySessions() {
      const u = auth.currentUser; if (!u) return [];
      const snap = await getDocs(query(collection(db, 'mentor_sessions'), where('mentorId', '==', u.uid)));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (b.createdAt || 0) - (a.createdAt || 0));
    },
    // Sessions logged against the signed-in student — powers the invoice
    // list in #billing, so a student can download their own receipts.
    async fetchMySessionsAsStudent() {
      const u = auth.currentUser; if (!u) return [];
      const snap = await getDocs(query(collection(db, 'mentor_sessions'), where('studentUid', '==', u.uid)));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    },
    async fetchAllSessions() {
      requireAdmin();
      const snap = await getDocs(collection(db, 'mentor_sessions'));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (b.createdAt || 0) - (a.createdAt || 0));
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
    // The mentor/admin counterpart of fetchMyOrders(), for one other
    // student. Only readable once mentor_students has a verified link for
    // this mentor↔student pair (firestore.rules) — a plain permission
    // error here just means no link exists yet, so callers should treat a
    // rejection as "no plan" rather than surfacing it as a failure.
    async fetchOrdersFor(uid) {
      if (!uid) return [];
      const snap = await getDocs(query(collection(db, 'orders'), where('uid', '==', uid)));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
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

  onAuthStateChanged(auth, u => {
    user = u;
    authResolved = true;
    paintAuth();
    // The top-nav avatar (initials) is painted by app.js's updateNavChrome(),
    // which only runs after route(). This callback fires without a
    // navigation on sign-out (B-06) AND on the very first restore after a
    // page refresh, when the initial route() already painted with no
    // session because Firebase hadn't resolved the stored one yet (B-08:
    // "avatar resets to empty on refresh even though still signed in").
    // Repainting here on every auth-state change, not just sign-out,
    // covers both.
    if (window.updateNavChrome) window.updateNavChrome();
    adminListeners.forEach(fn => { try { fn(isAdminUser(u)); } catch {} });
    refreshMentorProfile();          // updates the Mentor Dashboard sidebar link
    if (u && !isAdminUser(u)) pullAndMerge();   // real account signed in — pull their data
    // No eager anonymous sign-in here on purpose: `u` staying null is the
    // normal, expected state for a visitor who hasn't saved anything yet.
    // The only path that ever mints an anonymous session is the lead-capture
    // form's own ensureAuth() call, on demand, at submit time.
  });

  paintAuth();

  // catch any leads/requests queued before this module loaded
  pushInbox('inbox_leads', PFStore.get('leads', []), l => l.email + '|' + l.at);
  pushMentorRequests(PFStore.get('mentorRequests', []));
}
