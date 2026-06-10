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

  // assessment: { answers, result, completedAt }
  const getAssessment = () => get('assessment');
  const setAssessment = (a) => set('assessment', a);

  // saved opportunities: array of { kind:'lab'|'scholarship'|'uni', id }
  const getSaved = () => get('saved', []);
  function toggleSaved(kind, id) {
    const list = getSaved();
    const i = list.findIndex(x => x.kind === kind && x.id === id);
    if (i >= 0) list.splice(i, 1); else list.push({ kind, id, savedAt: Date.now() });
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

  // consultation requests — Firebase: users/{uid}/kv/consultations + a
  // create-only top-level `consultations` collection for the platform inbox
  const CONSULT_STATUSES = ['Requested', 'Replied', 'Scheduled', 'Completed'];
  const getConsults = () => get('consultations', []);
  function addConsultation({ mentorId, topic, note, name, contact }) {
    const list = getConsults();
    const c = { id: 'c_' + Date.now(), mentorId, topic: topic || '', note: note || '',
                name: name || '', contact: contact || '', status: 'Requested',
                at: new Date().toISOString() };
    list.push(c);
    set('consultations', list);
    return c;
  }
  function updateConsult(id, patch) {
    const list = getConsults();
    const c = list.find(x => x.id === id);
    if (c) { Object.assign(c, patch); set('consultations', list); }
    return c;
  }
  function deleteConsult(id) { set('consultations', getConsults().filter(c => c.id !== id)); }

  // settlement cost-calculator preferences: { city, status, overrides }
  const getCalcPrefs = () => get('calcPrefs', null);
  const setCalcPrefs = (p) => set('calcPrefs', p);

  return { get, set, remove, onChange, applyRemote, getMeta,
           getAssessment, setAssessment, getSaved, toggleSaved, isSaved,
           APP_STATUSES, getApps, upsertApp, deleteApp, addLead,
           getChecklist, setChecklistItem, isChecked,
           CONSULT_STATUSES, getConsults, addConsultation, updateConsult, deleteConsult,
           getCalcPrefs, setCalcPrefs };
})();
