/* ════════════════════════════════════════════════════════════
   PathFinder — Storage layer
   LocalStorage adapter today; the PFStore interface mirrors a
   Firestore document API so swapping in Firebase later means
   replacing only this file (see README → Firebase migration).
   ════════════════════════════════════════════════════════════ */

const PFStore = (() => {
  const NS = 'pathfinder.v1.';

  function get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(NS + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  }

  function set(key, value) {
    try { localStorage.setItem(NS + key, JSON.stringify(value)); } catch {}
    return value;
  }

  function remove(key) { try { localStorage.removeItem(NS + key); } catch {} }

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

  // leads (email capture) — queued locally; future: POST to Firebase function
  function addLead(email, source) {
    const leads = get('leads', []);
    leads.push({ email, source, at: new Date().toISOString() });
    set('leads', leads);
  }

  return { get, set, remove, getAssessment, setAssessment, getSaved, toggleSaved, isSaved,
           APP_STATUSES, getApps, upsertApp, deleteApp, addLead };
})();
