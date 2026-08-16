/* ════════════════════════════════════════════════════════════
   PathFinder — Storage layer
   LocalStorage adapter today; the PFStore interface mirrors a
   Firestore document API so swapping in Firebase later means
   replacing only this file (see README → Firebase migration).
   ════════════════════════════════════════════════════════════ */

const PFStore = (() => {
  const NS = 'pathfinder.v1.';

  /* change listeners — the Firebase sync layer subscribes here so every
     local write is mirrored to Firestore without callers knowing */
  const listeners = [];
  const onChange = (fn) => listeners.push(fn);
  function notify(key, value) { listeners.forEach(fn => { try { fn(key, value); } catch {} }); }

  /* per-key write timestamps — lets the sync layer merge local vs remote
     by "newer wins" instead of blindly overwriting either side */
  const getMeta = () => { try { return JSON.parse(localStorage.getItem(NS + '__meta')) || {}; } catch { return {}; } };
  function touchMeta(key) {
    try {
      const m = getMeta(); m[key] = Date.now();
      localStorage.setItem(NS + '__meta', JSON.stringify(m));
    } catch {}
  }

  function get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(NS + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  }

  function set(key, value) {
    try { localStorage.setItem(NS + key, JSON.stringify(value)); } catch {}
    touchMeta(key);
    notify(key, value);
    return value;
  }

  /* used by the sync layer to apply remote data WITHOUT re-notifying
     (would cause an echo loop) — stamps meta with the remote timestamp */
  function applyRemote(key, value, remoteTs) {
    try {
      localStorage.setItem(NS + key, JSON.stringify(value));
      const m = getMeta(); m[key] = remoteTs || Date.now();
      localStorage.setItem(NS + '__meta', JSON.stringify(m));
    } catch {}
  }

  function remove(key) { try { localStorage.removeItem(NS + key); } catch {} touchMeta(key); notify(key, null); }

  /* Domain helpers ------------------------------------------------ */

  // track: 'masters' | 'phd' — which qualification the student is aiming for.
  // Drives copy, roadmap phases, fee maths and catalogue filters everywhere
  // (see PF_TRACK in data.js). Defaults to 'phd' so existing users, who
  // signed up when PathFinder was PhD-only, keep the product they know.
  const getTrack = () => (get('track') === 'masters' ? 'masters' : 'phd');
  const setTrack = (t) => set('track', t === 'masters' ? 'masters' : 'phd');

  // assessment: { answers, result, completedAt }
  const getAssessment = () => get('assessment');
  const setAssessment = (a) => set('assessment', a);

  // saved opportunities: array of { kind:'lab'|'scholarship'|'uni'|'course'|'provider', id, label?, sub? }
  // `label`/`sub` are carried for catalogue items (courses, scholarships,
  // providers) so the dashboard can list them without loading the catalogue
  // shard they came from. Curated items (uni, lab) store neither and are
  // still resolved from PF_UNIVERSITIES / PF_LABS.
  const getSaved = () => get('saved', []);
  function toggleSaved(kind, id, label, sub) {
    const list = getSaved();
    const i = list.findIndex(x => x.kind === kind && x.id === id);
    if (i >= 0) list.splice(i, 1);
    else list.push({ kind, id, savedAt: Date.now(), ...(label ? { label } : {}), ...(sub ? { sub } : {}) });
    set('saved', list);
    return i < 0; // true if now saved
  }
  const isSaved = (kind, id) => getSaved().some(x => x.kind === kind && x.id === id);

  // applications: array of { id, uni, program, supervisor, status, notes, updatedAt }
  const APP_STATUSES = ['Researching', 'Contacted Supervisor', 'Preparing Documents', 'Applied', 'Interview', 'Offer', 'Enrolled'];
  const getApps = () => get('applications', []);
  function upsertApp(app) {
    const list = getApps();
    const i = list.findIndex(a => a.id === app.id);
    app.updatedAt = Date.now();
    if (i >= 0) list[i] = app; else { app.id = app.id || ('app_' + Date.now()); list.push(app); }
    set('applications', list);
    return app;
  }
  function deleteApp(id) { set('applications', getApps().filter(a => a.id !== id)); }

  // leads (email capture) — queued locally; synced to Firestore when configured
  function addLead(email, source) {
    const leads = get('leads', []);
    const lead = { email, source, at: new Date().toISOString() };
    leads.push(lead);
    set('leads', leads);
    return lead;
  }

  // generic checklists: checklist.<key> = { itemId: epochMs } — progress is
  // always derived from the dataset, so checklists can grow without
  // corrupting saved state. Firebase: users/{uid}/kv/checklist.<key>
  const getChecklist = (key) => get('checklist.' + key, {});
  function setChecklistItem(key, id, done) {
    const c = getChecklist(key);
    if (done) c[id] = Date.now(); else delete c[id];
    return set('checklist.' + key, c);
  }
  const isChecked = (key, id) => !!getChecklist(key)[id];

  // ── Mentor requests (the new marketplace queue) ────────────────────
  // The student's own LOCAL copy of every "Ask a mentor" request, mirrored
  // to users/{uid}/kv/mentorRequests (cross-device) AND pushed once to the
  // create-only top-level `mentor_requests` collection (the shared queue
  // mentors claim from). Replaces the old `consultations` / inbox flow.
  //
  // Lifecycle (also enforced in firestore.rules):
  //   open → claimed → intro_done → awaiting_payment → paid → completed
  //   (cancelled is reachable at any point before paid)
  const MENTOR_REQUEST_STATUSES = ['open', 'claimed', 'intro_done',
    'awaiting_payment', 'paid', 'completed', 'cancelled'];

  const getMentorRequests = () => get('mentorRequests', []);
  /* `redeem` ('session' | 'audit' | null) marks a request raised against a
     credit included in a paid plan, and is what creditsUsed() in app.js
     counts to derive the remaining balance — so it is the only record of
     the spend, and must survive the round trip to Firestore. `priority`
     rides along for plans that include it, and sorts the mentor queue. */
  // `source` is how the enquiry first reached us (PF_REQUEST_SOURCES in
  // data.js). It defaults to 'platform' — typed on the site — and is set to
  // 'whatsapp' when the student opens the chat from inside the app, so a
  // conversation that carries on over WhatsApp still has a row in the queue
  // rather than living only on somebody's phone.
  function addMentorRequest({ topic, note, name, contact, redeem, priority, source }) {
    const list = getMentorRequests();
    const r = {
      id: 'mr_' + Date.now(),
      topic: topic || '', note: note || '',
      name: name || '', contact: contact || '',
      source: source || 'platform',
      studentUid: null,             // set to the real uid by the sync layer
      status: 'open',
      mentorId: null,
      introDoneAt: null,
      redeem: redeem || null,       // 'session' | 'audit' — a plan credit spent
      priority: !!priority,         // included with Premium; sorts the queue
      payment: null,                // { amountLKR, payhereLink, paymentStatus, paidAt }
      at: new Date().toISOString(), // kept for sorting parity with old inbox
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    list.push(r);
    set('mentorRequests', list);
    return r;
  }
  function updateMentorRequest(id, patch) {
    const list = getMentorRequests();
    const r = list.find(x => x.id === id);
    if (r) { Object.assign(r, patch, { updatedAt: Date.now() }); set('mentorRequests', list); }
    return r;
  }
  function deleteMentorRequest(id) { set('mentorRequests', getMentorRequests().filter(r => r.id !== id)); }

  /* Deprecated alias — kept so any stray caller still works. The old
     "consultations" flow is superseded by mentor requests; mentorId is no
     longer meaningful at request time (no named directory), so it is dropped. */
  const CONSULT_STATUSES = MENTOR_REQUEST_STATUSES;
  const getConsults = getMentorRequests;
  function addConsultation({ topic, note, name, contact }) {
    return addMentorRequest({ topic, note, name, contact });
  }
  const updateConsult = updateMentorRequest;
  const deleteConsult = deleteMentorRequest;

  // settlement cost-calculator preferences: { city, status, overrides,
  //   weekly, partner:{ on, rate, hours } }
  const getCalcPrefs = () => get('calcPrefs', null);
  const setCalcPrefs = (p) => set('calcPrefs', p);

  // First-Months simulator progress: { day } (0–90)
  const getFirstMonthsProgress = () => get('firstMonths', null);
  const setFirstMonthsProgress = (p) => set('firstMonths', p);

  // Saved funds-planner scenarios: array of
  //   { id, name, cityId, status, overrides, weekly, partner, createdAt }
  // Mirrors the applications/consultations shape so it syncs the same way.
  const getFundsPlans = () => get('fundsPlans', []);
  function saveFundsPlan(plan) {
    const list = getFundsPlans();
    const i = list.findIndex(p => p.id === plan.id);
    if (i >= 0) list[i] = { ...list[i], ...plan };
    else { plan.id = plan.id || ('plan_' + Date.now()); plan.createdAt = Date.now(); list.push(plan); }
    set('fundsPlans', list);
    return plan;
  }
  function deleteFundsPlan(id) { set('fundsPlans', getFundsPlans().filter(p => p.id !== id)); }

  // Research Studio: one object { intake, candidates, selected, proposal,
  //   sources, generatedAt }. Scholarly results are cached inside it so
  //   reopening #research does NOT re-hit the external API (or Firestore).
  //   Firebase: users/{uid}/kv/research — one debounced write.
  const getResearch = () => get('research');
  const setResearch = (r) => set('research', r);

  return { get, set, remove, onChange, applyRemote, getMeta,
           getTrack, setTrack,
           getAssessment, setAssessment, getSaved, toggleSaved, isSaved,
           APP_STATUSES, getApps, upsertApp, deleteApp, addLead,
           getChecklist, setChecklistItem, isChecked,
           MENTOR_REQUEST_STATUSES, getMentorRequests, addMentorRequest,
           updateMentorRequest, deleteMentorRequest,
           CONSULT_STATUSES, getConsults, addConsultation, updateConsult, deleteConsult,
           getCalcPrefs, setCalcPrefs,
           getFirstMonthsProgress, setFirstMonthsProgress,
           getFundsPlans, saveFundsPlan, deleteFundsPlan,
           getResearch, setResearch };
})();
