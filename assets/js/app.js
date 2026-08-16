/* ════════════════════════════════════════════════════════════
   PathFinder — App SPA (assessment, roadmap, explorer,
   funding, dashboard, starter kit). Hash-routed, no build step.
   ════════════════════════════════════════════════════════════ */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uniById = id => PF_UNIVERSITIES.find(u => u.id === id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ── Study track ────────────────────────────────────────────────────
   Every view reads its track-specific copy and numbers through here, so
   an unknown or legacy stored value can only ever degrade to the PhD
   journey the product shipped with. See PF_TRACK in data.js. */
const trackCfg = () => PF_TRACK[PFStore.getTrack()] || PF_TRACK.phd;
const isMasters = () => PFStore.getTrack() === 'masters';
const visaUpdates = () => (isMasters() ? PF_VISA_UPDATES_MASTERS : PF_VISA_UPDATES);

/* Track value: prefers a `masters_<field>` alternate on the master's track.
   Several facts in the Visa Hub and the Settle In guide are true only for
   doctoral students — unlimited work rights, domestic school fees for
   children, publicly funded healthcare — and stating them to a master's
   applicant would be worse than saying nothing. Entries that need a
   different answer carry the alternate in data.js; everything else falls
   through to the shared text unchanged. */
const tv = (o, k) => (isMasters() && o['masters_' + k] !== undefined ? o['masters_' + k] : o[k]);

/* The stored assessment recomputed against the ACTIVE track. The answers
   stay valid across a track switch — a bachelor's degree is a bachelor's
   degree — but the pathway, readiness and matched counts derived from them
   do not, so every view that displays a result reads it through here rather
   than trusting the copy frozen at completion time. */
function currentResult() {
  const a = PFStore.getAssessment();
  if (!a) return null;
  return a.answers ? computeResult(a.answers) : a.result;
}

/* Switch tracks and re-render wherever we are. The assessment result is
   deliberately NOT cleared — the answers stay valid, but the pathway is
   recomputed against the new track's rules the next time it is read. */
function switchTrack(t) {
  if (PFStore.getTrack() === t) return;
  PFStore.setTrack(t);
  paintTrackSwitch();
  route();
  toast(`Switched to the ${trackCfg().label} track`);
}

/* The segmented control in the sidebar. Rendered once at boot and
   repainted on change — it is the only always-visible reminder of which
   journey the student is on. */
function paintTrackSwitch() {
  const box = $('#track-switch');
  if (!box) return;
  const cur = PFStore.getTrack();
  box.innerHTML = ['masters', 'phd'].map(t =>
    `<button class="tsw-opt ${t === cur ? 'active' : ''}" data-track="${t}"
       aria-pressed="${t === cur}">${PF_TRACK[t].label}</button>`).join('');
  $$('.tsw-opt', box).forEach(b => b.onclick = () => switchTrack(b.dataset.track));
}

/* Landing-page hand-off: index.html links to app.html?track=masters#assessment
   so the student's very first click already sets the journey. Consumed once,
   then stripped from the URL so a shared link doesn't silently re-switch. */
function adoptTrackFromQuery() {
  const t = new URLSearchParams(location.search).get('track');
  if (t === 'masters' || t === 'phd') {
    PFStore.setTrack(t);
    history.replaceState(null, '', location.pathname + location.hash);
  }
}

/* Given a raw institution display-name (from OpenAlex authorships, or our
   curated labs), resolve it to { uni } — one of the eight NZ campuses with an
   Explore link — or { institute } — a recognised NZ research home — or null.
   This is what lets a "cited author" quietly become "a researcher at a real NZ
   university the student could join". */
function nzHomeFromName(name) {
  if (!name) return null;
  const m = PF_UNI_MATCH.find(x => x.re.test(name));
  if (m) return { uni: uniById(m.id), uniId: m.id };
  const inst = PF_NZ_INSTITUTES.find(x => x.re.test(name));
  if (inst) return { institute: inst.label };
  return null;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2400);
}

/* Account gate for the two high-stakes, human-facing actions: connecting
   with a mentor and any purchase. Explorers use everything else (assessment,
   roadmap, explorer, funding, studio, templates) with no account — but the
   moment they want a mentor or want to pay, they must have a real account and
   be signed in (not the anonymous device session), so the request/order is
   tied to a person and reachable across devices. Returns true when allowed;
   otherwise nudges to #account (carrying where they were headed, so signing
   up doesn't strand them back on the dashboard) and returns false.

   `opts.next` is the hash (without the leading #) to resume once they're
   signed in — e.g. 'mentors?topic=visa-medical' so a student who got gated
   asking about their visa documents lands right back on that pre-filled
   form, not on the generic dashboard. Defaults to the current hash. */
function requireAccount(reason, opts = {}) {
  if (window.PFCloud && PFCloud.isSignedIn && PFCloud.isSignedIn()) return true;
  toast(reason || 'Create a free account to continue.');
  location.hash = accountHref(opts.next || location.hash.slice(1));
  return false;
}

/* ── The soft account prompt ─────────────────────────────────────────
   requireAccount() above is the hard gate: it stops an action until there
   is a real account behind it. This is its opposite — it never stops
   anything. It appears the moment a student has just MADE something worth
   keeping (a roadmap, a shortlist, a tracked application, a proposal
   draft) and offers to keep it on every device. Declining works, is
   remembered, and leaves the work exactly where it was.

   Why the ask lives here and not at the front door: every visitor is
   already signed in anonymously and already syncing to Firestore
   (firebase.js), and signing up later LINKS that anonymous account in
   place rather than orphaning it — so a wall at the landing page would
   protect nothing a student can feel, while costing the assessment funnel
   the whole product runs on. What an account actually buys them is the
   second device, and that is only worth explaining once they own
   something that would be stranded on the first one.

   Each moment fires at most once, ever. The record lives in `__softGate`
   — a `__`-prefixed key the sync layer skips (firebase.js:162) — so
   remembering a dismissal costs no Firestore write. */
function softAccountPrompt(opts) {
  const o = opts || {};
  if (!cloudOn() || !o.key) return;
  // PFCloud arrives as a deferred module; with no accounts layer loaded
  // there is nothing to offer and no way to tell who is already signed in.
  if (!(window.PFCloud && PFCloud.isSignedIn && PFCloud.signInGoogle)) return;
  if (PFCloud.isSignedIn()) return;
  const seen = PFStore.get('__softGate', {}) || {};
  if (seen[o.key]) return;
  seen[o.key] = Date.now();
  PFStore.set('__softGate', seen);

  const m = modal(o.title || 'Keep this on every device', `
    <p style="font-size:14.5px;margin:0">${esc(o.body || '')}</p>
    <p class="muted" style="font-size:12.5px;margin:10px 0 0">Free, one tap, and nothing you've done so far is lost either way — it's already saved on this device.</p>
    <div class="hero-actions mt-5" style="flex-wrap:wrap">
      <button type="button" class="btn sg-google">
        <span class="material-symbols-outlined" aria-hidden="true">login</span> Continue with Google</button>
      <button type="button" class="btn btn-quiet sg-email">Use an email instead</button>
    </div>
    <p style="margin:16px 0 0">
      <button type="button" class="sg-skip" style="background:none;border:0;padding:0;font:inherit;font-size:12.5px;color:var(--ink-faint);text-decoration:underline;cursor:pointer">Not now — keep working without an account</button>
    </p>
    <p class="faint sg-msg" style="font-size:12.5px;min-height:16px;margin:6px 0 0"></p>`);

  m.el.querySelector('.sg-skip').onclick = () => m.close();
  m.el.querySelector('.sg-email').onclick = () => {
    m.close();
    location.hash = accountHref(o.next || location.hash.slice(1));
  };
  m.el.querySelector('.sg-google').onclick = async () => {
    const msg = m.el.querySelector('.sg-msg');
    msg.textContent = 'Opening Google…';
    try {
      await PFCloud.signInGoogle();
      m.close();
      toast('Signed in — your work now follows you to any device');
      route();
    } catch (err) { msg.textContent = humanAuthError(err); }
  };
}

/* '#account?next=<encoded target hash>' — read back by resumeAfterAuth()
   once sign-up/sign-in succeeds. */
function accountHref(next) {
  return '#account' + (next ? '?next=' + encodeURIComponent(next) : '');
}

/* Where to land after a successful sign-up/sign-in on #account: back to
   whatever the visitor was trying to do (?next=), or the dashboard by
   default for a visitor who came to #account directly. */
function resumeAfterAuth() {
  const next = hashQuery().next;
  location.hash = next || '#dashboard';
}

/* Lightweight modal — the only one in the app. Returns { el, close } so
   callers can wire forms/buttons inside `el`. Closes on overlay click, the
   ✕ button, or Esc. Used by the payment flows (assets/js/pay.js). */
function modal(title, bodyHTML) {
  const root = document.createElement('div');
  root.className = 'modal';
  root.innerHTML = `<div class="modal-overlay"></div>
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head">
        <h2 style="font-size:1.15rem;margin:0">${esc(title)}</h2>
        <button class="modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">${bodyHTML}</div>
    </div>`;
  document.body.appendChild(root);
  document.body.style.overflow = 'hidden';
  const close = () => {
    root.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  root.querySelector('.modal-overlay').onclick = close;
  root.querySelector('.modal-close').onclick = close;
  requestAnimationFrame(() => root.classList.add('show'));
  return { el: root, close };
}

/* ── Entitlements (one-time premium plans) ───────────────────────────────
   Derived once per session from the signed-in user's paid `orders`, cached
   in a JS variable so gating reads (renderKit etc.) cost zero Firestore
   reads on navigation.

   A plan grants more than the template toolkit: mentor sessions and
   document audits are credits spent on #mentors, and Premium adds queue
   priority. What each plan gives lives in PF_CONFIG.planGrants (data.js),
   which #pricing also generates its copy from; what is left is granted
   minus spent, derived on read by the two functions below. */
let entState = { loaded: false, items: emptyEntitlements() };
function entitlements() { return entState.items; }
function cloudOn() { return !!(window.PF_FIREBASE_CONFIG && window.PF_FIREBASE_CONFIG.apiKey); }

function emptyEntitlements() {
  return { plans: [], toolkit: false, priority: false, fullAudit: false, interview: false,
           costCompare: false, officialData: false,
           sessions: 0, audits: 0, sessionsGranted: 0, auditsGranted: 0 };
}

/* Everything the student's PAID orders grant, summed. An order only reaches
   `paid` when the admin marks it so — a visitor may create one, but
   firestore.rules lets nobody but the admin flip that field — which is what
   makes this derivation a real entitlement rather than a client-side claim. */
function grantsFrom(orders) {
  const table = PF_CONFIG.planGrants || {};
  const out = { plans: [], toolkit: false, priority: false, fullAudit: false,
                interview: false, costCompare: false, officialData: false,
                sessions: 0, audits: 0 };
  (orders || []).filter(o => o.status === 'paid').forEach(o => {
    const g = table[o.item];
    if (!g) return;
    out.plans.push(o.item);
    Object.keys(g).forEach(k => {
      if (typeof g[k] === 'number') out[k] = (out[k] || 0) + g[k];
      else if (g[k]) out[k] = true;
    });
  });
  return out;
}

/* Credits already spent, derived from the student's own mentor requests —
   the same principle as the Accounting ledger and the client book: no
   `credits` document, no second query, nothing to secure, and no way for a
   balance to drift out of step with the requests it counts. A request
   raised against a credit carries `redeem:'session'|'audit'`; a cancelled
   one gives the credit back. */
function creditsUsed(requests) {
  const used = { sessions: 0, audits: 0 };
  (requests || []).forEach(r => {
    if (!r || !r.redeem || r.status === 'cancelled') return;
    if (r.redeem === 'session') used.sessions++;
    else if (r.redeem === 'audit') used.audits++;
  });
  return used;
}

function loadEntitlements(cb) {
  if (!(cloudOn() && window.PFCloud && PFCloud.hasUser && PFCloud.hasUser())) {
    entState = { loaded: true, items: emptyEntitlements() };
    if (cb) cb();
    return;
  }
  PFCloud.fetchMyOrders().then(orders => {
    const g = grantsFrom(orders);
    const used = creditsUsed(PFStore.getMentorRequests());
    entState = { loaded: true, items: {
      plans: g.plans,
      toolkit: g.toolkit, priority: g.priority,
      fullAudit: g.fullAudit, interview: g.interview, costCompare: g.costCompare,
      officialData: g.officialData,
      sessionsGranted: g.sessions, auditsGranted: g.audits,
      sessions: Math.max(0, g.sessions - used.sessions),
      audits: Math.max(0, g.audits - used.audits),
    } };
    if (cb) cb();
  }).catch(() => { entState = { loaded: true, items: emptyEntitlements() }; if (cb) cb(); });
}

/* ── Router ─────────────────────────────────────────────── */
const ROUTES = {
  assessment: renderAssessment,
  roadmap:    renderRoadmap,
  research:   renderResearch,
  courses:    renderCourses,
  explore:    renderExplore,
  funding:    renderFunding,
  funds:      renderFunds,
  cost:       renderCost,
  news:       renderNews,
  dashboard:  renderDashboard,
  kit:        renderKit,
  visa:       renderVisa,
  settlement: renderSettlement,
  mentors:    renderMentors,
  mentor:     renderMentor,
  pricing:    renderPricing,
  billing:    renderBilling,
  account:    renderAccount,
  admin:      renderAdmin,
};

/* The three login roles share two secret codes (see firebase-config.js):
   creating a mentor account needs ROLE_CODES.mentor; the admin panel asks
   for ROLE_CODES.admin before the password. Clients/students need none. */
const ROLE_CODES = () => window.PF_ROLE_CODES || { mentor: 'MNTR', admin: 'ADMN' };
const norm = s => String(s || '').trim().toUpperCase();

function route() {
  const view = (location.hash || '#dashboard').slice(1).split('?')[0];
  // The track question stands in front of every study view (see
  // needsTrackChoice). The hash is left alone, so answering it drops the
  // student straight onto the view they actually asked for.
  const gated = needsTrackChoice(view);
  const fn = gated ? renderTrackChoice : (ROUTES[view] || renderDashboard);
  if (ROUTES[view] && !gated) markSeen(view);
  $$('[data-view]').forEach(a => {
    if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  closeNavPop();
  const main = $('#view');
  main.innerHTML = '';
  fn(main);
  // The profile strip is inserted HERE rather than inside each of the five
  // renderers, because several of them return early (a completed
  // assessment, a saved funds result, the cost model still loading, the
  // cold-start dashboard) and every one of those paths needs the strip.
  // Doing it once, after render, catches them all and keeps the renderers
  // unaware of it — they still own everything below the strip.
  if (!gated && PROFILE_TABS.some(t => t.view === view)) {
    main.insertAdjacentHTML('afterbegin', profileTabs(view));
  }
  updateNavChrome();
  animateBars(main);
  main.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }],
    { duration: 350, easing: 'cubic-bezier(.22,1,.36,1)' });
  window.scrollTo(0, 0);
}

/* "#mentors?topic=visa-medical" → { topic:'visa-medical' } */
function hashQuery() {
  return Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
}

/* ── Journey engine ─────────────────────────────────────────────
   The whole product is one arc: Discover → Plan → Apply → Visa →
   Settle in. This models that arc as five phases, each with three
   concrete milestones derived from real saved data, so the student
   always sees where they are, what's next, and how far they've come
   (goal-gradient + endowed-progress + Zeigarnik). One source of truth
   feeds the dashboard Journey Map, the sidebar meter, and every
   next-best-action nudge. */

/* record that a view has been opened (once, ever) — powers the
   "explored" milestones without per-visit writes (stays frugal). */
function markSeen(view) {
  if (!view) return;
  const seen = PFStore.get('journey.seen', {}) || {};
  if (!seen[view]) { seen[view] = Date.now(); PFStore.set('journey.seen', seen); }
}

function journeyModel() {
  const a = PFStore.getAssessment();
  const saved = PFStore.getSaved();
  const apps = PFStore.getApps();
  const reqs = PFStore.getMentorRequests();
  const vp = visaProgress();
  const research = (PFStore.getResearch && PFStore.getResearch()) || null;
  const plans = (PFStore.getFundsPlans && PFStore.getFundsPlans()) || [];
  const fm = (PFStore.getFirstMonthsProgress && PFStore.getFirstMonthsProgress()) || null;
  const fundsCheck = PFStore.get('fundsCheck', null);
  const seen = PFStore.get('journey.seen', {}) || {};
  const ST = PFStore.APP_STATUSES;
  const furthest = apps.reduce((m, x) => Math.max(m, ST.indexOf(x.status) + 1), 0);
  const halfVisa = vp.total ? Math.ceil(vp.total / 2) : 1;

  const phases = [
    { id: 'discover', label: 'Discover', icon: 'travel_explore', view: 'assessment', color: 'teal',
      blurb: isMasters() ? 'Find your fit — pathway, subject, providers and funding.'
                         : 'Find your fit — pathway, fields, labs and funding.',
      steps: isMasters() ? [
        ['Take the 5-minute assessment', !!a, '#assessment'],
        ['Shortlist 3 qualifications', saved.length >= 3, '#courses'],
        ['Compare the providers offering them', !!seen.explore, '#explore'],
      ] : [
        ['Take the 5-minute assessment', !!a, '#assessment'],
        ['Save 3 labs or scholarships', saved.length >= 3, '#explore'],
        ['Generate a research direction', !!(research && research.candidates && research.candidates.length), '#research'],
      ] },
    { id: 'plan', label: 'Plan', icon: 'route', view: 'roadmap', color: 'violet',
      blurb: 'Turn your result into a month-by-month roadmap.',
      steps: [
        ['Open your personalized roadmap', !!seen.roadmap && !!a, '#roadmap'],
        ['Grab a starter-kit template', !!seen.kit, '#kit'],
        ['Check eligible scholarships', !!seen.funding, '#funding'],
      ] },
    { id: 'apply', label: 'Apply', icon: 'folder_managed', view: 'dashboard', color: 'gold',
      blurb: isMasters() ? 'Apply to your intakes and track every application.'
                         : 'Contact supervisors and track every application.',
      steps: [
        ['Track your first application', apps.length >= 1, '#dashboard'],
        ['Reach “Applied” on one', furthest >= ST.indexOf('Applied') + 1, '#dashboard'],
        ['Get a mentor’s eyes on your plan', reqs.length >= 1, '#mentors'],
      ] },
    { id: 'visa', label: 'Visa', icon: 'flight_takeoff', view: 'visa', color: 'rose',
      blurb: 'Walk the 7-stage NZ student-visa process.',
      steps: [
        ['Start the visa checklist', vp.done >= 1, '#visa'],
        ['Cross the halfway mark', !!vp.total && vp.done >= halfVisa, '#visa'],
        ['Finish the visa checklist', !!vp.total && vp.done >= vp.total, '#visa'],
      ] },
    { id: 'settle', label: 'Settle in', icon: 'luggage', view: 'settlement', color: 'teal',
      blurb: 'Check your visa funds, plan the first months and the move.',
      steps: [
        ['Check your visa-funds readiness', !!(fundsCheck && fundsCheck.result), '#funds'],
        ['Map your first 90 days', !!fm, '#settlement'],
        ['Read the settling-in guides', !!seen.settlement || plans.length >= 1, '#settlement'],
      ] },
  ];

  phases.forEach(p => {
    p.done = p.steps.filter(s => s[1]).length;
    p.total = p.steps.length;
    p.pct = Math.round((p.done / p.total) * 100);
    p.complete = p.done === p.total;
    p.started = p.done > 0;
    p.nextStep = p.steps.find(s => !s[1]) || null;
  });

  const totalSteps = phases.reduce((s, p) => s + p.total, 0);
  const doneSteps = phases.reduce((s, p) => s + p.done, 0);
  const overall = Math.round((doneSteps / totalSteps) * 100);
  const current = phases.find(p => !p.complete) || phases[phases.length - 1];
  const nextStep = current.nextStep;
  return { phases, overall, doneSteps, totalSteps, current, nextStep };
}

function journeyBlurb(J) {
  if (J.overall === 0) return 'Five stages from your first question to enrolment in New Zealand. It starts with a 5-minute assessment.';
  if (J.overall >= 100) return 'Every milestone done — you’re ready. Keep a mentor close for the final stretch.';
  const left = 100 - J.overall;
  return `You’re in <strong>${J.current.label}</strong>. ${J.current.blurb}${left <= 35 ? ' Almost there.' : ''}`;
}

/* ── The hero ──────────────────────────────────────────────────────
   Every view opens with the same inverted panel: kicker, title, one
   sentence, ≤2 buttons, an optional right-slot figure, and — on the
   dashboard — the five journey segments. renderHero() is pure markup;
   what goes in it is computed by the caller (highestPriorityIncomplete-
   Step() for the dashboard, per-view logic elsewhere). Replaces
   viewHead() as views migrate. */
function renderHero(opts) {
  const o = opts || {};
  // Most hero actions navigate (href); a few (Mentor Dashboard's "Someone
  // called", pause/resume) are JS actions instead — given an id with no
  // href, render a <button id="..."> for the caller to wire up rather than
  // forcing every action through the router.
  const primary = o.primaryHref || o.primaryId
    ? (o.primaryHref
        ? `<a class="btn" href="${o.primaryHref}">`
        : `<button type="button" class="btn" id="${o.primaryId}">`) +
      `${esc(o.primaryLabel || 'Continue')}${o.primaryIcon ? `<span class="material-symbols-outlined" aria-hidden="true">${o.primaryIcon}</span>` : ''}` +
      (o.primaryHref ? '</a>' : '</button>')
    : '';
  const secondary = o.secondaryHref || o.secondaryId
    ? (o.secondaryHref
        ? `<a class="btn btn-ghost" href="${o.secondaryHref}">`
        : `<button type="button" class="btn btn-ghost" id="${o.secondaryId}">`) +
      esc(o.secondaryLabel || 'Ask a mentor') +
      (o.secondaryHref ? '</a>' : '</button>')
    : '';
  const figureInner = o.figure != null
    ? `<div class="hero-figure">${esc(String(o.figure))}${o.figureSuffix ? `<span class="suf">${esc(o.figureSuffix)}</span>` : ''}</div>
       ${o.figureCaption ? `<div class="hero-caption">${esc(o.figureCaption)}</div>` : ''}`
    : '';
  // rendered twice, on purpose: side-by-side with the title on desktop
  // (.hero-right), between the body and the buttons on mobile
  // (.hero-figure-mobile) — the two breakpoints put it in a different
  // reading position, not just a different size, so one flex `order`
  // can't cover both; each copy is display:none at the other's breakpoint.
  const figureDesktop = o.figure != null ? `<div class="hero-right">${figureInner}</div>` : '';
  const figureMobile = o.figure != null ? `<div class="hero-figure-mobile">${figureInner}</div>` : '';
  return `<section class="hero">
    <div class="hero-row">
      <div class="hero-left">
        <div class="hero-kicker">${esc(o.kicker || '')}</div>
        <h1 class="hero-title">${esc(o.title || '')}</h1>
        <p class="hero-body">${esc(o.body || '')}</p>
        ${figureMobile}
        <div class="hero-actions">${primary}${secondary}</div>
      </div>
      ${figureDesktop}
    </div>
    ${o.segments ? heroSegsHtml(o.segments) : ''}
  </section>`;
}

/* Short segment labels for the hero's journey strip — deliberately
   different (shorter) than journeyModel()'s own phase labels, which
   stay unchanged for the nav context text and journeyBlurb(). PhD
   labels are buildPhdRoadmap()'s own phase titles verbatim. */
const HERO_SEG_LABELS = {
  masters: ['Choose', 'Credentials', 'Apply & fund', 'Offer & visa', 'Arrive'],
  phd: ['Foundation', 'Supervisor Discovery', 'Proposal & Application', 'Offer & Visa', 'Arrival & Enrollment'],
};
function heroSegLabels() { return HERO_SEG_LABELS[PFStore.getTrack()] || HERO_SEG_LABELS.phd; }

/* J.phases (journeyModel) already carries real pct/done/complete/nextStep
   per phase — heroSegments() re-labels those five phases with the shorter
   copy above (in the same order, so the strip and the "Phase N of 5"
   kicker always agree with the nav context label) and carries each
   phase's own real next-incomplete-step through, so the strip can show
   what's next in every phase, not just the current one. */
function heroSegments(J) {
  const labels = heroSegLabels();
  return J.phases.map((p, i) => ({
    label: labels[i] || p.label,
    pct: p.pct, done: p.done, total: p.total,
    current: p.id === J.current.id && !p.complete,
    complete: p.complete,
    href: p.nextStep ? p.nextStep[2] : '#' + p.view,
    next: p.nextStep ? p.nextStep[0] : null,
  }));
}
/* Each segment is a real link (to that phase's own next incomplete step,
   or its home view once the phase is done) carrying a done/total count
   and a numbered/checked badge — so "what's next in every step" and
   "completion so far" are both visible without turning the hero into a
   wall of text. The fuller sentence (the phase's actual next action)
   rides in the title attribute — a hover/long-press away, never printed
   outright — so the strip stays five short labels wide. */
function heroSegsHtml(segs) {
  return `<div class="segs">${segs.map((s, i) => {
    const hint = s.complete ? `${s.label} — done` : s.next ? `${s.label}: ${s.next}` : s.label;
    const badge = s.complete
      ? '<span class="material-symbols-outlined" aria-hidden="true">check</span>'
      : String(i + 1);
    return `<a class="seg${s.pct <= 0 ? ' is-empty' : ''}${s.current ? ' is-current' : ''}${s.complete ? ' is-complete' : ''}"
        href="${s.href}" title="${esc(hint)}" ${s.current ? 'aria-current="step"' : ''}>
      <span class="seg-top">
        <span class="seg-num">${badge}</span>
        <span class="seg-track"><span data-pct="${s.pct > 0 ? s.pct : 100}"></span></span>
      </span>
      <span class="seg-meta">
        <span class="seg-label">${esc(s.label)}</span>
        <span class="seg-frac">${s.done}/${s.total}</span>
      </span>
    </a>`;
  }).join('')}</div>`;
}

/* a .bar on canvas — pct is clamped and set via data-pct so the fill can
   animate on first paint (see animateBars) instead of the width arriving
   inline in the markup */
function barHtml(pct, extraAttrs) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  return `<div class="bar"><span data-pct="${p}"${extraAttrs || ''}></span></div>`;
}

/* Progress fills animate width on first paint of a view, once — never on
   re-renders mid-view. Rendering at width:0 and setting the real width a
   frame later lets the CSS transition (var(--t-bar)) do the animating;
   prefers-reduced-motion is already handled globally (site.css collapses
   all transition-duration to ~0). Called once per route() after the view
   has painted. */
function animateBars(root) {
  requestAnimationFrame(() => {
    $$('[data-pct]', root).forEach(el => { el.style.width = el.dataset.pct + '%'; });
  });
}

function truncate(s, n) {
  s = String(s || '').trim();
  return s.length > n ? s.slice(0, n - 1).trim() + '…' : s;
}

/* friendly names for the hero's secondary "Open X" phrasing — not a
   fabricated fact, just a nicer label for a real, already-computed href */
const HERO_HREF_LABEL = {
  '#assessment': 'the assessment', '#courses': 'Courses', '#explore': 'Explore',
  '#research': 'Research Studio', '#roadmap': 'your roadmap', '#kit': 'Templates',
  '#funding': 'Funding', '#dashboard': 'your dashboard', '#visa': 'the Visa Hub',
  '#mentors': 'Mentors', '#funds': 'the Funds Check', '#settlement': 'Settle In',
};

/* ── The next best action — computed, never hardcoded ────────────────
   Ranking (hard deadline soonest → blocks another step → cheapest to
   finish): the visa checklist is the one place in the data model with a
   genuinely ordered, blocking sequence (each stage gates the next), so an
   open visa stage outranks the generic next milestone once the student has
   reached that phase. Applications carry no deadline field and
   PF_SCHOLARSHIPS.deadline is prose ("1 Mar / 1 Jul / 1 Nov", "Rolling"),
   not a date — so neither is a sortable "hard deadline" candidate; adding
   one would mean inventing a date. Everything else falls through to
   journeyModel()'s own next incomplete milestone, the same engine behind
   the nav context label. Title ≤42 chars, body ≤120 chars, body never
   restates the title. */
function highestPriorityIncompleteStep() {
  const a = PFStore.getAssessment();
  const J = journeyModel();

  if (!a) {
    return { kicker: 'Get started', title: 'Take the 5-minute assessment',
      body: 'Seven quick questions build your whole plan — pathway, courses and funding.',
      primaryLabel: 'Start the assessment', primaryHref: '#assessment', consultTopic: '' };
  }
  if (J.overall >= 100) {
    return { kicker: 'Journey complete', title: 'You’re ready to fly',
      body: 'Every milestone is done — Settle In has your first-weeks checklist.',
      primaryLabel: 'Open Settle In', primaryHref: '#settlement', consultTopic: 'settle-arrival' };
  }

  // The kicker always names journeyModel()'s own current phase — the same
  // one the segment strip highlights — even when the action below jumps
  // ahead to an urgent visa step; otherwise a student who's front-loaded
  // their visa paperwork would see "Phase 4 of 5" in the hero while the
  // strip highlights phase 1, an internal contradiction rather than a
  // deliberate "next best action" call.
  const cur = J.current;
  const idx = J.phases.findIndex(p => p.id === cur.id);
  const kicker = `Phase ${idx + 1} of ${J.phases.length} · ${heroSegLabels()[idx]}`;

  const visaOpen = PF_VISA_STAGES.find(s => s.steps.some(st => !PFStore.isChecked('visa', st.id)));
  if (visaOpen && (J.current.id === 'visa' || visaProgress().done > 0)) {
    const step = visaOpen.steps.find(st => !PFStore.isChecked('visa', st.id));
    return {
      kicker,
      title: truncate(step.t, 42),
      body: truncate(step.note || visaOpen.summary, 120),
      primaryLabel: 'Open the Visa Hub', primaryHref: '#visa', consultTopic: visaOpen.consult,
    };
  }

  if (J.nextStep) {
    return {
      kicker,
      title: truncate(J.nextStep[0], 42),
      body: truncate(cur.blurb, 120),
      primaryLabel: `Open ${HERO_HREF_LABEL[J.nextStep[2]] || 'this step'}`, primaryHref: J.nextStep[2], consultTopic: '',
    };
  }

  return { kicker: 'Almost there', title: 'Ask a mentor to pressure-test your plan',
    body: 'Nothing outstanding here — a second pair of eyes catches what a checklist can’t.',
    primaryLabel: 'Ask a mentor', primaryHref: '#mentors', consultTopic: '' };
}

/* keep the top-nav context label + avatar in sync after every route.
   Replaces the old sidebar journey meter, which the hero + segments
   (renderHero) now supersede as the always-visible progress signal. */
function updateNavChrome() {
  const ctx = document.getElementById('nav-context');
  if (ctx) {
    const R = currentResult();
    ctx.textContent = trackCfg().label + (R && R.field ? ' · ' + R.field : '');
  }
  const av = document.getElementById('nav-avatar');
  if (av) {
    const signedIn = !!(window.PFCloud && PFCloud.isSignedIn && PFCloud.isSignedIn());
    const email = signedIn && PFCloud.currentEmail && PFCloud.currentEmail();
    av.textContent = email ? email.slice(0, 2).toUpperCase() : '·';
  }
}

/* ── Overflow popover (top-nav "more" menu) ──────────────────────────
   A .listcard-styled panel anchored under the avatar, holding the
   fourteen views that don't fit the six-item top nav, plus the track
   switch and account controls that used to live in the sidebar. Traps
   Tab, closes on Escape / outside click / picking a link. */
function closeNavPop() {
  const pop = document.getElementById('nav-pop');
  const btn = document.getElementById('nav-more-btn');
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  if (btn) btn.setAttribute('aria-expanded', 'false');
  document.removeEventListener('keydown', navPopKey);
  document.removeEventListener('click', navPopOutside, true);
}
function openNavPop() {
  const pop = document.getElementById('nav-pop');
  const btn = document.getElementById('nav-more-btn');
  if (!pop || !btn) return;
  pop.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  document.addEventListener('keydown', navPopKey);
  document.addEventListener('click', navPopOutside, true);
  const first = pop.querySelector('a, button, input');
  if (first) first.focus();
}
function navPopKey(e) {
  const pop = document.getElementById('nav-pop');
  if (!pop) return;
  if (e.key === 'Escape') { closeNavPop(); document.getElementById('nav-more-btn')?.focus(); return; }
  if (e.key !== 'Tab') return;
  const items = $$('a, button, input', pop).filter(el => !el.disabled && el.offsetParent !== null);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
function navPopOutside(e) {
  const pop = document.getElementById('nav-pop');
  const btn = document.getElementById('nav-more-btn');
  if (!pop || pop.contains(e.target) || e.target === btn || (btn && btn.contains(e.target))) return;
  closeNavPop();
}
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('nav-more-btn');
  const pop = document.getElementById('nav-pop');
  if (!btn || !pop) return;
  btn.addEventListener('click', () => (pop.hidden ? openNavPop() : closeNavPop()));
});

/* ── Briefing: live immigration + PhD/postgrad news ─────────────────
   Fetches ONLY on-topic news from free, no-key Google News RSS search
   feeds (PF_NEWS in data.js) through a CORS proxy — the same
   "external servers, never Firestore" model as the Research Studio, so
   it adds zero backend and zero Firestore cost. Results are filtered to
   relevant + recent, deduped, sorted newest-first, and cached locally
   under a `__`-prefixed key the sync layer skips (no write quota used). */
let newsState = { loading: false, items: null, fetchedAt: 0, error: null };
let newsFilter = 'all';

function newsCacheRead() {
  if (newsState.items) return;
  const c = PFStore.get('__newsCache', null);
  if (c && Array.isArray(c.items)) { newsState.items = c.items; newsState.fetchedAt = c.fetchedAt || 0; }
}
function newsStale() {
  const ms = (PF_NEWS.refreshHours || 3) * 3600e3;
  return !newsState.fetchedAt || (Date.now() - newsState.fetchedAt) > ms;
}

/* try each free proxy in turn until one returns RSS XML */
async function newsProxyFetch(url) {
  for (const p of (PF_NEWS.proxies || [])) {
    try {
      const r = await fetch(p + encodeURIComponent(url));
      if (!r.ok) continue;
      const t = await r.text();
      if (t && t.indexOf('<') !== -1) return t;
    } catch {}
  }
  return null;
}

function newsRelevant(title, summary) {
  const hay = (title + ' ' + summary).toLowerCase();
  if ((PF_NEWS.blocklist || []).some(b => hay.includes(b))) return false;
  return (PF_NEWS.keywords || []).some(k => hay.includes(k));
}

function parseNewsXML(xml, feed) {
  const out = [];
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    [...doc.querySelectorAll('item')].slice(0, PF_NEWS.perFeed || 12).forEach(it => {
      const rawTitle = stripTags(it.querySelector('title')?.textContent || '');
      const link = (it.querySelector('link')?.textContent || '').trim();
      const desc = stripTags(it.querySelector('description')?.textContent || '');
      const pub = it.querySelector('pubDate')?.textContent || '';
      let src = (it.getElementsByTagName('source')[0]?.textContent || '').trim();
      const ts = pub ? Date.parse(pub) : 0;
      if (!rawTitle || !link) return;
      // Google News appends " - Publisher" to titles — split it back out.
      let title = rawTitle;
      const dash = rawTitle.lastIndexOf(' - ');
      if (dash > 0 && rawTitle.length - dash < 40) { if (!src) src = rawTitle.slice(dash + 3); title = rawTitle.slice(0, dash); }
      if (!newsRelevant(title, desc)) return;
      out.push({ title: title.trim(), link, source: src || 'News', summary: desc, ts, tag: feed.tag, accent: feed.accent });
    });
  } catch {}
  return out;
}

async function fetchNews() {
  const maxAge = (PF_NEWS.maxAgeDays || 90) * 86400e3;
  const now = Date.now();
  const all = [];
  await Promise.all((PF_NEWS.feeds || []).map(async f => {
    const xml = await newsProxyFetch(PF_NEWS.googleBase + encodeURIComponent(f.q));
    if (xml) all.push(...parseNewsXML(xml, f));
  }));
  let items = all.filter(x => !x.ts || (now - x.ts) <= maxAge); // recency (keep undated)
  const seen = new Set();                                        // dedupe by title
  items = items.filter(x => {
    const k = x.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
    if (seen.has(k)) return false; seen.add(k); return true;
  });
  items.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return items.slice(0, 40);
}

function loadNews(cb, force) {
  newsCacheRead();
  if (!force && newsState.items && newsState.items.length && !newsStale()) { cb && cb(); return; }
  if (newsState.loading) { cb && cb(); return; }
  newsState.loading = true; newsState.error = null;
  if (cb) cb(); // let callers paint a loading state immediately
  fetchNews().then(items => {
    newsState.loading = false;
    if (items && items.length) {
      newsState.items = items; newsState.fetchedAt = Date.now();
      PFStore.set('__newsCache', { items, fetchedAt: newsState.fetchedAt }); // local-only (__ skips sync)
    } else if (!newsState.items || !newsState.items.length) {
      newsState.error = 'empty';
    }
    cb && cb();
  }).catch(() => { newsState.loading = false; newsState.error = 'fail'; cb && cb(); });
}

function relTime(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 3600) return Math.max(1, Math.floor(s / 60)) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  const d = Math.floor(s / 86400);
  return d < 30 ? d + 'd ago' : new Date(ts).toLocaleDateString();
}

/* one headline + a mono date — no excerpt, per the Briefing spec */
function newsItemRow(x) {
  return `<a class="row" href="${esc(x.link)}" target="_blank" rel="noopener">
    <div class="row-main">
      <div class="row-title">${esc(x.title)}</div>
      <div class="row-sub">${esc(x.source)}${x.ts ? ' · ' + relTime(x.ts) : ''}</div>
    </div>
    <span class="chip chip-neutral">${esc(x.tag)}</span>
  </a>`;
}

function renderNews(main) {
  main.innerHTML = renderHero({
    kicker: 'Briefing', title: 'Immigration & PhD news, live',
    body: 'Visa/immigration changes and postgraduate news, pulled fresh and refreshed continuously.',
  }) + `<div id="news-body"></div>`;
  const body = $('#news-body', main);

  const paint = () => {
    const items = newsState.items || [];
    const tags = ['all', ...new Set((PF_NEWS.feeds || []).map(f => f.tag))];
    const chips = tags.map(t => `<button type="button" class="tab news-fil" role="tab" aria-selected="${newsFilter === t}" data-fil="${esc(t)}">${t === 'all' ? 'All' : esc(t)}</button>`).join('');
    const shown = items.filter(x => newsFilter === 'all' || x.tag === newsFilter);
    const updated = newsState.fetchedAt ? `Updated ${relTime(newsState.fetchedAt)}` : '';

    let listHtml;
    if (newsState.loading && !items.length) listHtml = '<p>Fetching the latest immigration & PhD news…</p>';
    else if (!items.length) listHtml = '<p>Couldn’t reach the news sources right now — <button type="button" class="btn-quiet news-refresh">Try again</button></p>';
    else listHtml = shown.length ? shown.map(x => newsItemRow(x)).join('')
      : '<p>Nothing in this category right now — try "All".</p>';

    body.innerHTML = `<div class="tab-row" role="tablist" aria-label="News category">${chips}
        <div class="tab-row-end">
          <span class="row-sub">${updated}${newsState.loading ? ' · refreshing…' : ''}</span>
          <button type="button" class="icon-btn news-refresh" title="Refresh"><span class="material-symbols-outlined" aria-hidden="true">refresh</span></button>
        </div>
      </div>
      <div class="listcard">
        <div class="listcard-head"><h2 class="listcard-title">Latest</h2></div>
        ${listHtml}
      </div>
      <p class="row-sub mt-5">Headlines are aggregated live from public news sources via Google News — PathFinder doesn’t write or endorse them. Always confirm visa rules with Immigration New Zealand.</p>`;
  };

  paint();
  loadNews(paint, false);

  body.addEventListener('click', e => {
    const fil = e.target.closest('.news-fil');
    if (fil) { newsFilter = fil.dataset.fil; paint(); return; }
    if (e.target.closest('.news-refresh')) { newsState.fetchedAt = 0; loadNews(paint, true); }
  });
}

/* contextual mentor hook — quiet, helpful, pre-fills the topic. Now an
   inline expand-in-place mini-form so asking a mentor never requires
   leaving the current view: submitting creates a `mentor_requests` doc
   directly via PFStore.addMentorRequest (see the delegated handler below). */
function consultCTA(topic) {
  const t = topic || '';
  return `<div class="consult-hook">
    <span class="material-symbols-outlined" style="font-size:15px">support_agent</span>
    <button type="button" class="consult-hook-toggle">Stuck at this step? Ask a mentor →</button>
    <form class="consult-hook-form hidden" data-topic="${t}">
      <input class="field ch-name" placeholder="Your name" autocomplete="name">
      <input class="field ch-contact" placeholder="Email or WhatsApp — how a mentor reaches you">
      <textarea class="field ch-note" rows="2" placeholder="One line about where you're stuck (optional)"></textarea>
      <button type="submit" class="btn btn-primary btn-sm">Send request</button>
    </form>
  </div>`;
}

/* status chip for a mentor_requests doc — reuses site.css chip tokens */
function reqStatusChip(status) {
  const cls = { open:'chip-warn', claimed:'chip-info', intro_done:'chip-info',
    awaiting_payment:'chip-warn', paid:'chip-ok', completed:'chip-ok', cancelled:'chip-neutral' };
  const lbl = { open:'Open', claimed:'Claimed', intro_done:'Intro done',
    awaiting_payment:'Awaiting payment', paid:'Paid', completed:'Completed', cancelled:'Cancelled' };
  return `<span class="chip ${cls[status] || 'chip-neutral'}">${lbl[status] || status}</span>`;
}

/* payment-status chip — works whether paymentStatus was set manually
   (Tier 1) or by the PayHere webhook (Tier 2): both write the same field */
function payStatusChip(payment) {
  const ps = (payment && payment.paymentStatus) || 'none';
  const cls = { none:'chip-neutral', requested:'chip-warn', reported:'chip-info', pending:'chip-warn', paid:'chip-ok' };
  const lbl = { none:'No payment', requested:'Payment requested', reported:'Payment reported', pending:'Awaiting payment', paid:'Paid' };
  const amt = ps !== 'none' && payment && payment.amountLKR
    ? ` · LKR ${Number(payment.amountLKR).toLocaleString()}` : '';
  return `<span class="chip ${cls[ps] || 'chip-neutral'}">${lbl[ps] || ps}${amt}</span>`;
}

/* inline "Ask a mentor" hook — expand + submit, no navigation. Gated
   visitors are sent to sign up with their topic carried along, so signing
   up lands them back on a pre-filled "Ask a mentor" request instead of the
   dashboard, with no memory of what they were stuck on. */
document.addEventListener('click', e => {
  const tgl = e.target.closest('.consult-hook-toggle');
  if (!tgl) return;
  const topic = tgl.parentElement.querySelector('.consult-hook-form').dataset.topic;
  if (!requireAccount('Create a free account to connect with a mentor.',
    { next: 'mentors' + (topic ? '?topic=' + topic : '') })) return;
  const form = tgl.parentElement.querySelector('.consult-hook-form');
  form.classList.toggle('hidden');
  if (!form.classList.contains('hidden')) form.querySelector('.ch-name').focus();
});
document.addEventListener('submit', e => {
  const form = e.target.closest('.consult-hook-form');
  if (!form) return;
  e.preventDefault();
  const topic = form.dataset.topic;
  if (!requireAccount('Create a free account to connect with a mentor.',
    { next: 'mentors' + (topic ? '?topic=' + topic : '') })) return;
  const name = form.querySelector('.ch-name').value.trim();
  const contact = form.querySelector('.ch-contact').value.trim();
  const note = form.querySelector('.ch-note').value.trim();
  if (!name || !contact) return toast('Add your name and a way to reach you');
  PFStore.addMentorRequest({ topic: form.dataset.topic || '', note, name, contact });
  form.reset();
  form.classList.add('hidden');
  toast('Request sent — a mentor will pick this up. Track it in Mentors → My requests.');
});

/* clearly-labelled affiliate placement */
function partnerRow(placement) {
  const p = PF_PARTNERS.find(x => x.placement === placement);
  if (!p) return '';
  return `<div class="partner-row">
    <span class="chip chip-gold">Partner</span>
    <p><strong>${p.name}</strong> — ${p.blurb}</p>
    <a class="btn btn-quiet btn-sm" href="${p.url}" target="_blank" rel="noopener sponsored">${p.cta}</a>
  </div>`;
}
window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', () => {
  adoptTrackFromQuery();   // must run before the first render
  paintTrackSwitch();
  route();
});

/* re-render the admin view whenever admin auth state flips (e.g. sign
   out) — PFCloud is exposed by the deferred firebase.js module, so wait
   for it before subscribing. No-op when Firebase isn't configured. */
(function hookAdminAuth(tries = 0) {
  if (window.PFCloud) {
    window.PFCloud.onAdminState(() => {
      const v = (location.hash || '').slice(1).split('?')[0];
      if (v === 'admin' || v === 'account') route();
    });
  } else if (tries < 40 && (window.PF_FIREBASE_CONFIG && window.PF_FIREBASE_CONFIG.apiKey)) {
    setTimeout(() => hookAdminAuth(tries + 1), 100);
  }
})();

function viewHead(icon, kicker, title, sub) {
  return `<div class="vhead">
    <span class="tag"><span class="material-symbols-outlined" style="font-size:14px">${icon}</span>${kicker}</span>
    <h1 class="display" style="font-size:clamp(1.8rem,3.6vw,2.6rem);margin:14px 0 8px">${title}</h1>
    <p class="muted" style="max-width:560px">${sub}</p>
  </div>`;
}

/* `label`/`sub` are optional but matter for catalogue items: a saved course
   or scholarship lives in a lazily-loaded shard, and the dashboard must be
   able to name it without pulling the whole catalogue down. Curated kinds
   (uni, lab) omit them and are resolved from the static dataset as before. */
function saveBtn(kind, id, label, sub) {
  const saved = PFStore.isSaved(kind, id);
  // .btn-quiet, not .btn-ghost: this renders on light .card/.listcard
  // surfaces everywhere it's used, and .btn-ghost is built for dark
  // chrome/hero panels — on a light card its border/text tokens
  // (--chrome-line/--on-chrome) are nearly invisible.
  return `<button class="btn btn-quiet btn-sm save-btn ${saved ? 'saved' : ''}" data-kind="${kind}" data-id="${esc(id)}"
    ${label ? `data-label="${esc(label)}"` : ''} ${sub ? `data-sub="${esc(sub)}"` : ''}>
    <span class="material-symbols-outlined" aria-hidden="true">${saved ? 'bookmark_added' : 'bookmark_add'}</span>
    ${saved ? 'Saved' : 'Save'}
  </button>`;
}

document.addEventListener('click', e => {
  const b = e.target.closest('.save-btn');
  if (!b) return;
  const nowSaved = PFStore.toggleSaved(b.dataset.kind, b.dataset.id, b.dataset.label, b.dataset.sub);
  b.classList.toggle('saved', nowSaved);
  b.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${nowSaved ? 'bookmark_added' : 'bookmark_add'}</span> ${nowSaved ? 'Saved' : 'Save'}`;
  toast(nowSaved ? 'Saved to your dashboard' : 'Removed from dashboard');
  // A shortlist is the first thing a student builds that is genuinely
  // theirs — and the first thing they'd lose moving from a phone to a
  // borrowed laptop. Offer once, at the third save, when it's a shortlist
  // rather than a stray tap.
  if (nowSaved && PFStore.getSaved().length >= 3) softAccountPrompt({
    key: 'saved',
    title: 'Keep your shortlist',
    body: `You've saved ${PFStore.getSaved().length} things worth coming back to. An account keeps them when you switch to a laptop, or lose this phone.`,
  });
});

/* ── 1 · Assessment ─────────────────────────────────────── */
let asmState = { step: 0, answers: {} };

/* The question set for the active track. The master's field question is
   rebuilt from the live catalogue when it has loaded, so a subject area the
   sync adds or empties is reflected without editing data.js; PF_SUBJECT_ROOTS
   is the synchronous fallback. */
function asmQuestions() {
  if (!isMasters()) return PF_QUESTIONS;
  const cat = window.PF_CATALOGUE;
  if (!cat) return PF_QUESTIONS_MASTERS;
  return PF_QUESTIONS_MASTERS.map(q => q.id !== 'field' ? q : Object.assign({}, q, {
    opts: cat.roots.map(r => ({ v: r, t: cat.taxonomy[r].n })),
  }));
}

/* ── The track gate ──────────────────────────────────────────────────
   `PFStore.getTrack()` degrades an unset track to PhD, which is the right
   thing to do with a stored value we can't parse — and the wrong thing to
   apply to a student who was never asked. A master's applicant shown the
   PhD track sees domestic fees, a doctoral stipend and unlimited work
   rights, and `computeFunds()` understates the money INZ wants to see by
   tens of thousands of dollars a year. That is the most expensive fact in
   the product to guess at.

   So the choice is asked once, before the FIRST view of any kind — not
   only before the assessment. index.html links directly into #dashboard,
   #courses, #funding, #visa, #kit and eleven subject tiles; every one of
   those entry points used to skip the question and silently pick PhD.

   Exempt: the role/system views, where a study track is meaningless (a
   mentor signing in should never be asked which degree they're applying
   for), and any session that already IS a mentor or an admin. */
/* ── The profile strip ──────────────────────────────────────────────────
   The dashboard is the student's own page — what they've saved, applied
   for, checked and been told. But three of the five things that belong on
   that page were behind the three-dot overflow menu (Assessment, Cost &
   payback, Briefing), and a fourth — the visa Funds Check, an entire
   feature with a score and a saved result — had NO nav entry anywhere.
   It was reachable only if a contextual nudge happened to catch you.

   So these five now share one strip, rendered above the hero on each, and
   `#dashboard` is simply its first tab. They keep their own routes: some
   forty inline CTAs across the visa hub, the funding page and the
   sidecards point at `#funds`, `#assessment` and `#cost`, and every one
   of them still works — the strip is navigation drawn on top, not a new
   place for these screens to live.

   Each tab carries its own state (a readiness %, a funds band, a payback
   verdict) because that is the difference between a menu and a profile:
   a menu tells you where you can go, a profile tells you where you are.
   A tab with nothing to show yet says so, which is also the honest nudge
   to go and do it. */
const PROFILE_TABS = [
  { view: 'dashboard',  href: '#dashboard',  label: 'Overview',   icon: 'space_dashboard' },
  { view: 'assessment', href: '#assessment', label: 'Assessment', icon: 'quiz' },
  { view: 'funds',      href: '#funds',      label: 'Funds check', icon: 'account_balance_wallet' },
  { view: 'cost',       href: '#cost',       label: 'Cost & payback', icon: 'savings' },
  { view: 'news',       href: '#news',       label: 'Briefing',   icon: 'newspaper' },
];

/* One short status per tab, or '' when there is nothing to report yet.
   Kept cheap on purpose — this renders on five views, so it reads only
   local storage and never touches the network or Firestore. */
function profileTabState(view) {
  try {
    if (view === 'dashboard') {
      const n = PFStore.getApps().length;
      return n ? `${n} application${n === 1 ? '' : 's'}` : '';
    }
    if (view === 'assessment') {
      const r = currentResult();
      return r ? `${r.readiness}% ready` : 'Not taken';
    }
    if (view === 'funds') {
      const fc = PFStore.get('fundsCheck', null);
      return fc && fc.result ? `${fc.result.score}% ready` : 'Not checked';
    }
    if (view === 'cost') {
      if (!isMasters()) return '';           // the PhD track gets a different screen
      const plan = PFStore.get('roiPlan', null);
      return plan ? 'Your plan' : 'Not costed';
    }
    if (view === 'news') return '';
  } catch (_) { /* never let a status line break navigation */ }
  return '';
}

function profileTabs(active) {
  return `<nav class="ptabs" aria-label="Your profile">
    ${PROFILE_TABS.map(t => {
      const on = t.view === active;
      const state = profileTabState(t.view);
      return `<a class="ptab ${on ? 'is-on' : ''}" href="${t.href}"${on ? ' aria-current="page"' : ''}>
        <span class="material-symbols-outlined" aria-hidden="true">${t.icon}</span>
        <span class="ptab-text">
          <span class="ptab-label">${esc(t.label)}</span>
          ${state ? `<span class="ptab-state">${esc(state)}</span>` : ''}
        </span>
      </a>`;
    }).join('')}
  </nav>`;
}

const TRACK_FREE_VIEWS = ['account', 'admin', 'mentor', 'billing', 'pricing'];

function needsTrackChoice(view) {
  if (PFStore.get('track', null) !== null || asmState.trackConfirmed) return false;
  if (view && TRACK_FREE_VIEWS.includes(view)) return false;
  const role = (window.PFCloud && PFCloud.role && PFCloud.role()) || 'anon';
  return role !== 'admin' && role !== 'mentor' && role !== 'mentor_pending';
}

function renderTrackChoice(main) {
  const feeLine = t => t.feeMode === 'domestic'
    ? `~NZ$${t.feeLo.toLocaleString()}–${t.feeHi.toLocaleString()}/yr, domestic rate`
    : `~NZ$${t.feeLo.toLocaleString()}–${t.feeHi.toLocaleString()}/yr, international rate`;
  const card = t => `<div class="listcard">
    <div class="listcard-head"><h2 class="listcard-title">${esc(t.label)}</h2></div>
    <p>Entry from ${esc(t.entryFrom)}.</p>
    <div class="mt-4">
      <div class="row-sub">Duration — ${esc(t.durationLabel)}</div>
      <div class="row-sub mt-3">Fees — ${feeLine(t)}</div>
      <div class="row-sub mt-3">Intake — ${esc(t.intakeLabel)}</div>
    </div>
    <button type="button" class="btn btn-quiet mt-5 track-choice-btn" data-track="${t.id}">Choose ${esc(t.label)}</button>
  </div>`;

  main.innerHTML = renderHero({
    kicker: 'Welcome to PathFinder', title: 'PhD or master’s — which one are you aiming for?',
    body: 'One question before anything else: the two routes differ on fees, funding and how much money your visa needs to show. Change it anytime from the menu.',
  }) +
    `<div class="choice-grid">${card(PF_TRACK.phd)}${card(PF_TRACK.masters)}</div>
     <p class="row-sub mt-6" style="max-width:620px">Not sure yet? Pick the one you're leaning towards — the 5-minute assessment will tell you which you're actually ready for, and switching keeps your answers.</p>`;

  $$('.track-choice-btn', main).forEach(b => b.onclick = () => {
    PFStore.setTrack(b.dataset.track);
    asmState.trackConfirmed = true;
    paintTrackSwitch();
    route();
  });
}

function renderAssessment(main) {
  // The track choice is asked by route() now, in front of every view — not
  // just this one. See needsTrackChoice().
  const T = trackCfg();
  const done = PFStore.getAssessment();
  if (done && asmState.step === 0 && !asmState.retake) {
    // A result computed on the other track is stale the moment they switch,
    // so recompute from the stored answers rather than showing the old verdict.
    const result = currentResult();
    main.innerHTML = renderHero({
      kicker: 'Pathway Assessment', title: result.pathway,
      body: `Your ${T.label} result, based on your answers. Retake anytime.`,
      figure: result.readiness, figureSuffix: '%', figureCaption: T.label + '-ready',
      primaryLabel: 'View my roadmap', primaryHref: '#roadmap',
    }) + resultCard(result) +
      `<div class="hero-actions mt-5">
        <a class="btn btn-quiet" href="${isMasters() ? '#courses' : '#explore'}">${isMasters() ? 'Browse matching courses' : 'Explore matched labs'}</a>
        <button type="button" class="btn btn-quiet" id="retake">Retake assessment</button>
      </div>`;
    $('#retake').onclick = () => { asmState = { step: 0, answers: {}, retake: true }; route(); };
    return;
  }

  // The master's field options come from the catalogue — pull it once, then
  // re-render. Cheap (~37 KB gz) and they are heading for #courses next.
  if (isMasters() && !window.PF_CATALOGUE) {
    ensureCatalogue().then(() => { if (location.hash.startsWith('#assessment')) route(); });
  }

  const qs = asmQuestions();
  const i = asmState.step;
  if (i >= qs.length) return finishAssessment(main);
  const q = qs[i];
  const pct = Math.round((i / qs.length) * 100);

  main.innerHTML = renderHero({
    kicker: `Question ${i + 1} of ${qs.length}`, title: q.q,
    body: `About five minutes in total — your answers shape the plan and the course filters.`,
  }) +
    barHtml(pct) +
    `<div class="asm-opts mt-6">${q.opts.map((o, k) =>
      `<button type="button" class="field asm-opt" data-k="${k}" role="radio" aria-checked="false">${o.t}</button>`).join('')}
     </div>
     ${i > 0 ? `<button type="button" class="btn btn-quiet mt-5" id="asm-back">← Back</button>` : ''}`;

  $$('.asm-opt', main).forEach(b => b.onclick = () => {
    asmState.answers[q.id] = q.opts[+b.dataset.k].v;
    asmState.step++;
    route();
  });
  const back = $('#asm-back', main);
  if (back) back.onclick = () => { asmState.step--; route(); };
}

function computeResult(a) {
  return isMasters() ? computeMastersResult(a) : computePhdResult(a);
}

/* The two tracks ask the field question with different vocabularies: the PhD
   track offers the eight research fields (PF_FIELDS), the master's track the
   NZQA subject-area roots. Both are stored in the same `field` answer, so a
   student who switches tracks would otherwise carry an id the other track
   cannot match — silently emptying Explore and the matched counts. These two
   translate between them so a switch keeps the subject the student chose. */
function fieldAsResearchField(field) {
  if (!field) return field;
  if (PF_FIELDS.includes(field)) return field;
  // An NZQA root id → the first research field that maps onto it.
  const hit = Object.keys(PF_FIELD_TO_SUBJECT_AREA).find(f => PF_FIELD_TO_SUBJECT_AREA[f].includes(field));
  return hit || '';   // Architecture, Creative Arts etc. have no research-field twin
}

function fieldAsSubjectArea(field) {
  if (!field) return field;
  if (PF_FIELD_TO_SUBJECT_AREA[field]) return PF_FIELD_TO_SUBJECT_AREA[field][0];
  return field;       // already an NZQA root id
}

function computePhdResult(a) {
  a = Object.assign({}, a, { field: fieldAsResearchField(a.field) });
  const score = (+a.degree || 0) + (+a.gpa || 0) + (+a.research || 0) + (+a.english || 0); // max 15
  const readiness = Math.round((score / 15) * 100);

  let pathway, pathwayWhy;
  if (a.degree >= 3 && a.research >= 3) {
    pathway = 'Direct PhD Entry';
    pathwayWhy = 'A research master’s or thesis puts you in range for direct PhD entry at the eight NZ universities. Finding a supervisor who will take you is the real hurdle, not the paperwork.';
  } else if (a.degree >= 2 && (a.research >= 2 || a.gpa >= 3)) {
    pathway = 'Direct PhD (with strong proposal) or 1-year MPhil bridge';
    pathwayWhy = 'Honours graduates with first-class results can enter NZ PhDs directly. What decides it is the research proposal and whether a supervisor backs you.';
  } else {
    pathway = 'Research Master’s first → PhD';
    pathwayWhy = 'A 1–2 year research master’s (in NZ or Sri Lanka) builds the thesis experience and supervisor references NZ PhD admissions committees expect.';
  }

  const unis = PF_UNIVERSITIES.filter(u => u.strengths.includes(a.field)).map(u => u.id);
  const labs = PF_LABS.filter(l => l.field === a.field).map(l => l.id);
  const schols = PF_SCHOLARSHIPS.filter(s => s.fields === 'All fields' || s.fields === a.field).map(s => s.id);

  return { track: 'phd', readiness, pathway, pathwayWhy, field: a.field, funding: a.funding,
           timeline: a.timeline, english: a.english, unis, labs, schols };
}

/* Master's admission turns on a different set of facts: a completed
   bachelor's in a related subject, its classification, and English. NZ
   universities routinely offer an under-qualified applicant a postgraduate
   diploma that articulates into the master's on good results — that bridge is
   the single most useful thing to tell a second-lower graduate, so the
   pathway names it explicitly rather than saying "you don't qualify". */
function computeMastersResult(a) {
  a = Object.assign({}, a, { field: fieldAsSubjectArea(a.field) });
  const score = (+a.degree || 0) + (+a.gpa || 0) + (+a.work || 0) + (+a.english || 0); // max 15
  const readiness = Math.round((score / 15) * 100);

  let pathway, pathwayWhy;
  if (a.degree >= 3 && a.gpa >= 3) {
    pathway = 'Direct Master’s Entry';
    pathwayWhy = 'A four-year or honours degree with a good average meets the usual entry rule for a 180-point NZ master’s, so you can apply directly. Individual programmes still set their own bar — check each one.';
  } else if (a.degree >= 2 && a.gpa >= 3) {
    pathway = 'Direct Master’s (180-point) or a Postgraduate Diploma bridge';
    pathwayWhy = 'A three-year bachelor’s with a second-upper average gets you into most 180-point master’s. Where a university wants four years of study, its postgraduate diploma credits straight into the master’s.';
  } else if (a.degree >= 2) {
    pathway = 'Postgraduate Diploma → Master’s';
    pathwayWhy = 'A PGDip is the standard route when the bachelor’s average sits below the direct-entry bar. Pass it well and the credits transfer into the master’s, usually adding one semester overall.';
  } else {
    pathway = 'Graduate Diploma → Postgraduate study';
    pathwayWhy = 'A graduate diploma brings an incomplete or unrelated bachelor’s up to the level NZ postgraduate admission expects, and is a recognised entry route rather than a detour.';
  }
  if (a.english !== undefined && a.english < 2) {
    pathwayWhy += ' Your English score is the gate to clear first — every route above needs it.';
  }

  // `field` is an NZQA subject-area root id on this track (see
  // PF_QUESTIONS_MASTERS); counts come from the catalogue when it is loaded.
  const cat = window.PF_CATALOGUE;
  const T = PF_TRACK.masters;
  const courses = cat
    ? cat.quals.filter(q => T.levels.includes(q.l) &&
        (q.s || []).some(s => cat.taxonomy[s] && cat.taxonomy[s].r === a.field)).length
    : 0;
  const providers = cat
    ? new Set(cat.quals.filter(q => T.levels.includes(q.l) &&
        (q.s || []).some(s => cat.taxonomy[s] && cat.taxonomy[s].r === a.field))
        .flatMap(q => q.o)).size
    : 0;
  const fieldName = (cat && cat.taxonomy[a.field] && cat.taxonomy[a.field].n) ||
    (PF_SUBJECT_ROOTS.find(r => r.id === a.field) || {}).name || 'your subject';

  return { track: 'masters', readiness, pathway, pathwayWhy, field: fieldName, subjectArea: a.field,
           funding: a.funding, timeline: a.timeline, english: a.english, work: a.work,
           courses, providers, unis: [], labs: [], schols: [] };
}

function finishAssessment(main) {
  const result = computeResult(asmState.answers);
  PFStore.setAssessment({ answers: asmState.answers, result, completedAt: Date.now() });
  asmState = { step: 0, answers: {} };
  const synced = !!(window.PFCloud && PFCloud.isSignedIn && PFCloud.isSignedIn());
  main.innerHTML = renderHero({
    kicker: 'Assessment complete', title: result.pathway,
    body: 'Saved to your dashboard — your roadmap is built from these answers.',
    figure: result.readiness, figureSuffix: '%', figureCaption: trackCfg().label + '-ready',
    primaryLabel: 'Open my roadmap', primaryHref: '#roadmap',
  }) +
    resultCard(result) +
    // Endowed-progress login moment: the student now HAS a result worth
    // keeping — the strongest point to offer a free account (never forced).
    (cloudOn() && !synced
      ? `<a class="nudge mt-5" href="#account">
          <span class="material-symbols-outlined nudge-icon" aria-hidden="true">workspace_premium</span>
          <p class="nudge-body">You're ${result.readiness}% ${esc(trackCfg().label)}-ready. Create a free account and this stays with you on every device.</p>
        </a>`
      : '') +
    `<div class="hero-actions mt-5">
      ${isMasters()
        ? '<a class="btn btn-quiet" href="#courses">Browse matching qualifications</a>'
        : '<a class="btn btn-quiet" href="#explore">Explore matched labs</a>'}
    </div>`;
}

/* The recommended-pathway panel — shown both right after finishing and
   whenever the student revisits a completed assessment. The readiness
   ring the old design used is gone: the hero's own figure slot already
   carries that percentage, so this listcard only needs the pathway
   explanation and the field-specific counts. */
function resultCard(r) {
  const stats = r.track === 'masters'
    ? [['school', r.courses || 0, 'Qualifications'], ['apartment', r.providers || 0, 'Providers']]
    : [['school', r.unis.length, 'Matched universities'], ['science', r.labs.length, 'Matched labs'], ['payments', r.schols.length, 'Eligible scholarships']];
  return `<div class="listcard">
    <div class="listcard-head"><h2 class="listcard-title">Why this pathway</h2><span class="listcard-summary">${esc(r.field)}</span></div>
    <p>${r.pathwayWhy}</p>
    <div class="result-stats">${stats.map(([ic, n, l]) => `<div class="stat">
      <span class="material-symbols-outlined stat-icon" aria-hidden="true">${ic}</span>
      <div class="stat-figure">${n}</div><div class="stat-label">${l}</div></div>`).join('')}</div>
    ${r.english < 3 ? partnerRow('ielts') : ''}
  </div>`;
}

/* ── 2 · Roadmap ────────────────────────────────────────── */
function buildRoadmap(r) {
  return isMasters() ? buildMastersRoadmap(r) : buildPhdRoadmap(r);
}

/* A master's application runs on the university's calendar, not on a
   supervisor's goodwill: you pick a programme, apply to an intake, and the
   deadlines are fixed. So the phases are anchored to the two NZ intakes
   (February and July) and counted BACKWARDS from the one being targeted —
   the opposite shape to the PhD roadmap, where discovery comes first and the
   start date follows whenever a supervisor says yes. */
function buildMastersRoadmap(r) {
  const C = PF_CONFIG;
  const fees = C.mastersFeesIntlPerYear;
  const phases = [];

  phases.push({ when: '9–12 months out', title: 'Choose the qualification', color: 'teal', consult: 'masters-intake', link: { href: '#courses', label: 'Open the Course Catalogue →' }, items: [
    r ? `Shortlist 4–6 qualifications in ${r.field} from the catalogue — compare entry requirements line by line, not just the titles`
      : 'Shortlist 4–6 qualifications from the Course Catalogue and compare their entry requirements',
    'Check whether each one is 180 points (one year) or 240 points (two) — it changes your fees and your visa funds by a full year',
    r && r.english < 3 ? 'Book IELTS Academic — target 6.5+ overall with no band below 6.0' : 'English requirement met ✓ — your IELTS certificate is valid for two years',
  ]});

  phases.push({ when: '8–10 months out', title: 'Credentials & documents', color: 'violet', consult: 'masters-credential', items: [
    'Order certified transcripts and your degree certificate — Sri Lankan universities can take 4–6 weeks',
    'Ask two academic referees early; give them your CV and the programmes you are applying to',
    r && r.degree === 2 ? 'If a university wants four years of study, ask its admissions office directly whether its postgraduate diploma articulates into the master’s' : 'Confirm your degree is recognised for direct entry — admissions offices answer this by email in days',
  ]});

  phases.push({ when: '6–8 months out', title: 'Apply & fund', color: 'gold', consult: 'masters-sop', link: { href: '#funding', label: 'Open the Scholarship Hub →' }, items: [
    'Submit applications — most NZ universities charge no application fee and let you apply to several at once',
    'Write one statement of purpose per programme; a generic one reads as generic (template in the Starter Kit)',
    r && r.funding !== 'self'
      ? 'Apply for scholarships in the same cycle — master’s awards have hard deadlines and are NOT automatic with admission, unlike doctoral ones'
      : `Plan for full international tuition of about ${fundsMoney(fees.lo)}–${fundsMoney(fees.hi)} a year — master’s students get no domestic-fee concession`,
  ]});

  phases.push({ when: '3–5 months out', title: 'Offer, deposit & visa', color: 'rose', consult: 'visa-evisa', link: { href: '#visa', label: 'Open the Visa Hub →' }, items: [
    'Accept the offer of place and pay the tuition deposit — the receipt is part of your visa evidence',
    `Show funds: tuition plus ${fundsMoney(C.visaFundsPerYear)}/yr living costs. Run the Funds Check before you apply, not after`,
    'Apply for the Student Visa via the INZ eVisa — allow 6–8 weeks',
    'Medical & chest X-ray at an INZ-approved panel physician in Colombo',
  ]});

  phases.push({ when: 'Intake month', title: 'Arrive & enrol', color: 'teal', consult: 'settle-arrival', link: { href: '#settlement', label: 'Open the Settle In guide →' }, items: [
    'IRD number, NZ bank account and a SIM card in week one',
    'Enrol in courses before orientation — popular papers fill, and a wrong enrolment can cost you a semester',
    'Check your work rights: 25 hours a week during semester, full-time over the summer break',
  ]});
  return phases;
}

function buildPhdRoadmap(r) {
  const phases = [];
  phases.push({ when: 'Months 1–2', title: 'Foundation', color: 'teal', items: [
    r && r.english < 3 ? 'Book and prepare for IELTS Academic — target 6.5+ overall, no band below 6.0' : 'English requirement met ✓ — keep your IELTS score certificate handy (valid 2 years)',
    'Finalize your research area and read 10–15 recent papers in it',
    'Polish your academic CV using the Starter Kit template',
  ]});
  phases.push({ when: 'Months 2–4', title: 'Supervisor Discovery', color: 'violet', consult: 'roadmap-supervisor', items: [
    r ? `Shortlist 8–10 supervisors in ${r.field} across your ${r.unis.length} matched universities` : 'Shortlist 8–10 supervisors across NZ universities',
    'Send personalized first-contact emails (template in Starter Kit) — most go unanswered, so send more than feels necessary',
    'Track every contact in your Application Dashboard',
  ]});
  phases.push({ when: 'Months 3–6', title: 'Proposal & Application', color: 'gold', consult: 'roadmap-proposal', items: [
    'Draft a 4–6 page research proposal with your interested supervisor’s feedback',
    'Gather transcripts (certified), 2–3 referee letters, and degree certificates',
    'Submit university applications (free at most NZ universities for PhD)',
    r && r.funding !== 'self' ? 'Apply for doctoral scholarships in the same cycle — most are automatic with admission' : 'Prepare evidence of funds (~NZ$20,000/yr living costs + fees)',
  ]});
  phases.push({ when: 'Months 6–9', title: 'Offer & Visa', color: 'rose', consult: 'visa-evisa', link: { href: '#visa', label: 'Open the Visa Hub →' }, items: [
    'Receive offer of place (+ scholarship outcome)',
    'Apply for the Student Visa via Immigration NZ eVisa — allow 6–8 weeks',
    'Medical & chest X-ray at an INZ-approved panel physician in Colombo',
    'Book flights, arrange first-month accommodation through your university',
  ]});
  phases.push({ when: 'Month 9+', title: 'Arrival & Enrollment', color: 'teal', consult: 'settle-arrival', link: { href: '#settlement', label: 'Open the Settle In guide →' }, items: [
    'IRD number, NZ bank account, SIM card in week one',
    'Complete PhD provisional registration; agree supervision plan & milestones',
    'Confirmation (full registration) review at ~12 months — your first big milestone',
  ]});
  return phases;
}

/* A .nudge variant that keeps the same underlying "Ask a mentor" toggle +
   inline form as consultCTA() (same classes, same global delegated
   handlers below) so migrated views get the new panel shape with zero
   behaviour change. */
function consultNudge(topic) {
  const t = topic || '';
  return `<div class="nudge">
    <span class="material-symbols-outlined nudge-icon" aria-hidden="true">support_agent</span>
    <button type="button" class="consult-hook-toggle nudge-toggle">Stuck at this step? Ask a mentor →</button>
    <form class="consult-hook-form hidden" data-topic="${t}">
      <input class="field ch-name" placeholder="Your name" autocomplete="name">
      <input class="field ch-contact" placeholder="Email or WhatsApp — how a mentor reaches you">
      <textarea class="field ch-note" rows="2" placeholder="One line about where you're stuck (optional)"></textarea>
      <button type="submit" class="btn btn-quiet btn-sm">Send request</button>
    </form>
  </div>`;
}

function renderRoadmap(main) {
  const T = trackCfg();
  // Recompute against the active track so switching tracks re-plans rather
  // than leaving a PhD pathway attached to a master's roadmap.
  const r = currentResult();
  const phases = buildRoadmap(r);
  const when = { '6m':'aiming at the next intake', '1y':'starting in about a year',
                 '2y':'starting in 1–2 years', 'explore':'exploration' };
  // Step completion is new persisted state — buildRoadmap() has no checkable
  // items today. Reuses the same generic checklist store as the Visa Hub
  // (PFStore.isChecked/setChecklistItem), track-scoped so switching tracks
  // doesn't cross-contaminate a master's checklist with a PhD one.
  const key = 'roadmap-' + PFStore.getTrack();

  const phaseRows = (p, ids) => `<ul class="ck-list">${p.items.map((it, ii) => {
    const done = PFStore.isChecked(key, ids[ii]);
    return `<li class="ck-item ${done ? 'done' : ''}">
      <label>
        <input type="checkbox" data-roadmap-id="${ids[ii]}" ${done ? 'checked' : ''}>
        <span class="ck-box"><span class="material-symbols-outlined" aria-hidden="true">check</span></span>
        <span class="ck-t">${it}</span>
      </label>
    </li>`;
  }).join('')}</ul>`;

  main.innerHTML = renderHero({
    kicker: 'Interactive Roadmap',
    title: r ? `Your roadmap to ${T.article} in ${r.field}` : `Your ${T.label} roadmap`,
    body: r ? `Personalized for the ${r.pathway} pathway, ${when[r.timeline] || ''}.`
             : `This is the standard NZ ${T.label} timeline.`,
    primaryLabel: r ? '' : 'Take the assessment', primaryHref: r ? '' : '#assessment',
    secondaryLabel: 'Ask a mentor', secondaryHref: '#mentors',
  }) +
    phases.map((p, pi) => {
      const ids = p.items.map((_, ii) => `p${pi}-i${ii}`);
      const allDone = ids.every(id => PFStore.isChecked(key, id));
      const body = phaseRows(p, ids) +
        (p.link ? `<div class="phase-link"><a class="btn btn-quiet btn-sm" href="${p.link.href}">${p.link.label}</a></div>` : '') +
        (p.consult ? consultNudge(p.consult) : '');
      return `<div class="listcard roadmap-phase" data-phase="${pi}">
        <div class="listcard-head">
          <div class="phase-head-left">
            <span class="phase-num ${allDone ? 'is-done' : ''}">${allDone ? '<span class="material-symbols-outlined" aria-hidden="true">check</span>' : pi + 1}</span>
            <h2 class="listcard-title">${p.title}</h2>
          </div>
          <span class="chip chip-neutral">${p.when}</span>
        </div>
        ${allDone ? `<button type="button" class="phase-collapse-toggle" data-toggle="${pi}">
            <span class="material-symbols-outlined" aria-hidden="true">expand_more</span>
            All ${p.items.length} steps done — show them
          </button>
          <div class="phase-body hidden" data-body="${pi}">${body}</div>`
        : `<div class="phase-body" data-body="${pi}">${body}</div>`}
      </div>`;
    }).join('');

  // The strongest moment to ask: they finished the assessment, and this
  // screen is the thing it produced — a plan with their field, their
  // pathway and their timeline in it. Deliberately NOT on the result
  // screen itself, where a modal would cover the result they just earned
  // before they had a chance to read it.
  if (r) softAccountPrompt({
    key: 'roadmap',
    title: 'Keep your roadmap',
    body: `This plan is built from your answers — ${esc(r.pathway)}, ${esc(r.field)}. An account keeps it, and every box you tick on it, on any device you sign into.`,
  });
}

/* Delegated on document (not on #view) so the handler is registered once,
   not re-added on every renderRoadmap() re-render — #view's own node
   persists across route() calls even though its innerHTML is replaced. */
document.addEventListener('change', e => {
  const cb = e.target.closest('[data-roadmap-id]');
  if (!cb) return;
  PFStore.setChecklistItem('roadmap-' + PFStore.getTrack(), cb.dataset.roadmapId, cb.checked);
  route();
});
document.addEventListener('click', e => {
  const t = e.target.closest('.phase-collapse-toggle');
  if (!t) return;
  document.querySelector(`[data-body="${t.dataset.toggle}"]`)?.classList.toggle('hidden');
});

/* ── 2b · Research Studio (topic & proposal generator) ───────
   "AI" = a free, no-key scholarly-API search (OpenAlex) + a
   deterministic generator that turns real papers + the student's
   answers + the NZ dataset into candidate directions and a full
   proposal draft. No backend, no key, works offline (degraded). */
let researchState = { stage: 'intake', intake: null, results: null,
  candidates: [], selected: null, proposal: null, loading: false,
  error: null, started: false };

const rsCap   = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const rsLower = s => s ? s.charAt(0).toLowerCase() + s.slice(1) : s;

/* Reconstruct plain text from OpenAlex's abstract_inverted_index */
function reconstructAbstract(inv) {
  if (!inv) return '';
  const words = [];
  Object.entries(inv).forEach(([word, positions]) =>
    positions.forEach(pos => { words[pos] = word; }));
  const text = words.filter(Boolean).join(' ').trim();
  return text.length > 360 ? text.slice(0, 357).trim() + '…' : text;
}

/* Normalise a raw OpenAlex /works payload into the shape the UI needs.
   For every author we keep their NZ affiliation (read straight from the
   authorship's institutions[].country_code) so we can later surface, quietly,
   which of the people advancing this topic are based in New Zealand. */
function parseWorks(works) {
  const papers = (works || []).map(w => {
    const authorships = (w.authorships || []);
    // The NZ people on this paper, with the institution that makes them NZ.
    const nzAuthors = [];
    authorships.forEach(a => {
      const name = a.author && a.author.display_name;
      if (!name) return;
      const nzInst = (a.institutions || []).find(i => i.country_code === 'NZ');
      if (nzInst) nzAuthors.push({ name, institution: nzInst.display_name || '' });
    });
    return {
      title: w.title || w.display_name || '',
      year: w.publication_year || null,
      venue: (w.primary_location && w.primary_location.source && w.primary_location.source.display_name)
        || (w.host_venue && w.host_venue.display_name) || '',
      citations: w.cited_by_count || 0,
      authors: authorships.map(a => a.author && a.author.display_name).filter(Boolean),
      nzAuthors,
      isNZ: nzAuthors.length > 0,
      concepts: (w.concepts || []).filter(c => c.level >= 1 && c.score >= 0.3).map(c => c.display_name),
      abstract: reconstructAbstract(w.abstract_inverted_index),
      doi: w.doi || '',
      url: (w.primary_location && w.primary_location.landing_page_url) || w.doi || '',
    };
  }).filter(p => p.title);

  return aggregateResults(papers);
}

/* Build the author / concept / year rollups (and the NZ-author roll-up) from a
   flat list of papers. Shared by OpenAlex, Crossref and the merge step. */
function aggregateResults(papers) {
  const authorFreq = {}, conceptFreq = {}, years = {}, nzMap = {};
  papers.forEach(p => {
    p.authors.forEach(a => { authorFreq[a] = (authorFreq[a] || 0) + 1; });
    (p.concepts || []).forEach(c => { conceptFreq[c] = (conceptFreq[c] || 0) + 1; });
    if (p.year) years[p.year] = (years[p.year] || 0) + 1;
    (p.nzAuthors || []).forEach(na => {
      const k = na.name;
      if (!nzMap[k]) nzMap[k] = { name: na.name, institution: na.institution, count: 0, citations: 0 };
      nzMap[k].count++;
      nzMap[k].citations += (p.citations || 0);   // citation impact, not just paper count
      if (!nzMap[k].institution && na.institution) nzMap[k].institution = na.institution;
    });
  });
  const rank = obj => Object.entries(obj).sort((a, b) => b[1] - a[1]);
  // NZ authors in this result set, tagged with the campus we resolve them to.
  // (Final ranking/blending with the corpus index happens in blendNZAuthors.)
  const nzAuthors = Object.values(nzMap)
    .map(a => ({ ...a, home: nzHomeFromName(a.institution) }))
    .sort((a, b) => (b.count - a.count) || (b.citations - a.citations));
  return {
    papers,
    topAuthors: rank(authorFreq).slice(0, 8).map(([name, count]) => ({ name, count })),
    topConcepts: rank(conceptFreq).slice(0, 12).map(([name, count]) => ({ name, count })),
    nzAuthors,
    nzPaperCount: papers.filter(p => p.isNZ).length,
    years,
  };
}

/* Build the OpenAlex `search` string. The topic + the student's own keywords
   lead; field keywords are only appended when the input is sparse, so they
   sharpen recall without diluting relevance on a well-specified topic. */
function rsQuery(intake) {
  const core = [intake.topic, intake.keywords].filter(Boolean).join(' ').trim();
  if (core.replace(/\s+/g, '').length >= 24) return core;
  return [core, (PF_FIELD_KEYWORDS[intake.field] || []).join(' ')].filter(Boolean).join(' ').trim()
    || intake.field || 'research';
}

/* Free, no-key, CORS-enabled OpenAlex /works search. `opts.sort` defaults to
   relevance (relevance_score:desc) — the previous citation-only sort discarded
   OpenAlex's relevance ranking and hid relevant niche work; we now retrieve by
   relevance and order the display by citations later. Degrades gracefully. */
async function openAlexSearch(intake, nzOnly, opts = {}) {
  const fromYear = new Date().getFullYear() - 7;
  // The NZ pass restricts to papers with >= 1 New-Zealand-based author so even
  // niche topics surface NZ work; the global pass keeps the map credible.
  const filters = [`from_publication_date:${fromYear}-01-01`];
  if (nzOnly) filters.push('authorships.institutions.country_code:NZ');
  const params = new URLSearchParams({
    search: rsQuery(intake),
    filter: filters.join(','),
    sort: opts.sort || 'relevance_score:desc',
  });
  params.set('per-page', String(opts.perPage || 50));
  const email = (window.PF_CONFIG && PF_CONFIG.contactEmail) || '';
  if (email && !/example/i.test(email)) params.set('mailto', email);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const resp = await fetch('https://api.openalex.org/works?' + params.toString(), { signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    return { results: parseWorks(data.results) };
  } catch (e) {
    return { results: parseWorks([]), error: e.message || 'network' };
  }
}

/* The "best published NZ authors on this topic", straight from OpenAlex's native
   analytics: group all NZ-authored works matching the query by author and read
   the ranked counts. Far more accurate than aggregating a small page of papers.
   Returns [{ name, topicCount }] (most prolific first) or [] on failure. */
async function openAlexNZAuthors(intake) {
  const fromYear = new Date().getFullYear() - 7;
  const params = new URLSearchParams({
    search: rsQuery(intake),
    filter: `authorships.institutions.country_code:NZ,from_publication_date:${fromYear}-01-01`,
    group_by: 'authorships.author.id',
  });
  const email = (window.PF_CONFIG && PF_CONFIG.contactEmail) || '';
  if (email && !/example/i.test(email)) params.set('mailto', email);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const resp = await fetch('https://api.openalex.org/works?' + params.toString(), { signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    return (data.group_by || []).filter(g => g.key_display_name && g.key_display_name !== 'unknown')
      .slice(0, 20).map(g => ({ name: g.key_display_name, topicCount: g.count }));
  } catch (e) {
    return [];
  }
}

/* Strip JATS/HTML tags Crossref sometimes wraps abstracts in */
function stripTags(s) { return s ? String(s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : ''; }

/* When a source has no concept taxonomy (Crossref), derive crude sub-themes
   from the frequency of meaningful title words across the result set. */
const RS_STOP = new Set(('the a an of and or for to in on at with using use used based via from into over under between within across study studies ' +
  'analysis approach approaches method methods novel new towards toward case review research model models data system systems').split(/\s+/));
function deriveConcepts(papers) {
  const freq = {};
  papers.forEach(p => (p.title || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)
    .forEach(w => { if (w.length > 4 && !RS_STOP.has(w)) freq[w] = (freq[w] || 0) + 1; }));
  return Object.entries(freq).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])
    .slice(0, 12).map(([name, count]) => ({ name, count }));
}

/* Crossref: genuinely free, polite-pool, no credits — the resilient fallback
   when OpenAlex is rate-limited/over-budget. No abstracts/concepts guaranteed. */
function parseCrossRef(items) {
  const papers = (items || []).map(w => {
    const ab = stripTags(w.abstract);
    return {
      title: (w.title || [])[0] || '',
      year: (((w.issued || {})['date-parts'] || [[]])[0] || [])[0] || null,
      venue: (w['container-title'] || [])[0] || '',
      citations: w['is-referenced-by-count'] || 0,
      authors: (w.author || []).map(a => [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean),
      concepts: [],
      abstract: ab.length > 360 ? ab.slice(0, 357).trim() + '…' : ab,
      doi: w.DOI ? 'https://doi.org/' + w.DOI : '',
      url: w.URL || (w.DOI ? 'https://doi.org/' + w.DOI : ''),
    };
  }).filter(p => p.title);
  // Crossref has no institution/country data, so isNZ/nzAuthors come back empty
  // here (the caller fills nzAuthors from the curated seed). Concepts are
  // derived from titles since Crossref carries no concept taxonomy.
  const agg = aggregateResults(papers);
  agg.topConcepts = deriveConcepts(papers);
  return agg;
}

async function crossRefSearch(intake) {
  const terms = [intake.topic, intake.keywords, (PF_FIELD_KEYWORDS[intake.field] || []).join(' ')]
    .filter(Boolean).join(' ').trim();
  const fromYear = new Date().getFullYear() - 6;
  const params = new URLSearchParams({ query: terms || intake.field || 'research',
    rows: '25', sort: 'is-referenced-by-count', order: 'desc' });
  params.set('filter', `from-pub-date:${fromYear}-01-01`);
  const email = (window.PF_CONFIG && PF_CONFIG.contactEmail) || '';
  if (email && !/example/i.test(email)) params.set('mailto', email);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const resp = await fetch('https://api.crossref.org/works?' + params.toString(), { signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    return { results: parseCrossRef(data.message && data.message.items) };
  } catch (e) {
    return { results: parseCrossRef([]), error: e.message || 'network' };
  }
}

/* Combine any number of result sets into one: dedup by DOI/title (earlier args
   win, so pass NZ / corpus sources first to preserve their affiliations), then
   order by citations for a credible literature map and re-aggregate. The NZ
   steer happens in how we surface NZ authors and which papers we cite — not by
   hiding global work. */
function combineResults(...sets) {
  const key = p => (p.doi || p.title || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const seen = new Set(), papers = [];
  sets.forEach(s => ((s && s.papers) || []).forEach(p => {
    const k = key(p);
    if (!k || seen.has(k)) return;
    seen.add(k); papers.push(p);
  }));
  papers.sort((a, b) => (b.citations || 0) - (a.citations || 0));
  return aggregateResults(papers);
}

/* ── Pre-scraped NZ corpus (sharded) ──────────────────────────
   10k+ recent NZ-authored papers live in per-field shards under
   assets/js/corpus/<slug>.js, with a tiny index at assets/js/research-corpus.js.
   We load the index once, then lazy-load ONLY the shard for the field a student
   is searching — so the browser downloads ~one field's worth, never all 10k.
   The corpus anchors the NZ side: it works offline and never hits a rate limit;
   the live API still runs for freshness/global context. Rebuild the data with
   scripts/scrape-nz-corpus.js. */
function _loadScript(src) {
  return new Promise(resolve => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

let _corpusIndexPromise = null;
function ensureCorpusIndex() {
  if (typeof window !== 'undefined' && window.PF_RESEARCH_CORPUS) return Promise.resolve(window.PF_RESEARCH_CORPUS);
  if (_corpusIndexPromise) return _corpusIndexPromise;
  _corpusIndexPromise = _loadScript('assets/js/research-corpus.js').then(() => window.PF_RESEARCH_CORPUS || null);
  return _corpusIndexPromise;
}

const _shardPromises = {};
/* Load one field's shard on demand. Resolves whether or not it succeeds. */
function ensureField(field) {
  if (typeof window === 'undefined') return Promise.resolve(false);
  window.PF_CORPUS_SHARDS = window.PF_CORPUS_SHARDS || {};
  if (window.PF_CORPUS_SHARDS[field]) return Promise.resolve(true);
  if (_shardPromises[field]) return _shardPromises[field];
  _shardPromises[field] = ensureCorpusIndex().then(idx => {
    const info = idx && idx.fields && idx.fields[field];
    if (!info) return false;
    return _loadScript('assets/js/' + info.file).then(() => !!(window.PF_CORPUS_SHARDS && window.PF_CORPUS_SHARDS[field]));
  });
  return _shardPromises[field];
}

/* Ensure the index plus the shard(s) we'll query are loaded before a search. */
function ensureCorpus(intake) {
  return ensureCorpusIndex().then(() => ensureField(intake.field)).catch(() => false);
}

/* ── NZQA course catalogue (sharded) ──────────────────────────────────
   1,716 current postgraduate qualifications from the NZQA register, with
   the 51 providers that teach them, generated by
   scripts/sync-astra-catalogue.js. Same shape as the research corpus
   above: a small index (assets/js/catalogue.js) holds the taxonomy, the
   provider directory and a filterable row per qualification; the long
   prose — entry requirements, graduate profile, employment pathway —
   lives in per-subject-area shards loaded only when a student opens that
   subject. Nothing here is fetched until #courses, #explore or #funding
   is opened, so the dashboard's first paint is unchanged.

   IMPORTANT: catalogue data must never be written through PFStore. Every
   PFStore key is mirrored to users/{uid}/kv/{key} with no allowlist (see
   assets/js/firebase.js), and pushing megabytes of catalogue there would
   blow the Firestore free tier. It stays in module-scope globals. */
let _cataloguePromise = null;
function ensureCatalogue() {
  if (window.PF_CATALOGUE) return Promise.resolve(window.PF_CATALOGUE);
  if (_cataloguePromise) return _cataloguePromise;
  _cataloguePromise = _loadScript('assets/js/catalogue.js').then(() => window.PF_CATALOGUE || null);
  return _cataloguePromise;
}

const _catShardPromises = {};
/* Load one subject area's detail shard. Resolves whether or not it succeeds —
   the Courses view degrades to index-only rows rather than breaking. */
function ensureSubjectArea(rootId) {
  window.PF_CAT_SHARD = window.PF_CAT_SHARD || {};
  if (window.PF_CAT_SHARD[rootId]) return Promise.resolve(true);
  if (_catShardPromises[rootId]) return _catShardPromises[rootId];
  _catShardPromises[rootId] = ensureCatalogue().then(cat => {
    const info = cat && cat.shards && cat.shards[rootId];
    if (!info) return false;
    return _loadScript('assets/js/' + info.file).then(() => !!window.PF_CAT_SHARD[rootId]);
  });
  return _catShardPromises[rootId];
}

/* One-off side files: the scholarship register (#funding) and the programme
   rows that carry real published fees (#courses detail). */
function _ensureCatFile(global, file, cache) {
  if (window[global]) return Promise.resolve(true);
  if (_catShardPromises[cache]) return _catShardPromises[cache];
  _catShardPromises[cache] = _loadScript('assets/js/catalogue/' + file).then(() => !!window[global]);
  return _catShardPromises[cache];
}
const ensureScholarships = () => _ensureCatFile('PF_CAT_SCHOLARSHIPS', 'scholarships.js', '__sch');
const ensureProgrammes  = () => _ensureCatFile('PF_CAT_PROGRAMMES', 'programmes.js', '__prg');

/* Full detail for one qualification = its index row + whatever the shard
   holds. Returns just the row if the shard hasn't loaded (or failed). */
function qualDetail(row) {
  const shard = window.PF_CAT_SHARD || {};
  for (const s of row.s || []) {
    const root = catTaxon(s) && catTaxon(s).r;
    if (shard[root] && shard[root][row.i]) return Object.assign({}, row, shard[root][row.i]);
  }
  return row;
}

const catTaxon = id => (window.PF_CATALOGUE && window.PF_CATALOGUE.taxonomy[id]) || null;
const catProvider = id => (window.PF_CATALOGUE && window.PF_CATALOGUE.providers[id]) || null;
/* The subject-area roots a qualification belongs to, de-duplicated. */
const catRoots = row => [...new Set((row.s || []).map(s => catTaxon(s) && catTaxon(s).r).filter(Boolean))];

/* Expand a compact corpus record (short keys) to the standard paper shape. */
function expandCorpusRec(r) {
  return {
    title: r.t || '', year: r.y || null, venue: r.v || '', citations: r.c || 0,
    authors: r.a || [],
    nzAuthors: (r.nz || []).map(x => ({ name: x.n, institution: x.i })),
    isNZ: true,
    concepts: r.k || [], abstract: r.ab || '',
    doi: r.d || '', url: r.d || '',
  };
}

const _corpusTok = s => String(s || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ')
  .split(/\s+/).filter(w => w.length > 2 && !RS_STOP.has(w));

/* Score & rank the local NZ corpus against the student's topic + keywords.
   Returns up to `limit` papers in the standard shape (all NZ-authored), or []
   if the corpus isn't loaded. Broadens beyond the chosen field if a niche topic
   has too few in-field hits, so there's always NZ work to anchor to. */
function corpusSearch(intake, limit = 25) {
  const shards = (typeof window !== 'undefined' && window.PF_CORPUS_SHARDS) || null;
  if (!shards) return [];
  const terms = new Set([..._corpusTok(intake.topic), ..._corpusTok(intake.keywords),
    ...(PF_FIELD_KEYWORDS[intake.field] || []).flatMap(_corpusTok)]);
  const score = r => {
    if (!terms.size) return r.c ? 1 : 0;
    const hay = (r.t + ' ' + (r.k || []).join(' ') + ' ' + (r.ab || '')).toLowerCase();
    let s = 0;
    terms.forEach(t => { if (hay.includes(t)) s += 2; });
    // tie-break toward well-cited work without letting it dominate relevance
    return s ? s + Math.min(3, Math.log10((r.c || 0) + 1)) : 0;
  };
  const rank = list => list.map(r => ({ r, s: score(r) })).filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s);
  let scored = rank(shards[intake.field] || []);
  if (scored.length < 8) {
    // Broaden across whatever other shards happen to be loaded already (we don't
    // force-load every shard — the live NZ pass covers anything still missing).
    const others = Object.entries(shards).filter(([f]) => f !== intake.field)
      .flatMap(([, ps]) => ps || []);
    const seen = new Set(scored.map(x => x.r.t));
    scored = scored.concat(rank(others).filter(x => !seen.has(x.r.t)));
  }
  return scored.slice(0, limit).map(x => expandCorpusRec(x.r));
}

/* The precomputed top NZ authors for a field (from the corpus index), ranked by
   total citations — the best-published NZ researchers in the field, available
   instantly and offline. Returns [{ name, institution, home, papers, citations }]. */
function corpusFieldAuthors(field) {
  const idx = (typeof window !== 'undefined' && window.PF_RESEARCH_CORPUS
    && window.PF_RESEARCH_CORPUS.fields && window.PF_RESEARCH_CORPUS.fields[field]) || null;
  if (!idx || !idx.authors) return [];
  return idx.authors.map(a => ({ name: a.n, institution: a.i, home: nzHomeFromName(a.i),
    papers: a.p, citations: a.c, fieldTop: true }));
}

/* Blend the NZ-author signals into one ranked, accurate list:
   • the verified PF_NZ_SUPERVISORS roster (180+ named, topic-tagged supervisors),
   • OpenAlex group_by (topic-specific output, the most authoritative ranking),
   • the authors of the papers actually retrieved (gives campus + citations),
   • the corpus field index (best-published in the field, fills gaps offline).
   Verified supervisors whose subfield keywords match the topic get a strong
   boost; this ensures the panel surfaces real, active NZ researchers even when
   the API or corpus coverage is thin. */
function blendNZAuthors(intake, results, groupAuthors) {
  const norm = s => String(s).toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
  const map = {};
  const e = name => (map[norm(name)] || (map[norm(name)] = {
    name, topicCount: 0, matched: 0, citations: 0, institution: '', home: null,
    verified: false, subMatch: 0 }));
  // Signal 1: verified supervisor roster — topic-keyword matching
  const topicLC = (intake.topic + ' ' + (intake.keywords || '')).toLowerCase();
  const topicToks = topicLC.split(/\s+/).filter(w => w.length > 2);
  (typeof PF_NZ_SUPERVISORS !== 'undefined' ? PF_NZ_SUPERVISORS : [])
    .filter(s => s.field === intake.field)
    .forEach(s => {
      const x = e(s.n);
      x.verified = true;
      const u = uniById(s.uni);
      if (!x.institution) { x.institution = u ? u.name : s.uni; x.home = { uni: u, uniId: s.uni }; }
      let sm = 0;
      (s.sub || []).forEach(kw => {
        const kwl = kw.toLowerCase();
        if (topicLC.includes(kwl)) sm += 3;
        else kwl.split(/\s+/).forEach(w => { if (w.length > 3 && topicToks.some(t => t.includes(w) || w.includes(t))) sm += 1; });
      });
      x.subMatch = Math.max(x.subMatch, sm);
    });
  // Signal 2: OpenAlex group_by facet
  (groupAuthors || []).forEach(g => { const x = e(g.name); x.topicCount = Math.max(x.topicCount, g.topicCount || 0); });
  // Signal 3: authors from retrieved papers
  (results.nzAuthors || []).forEach(a => { const x = e(a.name);
    x.matched = Math.max(x.matched, a.count || 0);
    x.citations = Math.max(x.citations, a.citations || 0);
    if (!x.institution && a.institution) { x.institution = a.institution; x.home = a.home || nzHomeFromName(a.institution); } });
  // Signal 4: corpus field index
  corpusFieldAuthors(intake.field).forEach(a => { const x = e(a.name);
    x.citations = Math.max(x.citations, a.citations || 0);
    if (!x.institution && a.institution) { x.institution = a.institution; x.home = a.home; } });
  const list = Object.values(map).filter(x => x.name).map(x => {
    const home = x.home || nzHomeFromName(x.institution);
    const score = x.topicCount * 4 + x.matched * 3
      + Math.min(6, Math.log10((x.citations || 0) + 1) * 2)
      + (home ? 1.5 : 0)
      + x.subMatch * 2
      + (x.verified ? 2 : 0);
    return { name: x.name, institution: x.institution || (x.topicCount ? 'New Zealand' : x.institution),
      home, citations: x.citations, papers: x.matched || x.topicCount, cited: x.matched > 0,
      verified: x.verified, score };
  });
  list.sort((a, b) => b.score - a.score);
  return list.slice(0, 12);
}

/* Curated NZ seed — draws from the verified PF_NZ_SUPERVISORS roster (180+
   named researchers with subfield keywords and campus), falling back to
   PF_LABS when no supervisors match. Topic-relevant supervisors rank first
   so the panel stays useful even with zero network. */
function nzSeedAuthors(intake) {
  const topicLC = (intake.topic + ' ' + (intake.keywords || '')).toLowerCase();
  const sups = (typeof PF_NZ_SUPERVISORS !== 'undefined' ? PF_NZ_SUPERVISORS : [])
    .filter(s => s.field === intake.field);
  if (sups.length) {
    const scored = sups.map(s => {
      const u = uniById(s.uni);
      let rel = 0;
      (s.sub || []).forEach(kw => { if (topicLC.includes(kw.toLowerCase())) rel += 3;
        else kw.toLowerCase().split(/\s+/).forEach(w => { if (w.length > 3 && topicLC.includes(w)) rel += 1; }); });
      return { name: s.n, institution: u ? u.name : s.uni, home: { uni: u, uniId: s.uni },
        topics: s.sub, count: 0, seed: true, verified: true, rel };
    });
    scored.sort((a, b) => b.rel - a.rel);
    const seen = new Set();
    return scored.filter(a => { const k = a.name.toLowerCase(); return seen.has(k) ? false : (seen.add(k), true); }).slice(0, 10);
  }
  // Fallback: parse PF_LABS supervisor strings
  const pool = PF_LABS.filter(l => l.field === intake.field);
  const out = [];
  (pool.length ? pool : PF_LABS).forEach(l => {
    const u = uniById(l.uni);
    l.supervisor.split('/').map(s => s.trim())
      .filter(s => s && !/multiple|various|several/i.test(s))
      .forEach(name => out.push({
        name: name.replace(/\s*\((founding|founder)\)/i, ''),
        institution: u ? u.name : l.uni,
        home: { uni: u, uniId: l.uni },
        lab: l.name, topics: l.topics, count: 0, seed: true,
      }));
  });
  const seen = new Set();
  return out.filter(a => { const k = a.name.toLowerCase(); return seen.has(k) ? false : (seen.add(k), true); });
}

/* The warm, ethical "this research lives in New Zealand" panel. It highlights
   the NZ people behind the literature *indirectly* — as authors of the work the
   student is reading/citing, shown with their campus, never labelled "your
   supervisor" — then makes the honest case for why a NZ PhD is a real door.
   `authors` is a list of { name, institution, home, cited?, seed? }. */
function nzOpportunityPanel(authors) {
  authors = (authors || []).slice(0, 8);
  if (!authors.length) return '';
  const live = authors.some(a => !a.seed);
  const lead = live ? 'Notice who’s writing the work in your area'
                    : 'Where this field is alive in New Zealand';
  const sub = live
    ? 'Several of the researchers whose recent papers match your topic are based at New Zealand universities — publishing right now, and supervising doctoral students. A PhD here means working in the same departments they publish from.'
    : 'These New Zealand groups are active in your field — the kind of people you’d be citing, and potentially working alongside, on a doctorate here.';
  const impact = c => c >= 1000 ? (c / 1000).toFixed(c >= 10000 ? 0 : 1) + 'k' : String(c);
  const rows = authors.map(a => {
    const uni = a.home && a.home.uni, inst = a.home && a.home.institute;
    const place = uni ? uni.name : (inst || a.institution || 'New Zealand');
    const city = uni ? uni.city : '';
    const meta = a.citations ? `${impact(a.citations)} citations` : '';
    return `<li class="rs-nz-person">
      <span class="rs-nz-dot">${esc((a.name.trim()[0] || 'N').toUpperCase())}</span>
      <div>
        <strong>${esc(a.name)}</strong>${a.cited ? ' <span class="chip chip-gold">in your citations</span>' : ''}
        <span class="rs-nz-place">${esc(place)}${city ? ' · ' + esc(city) : ''}${meta ? ' · ' + meta : ''}</span>
      </div>
    </li>`;
  }).join('');
  return `<section class="rs-nz card">
    <span class="chip chip-teal">Research happening in New Zealand</span>
    <h3 class="rs-nz-h">${lead}</h3>
    <p class="rs-nz-sub">${sub}</p>
    <ul class="rs-nz-people">${rows}</ul>
    <p class="rs-nz-why">And why being <em>here</em> matters for a PhD:</p>
    <ul class="rs-nz-perks">
      <li>Domestic PhD tuition (~NZ$7–8k/yr) — the same rate a local student pays</li>
      <li>Work unlimited hours while you study; your partner gets an open work visa</li>
      <li>A 3-year open post-study work visa once you graduate</li>
    </ul>
    <div class="rs-nz-cta">
      <a class="btn btn-primary btn-sm" href="#explore">Explore their universities</a>
      <a class="btn btn-quiet btn-sm" href="#kit">First-contact email template</a>
    </div>
    <p class="faint" style="font-size:11.5px;margin-top:12px">Authors and affiliations are drawn from the public research literature. PathFinder doesn’t arrange supervision — any approach is yours to make.</p>
  </section>`;
}

/* Anchor on the pre-scraped NZ corpus (real NZ-authored papers, always present
   offline), then enrich with live OpenAlex — a global pass plus an NZ-filtered
   pass — for freshness and global context. Corpus papers are passed first to
   combineResults so they win de-dup. Falls back to Crossref, then to the curated
   seed so the NZ author panel always appears. Returns { results, source, error }. */
async function runScholarlySearch(intake) {
  const corpus = corpusSearch(intake);                 // local NZ papers (may be [])
  const corpusSet = corpus.length ? { papers: corpus } : null;
  // Three live calls in parallel: a relevance-ranked global pass, the same for
  // NZ-only papers, and OpenAlex's group_by facet for the best NZ authors.
  const [g, nz, groupAuthors] = await Promise.all([
    openAlexSearch(intake, false),
    openAlexSearch(intake, true),
    openAlexNZAuthors(intake),
  ]);
  const gotGlobal = !g.error && g.results.papers.length;
  const gotNZ = !nz.error && nz.results.papers.length;
  // Blend the accurate author list from the group_by facet, the retrieved
  // papers, and the corpus index — falling back to the curated seed only if
  // nothing else placed an NZ researcher.
  const withAuthors = (results, source, error) => {
    results.nzAuthors = blendNZAuthors(intake, results, groupAuthors);
    if (!results.nzAuthors.length) results.nzAuthors = nzSeedAuthors(intake);
    return { results, source, error };
  };
  if (gotGlobal || gotNZ) {
    return withAuthors(combineResults(corpusSet, nz.results, g.results),
      corpus.length ? 'NZ corpus + OpenAlex' : 'OpenAlex');
  }
  // Offline / live failed but the corpus loaded — it alone is a solid NZ result.
  if (corpus.length) return withAuthors(aggregateResults(corpus), 'NZ corpus');
  const cr = await crossRefSearch(intake);
  if (cr.results.papers.length) return withAuthors(cr.results, 'Crossref');
  return withAuthors(g.results, null, g.error || nz.error || cr.error || 'unavailable');
}

/* 3–5 candidate directions from the student's input + trending concepts */
function generateCandidates(intake, results) {
  const topic = intake.topic.trim().replace(/[.\s]+$/, '');
  const method = PF_RESEARCH_METHODS.find(m => m.v === intake.method) || PF_RESEARCH_METHODS[1];
  // Clip very long topic phrases so generated titles stay readable.
  const tWords = topic.split(/\s+/);
  const topicShort = tWords.length > 9 ? tWords.slice(0, 9).join(' ') : topic;
  const lowTopic = topic.toLowerCase();
  // Drop angle terms already contained in the topic (avoids "...learning using learning").
  const concepts = (results.topConcepts || []).map(c => c.name)
    .filter(c => { const cw = c.toLowerCase();
      return cw !== intake.field.toLowerCase() && !lowTopic.includes(cw); });
  const angles = concepts.length ? concepts.slice(0, 5)
    : ['emerging methods', 'real-world data', 'rigorous evaluation', 'reproducibility', 'equitable access'];
  const templates = [
    c => `${rsCap(method.short)}: ${rsLower(topicShort)} through the lens of ${rsLower(c)}`,
    c => `${rsCap(topicShort)} — addressing ${rsLower(c)} in the New Zealand context`,
    c => `Bridging ${rsLower(c)} and ${rsLower(topicShort)}: an under-explored intersection`,
    c => `Towards robust ${rsLower(topicShort)}: the role of ${rsLower(c)}`,
    c => `A ${rsLower(method.short)} of ${rsLower(topicShort)} informed by ${rsLower(c)}`,
  ];
  const seen = new Set(), out = [];
  for (let i = 0; i < templates.length && out.length < 5; i++) {
    const angle = angles[i % angles.length];
    const title = templates[i](angle);
    if (seen.has(title)) continue;
    seen.add(title);
    out.push({ id: 'cand_' + i, title, angle,
      question: `How can a ${rsLower(method.short)} advance ${rsLower(topicShort)} with respect to ${rsLower(angle)}?` });
  }
  return out;
}

/* Score the NZ labs against the topic + discovered concepts */
function matchLabs(intake, results) {
  const terms = (intake.topic + ' ' + (intake.keywords || '') + ' ' +
    (results.topConcepts || []).map(c => c.name).join(' ')).toLowerCase();
  const pool = PF_LABS.filter(l => l.field === intake.field);
  const scored = (pool.length ? pool : PF_LABS).map(l => {
    let score = l.field === intake.field ? 2 : 0;
    l.topics.forEach(t => {
      if (terms.includes(t.toLowerCase())) score += 2;
      t.toLowerCase().split(/\s+/).forEach(w => { if (w.length > 3 && terms.includes(w)) score += 1; });
    });
    return { lab: l, score };
  }).sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map(s => s.lab);
}

function citeTag(p) {
  const last = (p.authors[0] || 'Author').split(' ').slice(-1)[0] || 'Author';
  return `(${last}${p.authors.length > 1 ? ' et al.' : ''}, ${p.year || 'n.d.'})`;
}
function formatRef(p) {
  const authors = p.authors.length
    ? p.authors.slice(0, 3).join(', ') + (p.authors.length > 3 ? ', et al.' : '')
    : 'Unknown author';
  return `${authors} ${p.year ? `(${p.year}). ` : ''}${p.title}.${p.venue ? ` ${p.venue}.` : ''}${p.doi ? ` ${p.doi}` : ''}`.trim();
}

function buildResearchTimeline() {
  return [
    { when: 'Year 1', items: ['Confirm research questions and complete the full literature review', 'Provisional registration and an agreed supervision plan', 'Pilot study / proof-of-concept; confirmation (full registration) review at ~12 months'] },
    { when: 'Year 2', items: ['Core data collection or model development', 'First conference paper or workshop submission', 'Mid-candidature progress review'] },
    { when: 'Year 3', items: ['Complete analysis and remaining studies', 'Submit journal articles from thesis chapters', 'Write up, submit, and defend the thesis'] },
  ];
}

/* Assemble the structured proposal object from a chosen direction */
function buildProposal(intake, candidate, results) {
  const method = PF_RESEARCH_METHODS.find(m => m.v === intake.method) || PF_RESEARCH_METHODS[1];
  // NZ-prioritized citations: lead with NZ-authored papers, fill with global —
  // so the references the student carries forward foreground NZ scholarship.
  const all = results.papers || [];
  const papers = [...all.filter(p => p.isNZ), ...all.filter(p => !p.isNZ)].slice(0, 6);
  const cites = papers.map(citeTag);
  const themes = (results.topConcepts || []).slice(0, 5).map(c => c.name);
  const labs = matchLabs(intake, results);
  const nzAuthors = nzAuthorsForProposal(papers, results);

  const abstract = `This doctoral research investigates ${rsLower(intake.topic)}` +
    `${intake.problem ? `, motivated by ${rsLower(intake.problem)}` : ''}. ` +
    `Adopting ${method.blurb}, the project focuses on ${rsLower(candidate.angle)} as an under-served angle within ${intake.field}. ` +
    `The intended contribution is new evidence and methods that advance both scholarship and practice, with relevance to the New Zealand research context.`;

  const background = `Recent work in ${intake.field}` +
    `${themes.length ? ` has concentrated on ${themes.slice(0, 3).join(', ')}` : ' has grown rapidly'}` +
    `${cites.length ? ` ${cites.slice(0, 3).join(' ')}` : ''}. ` +
    (papers.length
      ? `The most-cited recent literature (see References) frames the current state of the field. `
      : `A focused reading of 10–15 recent papers will frame the current state of the field. `) +
    `This proposal builds on that base while targeting ${rsLower(candidate.angle)}, which remains comparatively under-explored.`;

  const gap = `Despite this progress, ${rsLower(candidate.angle)} in relation to ${rsLower(intake.topic)} is not yet well understood` +
    `${themes.length > 1 ? `, particularly where ${themes[0]} and ${themes[1]} intersect` : ''}. ` +
    `${intake.problem ? rsCap(intake.problem) + '. ' : ''}This project addresses that gap directly.`;

  const questions = [
    candidate.question,
    `What evidence from a ${rsLower(method.short)} best characterises ${rsLower(intake.topic)} in practice?`,
    `How do the findings transfer to the New Zealand setting and its national research priorities?`,
  ];

  const methodology = `The project will pursue ${method.blurb}. Indicatively this involves: ${method.methods.join('; ')}. ` +
    `Data sources, instruments, and evaluation criteria will be refined with the supervisor during the first six months.`;

  return {
    title: candidate.title, intake, abstract, background, gap, questions, methodology,
    timeline: buildResearchTimeline(),
    groups: labs.map(l => { const u = uniById(l.uni);
      return { lab: l.name, lead: l.supervisor, uni: u ? u.name : l.uni, hint: l.hint }; }),
    nzAuthors,
    refs: papers.map(formatRef),
    sourcedFrom: papers.length,
    generatedAt: Date.now(),
  };
}

/* The indirect highlight: which authors of the work the proposal cites are
   based in New Zealand. Cross-references PF_NZ_SUPERVISORS for accurate
   institution resolution. Returns up to 8, verified campus-pinned authors first. */
function nzAuthorsForProposal(citedPapers, results) {
  const norm = s => String(s).toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
  const supIdx = {};
  (typeof PF_NZ_SUPERVISORS !== 'undefined' ? PF_NZ_SUPERVISORS : []).forEach(s => {
    supIdx[norm(s.n)] = s;
  });
  const byName = {};
  citedPapers.forEach(p => (p.nzAuthors || []).forEach(na => {
    const k = norm(na.name);
    if (!byName[k]) {
      const sv = supIdx[k];
      const u = sv ? uniById(sv.uni) : null;
      byName[k] = { name: na.name, institution: u ? u.name : na.institution,
        home: u ? { uni: u, uniId: sv.uni } : nzHomeFromName(na.institution),
        cited: true, count: 0, verified: !!sv };
    }
    byName[k].count++;
  }));
  let list = Object.values(byName);
  if (!list.length) list = (results.nzAuthors || []).slice();
  list.sort((a, b) => (!!b.verified - !!a.verified) || (!!(b.home && b.home.uni) - !!(a.home && a.home.uni)) || (b.count - a.count));
  return list.slice(0, 8);
}

function proposalToMarkdown(p) {
  const methodLabel = (PF_RESEARCH_METHODS.find(m => m.v === p.intake.method) || {}).t || '';
  const L = [];
  L.push(`# ${p.title}\n`);
  L.push(`*Field:* ${p.intake.field}  \n*Methodology:* ${methodLabel}  \n*Generated by PathFinder Research Studio*\n`);
  L.push(`## Abstract\n\n${p.abstract}\n`);
  L.push(`## Background & significance\n\n${p.background}\n`);
  L.push(`## Research gap\n\n${p.gap}\n`);
  L.push(`## Research questions\n\n${p.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n`);
  L.push(`## Methodology\n\n${p.methodology}\n`);
  L.push(`## Indicative 3-year timeline\n\n${p.timeline.map(t => `**${t.when}**\n${t.items.map(i => `- ${i}`).join('\n')}`).join('\n\n')}\n`);
  if ((p.nzAuthors || []).length) {
    L.push(`## The work behind your references is happening in New Zealand\n`);
    L.push(`Several authors of the literature cited above are based at New Zealand universities — the same campuses you could join as a doctoral researcher:\n`);
    L.push(p.nzAuthors.map(a => `- **${a.name}** — ${(a.home && a.home.uni && a.home.uni.name) || (a.home && a.home.institute) || a.institution}`).join('\n') + '\n');
  }
  if ((p.groups || []).length) L.push(`## New Zealand research groups in this space\n\n${p.groups.map(s => `- **${s.lab}** (${s.uni}) — led by ${s.lead}. ${s.hint}`).join('\n')}\n`);
  if (p.refs.length) L.push(`## References\n\n${p.refs.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n`);
  L.push(`\n---\n_Draft scaffold — verify all citations and refine with your supervisor before submission._`);
  return L.join('\n');
}

function persistResearch() {
  const rs = researchState;
  PFStore.setResearch({ intake: rs.intake, candidates: rs.candidates,
    selected: rs.selected, proposal: rs.proposal, results: rs.results,
    generatedAt: Date.now() });
}

function startDiscovery() {
  researchState.loading = true;
  researchState.error = null;
  route(); // paint the loading state
  // Lazy-load the index + this field's NZ corpus shard before searching, so it
  // anchors the results; if it fails to load the live/seed path still works.
  ensureCorpus(researchState.intake).then(() => runScholarlySearch(researchState.intake)).then(res => {
    researchState.results = res.results;
    researchState.error = res.error || null;
    researchState.source = res.source || null;
    researchState.candidates = generateCandidates(researchState.intake, res.results);
    researchState.loading = false;
    if ((location.hash || '').slice(1).split('?')[0] === 'research') route();
  });
}

function renderResearch(main) {
  const rs = researchState;
  // Most master's students are on a taught, coursework-only programme and
  // will never write a research proposal — sending them through a proposal
  // generator would waste their time and misrepresent what admission needs.
  // Research master's applicants do need one, so this is a signpost, not a
  // lock: the intake is one click away.
  if (isMasters() && !rs.started && !PFStore.getResearch()) {
    main.innerHTML = viewHead('lightbulb', 'Research Studio', 'Do you need a research proposal?',
      'Most taught master’s are coursework-only and ask for a statement of purpose, not a proposal.') +
      `<div class="card" style="max-width:680px">
        <p style="font-size:14.5px;line-height:1.6">A New Zealand master’s comes in two shapes. A <strong>taught master’s</strong>
        is coursework and assignments — admission turns on your transcript and a
        statement of purpose, and no research proposal is required. A <strong>research
        master’s or MPhil</strong> is thesis-based, and there you do need a proposal and a
        supervisor who has agreed to take you.</p>
        <p class="muted" style="font-size:13.5px;margin-top:14px">If you are not sure which
        yours is, check the qualification in the catalogue — a 120-point thesis component is
        the giveaway.</p>
        <div style="margin-top:20px;display:flex;gap:12px;flex-wrap:wrap">
          <a class="btn btn-primary" href="#kit">Write my statement of purpose</a>
          <a class="btn btn-quiet" href="#courses">Check my qualification</a>
          <button class="btn btn-quiet" id="rs-anyway">I’m applying for a research master’s</button>
        </div>
      </div>`;
    $('#rs-anyway').onclick = () => { researchState.started = true; route(); };
    return;
  }
  if (!rs.started) {
    const saved = PFStore.getResearch();
    if (saved && saved.proposal) return renderResearchLanding(main, saved);
  }
  if (rs.stage === 'proposal' && rs.proposal) return renderResearchProposal(main);
  if (rs.stage === 'discover') return renderResearchDiscover(main);
  return renderResearchIntake(main);
}

function renderResearchLanding(main, saved) {
  main.innerHTML = viewHead('lightbulb', 'Research Studio', 'Your research workspace',
    'Pick up where you left off, or start a fresh topic search.') +
    `<div class="card" style="max-width:680px">
      <span class="chip chip-teal">Saved draft</span>
      <h3 style="font-size:1.2rem;margin:10px 0 6px">${esc(saved.proposal.title)}</h3>
      <p class="muted" style="font-size:13.5px">Field: ${esc(saved.intake.field)} · saved ${new Date(saved.proposal.generatedAt).toLocaleDateString()}</p>
      <div style="margin-top:18px;display:flex;gap:12px;flex-wrap:wrap">
        <button class="btn btn-primary" id="rs-resume">Open saved proposal</button>
        <button class="btn btn-quiet" id="rs-new">Start a new topic</button>
      </div>
    </div>`;
  $('#rs-resume', main).onclick = () => {
    researchState = { stage: 'proposal', started: true, loading: false, error: null,
      intake: saved.intake, results: saved.results || { papers: [], topAuthors: [], topConcepts: [], nzAuthors: [], years: {} },
      candidates: saved.candidates || [], selected: saved.selected, proposal: saved.proposal };
    route();
  };
  $('#rs-new', main).onclick = () => {
    researchState = { stage: 'intake', intake: null, results: null, candidates: [],
      selected: null, proposal: null, loading: false, error: null, started: true };
    route();
  };
}

function renderResearchIntake(main) {
  const a = PFStore.getAssessment();
  const prefField = (currentResult() || {}).field || '';
  const prev = researchState.intake || {};
  main.innerHTML = viewHead('lightbulb', 'Research Studio', `Find your ${isMasters() ? 'thesis' : 'PhD'} topic & draft a proposal`,
    'Answer a few questions. PathFinder searches real, recent academic literature (free, no sign-up) and turns it into candidate directions and a full proposal draft.') +
    `<div class="card" style="max-width:680px">
      <div class="rs-field">
        <label class="rs-label">Your broad field</label>
        <select class="field" id="rs-fieldsel">
          ${PF_FIELDS.map(f => `<option ${(prev.field || prefField) === f ? 'selected' : ''}>${f}</option>`).join('')}
        </select>
      </div>
      <div class="rs-field">
        <label class="rs-label">What do you want to research? <span class="faint">(one sentence, your own words)</span></label>
        <textarea class="field" id="rs-topic" rows="2" placeholder="e.g. using machine learning to detect crop disease from drone imagery">${esc(prev.topic || '')}</textarea>
      </div>
      <div class="rs-field">
        <label class="rs-label">What problem or gap motivates you? <span class="faint">(optional)</span></label>
        <textarea class="field" id="rs-problem" rows="2" placeholder="e.g. smallholder farmers lack affordable early-warning tools">${esc(prev.problem || '')}</textarea>
      </div>
      <div class="rs-field">
        <label class="rs-label">Preferred methodology</label>
        <select class="field" id="rs-method">
          ${PF_RESEARCH_METHODS.map(m => `<option value="${m.v}" ${prev.method === m.v ? 'selected' : ''}>${m.t}</option>`).join('')}
        </select>
      </div>
      <div class="rs-field">
        <label class="rs-label">Extra keywords <span class="faint">(optional, comma-separated)</span></label>
        <input class="field" id="rs-keywords" placeholder="e.g. remote sensing, precision agriculture" value="${esc(prev.keywords || '')}">
      </div>
      <button class="btn btn-primary" id="rs-go" style="margin-top:8px">
        <span class="material-symbols-outlined" style="font-size:18px">search</span> Find research directions
      </button>
      <p class="faint" style="font-size:12px;margin-top:14px">Powered by the open <a href="https://openalex.org" target="_blank" rel="noopener" style="color:var(--route)">OpenAlex</a> catalogue. Drafts are a starting point — always refine with a supervisor.</p>
    </div>`;
  $('#rs-go', main).onclick = () => {
    const topic = $('#rs-topic', main).value.trim();
    if (!topic) return toast('Tell us what you want to research first');
    researchState.intake = {
      field: $('#rs-fieldsel', main).value,
      topic,
      problem: $('#rs-problem', main).value.trim(),
      method: $('#rs-method', main).value,
      keywords: $('#rs-keywords', main).value.trim(),
    };
    researchState.stage = 'discover';
    researchState.started = true;
    researchState.results = null;
    startDiscovery();
  };
}

function yearHistogram(years) {
  const xs = Object.keys(years).map(Number).sort((a, b) => a - b);
  if (!xs.length) return '';
  const max = Math.max(...xs.map(y => years[y]));
  return `<div class="rs-hist">${xs.map(y => `
    <div class="rs-hist-bar" title="${y}: ${years[y]} paper(s)">
      <span style="height:${Math.round(years[y] / max * 100)}%"></span><em>${String(y).slice(2)}</em>
    </div>`).join('')}</div>`;
}

function renderResearchDiscover(main) {
  const rs = researchState;
  if (rs.loading || !rs.results) {
    main.innerHTML = viewHead('lightbulb', 'Research Studio', 'Searching the literature…',
      'Querying the open OpenAlex catalogue for recent, highly-cited work in your area.') +
      `<div class="card" style="max-width:520px;text-align:center;padding:48px 28px">
        <div class="rs-spinner"></div>
        <p class="muted" style="margin-top:18px;font-size:14px">Reading recent papers and mapping the field…</p>
      </div>`;
    return;
  }
  const r = rs.results;
  const labs = matchLabs(rs.intake, r);
  const nzNameMap = {}; (r.nzAuthors || []).forEach(a => { nzNameMap[a.name] = a; });
  const nzChip = a => { const h = nzNameMap[a.name] && nzNameMap[a.name].home;
    const label = h && (h.uni ? h.uni.name : h.institute);
    return label ? ` <span class="chip chip-teal" style="font-size:10px">${esc(label)}</span>` : ''; };
  const nzPanel = nzOpportunityPanel(r.nzAuthors);
  const notice = rs.error
    ? `<div class="rs-notice"><span class="material-symbols-outlined" style="font-size:16px">cloud_off</span>
        Couldn't reach the literature services right now, so the directions below are built from your answers and PathFinder's NZ data. You can still generate a full proposal and add citations later.</div>`
    : (rs.source ? `<p class="faint" style="font-size:12px;margin:-8px 0 18px">Literature sourced live from ${esc(rs.source)} · ${r.papers.length} recent papers</p>` : '');
  main.innerHTML = viewHead('lightbulb', 'Research Studio', 'Candidate directions & literature map',
    `For “${esc(rs.intake.topic)}” in ${esc(rs.intake.field)}.`) +
    notice +
    `<div style="margin-bottom:24px"><button class="btn btn-quiet btn-sm" id="rs-back">← Edit answers</button></div>
     <h2 class="rs-h2">Pick a direction to expand</h2>
     <div class="grid-2" style="margin-bottom:36px">
       ${rs.candidates.map(c => `
         <div class="card rs-cand">
           <span class="chip chip-violet">${esc(c.angle)}</span>
           <h3 style="font-size:1.05rem;margin:10px 0 8px">${esc(c.title)}</h3>
           <p class="muted" style="font-size:13px">${esc(c.question)}</p>
           <button class="btn btn-primary btn-sm rs-expand" data-id="${c.id}" style="margin-top:14px">
             Expand into proposal <span class="material-symbols-outlined" style="font-size:15px">arrow_forward</span></button>
         </div>`).join('')}
     </div>` +
    nzPanel +
    (r.papers.length ? `
      <h2 class="rs-h2">Literature map</h2>
      <div class="grid-2" style="margin-bottom:24px">
        <div class="card">
          <strong style="font-size:13px">Trending sub-themes</strong>
          <div class="rs-chips">${r.topConcepts.slice(0, 10).map(c => `<span class="chip chip-dim">${esc(c.name)}</span>`).join('')}</div>
          ${yearHistogram(r.years)}
        </div>
        <div class="card">
          <strong style="font-size:13px">Most active authors</strong>
          <ul class="rs-authors">${r.topAuthors.slice(0, 8).map(a => `<li>${esc(a.name)} <span class="faint">· ${a.count}</span>${nzChip(a)}</li>`).join('')}</ul>
        </div>
      </div>
      <h2 class="rs-h2">Key recent papers</h2>
      <div style="display:flex;flex-direction:column;gap:14px;margin-bottom:28px">
        ${r.papers.slice(0, 10).map(p => `
          <div class="card rs-paper">
            <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
              <strong style="font-size:14px;flex:1;min-width:200px">${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener" style="color:var(--ink)">${esc(p.title)}</a>` : esc(p.title)}</strong>
              <span style="display:flex;gap:6px;height:fit-content">${p.isNZ ? '<span class="chip chip-teal">NZ-authored</span>' : ''}<span class="chip chip-gold">${p.citations.toLocaleString()} cites</span></span>
            </div>
            <p class="faint" style="font-size:12px;margin-top:4px">${esc(p.authors.slice(0, 3).join(', '))}${p.authors.length > 3 ? ' et al.' : ''}${p.year ? ` · ${p.year}` : ''}${p.venue ? ` · ${esc(p.venue)}` : ''}</p>
            ${p.abstract ? `<p class="muted" style="font-size:12.5px;margin-top:8px">${esc(p.abstract)}</p>` : ''}
          </div>`).join('')}
      </div>` : '') +
    (labs.length ? `
      <h2 class="rs-h2">NZ labs that fit this topic</h2>
      <div class="grid-3">
        ${labs.map(l => { const u = uniById(l.uni); return `
          <div class="card">
            <span class="chip chip-teal">${esc(u ? u.name : l.uni)}</span>
            <h3 style="font-size:1rem;margin:8px 0 4px">${esc(l.name)}</h3>
            <p class="faint" style="font-size:12.5px">${esc(l.supervisor)}</p>
            <p class="muted" style="font-size:12.5px;margin-top:8px">${esc(l.hint)}</p>
          </div>`; }).join('')}
      </div>` : '');
  $('#rs-back', main).onclick = () => { researchState.stage = 'intake'; route(); };
  $$('.rs-expand', main).forEach(b => b.onclick = () => {
    const cand = rs.candidates.find(c => c.id === b.dataset.id);
    researchState.selected = cand;
    researchState.proposal = buildProposal(rs.intake, cand, rs.results);
    researchState.stage = 'proposal';
    persistResearch();
    toast('Proposal drafted and saved');
    route();
  });
}

function renderResearchProposal(main) {
  const p = researchState.proposal;
  if (!p) { researchState.stage = 'intake'; return renderResearchIntake(main); }
  const methodLabel = (PF_RESEARCH_METHODS.find(m => m.v === p.intake.method) || {}).t || '';
  const sec = (title, body) => `<section class="rs-sec"><h3>${title}</h3>${body}</section>`;
  main.innerHTML = viewHead('lightbulb', 'Research Studio', 'Your draft proposal',
    'A structured scaffold from your answers and real literature. Refine it with a supervisor before submitting.') +
    `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:22px">
      <button class="btn btn-quiet btn-sm" id="rs-back2">← Back to directions</button>
      <button class="btn btn-primary btn-sm rs-copy"><span class="material-symbols-outlined" style="font-size:15px">content_copy</span> Copy</button>
      <button class="btn btn-quiet btn-sm rs-dl" data-fmt="md"><span class="material-symbols-outlined" style="font-size:15px">download</span> .md</button>
      <button class="btn btn-quiet btn-sm rs-dl" data-fmt="txt"><span class="material-symbols-outlined" style="font-size:15px">download</span> .txt</button>
    </div>
    <div class="card rs-proposal" style="max-width:800px">
      <div class="rs-stamps">
        <span class="chip chip-violet">${esc(p.intake.field)}</span>
        <span class="chip chip-dim">${esc(methodLabel)}</span>
        ${p.sourcedFrom ? `<span class="chip chip-gold">${p.sourcedFrom} sources cited</span>` : `<span class="chip chip-dim">offline draft</span>`}
      </div>
      <h1 class="rs-title">${esc(p.title)}</h1>
      ${sec('Abstract', `<p>${esc(p.abstract)}</p>`)}
      ${sec('Background &amp; significance', `<p>${esc(p.background)}</p>`)}
      ${sec('Research gap', `<p>${esc(p.gap)}</p>`)}
      ${sec('Research questions', `<ol class="rs-ol">${p.questions.map(q => `<li>${esc(q)}</li>`).join('')}</ol>`)}
      ${sec('Methodology', `<p>${esc(p.methodology)}</p>`)}
      ${sec('Indicative 3-year timeline', p.timeline.map(t => `<div class="rs-tl"><strong>${t.when}</strong><ul>${t.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join(''))}
      ${(p.nzAuthors || []).length ? sec('The people behind your citations — in New Zealand', `<p style="font-size:13.5px;color:var(--ink-soft);margin-bottom:12px">Several authors of the work you cite above are based at New Zealand universities — a reasonable place to start looking for a supervisor in this area.</p><ul class="rs-sup">${p.nzAuthors.map(a => { const place = (a.home && a.home.uni && a.home.uni.name) || (a.home && a.home.institute) || a.institution; return `<li><strong>${esc(a.name)}</strong>${a.cited ? ' <span class="chip chip-gold">in your citations</span>' : ''}<br><span class="faint" style="font-size:12.5px">${esc(place)}</span></li>`; }).join('')}</ul>`) : ''}
      ${(p.groups || []).length ? sec('New Zealand research groups in this space', `<ul class="rs-sup">${p.groups.map(s => `<li><strong>${esc(s.lab)}</strong> — ${esc(s.uni)}<br><span class="faint" style="font-size:12.5px">Group lead: ${esc(s.lead)}. ${esc(s.hint)}</span></li>`).join('')}</ul>`) : ''}
      ${p.refs.length ? sec('References', `<ol class="rs-refs">${p.refs.map(r => `<li>${esc(r)}</li>`).join('')}</ol>`) : `<p class="faint" style="font-size:12.5px">No external citations were fetched. Add 8–12 recent references before submitting.</p>`}
      <p class="rs-disclaimer">Draft scaffold generated by PathFinder — verify every citation and refine with your supervisor before any submission.</p>
    </div>
    ${nzOpportunityPanel(p.nzAuthors)}
    ${consultCTA('research-proposal')}`;
  $('#rs-back2', main).onclick = () => { researchState.stage = 'discover'; route(); };
}

/* Proposal copy/download — delegated once, mirrors the template handler */
document.addEventListener('click', e => {
  const cp = e.target.closest('.rs-copy'), dl = e.target.closest('.rs-dl');
  if (!cp && !dl) return;
  const p = researchState.proposal;
  if (!p) return;
  const md = proposalToMarkdown(p);
  if (cp) { navigator.clipboard.writeText(md).then(() => toast('Proposal copied to clipboard')); return; }
  const fmt = dl.dataset.fmt === 'txt' ? 'txt' : 'md';
  const blob = new Blob([md], { type: 'text/plain' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: (p.title.replace(/[^\w]+/g, '-').toLowerCase().replace(/^-+|-+$/g, '').slice(0, 60) || 'research-proposal') + '.' + fmt,
  });
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Proposal downloaded (.' + fmt + ')');
  // The single biggest thing the app produces for a student. It is already
  // auto-saved to their account — which is only worth saying to someone
  // whose account is an anonymous device session.
  softAccountPrompt({
    key: 'proposal',
    title: 'Keep your proposal draft',
    body: 'Your draft is saved, but only to this browser. An account keeps it — and lets you send it to a mentor for review from anywhere.',
  });
});

/* ── 2c · Courses (the NZQA postgraduate catalogue) ──────────
   The register itself, browsable: 1,716 current postgraduate
   qualifications across the 51 providers that teach them — 8 universities,
   14 polytechnics and 29 private colleges — indexed by the NZQA
   subject-area taxonomy. The provider list is derived from the data rather
   than from NZQA's category, because category is a poor proxy: most private
   colleges teach only certificates, but 29 of them award master's degrees.

   Search is client-side substring matching, deliberately. The Astra
   collections are configured for vector search but hold no embeddings,
   so there is no semantic option; at 1,716 rows a plain scan is instant
   anyway and works with the network off. */
/* `shown` caps how many result rows are in the DOM at once.

   Without it this view renders every match — 1,716 qualifications on "All
   subjects", which measured at 18,383 DOM nodes. Chrome's own guidance is
   under 1,500. That cost is paid again on every keystroke of the search
   box and every filter change, because each one re-renders the whole list;
   on the mid-range Android phones this audience actually uses, that is a
   visible freeze per character typed.

   Rendering the first 60 and appending on demand keeps the DOM around
   700 nodes for the common case. It is not virtualisation — rows already
   shown stay shown — because a student who has scrolled and opened a few
   courses should never have them vanish underneath them. The count is
   reset on any change to the filters, which is the only time the result
   set means something different. */
const COURSES_PAGE = 60;
let coursesState = { root: null, sub: null, q: '', level: '', type: '', org: '', open: null, shown: COURSES_PAGE };

function renderCourses(main) {
  const T = trackCfg();
  main.innerHTML = renderHero({ kicker: 'Course Catalogue', title: `Find ${T.article} that fits`,
    body: 'Loading the NZQA register…' });

  ensureCatalogue().then(cat => {
    if (!cat) {
      main.innerHTML = renderHero({ kicker: 'Course Catalogue', title: 'Course catalogue unavailable',
        body: 'Could not load the register — check your connection and refresh.' });
      return;
    }
    // First visit lands on the subject area matching the student's
    // assessment, so the catalogue opens somewhere personal.
    if (coursesState.root === null) coursesState.root = defaultCourseRoot(cat);
    paintCourses(main, cat);
  });
}

/* Subject area to open by default: the one the student's assessed field maps
   to (PF_FIELD_TO_SUBJECT_AREA), else no filter. */
function defaultCourseRoot(cat) {
  const r = currentResult();
  if (!r) return '';
  // The master's result carries the NZQA root id in `subjectArea` (its `field`
  // is the human-readable name); the PhD result carries a PF_FIELDS name.
  const root = r.subjectArea || fieldAsSubjectArea(r.field);
  return root && cat.shards[root] ? root : '';
}

/* The rows matching the current filters, always scoped to the active track's
   levels so a master's student never has to wade through doctorates. */
function coursesMatching(cat) {
  const T = trackCfg();
  const q = coursesState.q.trim().toLowerCase();
  const rows = cat.quals.filter(row => {
    if (!T.levels.includes(row.l) && !(row.l === '8 - 9' && T.levels.includes('9'))) return false;
    if (coursesState.root && !catRoots(row).includes(coursesState.root)) return false;
    if (coursesState.sub && !(row.s || []).includes(coursesState.sub)) return false;
    if (coursesState.level && row.l !== coursesState.level) return false;
    if (coursesState.type && row.y !== coursesState.type) return false;
    if (coursesState.org && !row.o.includes(coursesState.org)) return false;
    if (q && !row.t.toLowerCase().includes(q) &&
        !row.o.some(o => (catProvider(o) || {}).name?.toLowerCase().includes(q))) return false;
    return true;
  });

  /* Ordering matters more than it looks. The register is full of near-identical
     titles (the same honours degree offered by six universities is six rows,
     each with its own NZQA id), so a plain alphabetical sort opens the
     catalogue on a wall of duplicates. Leading with the qualification type the
     track is actually about — a Master's degree, or a Doctorate — puts the
     thing the student came for on the first screen, with the bridging
     qualifications below it in the order you would consider them. */
  const rank = t => {
    const i = T.qualTypes.indexOf(t);
    return i === -1 ? T.qualTypes.length : i;
  };
  return rows.sort((a, b) => rank(a.y) - rank(b.y) || a.t.localeCompare(b.t));
}

function paintCourses(main, cat) {
  const T = trackCfg();
  const rows = coursesMatching(cat);
  // Never render more rows than the student has asked to see, and never
  // fewer than one page — `shown` can outlive a filter change that shrank
  // the result set.
  const shown = Math.min(Math.max(coursesState.shown || COURSES_PAGE, COURSES_PAGE), rows.length);
  const rootName = coursesState.root ? cat.taxonomy[coursesState.root].n : null;
  const savedCount = PFStore.getSaved().filter(s => s.kind === 'course').length;

  // Never open with the catalogue's own size — that's a fact about the
  // register, not about where this student is. Lead with what they've
  // actually done (saved something) or are doing (browsing a field); the
  // register size only earns a mention as the reason to keep searching.
  const title = savedCount
    ? `${savedCount} course${savedCount === 1 ? '' : 's'} saved so far`
    : rootName ? `Browsing ${rootName}` : `Find ${T.article} programme worth applying to`;
  const body = savedCount
    ? `Keep comparing before you commit — saved courses follow you to the dashboard and roadmap.`
    : `${cat.meta.qualCount.toLocaleString()} current NZQF level ${T.levels.join(' and ')} qualifications, searchable by subject, provider and level${rootName ? `, in ${rootName}` : ''}.`;

  main.innerHTML = renderHero({
    kicker: rootName ? `Course Catalogue · ${rootName}` : 'Course Catalogue', title, body,
    figure: savedCount, figureCaption: 'Saved',
  }) +
    `<div class="crs-bar">
      <input class="crs-search" id="crs-q" type="search" placeholder="Search by qualification or provider…"
        value="${esc(coursesState.q)}" aria-label="Search courses" />
      <select class="crs-sel" id="crs-level" aria-label="Filter by level">
        <option value="">All levels</option>
        ${T.levels.map(l => `<option value="${l}" ${coursesState.level === l ? 'selected' : ''}>Level ${l}</option>`).join('')}
      </select>
      <select class="crs-sel" id="crs-type" aria-label="Filter by qualification type">
        <option value="">All types</option>
        ${T.qualTypes.map(t => `<option value="${esc(t)}" ${coursesState.type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
      </select>
      <select class="crs-sel" id="crs-org" aria-label="Filter by provider">
        <option value="">All providers</option>
        ${Object.entries(cat.providers).sort((a, b) => a[1].name.localeCompare(b[1].name))
          .map(([id, p]) => `<option value="${id}" ${coursesState.org === id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>
    </div>

    <div class="crs-rail" id="crs-rail" role="tablist" aria-label="Subject area">
      <button type="button" class="tab" role="tab" aria-selected="${!coursesState.root}" data-root="">All subjects</button>
      ${cat.roots.map(r => `<button type="button" class="tab" role="tab" aria-selected="${coursesState.root === r}"
        data-root="${r}">${esc(cat.taxonomy[r].n)} <span class="tab-n">${cat.shards[r].count}</span></button>`).join('')}
    </div>
    ${coursesState.root ? subAreaRail(cat) : ''}

    <p class="listcard-summary mt-4">${rows.length.toLocaleString()} ${rows.length === 1 ? 'qualification' : 'qualifications'}${
      shown < rows.length ? ` <span class="faint">· showing ${shown.toLocaleString()}</span>` : ''}</p>
    <div class="card-grid mt-3" id="crs-list">${rows.length
      ? rows.slice(0, shown).map(courseRow).join('')
      : '<p>Nothing matches those filters. Try widening the subject area or clearing the search.</p>'}</div>
    ${shown < rows.length ? `<div class="crs-more">
      <button type="button" class="btn btn-quiet" id="crs-more">Show ${Math.min(COURSES_PAGE, rows.length - shown)} more</button>
      <span class="faint">${(rows.length - shown).toLocaleString()} still to come — or narrow it with the filters above</span>
    </div>` : ''}

    <p class="row-sub mt-7">Source: NZQA qualifications register, synced ${esc(cat.meta.generated)}. Always confirm entry
      requirements and fees with the provider before you apply.</p>`;

  // Loading the shard fills in the prose behind each row's detail panel.
  if (coursesState.root) ensureSubjectArea(coursesState.root);

  const rerender = () => paintCourses(main, cat);
  $$('#crs-rail .tab').forEach(b => b.onclick = () => {
    coursesState.root = b.dataset.root; coursesState.sub = null; coursesState.open = null;
    coursesState.shown = COURSES_PAGE;
    rerender();
    if (coursesState.root) ensureSubjectArea(coursesState.root).then(rerender);
  });
  $$('#crs-sub .tab').forEach(b => b.onclick = () => {
    coursesState.sub = b.dataset.sub || null; coursesState.open = null;
    coursesState.shown = COURSES_PAGE; rerender();
  });
  ['level', 'type', 'org'].forEach(k => {
    const el = $('#crs-' + k);
    if (el) el.onchange = () => {
      coursesState[k] = el.value; coursesState.open = null;
      coursesState.shown = COURSES_PAGE; rerender();
    };
  });
  const search = $('#crs-q');
  let debounce;
  search.oninput = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      coursesState.q = search.value; coursesState.open = null;
      coursesState.shown = COURSES_PAGE;
      rerender();
      const s = $('#crs-q'); s.focus(); s.setSelectionRange(s.value.length, s.value.length);
    }, 220);
  };

  const more = $('#crs-more');
  if (more) more.onclick = () => {
    coursesState.shown = (coursesState.shown || COURSES_PAGE) + COURSES_PAGE;
    rerender();
    // Put focus back on the button in its new position so a keyboard or
    // screen-reader user is not dumped at the top of a longer page.
    const again = $('#crs-more');
    if (again) again.focus();
  };

  $$('#crs-list .crs-head').forEach(h => h.onclick = e => {
    if (e.target.closest('.save-btn')) return;   // saving must not toggle the panel
    const id = h.parentElement.dataset.id;
    coursesState.open = coursesState.open === id ? null : id;
    rerender();
    if (!coursesState.open) return;
    // The prose for this course lives in its subject-area shard, which is NOT
    // loaded when browsing "All subjects" — fetch it (plus the programme rows
    // that carry the only real fee figures) before painting the panel.
    const row = cat.quals.find(q => q.i === id);
    const roots = row ? catRoots(row) : [];
    Promise.all([ensureProgrammes()].concat(roots.map(ensureSubjectArea))).then(rerender);
  });
}

/* Level-2 sub-areas inside the chosen subject area, with counts — the second
   step of the drill-down. Only shows sub-areas that actually have courses. */
function subAreaRail(cat) {
  const counts = {};
  cat.quals.forEach(row => {
    if (!catRoots(row).includes(coursesState.root)) return;
    (row.s || []).forEach(s => {
      const t = catTaxon(s);
      if (!t || t.r !== coursesState.root) return;
      const l2 = t.l === 2 ? s : t.l === 3 ? t.p : null;
      if (l2) counts[l2] = (counts[l2] || 0) + 1;
    });
  });
  const subs = Object.keys(counts).sort((a, b) => catTaxon(a).n.localeCompare(catTaxon(b).n));
  if (!subs.length) return '';
  return `<div class="crs-rail crs-rail-sub" id="crs-sub" role="tablist" aria-label="Sub-area">
    <button type="button" class="tab" role="tab" aria-selected="${!coursesState.sub}" data-sub="">All of ${esc(cat.taxonomy[coursesState.root].n)}</button>
    ${subs.map(s => `<button type="button" class="tab" role="tab" aria-selected="${coursesState.sub === s}"
      data-sub="${s}">${esc(catTaxon(s).n)} <span class="tab-n">${counts[s]}</span></button>`).join('')}
  </div>`;
}

function courseRow(row) {
  const open = coursesState.open === row.i;
  const providers = row.o.map(catProvider).filter(Boolean);
  return `<div class="listcard crs-card ${open ? 'is-open' : ''}" data-id="${esc(row.i)}">
    <div class="crs-head">
      <div style="flex:1;min-width:240px">
        <h3 class="listcard-title">${esc(row.t)}</h3>
        <div class="row-sub mt-3">
          ${esc(providers.map(p => p.name).join(' · ') || 'Provider not listed')}
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span class="chip chip-neutral">Level ${esc(row.l)}</span>
        ${row.c ? `<span class="chip chip-neutral">${esc(row.c)} credits</span>` : ''}
        ${saveBtn('course', row.i, row.t, providers.map(p => p.name).join(' · '))}
        <span class="material-symbols-outlined crs-caret ${open ? 'open' : ''}" aria-hidden="true">expand_more</span>
      </div>
    </div>
    ${open ? courseDetail(row, providers) : ''}
  </div>`;
}

function courseDetail(row, providers) {
  const d = qualDetail(row);
  const progs = (window.PF_CAT_PROGRAMMES || []).filter(p => p.q === row.i && (p.intlFee || p.domesticFee));
  const sect = (label, body) => body
    ? `<div class="crs-sect"><div class="crs-lbl">${label}</div><p>${esc(body)}</p></div>` : '';

  return `<div class="crs-body">
    <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:16px">
      <span class="chip chip-ok">${esc(row.y)}</span>
      ${catRoots(row).map(r => `<span class="chip chip-neutral">${esc(catTaxon(r).n)}</span>`).join('')}
    </div>
    ${sect('Entry requirements', d.entryRequirements)}
    ${sect('What it is for', d.strategicPurposeStatement)}
    ${sect('Graduate profile', d.graduateProfile)}
    ${sect('Where it leads — further study', d.educationPathway)}

    ${progs.length ? `<div class="crs-sect">
      <div class="crs-lbl">Published fees</div>
      ${progs.map(p => `<p style="margin-bottom:6px">${esc(p.n)} —
        ${p.intlFee ? `<strong>international ${esc(p.intlFee)}</strong>` : ''}
        ${p.domesticFee ? `<span class="faint">· domestic ${esc(p.domesticFee)}</span>` : ''}</p>`).join('')}
      <p class="faint" style="font-size:12px">Published by the provider — most providers list fees on their own site only.</p>
    </div>` : `<div class="crs-sect">
      <div class="crs-lbl">Fees</div>
      <p class="muted">Not published in the NZQA register. ${isMasters()
        ? `Budget <strong>${fundsMoney(PF_CONFIG.mastersFeesIntlPerYear.lo)}–${fundsMoney(PF_CONFIG.mastersFeesIntlPerYear.hi)} a year</strong> for international master's tuition and confirm with the provider.`
        : `PhD candidates pay the domestic rate, roughly <strong>${fundsMoney(PF_CONFIG.phdFeesDomesticPerYear)} a year</strong>.`}</p>
    </div>`}

    <div class="crs-sect">
      <div class="crs-lbl">Offered by</div>
      ${providers.map(p => `<div class="crs-prov">
        <div><strong>${esc(p.name)}</strong>
          <div class="faint" style="font-size:12.5px">${esc(p.location || p.address || '')}</div></div>
        <div class="crs-prov-links">
          ${p.website ? `<a href="https://${esc(p.website.replace(/^https?:\/\//, ''))}" target="_blank" rel="noopener">Website</a>` : ''}
          ${p.email ? `<a href="mailto:${esc(p.email)}">Email</a>` : ''}
        </div>
      </div>`).join('')}
    </div>

    ${d.nzqaLink ? `<a class="btn btn-quiet btn-sm" href="${esc(d.nzqaLink)}" target="_blank" rel="noopener">
      View on NZQA <span class="material-symbols-outlined" aria-hidden="true" style="font-size:15px">open_in_new</span></a>` : ''}
    ${consultNudge(isMasters() ? 'masters-intake' : 'roadmap-supervisor')}
  </div>`;
}

/* ── 3 · Explore (providers, labs, supervisors) ──────────────
   The eight universities carry curated research detail — labs, named
   supervisors, QS rank — that nothing in the NZQA dataset can replace, so
   they stay hand-written. What the catalogue adds is the other 43 providers:
   polytechnics and private colleges that teach real postgraduate
   qualifications (Yoobee's three master's degrees, Whitecliffe's ten
   postgraduate qualifications, Media Design School's six), plus a live
   per-provider qualification count and contact details the static dataset
   never had.

   Labs and supervisors are PhD-track only: a taught master's applicant
   picks a programme, not a principal investigator. */
function renderExplore(main) {
  const T = trackCfg();
  const a = PFStore.getAssessment();
  const myField = (!isMasters() && currentResult()) ? currentResult().field : '';
  const savedCount = PFStore.getSaved().filter(s => s.kind === 'uni' || s.kind === 'lab' || s.kind === 'provider').length;

  const title = isMasters()
    ? (savedCount ? `${savedCount} provider${savedCount === 1 ? '' : 's'} on your list` : 'Where you could study')
    : myField ? `Labs working in ${myField}`
    : savedCount ? `${savedCount} lab${savedCount === 1 ? '' : 's'} shortlisted` : 'Find a supervisor who fits your research';
  const body = isMasters()
    ? 'Every New Zealand provider that teaches postgraduate qualifications — save the ones worth a closer look.'
    : myField ? `Matched to your assessment result — widen the field filter below to see the rest.`
    : 'Browse research groups across the eight NZ universities, or take the assessment to filter by field.';

  main.innerHTML = renderHero({
    kicker: isMasters() ? 'Provider Explorer' : 'Research Lab Explorer',
    title, body,
    figure: savedCount, figureCaption: 'Saved',
  }) +
    (isMasters() ? '' :
      `<div class="tab-row" id="field-filters" role="tablist" aria-label="Field">
        <button type="button" class="tab" role="tab" aria-selected="${!myField}" data-f="">All fields</button>
        ${PF_FIELDS.map(f => `<button type="button" class="tab" role="tab" aria-selected="${f === myField}" data-f="${esc(f)}">${esc(f)}</button>`).join('')}
      </div>`) +
    '<div id="explore-list"></div>';

  // Curated universities first, then the other providers the catalogue adds.
  const paint = field => {
    $('#explore-list').innerHTML =
      PF_UNIVERSITIES.filter(u => !field || u.strengths.includes(field)).map(u => uniCard(u, field)).join('') +
      polytechCards();
    $$('#explore-list .crs-head').forEach(h => h.onclick = e => {
      if (e.target.closest('.save-btn')) return;
      const id = h.parentElement.dataset.id;
      exploreOpen = exploreOpen === id ? null : id;
      paint(field);
    });
  };

  ensureCatalogue().then(() => paint(myField));
  paint(myField);

  $$('#field-filters .tab').forEach(b => b.onclick = () => {
    $$('#field-filters .tab').forEach(x => x.setAttribute('aria-selected', 'false'));
    b.setAttribute('aria-selected', 'true');
    paint(b.dataset.f);
  });
}

let exploreOpen = null;

/* Count of in-scope postgraduate qualifications a provider teaches, from the
   catalogue index. 0 until the index loads — the caller hides it then. */
function providerQualCount(orgId) {
  const cat = window.PF_CATALOGUE;
  if (!cat) return 0;
  const levels = trackCfg().levels;
  return cat.quals.filter(q => q.o.includes(orgId) && levels.includes(q.l)).length;
}

/* Resolve one of the eight curated universities to its NZQA provider id, so
   the curated card can show live counts and real contact details. */
function catOrgForUni(uni) {
  const cat = window.PF_CATALOGUE;
  if (!cat) return null;
  const m = PF_UNI_MATCH.find(x => x.id === uni.id);
  const hit = Object.entries(cat.providers).find(([, p]) => p.type === 'universities' && m && m.re.test(p.name));
  return hit ? hit[0] : null;
}

function uniCard(u, field) {
  const labs = isMasters() ? [] : PF_LABS.filter(l => l.uni === u.id && (!field || l.field === field));
  const orgId = catOrgForUni(u);
  const n = orgId ? providerQualCount(orgId) : 0;
  const p = orgId ? catProvider(orgId) : null;
  return `<div class="card" style="margin-bottom:18px">
    <div style="display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;align-items:flex-start">
      <div>
        <h3 style="font-size:1.15rem">${esc(u.name)}</h3>
        <p class="faint" style="font-size:13px;margin-top:2px">${esc(u.city)} · ${esc(u.rank)}${isMasters() ? '' : ' · ' + esc(u.phdFee)}</p>
      </div>
      ${saveBtn('uni', u.id)}
    </div>
    <p class="muted" style="font-size:13.5px;margin:10px 0 14px">${u.note}</p>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:${labs.length ? '16px' : '10px'}">
      ${u.strengths.map(s => `<span class="chip chip-neutral">${esc(s)}</span>`).join('')}
    </div>
    ${n ? `<a class="btn btn-quiet btn-sm" href="#courses">${n} ${trackCfg().label}-level qualification${n === 1 ? '' : 's'}
      <span class="material-symbols-outlined" aria-hidden="true" style="font-size:15px">arrow_forward</span></a>` : ''}
    ${p && p.website ? `<a class="btn btn-quiet btn-sm" href="https://${esc(p.website.replace(/^https?:\/\//, ''))}"
      target="_blank" rel="noopener" style="margin-left:8px">Website</a>` : ''}
    ${labs.map(l => `
      <div class="lab-row">
        <div style="flex:1;min-width:220px">
          <strong style="font-size:14px">${esc(l.name)}</strong>
          <div class="faint" style="font-size:12.5px;margin-top:2px">
            <span class="material-symbols-outlined" style="font-size:13px;vertical-align:-2px">person</span> ${esc(l.supervisor)}
            &nbsp;·&nbsp; ${l.topics.map(esc).join(' · ')}
          </div>
          <div style="font-size:12.5px;color:var(--ochre);margin-top:5px;font-family:var(--font-mono)">N.B. — ${esc(l.hint)}</div>
        </div>
        ${saveBtn('lab', l.id)}
      </div>`).join('')}
    ${labs.length ? consultCTA('roadmap-supervisor') : ''}
  </div>`;
}

/* Every other provider teaching postgraduate study — polytechnics and the
   private colleges NZQA files as PTEs. No curated research detail exists for
   them, so they render as a compact expandable list rather than pretending to
   a university card. */
function polytechCards() {
  const cat = window.PF_CATALOGUE;
  if (!cat) return '';
  const rows = Object.entries(cat.providers)
    .filter(([id, p]) => p.type !== 'universities' && providerQualCount(id) > 0)
    .sort((a, b) => providerQualCount(b[0]) - providerQualCount(a[0]) || a[1].name.localeCompare(b[1].name));
  if (!rows.length) return '';

  return `<div class="sec-head" style="margin:44px 0 18px">
      <span class="tag"><span class="material-symbols-outlined" style="font-size:14px">domain</span>Polytechnics & private colleges</span>
      <h2 style="font-size:1.35rem;margin-top:12px">${rows.length} more providers teaching postgraduate qualifications</h2>
      <p class="muted" style="font-size:13.5px;margin-top:6px">Applied and industry-facing postgraduate diplomas and master's, often with
        later application deadlines than the universities. Listed by how much postgraduate study each one teaches.</p>
    </div>` +
    rows.map(([id, p]) => {
      const n = providerQualCount(id);
      const open = exploreOpen === id;
      return `<div class="card crs-card" data-id="${esc(id)}">
        <div class="crs-head">
          <div style="flex:1;min-width:220px">
            <strong style="font-size:14.5px">${esc(p.name)}</strong>
            <div class="faint" style="font-size:12.5px;margin-top:2px">${esc(p.location || p.address || '')}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span class="chip chip-neutral">${n} qualification${n === 1 ? '' : 's'}</span>
            ${saveBtn('provider', id, p.name, p.location)}
            <span class="material-symbols-outlined crs-caret ${open ? 'open' : ''}">expand_more</span>
          </div>
        </div>
        ${open ? `<div class="crs-body">
          <div class="crs-sect">
            <div class="crs-lbl">Contact</div>
            ${p.address ? `<p>${esc(p.address)}</p>` : ''}
            ${p.phone ? `<p>${esc(p.phone)}</p>` : ''}
            <div class="crs-prov-links" style="margin-top:8px">
              ${p.website ? `<a href="https://${esc(p.website.replace(/^https?:\/\//, ''))}" target="_blank" rel="noopener">Website</a>` : ''}
              ${p.email ? `<a href="mailto:${esc(p.email)}">Email</a>` : ''}
              ${p.providerLink ? `<a href="${esc(p.providerLink)}" target="_blank" rel="noopener">NZQA profile</a>` : ''}
            </div>
          </div>
          <a class="btn btn-quiet btn-sm" href="#courses">See its qualifications
            <span class="material-symbols-outlined" aria-hidden="true" style="font-size:15px">arrow_forward</span></a>
        </div>` : ''}
      </div>`;
    }).join('');
}

/* ── 4 · Funding (scholarships + visa) ──────────────────────
   281 real scholarships from the NZQA-linked provider register, replacing
   the eight hand-written doctoral awards that shipped originally. Those
   eight are kept as PF_SCHOLARSHIPS and still render if the shard fails to
   load, so the view degrades rather than emptying.

   Master's funding is a genuinely different problem from PhD funding, and
   the copy says so: doctoral awards are largely automatic with admission
   and cover fees plus a stipend, while master's awards are competitive,
   deadline-bound, and usually discount fees only. */
let fundingState = { level: '', intlOnly: false, org: '' };

function renderFunding(main) {
  ensureScholarships().then(() => ensureCatalogue()).then(() => paintFunding(main));
  paintFunding(main);
}

/* A scholarship's deadline chip — real date math when s.closing parses to
   one (warn inside 30 days, alert once passed), a plain neutral chip with
   the provider's own text otherwise ("Refer to website" isn't a date). */
function deadlineChip(closing) {
  const ts = closing ? Date.parse(closing) : NaN;
  if (isNaN(ts)) return `<span class="chip chip-neutral">Closes: ${esc(closing || 'Refer to website')}</span>`;
  const days = Math.ceil((ts - Date.now()) / 86400000);
  const cls = days < 0 ? 'chip-alert' : days <= 30 ? 'chip-warn' : 'chip-neutral';
  const label = days < 0 ? 'Closed' : days === 0 ? 'Closes today' : `Closes in ${days}d`;
  return `<span class="chip ${cls}">${label}</span>`;
}

function paintFunding(main) {
  const T = trackCfg();
  const list = window.PF_CAT_SCHOLARSHIPS || null;
  const masters = isMasters();
  const savedCount = PFStore.getSaved().filter(s => s.kind === 'scholarship').length;

  main.innerHTML = renderHero({
    kicker: 'Scholarship & Funding Hub', title: `Fund ${T.possessive}`,
    body: masters
      ? 'Master’s scholarships discount fees, have hard deadlines, and are not automatic with admission.'
      : 'Most doctoral scholarships cover fees plus a living stipend, awarded with admission.',
    figure: savedCount, figureCaption: 'Saved',
  }) +
    fundsCheckBanner() +
    (list ? scholarshipBrowser(list) : legacyScholarships()) +

    `<div class="listcard mt-7">
      <div class="listcard-head"><h2 class="listcard-title">Latest visa updates</h2>
        <span class="listcard-summary">${masters ? 'Master’s' : 'PhD'} students</span></div>
      ${visaUpdates().map(v => `
        <div class="row">
          <span class="chip chip-info">${esc(v.tag)}</span>
          <div class="row-main">
            <div class="row-title">${esc(v.title)} <span class="row-sub">· ${esc(v.date)}</span></div>
            <div class="row-sub">${esc(v.body)}</div>
          </div>
        </div>`).join('')}
    </div>`;

  const rerender = () => paintFunding(main);
  ['level', 'org'].forEach(k => {
    const el = $('#fh-' + k);
    if (el) el.onchange = () => { fundingState[k] = el.value; rerender(); };
  });
  const intl = $('#fh-intl');
  if (intl) intl.onchange = () => { fundingState.intlOnly = intl.checked; rerender(); };
}

/* Which studyLevels tags belong to the active track. "General" and
   "Postgraduate" appear on both because providers use them as catch-alls. */
function scholarshipLevels() {
  return isMasters()
    ? ['Masters', 'Postgraduate', 'General']
    : ['PhD / Doctorate', 'Postgraduate', 'General'];
}

function scholarshipBrowser(list) {
  const cat = window.PF_CATALOGUE;
  const want = scholarshipLevels();
  const rows = list.filter(s => {
    if (!(s.levels || []).some(l => want.includes(l))) return false;
    if (fundingState.level && !(s.levels || []).includes(fundingState.level)) return false;
    if (fundingState.org && s.o !== fundingState.org) return false;
    // Sri Lankan students are international students, so a domestic-only
    // award is not merely lower priority — it is not open to them at all.
    if ((s.eligibility || {}).domesticOnly) return false;
    if (fundingState.intlOnly && !(s.eligibility || {}).internationalOnly) return false;
    return true;
  });

  // Sort by deadline: a real, parseable closing date soonest first: then
  // scholarships with an unparseable closing note ("Refer to website"); a
  // dollar figure and a specific level tag still break ties within each
  // group, since providers publish a lot of catch-all pages with neither.
  const actionable = s => {
    let score = 0;
    if ((s.values || []).some(v => /\d/.test(v.value || ''))) score -= 2;
    if ((s.levels || []).some(l => l !== 'General')) score -= 1;
    return score;
  };
  /* "Soonest first" sounds right and was wrong: a closing date in the PAST
     is the soonest date of all, so every expired award sorted above every
     live one and the screen opened on a wall of red CLOSED chips — 185
     scholarships whose single most useful property is that you can still
     apply for them, led by the ones you cannot.

     Three bands instead, in the order a student can act on them:
       0  still open      — soonest deadline first, the genuine urgency
       1  no usable date  — "refer to website", still worth a look
       2  already closed  — last, most recently closed first, because an
                            annual award that shut in March is the one most
                            likely to reopen next March. */
  const now = Date.now();
  const band = s => {
    const t = Date.parse(s.closing);
    if (isNaN(t)) return 1;
    return t >= now ? 0 : 2;
  };
  rows.sort((a, b) => {
    const ba = band(a), bb = band(b);
    if (ba !== bb) return ba - bb;
    const da = Date.parse(a.closing), db = Date.parse(b.closing);
    if (ba === 0) return da - db;   // open: soonest deadline first
    if (ba === 2) return db - da;   // closed: most recent first
    return actionable(a) - actionable(b) || a.n.localeCompare(b.n);
  });
  const openCount = rows.filter(s => band(s) === 0).length;

  const orgs = [...new Set(list.map(s => s.o))]
    .map(id => [id, cat && cat.providers[id]]).filter(([, p]) => p)
    .sort((a, b) => a[1].name.localeCompare(b[1].name));

  return `<div class="crs-bar">
      <select class="crs-sel" id="fh-level" aria-label="Filter by study level">
        <option value="">All ${isMasters() ? 'master’s-level' : 'doctoral-level'} awards</option>
        ${want.map(l => `<option value="${esc(l)}" ${fundingState.level === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}
      </select>
      <select class="crs-sel" id="fh-org" aria-label="Filter by provider">
        <option value="">All providers</option>
        ${orgs.map(([id, p]) => `<option value="${id}" ${fundingState.org === id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>
      <label class="fh-check"><input type="checkbox" id="fh-intl" ${fundingState.intlOnly ? 'checked' : ''} />
        Open to international students only</label>
    </div>
    <div class="listcard mt-3">
      <div class="listcard-head"><h2 class="listcard-title">Scholarships</h2>
        <span class="listcard-summary">${openCount
          ? `${openCount} still open · ${rows.length} total`
          : `${rows.length} awards`}</span></div>
      ${rows.length ? rows.map(s => scholarshipRow(s, cat)).join('')
        : '<p>Nothing matches those filters yet — try clearing the provider or level.</p>'}
    </div>
    <p class="row-sub mt-4">Sourced from provider scholarship pages via the NZQA register.
      Values and closing dates change every year — confirm on the provider’s own page before you rely on one.</p>`;
}

function scholarshipRow(s, cat) {
  const provider = cat && cat.providers[s.o];
  // `values` are condition-keyed: an award can be worth one thing to a
  // domestic student and another to an international one, so every
  // condition shows rather than collapsing to a single headline figure.
  const values = (s.values || []).filter(v => v.value);
  const el = s.eligibility || {};
  return `<div class="row">
      <div class="row-main">
        <div class="row-title">${esc(s.n)}</div>
        <div class="row-sub">${provider ? esc(provider.name) + ' · ' : ''}${esc((s.about || '').slice(0, 200))}${(s.about || '').length > 200 ? '…' : ''}
          ${el.other ? ` <strong>Eligibility:</strong> ${esc(el.other)}` : ''}</div>
        <div class="mt-3">
          ${values.map(v => `<span class="chip chip-ok">${esc(v.value)}${
            v.condition && v.condition !== 'NoCondition' ? ` (${esc(v.condition)})` : ''}</span>`).join('')}
          ${deadlineChip(s.closing)}
          ${el.internationalOnly ? '<span class="chip chip-info">International students</span>' : ''}
        </div>
      </div>
      <div class="row-actions">
        ${s.url ? `<a class="btn btn-quiet btn-sm" href="${esc(s.url)}" target="_blank" rel="noopener">Provider page</a>` : ''}
        ${saveBtn('scholarship', s.i, s.n, provider ? provider.name : '')}
      </div>
    </div>`;
}

/* Fallback when the scholarship shard can't load — the original eight
   curated doctoral awards, so the view is never empty. */
function legacyScholarships() {
  const a = PFStore.getAssessment();
  const cr = currentResult();
  const matched = cr && cr.schols ? new Set(cr.schols) : null;
  return `<div class="grid-2">${PF_SCHOLARSHIPS.map(s => `
    <div class="card" ${matched && matched.has(s.id) ? 'style="border-color:var(--route)"' : ''}>
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
        <h3 style="font-size:1.02rem;line-height:1.35">${esc(s.name)}</h3>
        ${saveBtn('scholarship', s.id)}
      </div>
      <div style="margin:12px 0 10px;display:flex;gap:8px;flex-wrap:wrap">
        <span class="chip chip-teal">${esc(s.value)}</span>
        <span class="chip chip-gold">Deadline: ${esc(s.deadline)}</span>
        <span class="chip chip-dim">${esc(s.fields)}</span>
      </div>
      <p class="muted" style="font-size:13.5px">${esc(s.eligibility)}</p>
      <p class="faint" style="font-size:12px;margin-top:10px">↗ ${esc(s.link)}</p>
      ${consultCTA('visa-offer')}
    </div>`).join('')}
  </div>`;
}

/* ── Visa funds-readiness check (#funds) ────────────────────────────
   A self-assessment, like the pathway assessment, but for the scariest
   visa gate: "do I have the money INZ wants to see?" A few questions →
   a readiness score, a required-vs-covered breakdown (NZ$ + LKR), the
   exact gap, genuine-funds risk flags, and tailored next steps. Pure
   client-side maths off PF_CONFIG benchmarks — no backend. Natural
   upsell to a mentor funds-evidence review + forex partner. */
let fundsState = { step: 0, answers: {}, retake: false };

/* The tuition and stipend questions are the ones that differ by track, and
   they are the ones that move the number most. A PhD candidate pays the
   domestic rate and usually holds a stipend; a master's student pays full
   international tuition and NZ has no master's stipend to hold. Asking a
   master's applicant the doctoral questions would understate their
   requirement by tens of thousands of dollars a year. */
const FUNDS_Q_PHD = [
  { id: 'tuition', q: 'Will a scholarship cover your PhD tuition?',
    help: 'International PhD students in NZ pay the domestic rate, about NZ$7–9k a year. Master\u2019s students do not — this question is about the doctoral fee.',
    opts: [
      { t: 'Yes — a scholarship covers my fees', v: 'scholarship' },
      { t: 'No — I’ll pay the domestic PhD fees myself', v: 'self' },
      { t: 'Not sure yet', v: 'unsure' },
    ] },
  { id: 'stipend', q: 'Do you have a doctoral stipend for living costs?',
    help: 'NZ doctoral scholarships often include a NZ$28–33k/yr living stipend, which INZ accepts toward your living-cost evidence.',
    opts: [
      { t: 'Yes — a full stipend (~NZ$28–33k/yr)', v: 'full' },
      { t: 'Partial / a smaller award', v: 'partial' },
      { t: 'None — I’ll show my own funds', v: 'none' },
    ] },
];

const FUNDS_Q_MASTERS = [
  { id: 'tuition', q: 'How much is your programme’s international tuition?',
    help: 'Master’s students pay FULL international fees — there is no domestic-fee concession like the one PhD candidates get. Most 180-point master’s land between NZ$32,000 and NZ$48,000 a year.',
    opts: [
      { t: 'Under NZ$35,000 a year', v: 'low' },
      { t: 'NZ$35,000–45,000 a year', v: 'mid' },
      { t: 'Over NZ$45,000 a year', v: 'high' },
      { t: 'I don’t know yet', v: 'unsure' },
    ] },
  { id: 'stipend', q: 'Do you hold a scholarship toward fees or living costs?',
    help: 'Master’s scholarships are competitive, have hard deadlines, and are not automatic with admission — unlike doctoral awards. Most cover part of the fees rather than living costs.',
    opts: [
      { t: 'Yes — a full-fees scholarship', v: 'full' },
      { t: 'A partial award', v: 'partial' },
      { t: 'None — I’m funding it myself', v: 'none' },
    ] },
];

const FUNDS_Q_COMMON = [
  { id: 'who', q: 'Who is moving to New Zealand with you?',
    help: 'INZ expects extra maintenance funds for an accompanying partner or children.',
    opts: [
      { t: 'Just me', v: 'single' },
      { t: 'Me + my partner', v: 'couple' },
      { t: 'Me + partner + children', v: 'family' },
    ] },
  { id: 'source', q: 'Where do these funds mainly come from?',
    help: 'INZ checks funds are genuine and available to you — the source changes what evidence you’ll need.',
    opts: [
      { t: 'My own savings (held for a while)', v: 'savings' },
      { t: 'A family sponsor', v: 'sponsor' },
      { t: 'An education / bank loan', v: 'loan' },
      { t: 'A scholarship body', v: 'scholarship' },
    ] },
  { id: 'timeline', q: 'When do you intend to start?',
    help: 'Funds usually need to be in place — and “seasoned” — before you apply.',
    opts: [
      { t: 'Within 3 months', v: 'lt3' },
      { t: '3–6 months', v: 'm36' },
      { t: '6–12 months', v: 'm612' },
      { t: '12+ months away', v: 'gt12' },
    ] },
];

const fundsQuestions = () => (isMasters() ? FUNDS_Q_MASTERS : FUNDS_Q_PHD).concat(FUNDS_Q_COMMON);

const fundsMoney = n => 'NZ$' + Math.round(n).toLocaleString();
const fundsLkr = n => 'LKR ' + Math.round(n * (PF_CONFIG.nzdToLkr || 185)).toLocaleString();

function computeFunds(a) {
  const C = PF_CONFIG;
  const fx = C.nzdToLkr || 185;
  const amount = Number(a.fundsAmount) || 0;
  const fundsNZD = a.fundsCurrency === 'NZD' ? amount : amount / fx;

  const masters = isMasters();
  const mf = C.mastersFeesIntlPerYear || { lo: 32000, mid: 38000, hi: 48000 };

  /* Gross tuition before any award. On the PhD track this is the domestic
     rate; on the master's track it is full international tuition, chosen
     from the band the student picked. */
  const grossTuition = masters
    ? ({ low: 33000, mid: 40000, high: 50000 }[a.tuition] || mf.mid)
    : (C.phdFeesDomesticPerYear || 8500);

  /* What an award actually covers differs by track, which is why the two
     cannot share one line. A doctoral scholarship covers fees outright and
     usually adds a living stipend; a master's award almost always discounts
     fees only, and never replaces the living-cost evidence INZ wants. */
  const tuitionCovered = masters
    ? (a.stipend === 'full' ? grossTuition : a.stipend === 'partial' ? grossTuition * 0.5 : 0)
    : (a.tuition === 'scholarship' ? grossTuition : 0);
  const tuition = Math.max(0, grossTuition - tuitionCovered);

  const depMult = (C.dependentFundsMult && C.dependentFundsMult[a.who]) || 1;
  const livingReq = (C.visaFundsPerYear || 20000) * depMult;
  const heads = a.who === 'single' ? 1 : a.who === 'couple' ? 2 : 3;
  const airfare = (C.returnAirfareBuffer || 2500) * heads;
  const requiredTotal = tuition + livingReq + airfare;

  // Only a doctoral stipend counts toward living costs — a master's fees
  // scholarship has already been applied against tuition above.
  const stipendCover = masters ? 0
    : a.stipend === 'full' ? livingReq : a.stipend === 'partial' ? livingReq * 0.5 : 0;
  const livingCovered = Math.min(stipendCover, livingReq);
  const counted = fundsNZD + livingCovered;
  const gap = Math.max(0, requiredTotal - counted);
  const ratio = requiredTotal > 0 ? counted / requiredTotal : 1;

  const flags = [];
  if (a.tuition === 'unsure' && !masters) flags.push('Confirm whether your scholarship covers tuition — it changes your total by ~' + fundsMoney(C.phdFeesDomesticPerYear || 8500) + '.');
  if (a.tuition === 'unsure' && masters) flags.push(`Get the exact tuition figure from the provider — international master's fees range from ${fundsMoney(mf.lo)} to ${fundsMoney(mf.hi)} a year, and this estimate assumes ${fundsMoney(mf.mid)}.`);
  if (masters && a.stipend === 'none') flags.push('With no award, tuition is the largest single number in your visa case — and NZ has no master’s equivalent of the doctoral stipend, so living costs must be shown from your own funds.');
  if (a.source === 'loan') flags.push('Loans need a clear approval + availability trail; INZ wants funds that are genuinely yours to use, not just promised.');
  if (a.source === 'sponsor') flags.push('A family sponsor must sign a financial undertaking and prove the money is theirs and available to you.');
  if (a.timeline === 'lt3') flags.push('Under 3 months to start — arrange and “season” your funds now (INZ prefers funds held for a period, not just deposited).');

  let penalty = 0;
  if (a.tuition === 'unsure') penalty += 5;
  if (a.source === 'loan') penalty += 8;
  if (a.source === 'sponsor') penalty += 4;
  if (a.timeline === 'lt3') penalty += 5;
  const score = Math.max(0, Math.min(100, Math.round(Math.min(1, ratio) * 100) - penalty));

  let band, bandCls, verdict;
  if (score >= 95 && gap === 0) { band = 'Visa-funds ready'; bandCls = 'chip-ok'; verdict = 'You meet the indicative funds bar. The work now is evidence, not money.'; }
  else if (score >= 75) { band = 'Nearly there'; bandCls = 'chip-warn'; verdict = 'A small gap left to close, and a workable one.'; }
  else if (score >= 45) { band = 'Notable gap'; bandCls = 'chip-info'; verdict = 'There’s a real gap to plan for — best to start now, with a clear strategy.'; }
  else { band = 'Significant gap'; bandCls = 'chip-alert'; verdict = 'A sizeable gap as things stand. Worth looking at funded routes, or a cheaper 180-point programme, before anything else.'; }

  return { fundsNZD, tuition, grossTuition, tuitionCovered, livingReq, airfare, requiredTotal,
           livingCovered, counted, gap, score, band, bandCls, verdict, flags, depMult, heads,
           track: masters ? 'masters' : 'phd' };
}

/* small CTA used on the Funding view + dashboard to enter the check */
function fundsCheckBanner() {
  const fc = PFStore.get('fundsCheck', null);
  const done = fc && fc.result;
  return `<a class="journey-nudge" href="#funds" style="margin:0 0 28px;background:var(--surface)">
    <span class="material-symbols-outlined" style="font-size:19px">savings</span>
    <span>${done
      ? `Your visa-funds readiness: <strong>${fc.result.score}% — ${esc(fc.result.band)}</strong>. Re-check anytime.`
      : `<strong>Can you meet the visa funds requirement?</strong> Take the 2-minute Funds Readiness Check and see exactly what INZ wants to see.`}</span>
    <span class="material-symbols-outlined" style="margin-left:auto;font-size:18px">arrow_forward</span>
  </a>`;
}

/* contextual CTA for the Visa Hub's Document Gathering stage (vs2), where
   funds evidence (vs2c) is compiled — the exact moment the check matters most */
function fundsStageCTA() {
  const fc = PFStore.get('fundsCheck', null);
  const done = fc && fc.result;
  return `<a class="journey-nudge" href="#funds" style="margin:16px 0 0;background:var(--surface)">
    <span class="material-symbols-outlined" style="font-size:19px">savings</span>
    <span>${done
      ? `Your funds readiness: <strong>${fc.result.score}% — ${esc(fc.result.band)}</strong>${fc.result.gap > 0 ? ` · about ${fundsMoney(fc.result.gap)} short` : ''}. Re-check before you compile your evidence.`
      : `<strong>Before you gather funds evidence,</strong> run the 2-minute Funds Readiness Check — see exactly what INZ wants to see and whether you meet it.`}</span>
    <span class="material-symbols-outlined" style="margin-left:auto;font-size:18px">arrow_forward</span>
  </a>`;
}

function renderFunds(main) {
  const saved = PFStore.get('fundsCheck', null);

  // landing on a completed check → show the result (with re-check)
  if (saved && saved.result && fundsState.step === 0 && !fundsState.retake) {
    main.innerHTML = renderHero({
      kicker: 'Funds Readiness Check', title: saved.result.band,
      body: 'How your money compares to what Immigration New Zealand expects to see.',
      figure: saved.result.score, figureSuffix: '%', figureCaption: 'Funds readiness',
      primaryLabel: 'Re-check my funds', primaryId: 'fc-redo',
      secondaryLabel: 'Detailed funds planner', secondaryHref: '#settlement',
    }) + fundsResultCard(saved.result);
    $('#fc-redo').onclick = () => { fundsState = { step: 0, answers: {}, retake: true }; route(); };
    return;
  }

  const QS = fundsQuestions();
  const i = fundsState.step;
  if (i >= QS.length) {
    // funds-amount step sits at the end (needs an input, not a radio)
    return renderFundsAmount(main);
  }
  const q = QS[i];
  const pct = Math.round((i / (QS.length + 1)) * 100);

  main.innerHTML = renderHero({
    kicker: `Funds check · ${i + 1} of ${QS.length + 1}`, title: q.q, body: q.help,
  }) +
    barHtml(pct) +
    `<div class="asm-opts mt-6">${q.opts.map((o, k) =>
      `<button type="button" class="field asm-opt" data-k="${k}" role="radio" aria-checked="false">${o.t}</button>`).join('')}
     </div>
     ${i > 0 ? `<button type="button" class="btn btn-quiet mt-5" id="fc-back">← Back</button>` : ''}`;

  $$('.asm-opt', main).forEach(b => b.onclick = () => {
    fundsState.answers[q.id] = q.opts[+b.dataset.k].v;
    fundsState.step++;
    route();
  });
  const back = $('#fc-back', main);
  if (back) back.onclick = () => { fundsState.step--; route(); };
}

function renderFundsAmount(main) {
  const a = fundsState.answers;
  const cur = a.fundsCurrency || 'LKR';
  const n = fundsQuestions().length;
  const pct = Math.round((n / (n + 1)) * 100);

  main.innerHTML = renderHero({
    kicker: `Funds check · ${n + 1} of ${n + 1}`, title: 'Roughly how much in liquid funds can you show?',
    body: 'Money you (or your sponsor) can evidence in a bank account — a rough figure is fine.',
  }) +
    barHtml(pct) +
    `<div class="fc-amount-row mt-6">
       <div class="fc-currency">
         <button type="button" class="fc-cur ${cur === 'LKR' ? 'active' : ''}" data-cur="LKR">LKR</button>
         <button type="button" class="fc-cur ${cur === 'NZD' ? 'active' : ''}" data-cur="NZD">NZ$</button>
       </div>
       <input class="field" id="fc-amount" type="number" inputmode="numeric" min="0" step="10000"
         placeholder="${cur === 'LKR' ? 'e.g. 4500000' : 'e.g. 25000'}" value="${a.fundsAmount != null ? a.fundsAmount : ''}">
     </div>
     <div class="hero-actions mt-6">
       <button type="button" class="btn" id="fc-finish">See my readiness <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span></button>
       <button type="button" class="btn btn-quiet" id="fc-back">← Back</button>
     </div>`;

  $$('.fc-cur', main).forEach(b => b.onclick = () => {
    fundsState.answers.fundsCurrency = b.dataset.cur;
    fundsState.answers.fundsAmount = $('#fc-amount').value ? Number($('#fc-amount').value) : fundsState.answers.fundsAmount;
    route();
  });
  $('#fc-back').onclick = () => { fundsState.step--; route(); };
  $('#fc-finish').onclick = () => {
    const v = Number($('#fc-amount').value);
    if (!v || v <= 0) return toast('Enter the funds you can show (a rough figure is fine)');
    fundsState.answers.fundsAmount = v;
    fundsState.answers.fundsCurrency = cur;
    const result = computeFunds(fundsState.answers);
    PFStore.set('fundsCheck', { answers: fundsState.answers, result, completedAt: Date.now() });
    fundsState = { step: 0, answers: {}, retake: false };
    route();
  };
}

function fundsResultCard(r) {
  const row = (label, nzd, strong) => `<div class="fc-row ${strong ? 'fc-row-strong' : ''}">
    <span>${label}</span><strong>${fundsMoney(nzd)} <em style="font-style:normal;color:var(--ink-dim);font-weight:400">· ${fundsLkr(nzd)}</em></strong></div>`;

  return `<div class="listcard">
    <p>${r.gap > 0 ? fundsMoney(r.gap) + ' gap to close. ' : 'Funds bar met. '}${r.verdict}</p>

    <div class="fc-break mt-6" style="padding-top:20px;border-top:1px solid var(--line)">
      <div class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px">What INZ expects to see (indicative)</div>
      ${r.track === 'masters'
        ? row('Tuition — first year (full international rate)', r.grossTuition) +
          (r.tuitionCovered > 0 ? row('Less: your scholarship toward fees', r.tuitionCovered) : '') +
          (r.tuitionCovered > 0 ? row('Tuition you must evidence', r.tuition) : '')
        : row('Tuition — first year (domestic PhD rate)', r.tuition)}
      ${row(`Living costs — 12 months${r.depMult > 1 ? ` (incl. family ×${r.depMult})` : ''}`, r.livingReq)}
      ${row(`Travel evidence buffer${r.heads > 1 ? ` (×${r.heads})` : ''}`, r.airfare)}
      ${row('Total required', r.requiredTotal, true)}
      <div class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.1em;margin:18px 0 8px">What you can cover</div>
      ${row('Your liquid funds', r.fundsNZD)}
      ${r.track === 'masters'
        ? ''
        : row('Stipend / scholarship toward living', r.livingCovered)}
      ${row('Total you can evidence', r.counted, true)}
      ${r.gap > 0 ? `<div class="fc-row fc-row-gap"><span>Shortfall</span><strong>${fundsMoney(r.gap)} · ${fundsLkr(r.gap)}</strong></div>` : ''}
    </div>

    ${r.flags.length ? `<div style="margin-top:20px;padding-top:18px;border-top:1px solid var(--line)">
      <div class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px">Make sure your funds count</div>
      <ul class="fc-flags">${r.flags.map(f => `<li><span class="material-symbols-outlined">info</span><span>${esc(f)}</span></li>`).join('')}</ul>
    </div>` : ''}

    <div style="margin-top:22px;padding-top:18px;border-top:1px solid var(--line)">
      ${r.gap > 0
        ? (r.track === 'masters'
          ? `<p style="font-size:14px;margin:0 0 12px">You’re about <strong>${fundsMoney(r.gap)}</strong> (~${fundsLkr(r.gap)}) short. Tuition is almost always the movable part: a <a href="#courses" style="color:var(--route)">180-point master’s</a> costs a full year less than a 240-point one, and <a href="#funding" style="color:var(--route)">fees scholarships</a> at some providers cut it further. A documented family sponsor and evidenced savings close the rest.</p>${partnerRow('forex')}`
          : `<p style="font-size:14px;margin:0 0 12px">You’re about <strong>${fundsMoney(r.gap)}</strong> (~${fundsLkr(r.gap)}) short. The usual routes from here: a <a href="#funding" style="color:var(--route)">doctoral scholarship with a stipend</a>, which covers fees and most living costs, a documented family sponsor, or evidenced savings built up over the months before you apply.</p>${partnerRow('forex')}`)
        : `<p style="font-size:14px;margin:0 0 12px">You meet the indicative bar. Now organise the <strong>evidence</strong>: 6 months of bank statements, your scholarship/sponsor letters, and proof the funds are available to you. Get it checked before you submit — a rejected funds case can cost you an intake.</p>`}
    </div>

    <!-- premium upsell: a mentor who passed the same check reviews the evidence -->
    <a class="nudge mt-4" href="#mentors?topic=visa-funds">
      <span class="material-symbols-outlined nudge-icon" aria-hidden="true">verified</span>
      <p class="nudge-body"><strong>Funds Evidence Review</strong> — first ${PF_CONFIG.freeIntroMinutes} min free. A postgrad who has already cleared this check looks over your bank statements and sponsor letter before you submit.</p>
    </a>

    <p class="row-sub mt-5">Figures are indicative — always confirm the current living-cost minimum, fees and dependent requirements with Immigration New Zealand and your university.</p>
  </div>`;
}

/* ── 5 · Dashboard (saved + tracker) ────────────────────── */
function appStatusChipClass(status) {
  if (status === 'Offer' || status === 'Enrolled') return 'chip-ok';
  if (status === 'Researching') return 'chip-neutral';
  return 'chip-info';
}

/* Funds evidence side card — real figures only, from the student's own
   completed Funds Readiness Check (computeFunds()). No check yet → a
   prompt, never a placeholder number. */
function fundsSidecard() {
  const fc = PFStore.get('fundsCheck', null);
  if (fc && fc.result) {
    const r = fc.result;
    return `<a class="sidecard" href="#funds">
      <span class="sidecard-kicker">Funds evidence</span>
      <div class="sidecard-figure">${fundsMoney(r.counted)}</div>
      <p>${esc(trackCfg().label)} pathway — ${fundsMoney(r.livingReq)} living costs required.</p>
      ${barHtml(r.score)}
      <div class="bar-caption">${r.score}% evidenced</div>
    </a>`;
  }
  return `<div class="sidecard">
    <span class="sidecard-kicker">Funds evidence</span>
    <p>See how your money compares to what Immigration New Zealand expects to see.</p>
    <a class="btn btn-quiet" href="#funds">Run the funds check</a>
  </div>`;
}

/* Mentor side card. The app doesn't sync a claiming mentor's name or a
   personal note back to the student's device (mentor_requests only carries
   a mentorId uid on claim — see firebase.js claimRequest) so this shows the
   real state of the student's own most recent request instead of a
   fabricated mentor identity/quote. */
function mentorSidecard(reqs) {
  const active = reqs.find(r => !['completed', 'cancelled'].includes(r.status)) || reqs[0];
  if (!active) {
    return `<div class="sidecard">
      <span class="sidecard-kicker">Mentors</span>
      <p>Stuck on a step? Ask someone who has already done it — your first ${PF_CONFIG.freeIntroMinutes} minutes are free.</p>
      <a class="btn btn-quiet" href="#mentors">Ask a mentor</a>
    </div>`;
  }
  const cls = { open: 'chip-warn', claimed: 'chip-info', intro_done: 'chip-info',
    awaiting_payment: 'chip-warn', paid: 'chip-ok', completed: 'chip-ok', cancelled: 'chip-neutral' };
  const lbl = { open: 'Open', claimed: 'Claimed', intro_done: 'Intro done',
    awaiting_payment: 'Awaiting payment', paid: 'Paid', completed: 'Completed', cancelled: 'Cancelled' };
  return `<a class="sidecard" href="#mentors?tab=mine">
    <span class="sidecard-kicker">Your mentor request</span>
    <div class="sidecard-name">${esc(PF_CONSULT_TOPICS[active.topic] || 'General guidance')}</div>
    <p>${active.note ? esc(active.note) : 'Track replies and next steps in Mentors → My requests.'}</p>
    <span class="chip ${cls[active.status] || 'chip-neutral'}">${lbl[active.status] || active.status}</span>
  </a>`;
}

/* Advisory panel — the visa checklist's next open step when one exists
   (a real blocking, ordered sequence), else a generic mentor hook. */
function advisoryNudge(vp) {
  const stage = PF_VISA_STAGES.find(s => s.steps.some(st => !PFStore.isChecked('visa', st.id)));
  if (vp.done > 0 && stage) {
    const step = stage.steps.find(st => !PFStore.isChecked('visa', st.id));
    return `<a class="nudge" href="#visa">
      <span class="material-symbols-outlined nudge-icon" aria-hidden="true">flight_takeoff</span>
      <p class="nudge-body">Visa ${vp.done} of ${vp.total} steps. ${esc(step.t)}${step.note ? ' — ' + esc(step.note) : '.'}</p>
    </a>`;
  }
  return `<a class="nudge" href="#mentors">
    <span class="material-symbols-outlined nudge-icon" aria-hidden="true">support_agent</span>
    <p class="nudge-body">Stuck on your next step? A mentor's first ${PF_CONFIG.freeIntroMinutes} minutes are free.</p>
  </a>`;
}

/* ── The dashboard before there is anything to put on it ──────────────
   #dashboard is the app's default route AND the landing page's "Open the
   dashboard" CTA, so it is the first screen a large share of visitors
   ever see. Rendered in full on a cold start it is four zeroes, a "—%"
   readiness figure and an empty application tracker wrapped around the
   one action that actually starts the journey — five pieces of evidence
   that the product is empty, competing with the invitation.

   Until there is a result to put on it, the dashboard IS the invitation:
   one action, an honest account of what the next five minutes produce,
   and a way back in for someone who has been here before. Everything
   below returns as soon as an assessment exists. */
function renderFirstRun(main) {
  const T = trackCfg();
  const signedIn = !!(window.PFCloud && PFCloud.isSignedIn && PFCloud.isSignedIn());
  const steps = [
    ['quiz', 'Answer seven questions',
      'Your background, your subject, your English score and your budget. About five minutes, no account needed.'],
    ['route', 'Get the route that fits you',
      isMasters()
        ? 'Direct entry, a postgraduate diploma, or a bridging qualification first — named, with how ready you are for it.'
        : 'Whether you go straight to a doctorate or strengthen your research profile first — named, with how ready you are for it.'],
    [isMasters() ? 'school' : 'science',
      isMasters() ? 'See the qualifications you can actually apply for' : 'See the labs and supervisors worth writing to',
      isMasters()
        ? 'Your answers filter the NZQA postgraduate register down to real qualifications at real providers, with entry requirements and fees.'
        : 'Matched research groups with named supervisors, plus the scholarships your field is eligible for.'],
  ];

  main.innerHTML = renderHero({
    kicker: 'Start here',
    title: `Let’s find your ${T.label.toLowerCase()} route into New Zealand`,
    body: 'Nothing here is filled in yet — the assessment is what builds your roadmap, your course matches and your funding list. It takes about five minutes.',
    primaryLabel: 'Start the assessment', primaryIcon: 'arrow_forward', primaryHref: '#assessment',
    secondaryLabel: isMasters() ? 'Browse the catalogue first' : 'Look around first',
    secondaryHref: isMasters() ? '#courses' : '#explore',
  }) +
    `<div class="viewgrid mt-6">
      <div>
        <div class="listcard">
          <div class="listcard-head"><h2 class="listcard-title">What the next five minutes give you</h2></div>
          ${steps.map(([icon, title, body], i) => `<div class="row">
            <div class="row-main">
              <div class="row-title"><span class="material-symbols-outlined" aria-hidden="true"
                style="font-size:17px;vertical-align:-3px;margin-right:8px;color:var(--route)">${icon}</span>${esc(title)}</div>
              <div class="row-sub">${esc(body)}</div>
            </div>
            <div class="row-actions"><span class="chip chip-neutral">${i + 1}</span></div>
          </div>`).join('')}
        </div>
      </div>
      <div class="aside">
        <div class="sidecard">
          <span class="sidecard-kicker">Your track</span>
          <p>You’re on the <strong>${esc(T.label)}</strong> track — fees, funding, visa money and deadlines all follow from it.</p>
          <button type="button" class="btn btn-quiet mt-4" id="fr-switch">Switch to ${esc(PF_TRACK[isMasters() ? 'phd' : 'masters'].label)}</button>
        </div>
        ${cloudOn() && !signedIn ? `<div class="sidecard">
          <span class="sidecard-kicker">Been here before?</span>
          <p>Sign in and your assessment, roadmap and saved shortlist come back on this device.</p>
          <a class="btn btn-quiet mt-4" href="${accountHref('dashboard')}">
            <span class="material-symbols-outlined" aria-hidden="true">login</span> Sign in</a>
        </div>` : ''}
        <div class="sidecard">
          <span class="sidecard-kicker">Rather ask a person?</span>
          <p>Mentors are Sri Lankan postgrads already studying in New Zealand. The first ${PF_CONFIG.freeIntroMinutes} minutes are free.</p>
          <a class="btn btn-quiet mt-4" href="#mentors">See the mentor network</a>
        </div>
      </div>
    </div>`;

  $('#fr-switch').onclick = () => switchTrack(isMasters() ? 'phd' : 'masters');
}

function renderDashboard(main) {
  const apps = PFStore.getApps();
  const ST = PFStore.APP_STATUSES;
  const vp = visaProgress();
  const reqs = PFStore.getMentorRequests().slice().reverse();
  const offers = apps.filter(x => ['Offer', 'Enrolled'].includes(x.status)).length;
  const saved = PFStore.getSaved();
  const R = currentResult();
  const T = trackCfg();

  // Cold start — nothing saved anywhere, so every metric below would render
  // as a zero and the tracker as an empty form. Show the invitation instead.
  // A student who skipped the assessment but has already shortlisted a
  // course or started the visa checklist has real state here, so they get
  // the real dashboard: the test is "is there anything to show?", not
  // "did they take the assessment?".
  // The funds check and a saved cost plan count as state too. They did not
  // before, and the profile strip made that visibly wrong: the strip could
  // read "74% ready" while the hero directly beneath it said "nothing here
  // is filled in yet". If a student has told us their money situation,
  // this is not a cold start.
  const fundsDone = !!(PFStore.get('fundsCheck', null) || {}).result;
  const costDone = !!PFStore.get('roiPlan', null);
  if (!R && !apps.length && !saved.length && !vp.done && !reqs.length && !fundsDone && !costDone) {
    return renderFirstRun(main);
  }

  const next = highestPriorityIncompleteStep();

  main.innerHTML = renderHero({
    kicker: next.kicker, title: next.title, body: next.body,
    figure: R ? R.readiness : '—', figureSuffix: R ? '%' : '', figureCaption: T.label + '-ready',
    primaryLabel: next.primaryLabel, primaryHref: next.primaryHref,
    secondaryLabel: 'Ask a mentor', secondaryHref: next.consultTopic ? `#mentors?topic=${next.consultTopic}` : '#mentors',
    segments: heroSegments(journeyModel()),
  }) +

    `<div class="stat-grid" style="margin:24px 0">
      <a class="stat" href="${isMasters() ? '#courses' : '#explore'}">
        <span class="material-symbols-outlined stat-icon" aria-hidden="true">bookmark</span>
        <div class="stat-figure">${saved.length}</div>
        <div class="stat-label">Saved</div>
      </a>
      <a class="stat" href="#dashboard">
        <span class="material-symbols-outlined stat-icon" aria-hidden="true">folder_managed</span>
        <div class="stat-figure">${apps.length}</div>
        <div class="stat-label">Applications</div>
      </a>
      <a class="stat" href="#dashboard">
        <span class="material-symbols-outlined stat-icon" aria-hidden="true">workspace_premium</span>
        <div class="stat-figure">${offers}</div>
        <div class="stat-label">Offer${offers === 1 ? '' : 's'}</div>
      </a>
      <a class="stat" href="#visa">
        <span class="material-symbols-outlined stat-icon" aria-hidden="true">flight_takeoff</span>
        <div class="stat-figure">${vp.done}/${vp.total}</div>
        <div class="stat-label">Visa steps</div>
      </a>
    </div>

    <div class="viewgrid">
      <div>
        <div class="listcard" style="margin-bottom:16px">
          <div class="listcard-head"><h2 class="listcard-title">Track a new application</h2></div>
          <div class="form-row">
            <div><span class="field-label">University / programme</span>
              <input class="field" id="app-uni" placeholder="e.g. UoA — ${isMasters() ? 'MDataSci' : 'PhD Computer Science'}"></div>
            <div><span class="field-label">Supervisor</span>
              <input class="field" id="app-sup" placeholder="Prof. ..."></div>
            <div><span class="field-label">Status</span>
              <select class="field" id="app-status">${ST.map(s => `<option>${s}</option>`).join('')}</select></div>
            <button type="button" class="btn btn-quiet" id="app-add">Add</button>
          </div>
        </div>

        <div class="listcard">
          <div class="listcard-head">
            <h2 class="listcard-title">Applications</h2>
            <span class="listcard-summary">${apps.length} tracked${offers ? ` · ${offers} offer${offers === 1 ? '' : 's'}` : ''}</span>
          </div>
          <div id="app-list">${apps.length ? apps.map(appRow).join('') :
            '<p>No applications yet — add your first one above. Every supervisor email counts as “Contacted Supervisor”.</p>'}</div>
        </div>
      </div>

      <div class="aside">
        ${fundsSidecard()}
        ${mentorSidecard(reqs)}
        ${advisoryNudge(vp)}
      </div>
    </div>`;

  function appRow(app) {
    const pct = Math.round(((ST.indexOf(app.status) + 1) / ST.length) * 100);
    return `<div class="row" data-app="${app.id}">
      <div class="row-main">
        <div class="row-title">${esc(app.uni)}</div>
        <div class="row-sub">${esc(app.supervisor || 'No supervisor listed')} · ${pct}%</div>
      </div>
      <div class="row-actions">
        <select class="field app-status-sel" aria-label="Status for ${esc(app.uni)}">
          ${ST.map(s => `<option ${s === app.status ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <span class="chip ${appStatusChipClass(app.status)}">${esc(app.status)}</span>
        <button type="button" class="icon-btn app-del" title="Delete" aria-label="Delete ${esc(app.uni)}">
          <span class="material-symbols-outlined" aria-hidden="true">delete</span>
        </button>
      </div>
    </div>`;
  }

  $('#app-add').onclick = () => {
    const uni = $('#app-uni').value.trim();
    if (!uni) return toast('Enter a university or program name');
    PFStore.upsertApp({ uni, supervisor: $('#app-sup').value.trim(), status: $('#app-status').value });
    toast('Application added');
    route();
    // After the re-render, so the prompt sits over the updated list rather
    // than the form they just submitted. A real application, with a real
    // deadline behind it, is the point at which losing this device stops
    // being an inconvenience.
    softAccountPrompt({
      key: 'application',
      title: 'Don’t track this on one device',
      body: 'You’re tracking a live application now. An account means it — and its status — survives a lost phone, a reinstalled browser, or a switch to a laptop.',
    });
  };
  $('#app-list').addEventListener('change', e => {
    const sel = e.target.closest('.app-status-sel');
    if (!sel) return;
    const id = sel.closest('[data-app]').dataset.app;
    const app = PFStore.getApps().find(x => x.id === id);
    app.status = sel.value;
    PFStore.upsertApp(app);
    toast('Status updated');
    route();
  });
  $('#app-list').addEventListener('click', e => {
    const d = e.target.closest('.app-del');
    if (!d) return;
    PFStore.deleteApp(d.closest('[data-app]').dataset.app);
    toast('Application removed');
    route();
  });
}

/* ── 6 · Starter Kit ────────────────────────────────────── */
function renderKit(main) {
  // Gate the advanced templates behind Explorer/Premium — but only when
  // the cloud (accounts/orders) is configured. Offline/static deploys keep
  // every template free, preserving the original behaviour.
  const premiumIds = (PF_CONFIG.premiumTemplateIds || []);
  const gate = cloudOn() && premiumIds.length > 0;
  const unlocked = !gate || entitlements().toolkit === true;
  const price = (PF_CONFIG.pricing && PF_CONFIG.pricing.explorer) || 0;
  // What else Explorer includes, read from the one grants table rather than
  // restated here — so a change to the plan can't leave this card lying.
  const eg = (PF_CONFIG.planGrants && PF_CONFIG.planGrants.explorer) || {};
  const explorerExtras = [
    eg.sessions ? `${eg.sessions} mentor session${eg.sessions === 1 ? '' : 's'}` : '',
    eg.audits ? (eg.fullAudit ? 'a full CV/SOP/proposal audit' : 'an SOP/proposal audit') : '',
  ].filter(Boolean).join(' and ');

  const freeCard = t => `<div class="card">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
        <div style="width:40px;height:40px;border-radius:11px;background:var(--teal-soft);display:flex;align-items:center;justify-content:center">
          <span class="material-symbols-outlined" style="color:var(--route);font-size:20px">${t.icon}</span>
        </div>
        <div><strong style="font-size:14.5px">${t.name}</strong>
          <div class="faint" style="font-size:12px">${t.type}</div></div>
      </div>
      <pre class="tpl-preview">${esc(t.body)}</pre>
      <div style="display:flex;gap:10px;margin-top:14px">
        <button class="btn btn-primary btn-sm tpl-dl" data-id="${t.id}">
          <span class="material-symbols-outlined" style="font-size:15px">download</span> Download .txt</button>
        <button class="btn btn-quiet btn-sm tpl-copy" data-id="${t.id}">
          <span class="material-symbols-outlined" style="font-size:15px">content_copy</span> Copy</button>
      </div>
    </div>`;

  const lockedCard = t => `<div class="card locked-card">
      <span class="chip chip-gold lock-chip"><span class="material-symbols-outlined" style="font-size:13px;vertical-align:-2px">lock</span> Premium</span>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
        <div style="width:40px;height:40px;border-radius:11px;background:var(--gold-soft);display:flex;align-items:center;justify-content:center">
          <span class="material-symbols-outlined" style="color:var(--ochre);font-size:20px">${t.icon}</span>
        </div>
        <div><strong style="font-size:14.5px">${t.name}</strong>
          <div class="faint" style="font-size:12px">${t.type}</div></div>
      </div>
      <p class="muted" style="font-size:13px;margin:0 0 14px">Part of the <strong>Explorer</strong> plan — unlock all ${premiumIds.length} advanced templates${explorerExtras ? ' plus ' + explorerExtras : ''}.</p>
      <button class="btn btn-primary btn-sm pf-buy" data-item="explorer" style="width:100%;justify-content:center">
        <span class="material-symbols-outlined" style="font-size:15px">lock_open</span> Unlock with Explorer · LKR ${price.toLocaleString()}</button>
    </div>`;

  const banner = (gate && !unlocked) ? `<div class="card" style="margin-bottom:24px;border-color:var(--ochre);display:flex;gap:14px;flex-wrap:wrap;align-items:center">
      <span class="material-symbols-outlined" style="color:var(--ochre)">workspace_premium</span>
      <p style="flex:1;min-width:220px;font-size:13.5px;margin:0">${PF_TEMPLATES.length - premiumIds.length} templates are free. Unlock the ${premiumIds.length} advanced ones (research proposal, interview prep, 3-year plan, budgets &amp; more) with the <strong>Explorer</strong> plan.</p>
      <a class="btn btn-quiet btn-sm" href="#pricing">See plans</a>
    </div>` : '';

  // Track-specific templates (the master's statement of purpose, the
  // programme comparison sheet) carry a `track` tag and are shown only on
  // that track. Untagged templates — CVs, visa checklists, budgets — serve
  // both and always show.
  const templates = PF_TEMPLATES.filter(t => !t.track || t.track === PFStore.getTrack());
  const locked = gate && !unlocked;

  main.innerHTML = renderHero({
    kicker: `${trackCfg().label} Starter Kit`,
    title: locked ? 'Free templates to start with' : 'Templates ready to adapt',
    body: locked
      ? `${templates.length - premiumIds.length} are free to use right now — the advanced set unlocks with Explorer.`
      : 'Preview, copy, or download each one, then rewrite it in your own words before you send it anywhere.',
  }) +
    banner +
    `<div class="grid-2">${templates.map(t => {
      const isPremium = gate && premiumIds.includes(t.id);
      return (isPremium && !unlocked) ? lockedCard(t) : freeCard(t);
    }).join('')}</div>`;

  // entitlements not yet resolved this session → fetch, then repaint #kit
  if (gate && !entState.loaded) loadEntitlements(() => {
    if (location.hash.slice(1).split('?')[0] === 'kit') route();
  });
}

/* buy buttons (premium unlocks) — delegated once */
document.addEventListener('click', e => {
  const b = e.target.closest('.pf-buy');
  if (!b) return;
  PFPay.startOrder(b.dataset.item, () => loadEntitlements(() => route()));
});

/* ── 7 · Visa Hub ───────────────────────────────────────── */
function visaProgress() {
  const all = PF_VISA_STAGES.flatMap(s => s.steps.map(st => st.id));
  const done = all.filter(id => PFStore.isChecked('visa', id)).length;
  return { done, total: all.length };
}

/* ── Government data (assets/js/govt-data.js) ───────────────────────────
   Three published New Zealand government datasets, generated by
   scripts/sync-govt-data.js: Immigration NZ's student and work visa
   decision tables, and MBIE's rental bond medians.

   Loaded the same lazy way as the catalogue shards and NZQA's provider
   record — ~17 KB, and only #visa, #cost and #settlement want it, so the
   dashboard's first paint never fetches it. Resolves false when the file
   is missing so every caller degrades to showing nothing at all rather
   than to showing a blank where a number should be. */
/* ── Deferred bundles ───────────────────────────────────────────────────
   Everything below used to be a plain <script> tag in app.html, so every
   visitor downloaded and parsed all of it before the app would run —
   including a PDF writer they will use only if they buy something, a cost
   model only the master's #cost screen touches, and four Settle In tools
   behind a tab most sessions never open.

   Together that is ~43 KB gzipped (~110 KB parsed) on the critical path of
   the landing → dashboard → courses funnel, which is where nearly all the
   traffic is. Now each one loads the first time a view actually needs it.

   The pattern is the same as ensureCatalogue()/ensureProviderQuality():
   one cached promise per bundle, resolved through _loadScript(), with the
   caller re-rendering when it lands. Order matters for the cost model —
   roi.js reads PF_ROI at call time, so its data file is loaded first. */
function _ensureBundle(state, files, test) {
  if (test()) return Promise.resolve(true);
  if (state.p) return state.p;
  state.p = files.reduce((chain, f) => chain.then(() => _loadScript(f)), Promise.resolve())
    .then(() => test())
    .catch(() => false);
  return state.p;
}

const _roiState = {};
function ensureRoi() {
  return _ensureBundle(_roiState, ['assets/js/roi-data.js', 'assets/js/roi.js'],
    () => typeof PF_ROI !== 'undefined' && typeof PFRoi !== 'undefined');
}

const _invoiceState = {};
function ensureInvoice() {
  // `const PFInvoice` is script-scoped, not a property of window — same trap
  // as PF_ROI, so test the binding rather than a window key.
  return _ensureBundle(_invoiceState, ['assets/js/invoice.js'],
    () => typeof PFInvoice !== 'undefined');
}

const _settleState = {};
function ensureSettlementTools() {
  return _ensureBundle(_settleState, [
    'assets/js/settlement/scene3d.js',
    'assets/js/settlement/funds-planner.js',
    'assets/js/settlement/buying-power.js',
    'assets/js/settlement/first-months.js',
  ], () => !!(window.PFFunds && window.PFBuying && window.PFFirstMonths));
}

let _govtPromise = null;
function ensureGovtData() {
  if (window.PF_GOVT) return Promise.resolve(false);
  if (_govtPromise) return _govtPromise;
  _govtPromise = _loadScript('assets/js/govt-data.js')
    .then(() => !!window.PF_GOVT)
    .catch(() => false);
  return _govtPromise;
}

/* Re-route once the file lands, but only if the student is still on the
   view that asked for it — the same guard ensureProviderQuality() uses. */
function govtRefresh(view) {
  ensureGovtData().then(loaded => {
    if (loaded && location.hash.slice(1).split('?')[0] === view) route();
  });
}

function govtLatest(series) { return (series && series.length) ? series[series.length - 1] : null; }
function govtRate(row) { const n = row.a + row.d; return n ? (row.a / n) * 100 : 0; }
function govtFY(y) { return y ? y.replace('/', '–') : ''; }

/* Attribution, printed next to the numbers rather than buried in a
   footer. Both publishers licence reuse on condition of credit — MBIE
   under CC BY 3.0 NZ, Immigration NZ under NZGOAL — so this line is a
   licence term, not decoration. It also names the date the file was
   prepared, because a visa statistic with no date is worthless. */
function govtSourceLine(block, extra) {
  if (!block) return '';
  const when = block.preparedOn ? `, prepared ${esc(block.preparedOn)}`
             : block.asOf ? `, ${esc(block.asOf)}` : '';
  return `<p class="govt-src">Source: <a href="${esc(block.srcUrl)}" target="_blank" rel="noopener">${esc(block.src)}</a>${when} —
    ${esc(block.attribution)}. Reproduced under ${esc(block.licence)}; PathFinder is not endorsed by either agency.
    ${extra ? esc(extra) : ''}</p>`;
}

/* A ten-year trend as ten bars. Not a chart library and not a sparkline:
   the number that matters is printed, and these only carry the shape of
   the last decade so "the highest in ten years" can be seen rather than
   claimed. Each bar is labelled for screen readers and on hover. */
function govtTrendBars(series, valueOf, fmt) {
  const vals = series.map(valueOf);
  const max = Math.max(...vals) || 1;
  return `<div class="govt-bars" role="img" aria-label="${esc(series.map((r, i) =>
      `${govtFY(r.y)} ${fmt(vals[i])}`).join('; '))}">
    ${series.map((r, i) => {
      const last = i === series.length - 1;
      return `<span class="govt-bar ${last ? 'is-now' : ''}" title="${esc(govtFY(r.y) + ' — ' + fmt(vals[i]))}">
        <span style="height:${Math.max(3, Math.round(vals[i] / max * 100))}%"></span>
      </span>`;
    }).join('')}
  </div>
  <div class="govt-bars-axis"><span>${esc(govtFY(series[0].y))}</span><span>${esc(govtFY(series[series.length - 1].y))}</span></div>`;
}

/* ── #visa · what actually happens to applications like yours ───────────
   The most common thing a Sri Lankan applicant has been told — by an
   agent, a cousin, a Facebook group — is that New Zealand is hard to get
   into. Immigration New Zealand publishes the answer and has done for a
   decade; nobody in this market puts it in front of the student.

   The headline stays FREE, deliberately and for the same reason the
   total-cost verdict in #cost is free: a person deciding whether to
   spend their family's savings should not have to pay to find out what
   the government's own file says about their odds. What Premium buys is
   the analysis on top — which route declines most, and how Sri Lanka
   compares with the countries an agent will have name-dropped.

   The decline count is printed as prominently as the approval rate, and
   the publisher's own caveat about what "declined" includes is printed
   under it. A 91.8% that quietly hides its denominator would be exactly
   the sales copy this platform exists to replace. */
function visaOddsCard(unlocked) {
  const g = window.PF_GOVT;
  if (!g || !g.studentVisa || !g.studentVisa.byNationality) return '';
  const sv = g.studentVisa;
  const lk = sv.byNationality.LK;
  if (!lk || !lk.series.length) return '';

  const now = govtLatest(lk.series);
  const rate = govtRate(now);
  const decided = now.a + now.d;
  const best = lk.series.reduce((m, r) => govtRate(r) > govtRate(m) ? r : m, lk.series[0]);
  const isBest = best.y === now.y;

  return `<div class="listcard govt-card">
    <div class="listcard-head">
      <h2 class="listcard-title">What happens to Sri Lankan applications</h2>
      <span class="chip chip-ok">Official figures</span>
    </div>

    <div class="govt-headline">
      <div class="govt-figure">
        <strong>${rate.toFixed(1)}%</strong>
        <span>approved in ${esc(govtFY(now.y))}</span>
      </div>
      <div class="govt-split">
        <div><span class="govt-n">${now.a.toLocaleString()}</span><span class="govt-l">approved</span></div>
        <div><span class="govt-n">${now.d.toLocaleString()}</span><span class="govt-l">declined</span></div>
        <div><span class="govt-n">${decided.toLocaleString()}</span><span class="govt-l">decided in total</span></div>
      </div>
    </div>

    <p class="mt-3">${isBest
      ? `That is the highest approval rate for Sri Lankan applicants in the ten years Immigration New Zealand has published, and the largest number of applications decided.`
      : `Approval rates for Sri Lankan applicants have moved between ${Math.min(...lk.series.map(govtRate)).toFixed(0)}% and ${Math.max(...lk.series.map(govtRate)).toFixed(0)}% over the last ten years.`}</p>

    ${govtTrendBars(lk.series, r => r.a + r.d, v => v.toLocaleString() + ' decided')}

    <div class="roi-basis">
      <p><strong>Read it honestly.</strong> ${esc(sv.note)} So this is what happened to applications
        like yours — not a prediction about yours, and not a substitute for meeting the requirements
        in the checklist below.</p>
      ${govtSourceLine(sv)}
    </div>

    ${unlocked ? visaOddsDetail(sv) : `<div class="govt-locked">
      <span class="chip chip-gold"><span class="material-symbols-outlined" style="font-size:13px;vertical-align:-2px">lock</span> Premium</span>
      <p class="mt-3"><strong>Which route you apply under changes the odds.</strong> The same file breaks
        decisions down by application criteria — full fee paying, pathway, English language, scholarship —
        and those routes do not decline at the same rate. Premium shows that breakdown, plus how Sri Lanka
        compares with the five countries an agent will have already told you about.</p>
      <a class="btn btn-quiet btn-sm mt-3" href="#pricing">See what Premium includes</a>
    </div>`}
  </div>`;
}

/* The Premium half: the criteria table and the peer comparison. Both are
   straight out of the same published file — no scoring, no ranking, no
   PathFinder opinion laid over the top. */
function visaOddsDetail(sv) {
  const crit = (sv.byCriteria || [])
    .map(c => ({ label: c.label, now: govtLatest(c.series) }))
    .filter(c => c.now && (c.now.a + c.now.d) >= 50)
    .sort((a, b) => govtRate(b.now) - govtRate(a.now));

  const peers = Object.keys(sv.byNationality)
    .map(k => ({ code: k, label: sv.byNationality[k].label, now: govtLatest(sv.byNationality[k].series) }))
    .filter(p => p.now)
    .sort((a, b) => govtRate(b.now) - govtRate(a.now));

  const bar = (pct, mine) => `<span class="govt-rate"><span class="govt-rate-fill ${mine ? 'is-mine' : ''}"
      style="width:${pct.toFixed(1)}%"></span></span>`;

  return `<div class="govt-detail">
    <h3 class="govt-h3">By the route you apply under</h3>
    <p class="govt-note">All nationalities, ${esc(govtFY(crit.length ? crit[0].now.y : ''))}. A route is only shown
      where at least 50 applications were decided.</p>
    <table class="ledger govt-table"><tbody>
      ${crit.map(c => `<tr>
        <td>${esc(c.label)}</td>
        <td class="govt-td-bar">${bar(govtRate(c.now), false)}</td>
        <td class="govt-td-n">${govtRate(c.now).toFixed(1)}%</td>
        <td class="govt-td-n govt-faint">${(c.now.a + c.now.d).toLocaleString()} decided</td>
      </tr>`).join('')}
    </tbody></table>

    <h3 class="govt-h3">How Sri Lanka compares</h3>
    <p class="govt-note">Student visa approval rate, ${esc(govtFY(peers.length ? peers[0].now.y : ''))}.</p>
    <table class="ledger govt-table"><tbody>
      ${peers.map(p => `<tr class="${p.code === 'LK' ? 'is-mine' : ''}">
        <td>${esc(p.label)}</td>
        <td class="govt-td-bar">${bar(govtRate(p.now), p.code === 'LK')}</td>
        <td class="govt-td-n">${govtRate(p.now).toFixed(1)}%</td>
        <td class="govt-td-n govt-faint">${(p.now.a + p.now.d).toLocaleString()} decided</td>
      </tr>`).join('')}
    </tbody></table>
  </div>`;
}

function renderVisa(main) {
  const { done, total } = visaProgress();
  const firstOpen = PF_VISA_STAGES.find(s => s.steps.some(st => !PFStore.isChecked('visa', st.id)));
  const T = trackCfg();

  const title = done === 0 ? 'Start your visa file'
    : done >= total ? 'Visa checklist — all done'
    : `Next — ${firstOpen.title}`;
  const body = done === 0
    ? `Eight stages, each one unlocking the next — here's where ${T.article} student in Sri Lanka starts.`
    : done >= total
      ? 'Every stage is checked off. Keep your confirmations somewhere safe for arrival.'
      : firstOpen.summary;

  main.innerHTML = renderHero({
    kicker: 'NZ Student Visa Hub', title, body,
    figure: total ? Math.round(done / total * 100) : 0, figureSuffix: '%', figureCaption: `${done}/${total} steps done`,
  }) +
    `<div class="viewgrid">
      <div>${visaOddsCard(!cloudOn() || entitlements().officialData === true)}
      ${PF_VISA_STAGES.map((s, i) => {
        const sDone = s.steps.filter(st => PFStore.isChecked('visa', st.id)).length;
        const stageDone = sDone === s.steps.length;
        const open = firstOpen && firstOpen.id === s.id;
        const bodyHtml = `
            ${s.where.map(w => `
              <div class="row">
                <span class="material-symbols-outlined stat-icon" aria-hidden="true">location_on</span>
                <div class="row-main"><div class="row-title">${esc(w.name)}</div>
                  <div class="row-sub">${esc(tv(w, 'detail'))}</div></div>
              </div>`).join('')}
            <ul class="ck-list">${s.steps.map(st => {
              const c = PFStore.isChecked('visa', st.id);
              return `<li class="ck-item ${c ? 'done' : ''}">
                <label><input type="checkbox" data-ck="visa" data-id="${st.id}" ${c ? 'checked' : ''}>
                  <span class="ck-box"><span class="material-symbols-outlined" aria-hidden="true">check</span></span>
                  <span class="ck-t">${esc(tv(st, 't'))}${tv(st, 'note') ? `<em>${esc(tv(st, 'note'))}</em>` : ''}</span></label>
              </li>`;
            }).join('')}</ul>
            ${s.id === 'vs7' ? partnerRow('insurance') + partnerRow('flights') : ''}
            ${s.id === 'vs2' ? fundsStageCTA() : ''}
            ${consultNudge(s.consult)}`;
        return `<div class="listcard roadmap-phase vh-stage ${stageDone ? 'done' : ''} ${open ? 'open' : ''}" data-stage="${s.id}">
          <div class="listcard-head">
            <div class="phase-head-left">
              <span class="phase-num ${stageDone ? 'is-done' : ''}">${stageDone ? '<span class="material-symbols-outlined" aria-hidden="true">check</span>' : i + 1}</span>
              <button type="button" class="vh-head" data-vh-toggle="${s.id}" aria-expanded="${open}">
                <h2 class="listcard-title">${s.title}</h2>
              </button>
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <span class="chip chip-neutral">${s.dur}</span>
              <span class="chip chip-neutral">${s.cost}</span>
              <span class="tab-n mono vh-count">${sDone}/${s.steps.length}</span>
            </div>
          </div>
          <p class="mt-3">${s.summary}</p>
          <div class="vh-body mt-4 ${open ? '' : 'hidden'}">${bodyHtml}</div>
        </div>`;
      }).join('')}
      </div>
      <div class="aside">
        <div class="sidecard">
          <span class="sidecard-kicker">Your visa as ${esc(T.article)} student</span>
          <p><strong>Tuition</strong> — ${T.feeMode === 'domestic'
            ? `Domestic rate, about ${fundsMoney(PF_CONFIG.phdFeesDomesticPerYear)}/yr`
            : `Full international rate, about ${fundsMoney(T.feeLo)}–${fundsMoney(T.feeHi)}/yr`}</p>
          <p><strong>Living-costs evidence</strong> — ${fundsMoney(PF_CONFIG.visaFundsPerYear)}/yr</p>
          <p><strong>Work rights</strong> — ${esc(T.workRights)}</p>
          <p><strong>After you finish</strong> — ${esc(T.postStudy)}</p>
        </div>
      </div>
    </div>
    <p class="row-sub mt-6">Figures are estimates — verify with immigration.govt.nz before relying on them.</p>`;

  govtRefresh('visa');
  if (cloudOn() && !entState.loaded) loadEntitlements(() => {
    if (location.hash.slice(1).split('?')[0] === 'visa') route();
  });
}

/* checklist + stage toggle — delegated once; progress updates IN PLACE so the
   open stage never collapses on a re-render */
document.addEventListener('change', e => {
  const ck = e.target.closest('[data-ck]');
  if (!ck) return;
  PFStore.setChecklistItem(ck.dataset.ck, ck.dataset.id, ck.checked);
  ck.closest('.ck-item').classList.toggle('done', ck.checked);
  const stage = ck.closest('.vh-stage');
  if (stage) {
    const s = PF_VISA_STAGES.find(x => x.id === stage.dataset.stage);
    const sDone = s.steps.filter(st => PFStore.isChecked('visa', st.id)).length;
    stage.querySelector('.vh-count').textContent = `${sDone}/${s.steps.length}`;
    stage.classList.toggle('done', sDone === s.steps.length);
    // Update the hero's own figure in place — same reason as the stage
    // count above: a full route() re-render would collapse the open stage.
    // renderHero() renders the figure twice (desktop .hero-right and the
    // <900px .hero-figure-mobile copy) so both need the update.
    const { done, total } = visaProgress();
    const hero = document.querySelector('.hero');
    if (hero) {
      $$('.hero-figure', hero).forEach(fig => { fig.firstChild.textContent = String(total ? Math.round(done / total * 100) : 0); });
      $$('.hero-caption', hero).forEach(cap => { cap.textContent = `${done}/${total} steps done`; });
    }
  }
});
document.addEventListener('click', e => {
  const t = e.target.closest('[data-vh-toggle]');
  if (!t) return;
  const stage = t.closest('.vh-stage');
  const body = stage.querySelector('.vh-body');
  const open = body.classList.toggle('hidden');
  stage.classList.toggle('open', !open);
  t.setAttribute('aria-expanded', String(!open));
});

/* ── 8 · Settle In ──────────────────────────────────────────
   The Settlement & Cost-of-Living tools (first-months / funds-planner /
   buying-power / scene3d) live in assets/js/settlement/*.js, loaded as
   additional CLASSIC <script> tags in app.html that attach to the global
   scope (window.PFFirstMonths etc.) — matching the global-function style
   of this file rather than introducing ES modules app-wide. Three.js is
   the one exception: it's pulled in on demand via dynamic import()
   resolved through the importmap in app.html. Every 3D scene is torn down
   via PFScene3D.disposeAll() on each settlement (re)render and on
   hashchange, because the router clears main.innerHTML on every route. */
/* Flat-hunting is the one Settle In topic where the guide can be right
   and still leave a student unprepared, because what they need is a
   price, and prices move. MBIE publishes them monthly.

   The card sits inside the existing "Finding a home" tab rather than
   becoming a tool of its own — same reason it is a reference in #cost
   and not a replacement: these are whole-tenancy medians, and a student
   reading them as a room rate would over-budget by a factor of three,
   so the framing does the work. Free, in full: it is a public statistic
   about the roof over someone's head. */
function settleRentCard() {
  const g = window.PF_GOVT;
  if (!g || !g.rent || !Object.keys(g.rent.byCity).length) return '';
  const cities = Object.keys(g.rent.byCity).map(k => g.rent.byCity[k])
    .sort((a, b) => b.median - a.median);
  const nz = n => 'NZ$' + Number(n).toLocaleString();

  return `<div class="card govt-card" style="grid-column:1/-1">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
      <div style="width:40px;height:40px;border-radius:11px;background:var(--teal-soft);display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <span class="material-symbols-outlined" style="color:var(--pine);font-size:20px">payments</span>
      </div>
      <strong style="font-size:15px">What rent actually costs, last month</strong>
    </div>
    <p class="muted" style="font-size:13.5px">Every one of these is a real bond lodged with Tenancy Services, not a
      listing price. They are for a <strong>whole house or flat</strong> — if you are taking a room in a shared one,
      your share is a fraction of it, which is why a flatmate ad and this table never match.</p>
    <table class="ledger govt-table" style="margin-top:14px"><tbody>
      ${cities.map(c => `<tr>
        <td>${esc(c.city)}</td>
        <td class="govt-td-n"><strong>${nz(c.median)}</strong>/wk</td>
        <td class="govt-td-n govt-faint">${nz(c.lq)}–${nz(c.uq)} middle half</td>
      </tr>`).join('')}
    </tbody></table>
    ${govtSourceLine(g.rent)}
  </div>`;
}

function renderSettlement(main) {
  if (window.PFScene3D) PFScene3D.disposeAll();

  const TOOLS = [
    { id: 'first-months',  label: 'Your first months' },
    { id: 'funds-planner', label: 'Funds planner' },
    { id: 'buying-power',  label: 'What NZ$20 buys' },
  ];

  main.innerHTML = renderHero({ kicker: 'Settle In', title: 'Your first months in New Zealand',
    body: 'Arrival, banking, transport and housing — plus a funds planner and a 90-day cost simulator.' }) +
    `<div id="set-tabs" class="set-tabs">
      ${PF_SETTLEMENT_CATS.map((c, i) => `<button class="chip-filter ${i === 0 ? 'active' : ''}" data-cat="${c.id}">${c.label}</button>`).join('')}
      <span class="set-tab-sep" aria-hidden="true"></span>
      ${TOOLS.map(t => `<button class="chip-filter set-tool" data-cat="${t.id}">${t.label}</button>`).join('')}
    </div>
    <div id="set-body"></div>`;

  function paintCards(cat) {
    $('#set-body').innerHTML = `<div class="grid-2">${PF_SETTLEMENT.filter(s => s.cat === cat).map(s => `
      <div class="card">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
          <div style="width:40px;height:40px;border-radius:11px;background:var(--violet-soft);display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <span class="material-symbols-outlined" style="color:var(--sea);font-size:20px">${s.icon}</span>
          </div>
          <strong style="font-size:15px">${s.title}</strong>
        </div>
        <p class="muted" style="font-size:13.5px">${esc(tv(s, 'body'))}</p>
        ${tv(s, 'tips') ? `<ul class="tl-list" style="margin-top:12px">${tv(s, 'tips').map(t => `<li style="font-size:13.5px">${esc(t)}</li>`).join('')}</ul>` : ''}
        ${s.perCity ? `<table class="ledger" style="margin-top:14px"><tbody>
          ${Object.entries(s.perCity).map(([city, how]) => `
            <tr><td style="font-family:var(--font-mono);font-size:11px;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;width:1%">${city}</td>
                <td style="font-size:13px">${how}</td></tr>`).join('')}
        </tbody></table>` : ''}
        ${consultCTA(s.consult)}
      </div>`).join('')}
    ${cat === 'housing' ? settleRentCard() : ''}
    </div>`;

    // Fetch the rent medians only when someone opens the housing tab, and
    // repaint just that tab rather than calling route() — a full re-render
    // would throw the student back to the first tab they were not on.
    if (cat === 'housing' && !window.PF_GOVT) {
      ensureGovtData().then(loaded => {
        const still = $('#set-tabs .chip-filter.active');
        if (loaded && still && still.dataset.cat === 'housing') paintCards('housing');
      });
    }
  }

  const TOOL_IDS = TOOLS.map(t => t.id);

  function open(cat) {
    if (window.PFScene3D) PFScene3D.disposeAll();
    const body = $('#set-body');
    // The three tools are a deferred bundle (~17 KB gzipped, plus Three.js
    // on top). Most sessions never open this tab, so the cost is paid on
    // the tap that needs it — with a line of copy in the gap, because on a
    // slow connection an empty panel reads as a broken one.
    if (TOOL_IDS.includes(cat)) {
      if (!window.PFFunds) {
        body.innerHTML = `<p class="muted" style="padding:24px 0">Loading the planner…</p>`;
        ensureSettlementTools().then(ok => {
          const active = $('#set-tabs .chip-filter.active');
          if (!active || active.dataset.cat !== cat) return;   // they moved on
          if (!ok) { body.innerHTML = `<p class="muted" style="padding:24px 0">Couldn't load the planner — check your connection and try again.</p>`; return; }
          open(cat);
        });
        return;
      }
      if (cat === 'first-months')  return PFFirstMonths.render(body);
      if (cat === 'funds-planner') return PFFunds.render(body);
      if (cat === 'buying-power')  return PFBuying.render(body);
    }
    paintCards(cat);
  }

  function selectTab(cat) {
    $$('#set-tabs .chip-filter').forEach(x => x.classList.toggle('active', x.dataset.cat === cat));
    $('.set-tab-sep')?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
    open(cat);
  }
  // first-months links can ask to jump straight to the planner tab — set
  // fresh each render so handlers never stack across navigations
  window.PFOpenSettleTab = selectTab;

  $('#set-tabs').addEventListener('click', e => {
    const b = e.target.closest('.chip-filter');
    if (b) selectTab(b.dataset.cat);
  });
  paintCards(PF_SETTLEMENT_CATS[0].id);
}

/* dispose any live Settlement 3D scenes when leaving the view — the
   router clears main.innerHTML but won't free WebGL contexts/rAF loops */
window.addEventListener('hashchange', () => { if (window.PFScene3D) PFScene3D.disposeAll(); });

/* ── 9 · Mentors (public view: Ask a mentor + My requests) ── */

// Cache of request docs currently on screen, so delegated "Pay" / action
// handlers can resolve a request by id without re-fetching.
const reqCache = new Map();
function cacheReqs(list) { (list || []).forEach(r => reqCache.set(r.id, r)); }

/* aggregate, non-identifying mentor stats. With Firebase off we derive a
   friendly count from the local seed data (PF_MENTORS); never names. */
function mentorStats() {
  const fields = {};
  PF_MENTORS.forEach(m => { fields[m.field] = (fields[m.field] || 0) + 1; });
  return { count: PF_MENTORS.length, fields: Object.entries(fields).sort((a, b) => b[1] - a[1]) };
}

let mentorsTab = 'ask';   // 'ask' | 'mine'

/* status → what to tell the student in their own hero, mentor-voice */
const MENTOR_REQ_STATUS_LINE = {
  open: 'is waiting for a mentor to claim it',
  claimed: 'has been claimed — a mentor is on it',
  intro_done: 'had its free intro — see what’s next',
  awaiting_payment: 'is ready for a follow-on session, once you pay',
  paid: 'is booked in for a paid session',
};

function renderMentors(main) {
  const topic = hashQuery().topic || '';
  if (hashQuery().tab === 'mine') mentorsTab = 'mine';
  const topicLabel = PF_CONSULT_TOPICS[topic] || '';
  const st = mentorStats();
  const active = PFStore.getMentorRequests()
    .filter(r => r.status !== 'completed' && r.status !== 'cancelled')
    .sort((a, b) => b.createdAt - a.createdAt)[0];

  const title = active
    ? `Your request ${MENTOR_REQ_STATUS_LINE[active.status] || 'is in progress'}`
    : topicLabel ? `Ask about ${topicLabel}` : 'Ask someone who has been through it';
  const heroBody = active
    ? `${active.topic && PF_CONSULT_TOPICS[active.topic] ? `On ${PF_CONSULT_TOPICS[active.topic]}. ` : ''}Open My requests below for the full thread.`
    : `Your first ${PF_CONFIG.freeIntroMinutes} minutes are free — paid follow-on sessions are optional.`;

  main.innerHTML = renderHero({
    kicker: 'Mentors', title, body: heroBody,
  }) +
    `<div class="tab-row" id="mtr-tabs" role="tablist" aria-label="Mentors">
      <button type="button" class="tab" role="tab" aria-selected="${mentorsTab === 'ask'}" data-mtab="ask">Ask a mentor</button>
      <button type="button" class="tab" role="tab" aria-selected="${mentorsTab === 'mine'}" data-mtab="mine">My requests</button>
    </div>
    <div id="mtr-body"></div>`;

  const body = $('#mtr-body');

  function paintAsk() {
    const signedIn = !!(window.PFCloud && PFCloud.isSignedIn && PFCloud.isSignedIn());
    const ent = entitlements();

    // What a paid plan actually buys, spendable right here. Rendered only
    // when there is a balance left, so a free student's form is unchanged.
    const redeemOpts = [];
    if (ent.sessions > 0) redeemOpts.push(['session',
      `Use 1 of my included mentor sessions (${ent.sessions} left)`]);
    if (ent.audits > 0) redeemOpts.push(['audit',
      ent.fullAudit
        ? `Use my included full audit — CV, SOP and proposal (${ent.audits} left)`
        : `Use my included SOP / proposal audit (${ent.audits} left)`]);

    const redeemField = redeemOpts.length ? `
          <div>
            <span class="field-label">Your plan</span>
            <select class="field" id="ask-redeem">
              <option value="">Free ${PF_CONFIG.freeIntroMinutes}-minute intro — keep my credits</option>
              ${redeemOpts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}
            </select>
          </div>` : '';

    const planStrip = (ent.plans && ent.plans.length) ? `
        <div class="chip-row mt-3">
          ${ent.priority ? '<span class="chip chip-gold">Priority queue</span>' : ''}
          <span class="chip chip-ok">${ent.sessions} session${ent.sessions === 1 ? '' : 's'} left</span>
          <span class="chip chip-ok">${ent.audits} audit${ent.audits === 1 ? '' : 's'} left</span>
          ${ent.interview ? '<span class="chip chip-neutral">Interview prep included</span>' : ''}
        </div>` : '';

    // Connecting with a mentor is account-gated: the explorer browses the
    // mentor network freely, but to actually ask one they create/sign into a
    // free account first, so the request is tied to them and trackable.
    const askCard = signedIn ? `
      <div class="listcard">
        <div class="listcard-head"><h2 class="listcard-title">Ask a mentor</h2></div>
        <p>Your request joins a shared queue — the first available mentor in the right area claims it.${topicLabel ? ` Pre-filled topic: ${esc(topicLabel)}.` : ''}${ent.priority ? ' Your plan puts it at the top of that queue.' : ''}</p>
        ${planStrip}
        <form id="ask-form" class="mt-4" style="display:flex;flex-direction:column;gap:12px">
          <select class="field" id="ask-topic">
            <option value="">General guidance</option>
            ${Object.entries(PF_CONSULT_TOPICS).map(([slug, lbl]) =>
              `<option value="${slug}" ${slug === topic ? 'selected' : ''}>${lbl}</option>`).join('')}
          </select>
          ${redeemField}
          <input class="field" id="ask-name" placeholder="Your name" autocomplete="name">
          <input class="field" id="ask-contact" placeholder="Email or WhatsApp — how a mentor reaches you">
          <textarea class="field" id="ask-note" rows="3" placeholder="What do you want to ask? (a line or two)"></textarea>
          <button class="btn" type="submit" style="align-self:flex-start">Ask a mentor</button>
        </form>
      </div>` : `
      <div class="listcard">
        <div class="listcard-head"><h2 class="listcard-title">Ask a mentor</h2></div>
        <p>Connecting with a mentor needs a free account, so your request is tied to you and follows you across devices.${topicLabel ? ` We'll keep your topic: ${esc(topicLabel)}.` : ''}</p>
        <a class="btn mt-4" href="${accountHref('mentors' + (topic ? '?topic=' + topic : ''))}" style="align-self:flex-start">
          <span class="material-symbols-outlined" aria-hidden="true">account_circle</span>
          Create a free account to ask
        </a>
      </div>`;

    const sidecard = `<div class="sidecard">
        <span class="sidecard-kicker">The mentor network</span>
        <p>${st.count} mentor${st.count === 1 ? '' : 's'} active across ${st.fields.length} field${st.fields.length === 1 ? '' : 's'} — postgrads from Sri Lanka, already in New Zealand.</p>
        <div class="chip-row mt-4">${st.fields.map(([f, n]) => `<span class="chip chip-neutral">${esc(f)} · ${n}</span>`).join('')}</div>
      </div>`;

    body.innerHTML = `<div class="viewgrid"><div style="max-width:680px">${askCard}</div><div class="aside">${sidecard}</div></div>`;

    const askForm = $('#ask-form');
    if (askForm) askForm.addEventListener('submit', e => {
      e.preventDefault();
      if (!requireAccount('Create a free account to connect with a mentor.')) return;
      const name = $('#ask-name').value.trim();
      const contact = $('#ask-contact').value.trim();
      if (!name || !contact) return toast('Add your name and a way to reach you');
      const redeemEl = $('#ask-redeem');
      const redeem = redeemEl ? redeemEl.value : '';
      // Re-read the balance at submit time rather than trusting the closure
      // this form painted with — entitlements resolve asynchronously, and a
      // credit may have been spent in another tab since then.
      const live = entitlements();
      const affordable = redeem === 'session' ? live.sessions > 0
                       : redeem === 'audit' ? live.audits > 0 : true;
      if (!affordable) { loadEntitlements(() => route()); return toast('That credit is already used — refreshing your plan.'); }
      PFStore.addMentorRequest({
        topic: $('#ask-topic').value, note: $('#ask-note').value.trim(), name, contact,
        redeem: redeem || null, priority: !!live.priority,
      });
      toast(redeem
        ? 'Request sent, and your included ' + (redeem === 'audit' ? 'audit' : 'session') + ' is booked against it.'
        : 'Request sent — a mentor will pick this up. Track it under “My requests”.');
      // The spend is derived from the requests, so the balance only moves
      // once the new request is in the list — recompute before repainting.
      loadEntitlements(() => { mentorsTab = 'mine'; route(); });
    });
  }

  function paintMine() {
    const render = (list, live) => {
      cacheReqs(list);
      body.innerHTML = `<div class="listcard">
        <div class="listcard-head"><h2 class="listcard-title">My requests</h2>
          ${!live ? `<span class="listcard-summary">On this device${window.PFCloud && PFCloud.isSignedIn() ? '' : ' — sign in to sync'}</span>` : ''}</div>
        ${list.length ? list.map(r => studentReqCard(r)).join('')
          : `<p>No requests yet — ask above whenever a step gets confusing. Your first ${PF_CONFIG.freeIntroMinutes} minutes are free.</p>`}
      </div>`;
    };
    // Local copy is the synchronous source of truth; if signed in, refresh
    // from Firestore so mentor-side status/payment updates show through.
    render(PFStore.getMentorRequests().slice().reverse(), false);
    // Refresh from Firestore for any visitor with a session — including the
    // anonymous one minted on load — so mentor-side status/payment updates
    // show through, not just for signed-in users.
    if (window.PFCloud && PFCloud.hasUser && PFCloud.hasUser()) {
      PFCloud.fetchMyRequests().then(remote => { if (remote && remote.length) render(remote, true); }).catch(() => {});
    }
  }

  function paint() { (mentorsTab === 'mine' ? paintMine : paintAsk)(); }

  $$('#mtr-tabs .tab').forEach(b => b.onclick = () => {
    mentorsTab = b.dataset.mtab;
    $$('#mtr-tabs .tab').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    paint();
  });
  paint();

  // What the student's plan includes has to be known before the ask form
  // can offer it. Resolved once per session (one Firestore read), then
  // repaint — same pattern as the Starter Kit's toolkit gate.
  if (cloudOn() && !entState.loaded) loadEntitlements(() => {
    if (location.hash.slice(1).split('?')[0] === 'mentors') paint();
  });
}

/* a student-facing request card: status + payment + (when due) a Pay button */
function studentReqCard(r) {
  const ps = r.payment && r.payment.paymentStatus;
  const payable = r.status === 'awaiting_payment' && ps === 'requested';
  const reported = r.status === 'awaiting_payment' && ps === 'reported';
  const payLabel = PFPay.isPayHereLive()
    ? 'Pay securely (Cards, HelaPay, eZ Cash, Genie & more)'
    : 'Pay now (bank transfer / mobile wallet)';
  return `<div class="row" style="flex-wrap:wrap">
    <div class="row-main">
      <div class="row-title">${PF_CONSULT_TOPICS[r.topic] || 'General guidance'}</div>
      <div class="row-sub">${r.at ? new Date(r.at).toLocaleDateString() : ''}${r.note ? ' · ' + esc(r.note) : ''}</div>
      ${payable ? `<p class="mt-3">Your free ${PF_CONFIG.freeIntroMinutes}-minute intro is done. Continue with a paid follow-on session for LKR ${Number(r.payment.amountLKR).toLocaleString()}.</p>
        <button type="button" class="btn btn-sm pay-now mt-3" data-req="${r.id}">
          <span class="material-symbols-outlined" aria-hidden="true">lock</span>${payLabel}</button>` : ''}
      ${reported ? `<p class="mt-3">Payment reported — your mentor will confirm receipt and book the session shortly.${r.payment.payerRef ? ` Reference: ${esc(r.payment.payerRef)}.` : ''}</p>` : ''}
    </div>
    <div class="row-actions">
      ${reqStatusChip(r.status)}
      ${r.payment ? payStatusChip(r.payment) : ''}
    </div>
  </div>`;
}

/* student "Pay" → manual rail (bank/wallet + report) or PayHere if live */
document.addEventListener('click', e => {
  const b = e.target.closest('.pay-now');
  if (!b) return;
  const r = reqCache.get(b.dataset.req);
  if (!r) return;
  PFPay.startSession(r);
});

/* ── 9c9 · Cost & Payback (#cost) ───────────────────────────────────────
   The master's track's own high-stakes screen.

   A PhD student is walking toward money: domestic fees and a stipend. A
   master's student is walking toward a bill — full international tuition,
   no stipend, one to two years — and on the University of Auckland's own
   published 2026 rates, an IT master's in Auckland comes to roughly
   NZ$180,000 all in. For a family in Sri Lanka that is not a tuition
   figure, it is a house.

   Nobody in that market will do this arithmetic for them honestly,
   because everybody else is paid a percentage of the tuition. An agent
   earns less when the student picks the cheaper qualification, so the
   cheaper qualification never gets mentioned. PathFinder takes no
   provider commission, which is the only reason this screen can exist.

   Free: the truth about the plan they already have.
   Premium: what to do about it — the cheaper routes, and the one-page
   sheet they put in front of the person who actually holds the money. */

let roiState = null;

function roiDefaults() {
  const R = currentResult();
  const saved = PFStore.get('roiPlan', null);
  // computeMastersResult() carries the NZQA subject-area ROOT as
  // `subjectArea` (`field` is its display name), which is exactly the key
  // the fee and earnings tables are cut by — so a student who has taken
  // the assessment lands here already pointed at their own subject.
  return Object.assign({
    subjectRoot: (R && R.subjectArea) || '76450',
    providerId: '700122001', tier: 'universities', city: 'akl', years: 2,
    who: 'single', scholarshipPct: 0, workHours: 25, feeOverride: 0,
    ownFundsNZD: 0, partnerWorks: false,
  }, saved || {});
}

function roiSave() { PFStore.set('roiPlan', roiState); }

function renderCost(main) {
  // roi-data.js and roi.js are a DEFERRED bundle — only this view uses the
  // cost model, and making every visitor download it to reach the dashboard
  // was 15 KB gzipped on the wrong critical path. They are classic scripts
  // declaring top-level `const`, which is script-scoped and NOT a property
  // of window, so test the bindings themselves the way PF_CONFIG is tested.
  if (typeof PF_ROI === 'undefined' || typeof PFRoi === 'undefined') {
    main.innerHTML = renderHero({
      kicker: 'Cost & payback',
      title: 'Working out what this costs…',
      body: 'Loading the fee schedules and the earnings tables.',
    });
    ensureRoi().then(ok => {
      if (location.hash.slice(1).split('?')[0] !== 'cost') return;
      if (ok) return route();
      main.innerHTML = renderHero({ kicker: 'Cost & payback', title: 'Cost data unavailable',
        body: 'The cost dataset did not load. Check your connection and reload.' });
    });
    return;
  }
  ensureInvoice();   // the family decision sheet is one tap away from here
  if (!roiState) roiState = roiDefaults();
  const cat = window.PF_CATALOGUE;
  if (!cat) ensureCatalogue().then(() => { if (location.hash.slice(1).split('?')[0] === 'cost') route(); });
  // NZQA's per-provider record — ~20 KB, and only this view needs it, so
  // it lazy-loads through the same helper as the catalogue shards.
  ensureProviderQuality().then(loaded => {
    if (loaded && location.hash.slice(1).split('?')[0] === 'cost') route();
  });
  // Immigration NZ's post-study decisions and MBIE's rent medians — same
  // lazy pattern, same guard.
  govtRefresh('cost');

  // The PhD economics run the opposite way, so say so rather than running
  // a master's model over a doctoral plan and quoting nonsense.
  if (!isMasters()) return roiPhdNote(main);

  const r = PFRoi.compute(roiState);
  const unlocked = !cloudOn() || entitlements().costCompare === true;
  // The government-data panels are their own entitlement, so the two can
  // be priced apart later without untangling them from the fee model.
  const govtUnlocked = !cloudOn() || entitlements().officialData === true;

  /* Reading order is the argument, in the order a family actually asks it:
       1. what am I costing out          (the plan, editable, at the top)
       2. what does it cost              (one number, in rupees)
       3. where does that go             (the breakdown)
       4. what does it earn back         (payback vs the visa)
       5. what else could we do          (cheaper providers)
       6. how do you know                (sources, last)
     On mobile this is the literal top-to-bottom order. The old version put
     the inputs in an aside, which on a phone dropped them to the BOTTOM —
     below every number they controlled. */
  main.innerHTML = renderHero({
    kicker: 'Cost & payback',
    title: r.band,
    body: r.verdict,
    figure: isFinite(r.paybackYears) ? Math.round(r.paybackYears * 10) / 10 : '—',
    figureSuffix: isFinite(r.paybackYears) ? ' yr' : '',
    figureCaption: 'to earn it back',
  }) +
    roiPlanCard(cat) +
    roiHeadline(r) +
    roiCostCard(r) +
    roiQualityCard() +
    roiAfterCard(r) +
    roiPostStudyCard(r, govtUnlocked) +
    roiRoutesCard(r, unlocked) +
    roiSourcesCard(r) +
    consultCTA('funding-costs');

  roiBindForm();

  if (cloudOn() && !entState.loaded) loadEntitlements(() => {
    if (location.hash.slice(1).split('?')[0] === 'cost') route();
  });
}

/* ── 1 · The plan, editable, first ──────────────────────────────────
   A <details> so it is one tap on a phone and open by default on a wide
   screen. The summary line always states the plan in words, so even
   closed it says exactly what is being costed. */
function roiPlanCard(cat) {
  const s = roiState;
  const choices = PFRoi.providerChoices(s.subjectRoot);
  const cities = (typeof PF_CITY_COSTS !== 'undefined' && PF_CITY_COSTS) || [];
  const subject = cat && cat.taxonomy[s.subjectRoot] ? cat.taxonomy[s.subjectRoot].n : 'your subject';
  const prov = choices.find(c => c.id === s.providerId);
  const city = cities.find(c => c.id === s.city);
  const opt = (v, l, sel) => `<option value="${esc(v)}" ${String(sel) === String(v) ? 'selected' : ''}>${esc(l)}</option>`;

  const groups = [['universities', 'Universities'], ['polytechnics', 'Polytechnics & institutes of technology'], ['ptes', 'Private colleges']];
  const provOpts = groups.map(([t, label]) => {
    const inGroup = choices.filter(c => c.tier === t);
    if (!inGroup.length) return '';
    return `<optgroup label="${esc(label)}">${inGroup.map(c =>
      opt(c.id, c.name + (c.confidence === 'published' ? ' — published fees' : ''), s.providerId)).join('')}</optgroup>`;
  }).join('');

  return `<details class="listcard roi-plan" ${window.innerWidth > 860 ? 'open' : ''} style="margin-top:20px">
    <summary class="roi-plan-summary">
      <span class="sidecard-kicker">Costing this plan</span>
      <strong>${esc(subject)} · ${esc(prov ? prov.name : 'a provider')}</strong>
      <span class="faint">${esc(city ? city.city : '')} · ${s.years} year${s.years === 1 ? '' : 's'} · ${s.who === 'single' ? 'on your own' : s.who === 'couple' ? 'with a partner' : 'with family'} — tap to change</span>
    </summary>
    <div class="roi-fields">
      <label><span class="field-label">Subject area</span>
        <select class="field" id="roi-subject">${(cat ? cat.roots.map(id => [id, cat.taxonomy[id].n]) : [[s.subjectRoot, 'Loading…']])
          .map(([id, n]) => opt(id, n, s.subjectRoot)).join('')}</select></label>
      <label><span class="field-label">Provider</span>
        <select class="field" id="roi-provider">${provOpts}</select></label>
      <label><span class="field-label">City</span>
        <select class="field" id="roi-city">${cities.map(c => opt(c.id, c.city, s.city)).join('')}</select></label>
      <label><span class="field-label">Length</span>
        <select class="field" id="roi-years">${[[1, '1 year'], [1.5, '18 months'], [2, '2 years']].map(([v, l]) => opt(v, l, s.years)).join('')}</select></label>
      <label><span class="field-label">Going as</span>
        <select class="field" id="roi-who">${[['single', 'On my own'], ['couple', 'With a partner'], ['family', 'With family']].map(([v, l]) => opt(v, l, s.who)).join('')}</select></label>
      <label><span class="field-label">Work hours a week</span>
        <select class="field" id="roi-hours">${[[25, '25 — current rules'], [20, '20 — older visa condition'], [0, 'Not working']].map(([v, l]) => opt(v, l, s.workHours)).join('')}</select></label>
      <label><span class="field-label">Fee you were quoted (NZ$/yr)</span>
        <input class="field" id="roi-fee" type="number" inputmode="numeric" min="0" placeholder="most accurate — ask your provider" value="${s.feeOverride || ''}"></label>
      <label><span class="field-label">Scholarship on tuition (%)</span>
        <input class="field" id="roi-schol" type="number" inputmode="numeric" min="0" max="100" value="${s.scholarshipPct || 0}"></label>
      <label><span class="field-label">Funds already arranged (NZ$)</span>
        <input class="field" id="roi-funds" type="number" inputmode="numeric" min="0" value="${s.ownFundsNZD || 0}"></label>
    </div>
  </details>`;
}

/* ── 2 · The one number ─────────────────────────────────────────── */
function roiHeadline(r) {
  return `<div class="listcard roi-headline">
    <span class="sidecard-kicker">What this costs, all in</span>
    <div class="roi-big">${esc(PFRoi.lkr(r.netCost))}</div>
    <div class="roi-big-sub">${esc(PFRoi.money(r.netCost))} over ${r.years} year${r.years === 1 ? '' : 's'}, after part-time earnings</div>
    <div class="roi-facts">
      <div><span class="faint">Before work income</span><strong>${esc(PFRoi.money(r.totalCost))}</strong></div>
      <div><span class="faint">Earned while studying</span><strong>${esc(PFRoi.money(r.studyIncomeTotal))}</strong></div>
      ${r.ownFunds ? `<div><span class="faint">Still to arrange</span><strong>${esc(PFRoi.money(r.gap))}</strong></div>` : ''}
    </div>
  </div>`;
}

/* ── 3 · The breakdown ──────────────────────────────────────────── */
function roiCostCard(r) {
  const conf = {
    quoted: ['chip-ok', 'Your quoted fee'],
    'provider-subject': ['chip-ok', 'Published fee'],
    'provider-band': ['chip-warn', 'Provider range'],
    'tier-band': ['chip-info', 'Estimate'],
  }[r.tuition.basis] || ['chip-neutral', ''];

  return `<div class="listcard">
    <div class="listcard-head"><h2 class="listcard-title">Where the money goes</h2>
      <span class="listcard-summary">${esc(PFRoi.money(r.totalCost))} total</span></div>
    ${r.costLines.map(l => `<div class="roi-line">
      <div class="roi-line-main">
        <div class="roi-line-label">${esc(l.label)}</div>
        <div class="roi-line-detail">${esc(l.detail || '')}${l.perYear ? ` · ${esc(PFRoi.money(l.perYear))}/yr` : ''}</div>
      </div>
      <div class="roi-line-money">
        <strong>${esc(PFRoi.money(l.amount))}</strong>
        <span class="faint">${esc(PFRoi.lkr(l.amount))}</span>
      </div>
    </div>`).join('')}
    <div class="roi-basis">
      <span class="chip ${conf[0]}">${esc(conf[1])}</span>
      <p>Tuition is from ${esc(r.tuition.label)}.${r.tuition.basis !== 'quoted'
        ? ' The exact number is the one your provider quotes you in writing — enter it above and everything here recalculates.' : ''}</p>
      ${roiRentCheck(r)}
    </div>
  </div>`;
}

/* ── The rent reality check ─────────────────────────────────────────
   MBIE publishes the median weekly rent actually lodged with Tenancy
   Services, by city, every month. It is the hardest housing number in
   New Zealand — and it is NOT interchangeable with the figure this app
   budgets with, so it is shown beside that figure rather than swapped
   into it.

   A bond is lodged against a whole tenancy. The median is what an
   entire house or flat costs. PF_CITY_COSTS budgets a room in a shared
   one. Substituting the first for the second would roughly double every
   living-cost figure in the app and quietly wreck the funds planner,
   the 90-day simulator and this model at once.

   What it is genuinely good for is the sanity check a student cannot
   otherwise do: our Auckland room rate implies a whole flat at roughly
   three times the money, and here is what whole flats in Auckland
   actually went for last month. If those two ever stop being
   reconcilable, the hand-maintained figure is the one that is wrong. */
function roiRentCheck(r) {
  const g = window.PF_GOVT;
  const city = r && r.city;
  if (!g || !g.rent || !city || !g.rent.byCity[city.id]) return '';
  const m = g.rent.byCity[city.id];
  const room = city.rentWeekly && city.rentWeekly.single;
  return `<p class="govt-inline">
    <strong>Rent check.</strong> ${esc(m.city)}'s median rent last month was
    <strong>${PFRoi.money(m.median)}/week</strong> for a whole house or flat
    (${PFRoi.money(m.lq)}–${PFRoi.money(m.uq)} across the middle half, from ${m.bonds.toLocaleString()} active bonds).
    ${room ? `This plan budgets ${PFRoi.money(room)}/week, which assumes you share — the government figure is
      for the whole tenancy, not a room in it.` : ''}
    ${govtSourceLine(g.rent)}</p>`;
}

/* Lazy-load NZQA's provider record. Resolves false (not true) when the
   file is absent, so every caller degrades to showing nothing rather than
   implying a provider is unrated. */
let _pqPromise = null;
function ensureProviderQuality() {
  if (window.PF_PROVIDER_QUALITY) return Promise.resolve(false);
  if (_pqPromise) return _pqPromise;
  _pqPromise = _loadScript('assets/js/provider-quality.js')
    .then(() => !!window.PF_PROVIDER_QUALITY)
    .catch(() => false);
  return _pqPromise;
}

/* ── 3b · Who you'd be handing the money to ─────────────────────────
   The cheaper-routes comparison is the most dangerous thing on this
   screen: it is very good at finding a lower number, and a lower number
   is not the same as a better decision. This is the counterweight — and
   it is deliberately placed BEFORE the cheaper routes, so a student meets
   the quality question on the way to the savings rather than after.

   Everything shown is NZQA's own published finding with its date and a
   link to the report. PathFinder does not rate providers: we put the
   regulator's evidence in front of the student and let them read it. */
function roiQualityCard() {
  if (typeof PF_ROI_QA === 'undefined') return '';
  const q = PFRoi.qualityFor(roiState.providerId);
  if (!q) return '';
  const QA = PF_ROI_QA;

  const catBlock = q.cat ? `
      <div class="roi-qa-verdict">
        <span class="chip ${q.cat.tone}">${esc(q.cat.label)}${q.statementYear ? ` · ${q.statementYear}` : ''}</span>
        <p>${esc(q.cat.meaning)}</p>
        <p class="roi-qa-note">${esc(QA.systemNote)}</p>
      </div>`
    : q.naReason ? `
      <div class="roi-qa-verdict">
        <span class="chip chip-neutral">No NZQA category</span>
        <p>${esc(q.naReason)}</p>
      </div>`
    : `<div class="roi-qa-verdict">
        <span class="chip chip-neutral">Nothing published</span>
        <p>NZQA's record for this provider carries no category. That is not a bad result — it usually means they have not been through an external evaluation under the old system. Open their NZQA record below and ask the provider directly.</p>
      </div>`;

  const statements = q.statements.length ? `
      <ul class="roi-qa-list">${q.statements.map(s => `<li>
        <strong>${esc(s.confidence)}</strong> in ${s.about === 'self-assessment' ? 'their capability in self-assessment' : 'their educational performance'}
        <span class="faint">— NZQA, ${esc(s.date)}</span></li>`).join('')}</ul>` : '';

  const reports = q.reports.length ? `
      <div class="roi-qa-reports">
        <span class="faint">Read the reports yourself:</span>
        ${q.reports.map(r => `<a href="${esc(r.url)}" target="_blank" rel="noopener">${r.year} report (PDF)</a>`).join('')}
      </div>` : '';

  return `<div class="listcard roi-qa${q.concern ? ' roi-qa-concern' : ''}">
    <div class="listcard-head"><h2 class="listcard-title">Who you'd be handing the money to</h2>
      <span class="listcard-summary">${esc(q.name)}</span></div>
    <p class="roi-line-detail">Cost is one axis. This is what New Zealand's regulator has published about this provider — the evidence, dated, with the reports so you can read them yourself.</p>
    ${catBlock}
    ${statements}
    ${q.codeSignatory ? `<p class="roi-qa-code"><strong>Signatory to the Code of Practice</strong> for the pastoral care of international students — the legal obligations a provider takes on for students from overseas.</p>` : ''}
    ${reports}
    <div class="roi-basis">
      <p><strong>What this does not tell you.</strong></p>
      <ul class="roi-qa-limits">${QA.limits.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
      <p class="mt-3">${esc(QA.noReviewsNote)}</p>
      <div class="roi-qa-actions">
        <a class="btn btn-quiet btn-sm" href="${esc(q.link)}" target="_blank" rel="noopener">Open the full NZQA record</a>
        <a class="btn btn-quiet btn-sm" href="#mentors?topic=choosing-provider">Ask someone who studied there</a>
      </div>
    </div>
  </div>`;
}

/* ── 4 · What it earns back ─────────────────────────────────────── */
function roiAfterCard(r) {
  const e = r.earnings;
  const row = (label, detail, value) => `<div class="roi-line">
      <div class="roi-line-main">
        <div class="roi-line-label">${esc(label)}</div>
        <div class="roi-line-detail">${esc(detail)}</div>
      </div>
      <div class="roi-line-money"><strong>${esc(value)}</strong></div>
    </div>`;
  return `<div class="listcard">
    <div class="listcard-head"><h2 class="listcard-title">What it earns back</h2>
      <span class="chip ${r.bandCls}">${esc(r.band)}</span></div>
    ${row('Likely salary in this field', e.basis === 'field' ? e.eg : (e.note || ''), PFRoi.money(r.grossAfter) + '/yr')}
    ${row('After tax and ACC', `NZ PAYE ${PF_ROI.tax.asOf} plus the ${(PF_ROI.tax.accRate * 100).toFixed(2)}% earner levy`, PFRoi.money(r.netAfter) + '/yr')}
    ${row('Left over after living costs', 'What can actually go toward repaying this', PFRoi.money(r.annualSurplus) + '/yr')}
    ${row('Time to earn the cost back', `Against a ${r.pswYears}-year post-study work visa`, PFRoi.fmtYears(r.paybackYears))}
    <div class="roi-basis"><p><strong>The window matters.</strong> A level 9 master's earns a ${r.pswYears}-year
      post-study work visa with open work rights and no job offer needed. Staying past that needs residence, which is a
      separate decision and never guaranteed — so a payback longer than ${r.pswYears} years is a plan that depends on
      something outside your control.</p></div>
  </div>`;
}

/* ── 4b · What happens on graduation day ────────────────────────────
   The payback model scores the investment against a three-year
   post-study work visa. That whole model rests on one assumption — that
   the student gets the visa — and until now the app asserted it without
   evidence. Immigration New Zealand publishes the actual decisions.

   This is Premium, and the split is the same one the rest of #cost
   makes: what your plan costs stays free; what to DO about it is paid.
   Here the free screen already tells a student the payback window is
   three years. What Premium adds is the decade of decisions behind that
   window — including the fact that this route was cut by three quarters
   between 2018/19 and 2023/24, which is the single strongest argument
   against treating any of it as guaranteed.

   Nothing here is scored or forecast. It is the published series, the
   direction it is moving, and an explicit statement that past decisions
   do not bind future ones. */
function roiPostStudyCard(r, unlocked) {
  const g = window.PF_GOVT;
  if (!g || !g.postStudyWork || !g.postStudyWork.routes) return '';
  const ps = g.postStudyWork;
  const open = ps.routes.find(x => /open/i.test(x.label));
  if (!open || !open.series.length) return '';

  const now = govtLatest(open.series);
  const rate = govtRate(now);
  const peak = open.series.reduce((m, x) => (x.a + x.d) > (m.a + m.d) ? x : m, open.series[0]);
  const trough = open.series.reduce((m, x) => (x.a + x.d) < (m.a + m.d) ? x : m, open.series[0]);

  if (!unlocked) {
    return `<div class="listcard locked-card">
      <span class="chip chip-gold"><span class="material-symbols-outlined" style="font-size:13px;vertical-align:-2px">lock</span> Premium</span>
      <h2 class="listcard-title mt-3">Does the post-study work visa actually come through?</h2>
      <p class="mt-3">Everything above is repaid inside a ${r.pswYears}-year post-study work visa. That assumption
        is doing a lot of work, and Immigration New Zealand publishes ten years of decisions on exactly that visa —
        including a stretch where the number granted fell by three quarters.</p>
      <p class="mt-3">Premium shows the full series, the approval rate, and where the current year sits against
        the best and worst years on record.</p>
      <a class="btn mt-4" href="#pricing">See what Premium includes</a>
    </div>`;
  }

  return `<div class="listcard govt-card">
    <div class="listcard-head">
      <h2 class="listcard-title">Does the post-study work visa come through?</h2>
      <span class="chip chip-ok">Official figures</span>
    </div>

    <div class="govt-headline">
      <div class="govt-figure">
        <strong>${rate.toFixed(1)}%</strong>
        <span>approved in ${esc(govtFY(now.y))}</span>
      </div>
      <div class="govt-split">
        <div><span class="govt-n">${now.a.toLocaleString()}</span><span class="govt-l">granted</span></div>
        <div><span class="govt-n">${now.d.toLocaleString()}</span><span class="govt-l">declined</span></div>
        <div><span class="govt-n">${(now.a + now.d).toLocaleString()}</span><span class="govt-l">decided in total</span></div>
      </div>
    </div>

    <p class="mt-3">Applications are decided at a high rate — this visa is granted on completing an eligible
      qualification, not on finding a job. <strong>The volume is the thing to watch.</strong> Decisions peaked at
      ${(peak.a + peak.d).toLocaleString()} in ${esc(govtFY(peak.y))}, fell to ${(trough.a + trough.d).toLocaleString()}
      by ${esc(govtFY(trough.y))} as eligibility was tightened, and have since recovered to
      ${(now.a + now.d).toLocaleString()}.</p>

    ${govtTrendBars(open.series, x => x.a + x.d, v => v.toLocaleString() + ' decided')}

    <div class="roi-basis">
      <p><strong>What this does and does not tell you.</strong> These are decisions across all nationalities on the
        open post-study work visa, the one a level 9 master's earns. They show the rule has held for a decade and
        that its scope has been changed twice inside that decade. Eligibility is set by policy and policy moves —
        a ${r.pswYears}-year payback that only works if this visa still exists in its current form is a plan with a
        political dependency in it. Confirm the current rule at immigration.govt.nz before you commit.</p>
      ${govtSourceLine(ps)}
    </div>
  </div>`;
}

/* ── 5 · Cheaper routes ─────────────────────────────────────────── */
function roiRoutesCard(r, unlocked) {
  const counts = PFRoi.levelNineTierCounts();
  const evidence = counts
    ? `The register holds ${counts.quals} level 9 master's qualifications. ${counts.polytechnics + counts.ptes} of those offerings are at polytechnics and private colleges rather than universities — the same level on the same framework.`
    : `Polytechnics and private colleges award level 9 master's degrees on the same framework as universities.`;

  if (!unlocked) {
    return `<div class="listcard locked-card">
      <span class="chip chip-gold"><span class="material-symbols-outlined" style="font-size:13px;vertical-align:-2px">lock</span> Premium</span>
      <h2 class="listcard-title mt-3">Cheaper routes to the same qualification</h2>
      <p class="mt-3">${esc(evidence)}</p>
      <p class="mt-3">Premium compares your plan against named providers teaching the same subject at the same level — with each one's published fee and the saving — and generates the one-page sheet you put in front of whoever is paying.</p>
      <p class="muted mt-3" style="font-size:12.5px">Every education agent in Colombo is paid a percentage of your tuition, so none of them will show you this. We take no provider commission.</p>
      <a class="btn mt-4" href="#pricing">See what Premium includes</a>
    </div>`;
  }

  const routes = PFRoi.cheaperRoutes(r, roiState);
  const head = `<div class="listcard-head"><h2 class="listcard-title">Cheaper routes to the same level</h2>
      <span class="listcard-summary">${routes.length} option${routes.length === 1 ? '' : 's'}</span></div>`;

  if (!routes.length) {
    return `<div class="listcard">${head}
      <p>Nothing we hold fees for comes out cheaper than the plan you've entered — this is already the low-cost route.</p></div>`;
  }

  return `<div class="listcard">${head}
    <p class="roi-line-detail" style="margin:0 0 4px">${esc(evidence)}</p>
    ${routes.map(a => `<div class="roi-route">
      <div class="roi-route-head">
        <div>
          ${a.kicker ? `<div class="roi-route-kicker">${esc(a.kicker)}</div>` : ''}
          <div class="roi-route-title">${esc(a.title)}</div>
        </div>
        <div class="roi-route-save">
          <strong>saves ${esc(PFRoi.money(a.saving))}</strong>
          <span class="faint">${esc(PFRoi.lkr(a.saving))}</span>
        </div>
      </div>
      <p class="roi-line-detail">${esc(a.why)}</p>
      <p class="roi-route-tradeoff"><strong>Trade-off:</strong> ${esc(a.tradeoff)}</p>
      ${roiRouteQuality(a)}
      <div class="roi-route-foot">
        ${a.confidence === 'published' ? '<span class="chip chip-ok">Published fee</span>' : '<span class="chip chip-warn">Provider range</span>'}
        <span class="faint">${a.payback == null ? esc(a.paybackNote || '') : 'pays back in ' + esc(PFRoi.fmtYears(a.payback))}</span>
        ${a.providerId ? `<button type="button" class="btn btn-quiet btn-sm roi-try" data-prov="${esc(a.providerId)}">Cost this one</button>` : ''}
      </div>
    </div>`).join('')}
    <div class="roi-basis">
      <p>These are real providers on the NZQA register, not recommendations. Check each one's standing and talk to a
      graduate before you commit — <a href="#courses">browse them in the catalogue</a>.</p>
      <button type="button" class="btn mt-4" id="roi-sheet">
        <span class="material-symbols-outlined" aria-hidden="true">description</span> Download the family sheet</button>
    </div>
  </div>`;
}

/* The quality line on a cheaper-route row. This is the whole reason the
   quality data exists: a saving of NZ$70,000 and a regulator's finding
   have to be legible in the same glance, or the comparison is just an
   argument for the cheapest option. Where the cheaper provider's record
   is materially worse, the row says so in the same breath as the saving. */
function roiRouteQuality(a) {
  if (!a.providerId || typeof PF_ROI_QA === 'undefined') return '';
  const q = PFRoi.qualityFor(a.providerId);
  if (!q) return '';
  const delta = PFRoi.qualityDelta(roiState.providerId, a.providerId);

  const chip = q.cat
    ? `<span class="chip ${q.cat.tone}">${esc(q.cat.label)}${q.statementYear ? ` · ${q.statementYear}` : ''}</span>`
    : q.naReason ? `<span class="chip chip-neutral">No category — university</span>` : '';

  const warn = delta ? `<p class="roi-route-warn"><strong>Worth pausing on.</strong>
      This provider sat at Category ${delta.to} where your current choice is Category ${delta.from}.
      ${esc((PF_ROI_QA.categories[delta.to] || {}).meaning || '')}</p>` : '';

  const concern = !delta && q.concern ? `<p class="roi-route-warn"><strong>Worth pausing on.</strong>
      ${esc((q.cat || {}).meaning || '')}</p>` : '';

  return `<div class="roi-route-qa">
      ${chip}
      ${q.codeSignatory ? '<span class="chip chip-neutral">Code of Practice signatory</span>' : ''}
      ${q.reports.length ? `<a class="faint" href="${esc(q.reports[0].url)}" target="_blank" rel="noopener">${q.reports[0].year} NZQA report</a>` : ''}
    </div>${warn}${concern}`;
}

/* ── 6 · Sources, last ──────────────────────────────────────────── */
function roiSourcesCard(r) {
  const d = PF_ROI;
  const p = PFRoi.providerOf(roiState.providerId);
  return `<details class="listcard">
    <summary class="roi-plan-summary"><strong>Where these numbers come from</strong>
      <span class="faint">Every figure is published and dated. Last checked ${esc(d.verified)}.</span></summary>
    <ul class="roi-src">
      <li><strong>Tuition</strong> — ${esc(p ? p.src : (d.tiers[roiState.tier] || {}).src || 'provider fee schedules')}</li>
      <li><strong>Living costs</strong> — PathFinder city data, verified ${esc((r.city && r.city.lastVerified) || d.verified)}</li>
      <li><strong>Wages</strong> — adult minimum wage NZ$${PF_CONFIG.minWageHourly}/hr from 1 April 2026 (employment.govt.nz)</li>
      <li><strong>Tax</strong> — IRD ${esc(d.tax.asOf)} brackets and the ${(d.tax.accRate * 100).toFixed(2)}% earner levy</li>
      <li><strong>Salaries</strong> — ${esc(d.earnings.src)}</li>
      <li><strong>Work &amp; visa rules</strong> — immigration.govt.nz</li>
      ${window.PF_GOVT ? `<li><strong>Visa decisions</strong> — ${esc(PF_GOVT.postStudyWork.src)},
        ${esc(PF_GOVT.postStudyWork.attribution)}${PF_GOVT.postStudyWork.preparedOn
          ? ', prepared ' + esc(PF_GOVT.postStudyWork.preparedOn) : ''} (${esc(PF_GOVT.postStudyWork.licence)})</li>
      <li><strong>Market rent</strong> — ${esc(PF_GOVT.rent.src)}, ${esc(PF_GOVT.rent.attribution)},
        ${esc(PF_GOVT.rent.asOf)} (${esc(PF_GOVT.rent.licence)})</li>` : ''}
      <li><strong>NZ$ → LKR</strong> — ${d.fx.nzdToLkr} as at ${esc(d.fx.asOf)}; an anchor for reading, not a transfer rate</li>
    </ul>
    <p class="roi-warn"><strong>Read this honestly.</strong> The salary figures are published for
      <em>domestic</em> New Zealand graduates. An international graduate holds a ${r.pswYears}-year work visa and no
      guarantee of residence, so treat them as an upper reference, not a forecast. Confirm tuition with the provider in
      writing before you decide anything. PathFinder takes no commission from any provider named here.</p>
  </details>`;
}

function roiBindForm() {
  const bind = (id, key, cast) => {
    const el = $('#' + id);
    if (!el) return;
    el.addEventListener('change', () => {
      roiState[key] = cast ? cast(el.value) : el.value;
      // Picking a provider carries its tier along, so the tier bands and
      // the trade-off wording stay in step with the named provider.
      if (key === 'providerId') {
        const c = PFRoi.providerChoices(roiState.subjectRoot).find(x => x.id === el.value);
        if (c) roiState.tier = c.tier;
      }
      roiSave();
      route();
    });
  };
  bind('roi-subject', 'subjectRoot');
  bind('roi-provider', 'providerId');
  bind('roi-city', 'city');
  bind('roi-years', 'years', Number);
  bind('roi-who', 'who');
  bind('roi-hours', 'workHours', Number);
  bind('roi-fee', 'feeOverride', Number);
  bind('roi-schol', 'scholarshipPct', Number);
  bind('roi-funds', 'ownFundsNZD', Number);

  const sheet = $('#roi-sheet');
  if (sheet) sheet.onclick = () => roiDownloadSheet(PFRoi.compute(roiState));

  $$('.roi-try').forEach(b => b.onclick = () => {
    const c = PFRoi.providerChoices(roiState.subjectRoot).find(x => x.id === b.dataset.prov);
    roiState.providerId = b.dataset.prov;
    if (c) roiState.tier = c.tier;
    roiState.feeOverride = 0;   // a quoted fee belongs to the old provider
    roiSave();
    route();
  });
}

/* The PhD track's economics run the other way, so this tells the truth
   about that instead of pretending the model applies. */
function roiPhdNote(main) {
  main.innerHTML = renderHero({
    kicker: 'Cost & payback', title: 'On the PhD track, the maths runs the other way',
    body: 'This tool models the master\'s bill. A doctorate in New Zealand is one of the few in the world that charges international students the domestic rate — and usually pays a stipend on top.',
    primaryLabel: 'Check my visa funds', primaryHref: '#funds',
  }) +
    `<div class="listcard mt-5">
      <div class="listcard-head"><h2 class="listcard-title">Why there is nothing to model</h2></div>
      <p>Tuition at the domestic rate is about ${esc(PFRoi.money(PF_CONFIG.phdFeesDomesticPerYear))} a year, and a doctoral
      scholarship — usually awarded with admission rather than applied for separately — covers fees and adds a stipend of
      roughly ${esc(PFRoi.money(PF_CONFIG.stipendLo * 12))}–${esc(PFRoi.money(PF_CONFIG.stipendHi * 12))} a year. You also
      have unlimited work rights. The question that decides a PhD is not cost; it is whether a supervisor says yes.</p>
      <div class="hero-actions mt-5">
        <a class="btn btn-quiet" href="#research">Find supervisors and a topic</a>
        <button type="button" class="btn btn-quiet" id="roi-to-masters">I'm actually looking at a master's</button>
      </div>
    </div>`;
  $('#roi-to-masters').onclick = () => switchTrack('masters');
}

/* The regulator's record on the chosen provider, flattened for the sheet.
   Returns null when nothing is published, so the PDF omits the section
   rather than printing a heading over an empty space. */
function roiSheetQuality() {
  if (typeof PF_ROI_QA === 'undefined') return null;
  const q = PFRoi.qualityFor(roiState.providerId);
  if (!q) return null;
  const lines = q.statements.map(s =>
    `NZQA was ${s.confidence} in ${s.about === 'self-assessment' ? 'their capability in self-assessment' : 'their educational performance'} (${s.date}).`);
  if (q.codeSignatory) lines.push('Signatory to the Code of Practice for the pastoral care of international students.');
  if (q.reports.length) lines.push(`NZQA reports published: ${q.reports.map(r => r.year).join(', ')} — available free at nzqa.govt.nz.`);
  return {
    name: q.name,
    verdict: q.cat ? `${q.cat.label}${q.statementYear ? ` (${q.statementYear})` : ''} — ${q.cat.meaning}`
                   : (q.naReason || 'NZQA publishes no provider category for this institution.'),
    lines,
    note: (q.cat ? PF_ROI_QA.systemNote + ' ' : '') +
      'A category describes the provider as a whole, not the programme, and says nothing about teaching quality in this subject. Read the NZQA report and talk to a graduate before committing money.',
  };
}

/* Build the sheet model and hand it to the PDF writer. Deliberately in
   LKR-first order: the reader is the person paying, not the student. */
function roiDownloadSheet(r) {
  const cat = window.PF_CATALOGUE;
  const subject = cat && cat.taxonomy[roiState.subjectRoot] ? cat.taxonomy[roiState.subjectRoot].n : 'Postgraduate study';
  const p = PFRoi.providerOf(roiState.providerId);
  const provName = (r.tuition.provider) || (p && p.name) || 'your provider';
  const routes = PFRoi.cheaperRoutes(r, roiState).slice(0, 4);
  const email = (window.PFCloud && PFCloud.currentEmail && PFCloud.currentEmail()) || '';

  const name = PFInvoice.downloadSheet({
    ref: 'PathFinder-decision-sheet',
    date: Date.now(),
    student: email || 'A PathFinder student',
    plan: `Master's (NZQF level 9) in ${subject} at ${provName} — ${r.city ? r.city.city : ''}, ${r.years} year${r.years === 1 ? '' : 's'}, going as ${r.who === 'single' ? 'one person' : r.who === 'couple' ? 'a couple' : 'a family'}.`,
    years: r.years,
    lines: r.costLines.map(l => ({ label: l.label, detail: l.detail, nzd: l.amount })),
    totalNZD: r.totalCost,
    studyIncomeNZD: r.studyIncomeTotal,
    netNZD: r.netCost,
    ownFundsNZD: r.ownFunds,
    gapNZD: r.gap,
    band: r.band, bandOk: r.bandCls === 'chip-ok',
    verdict: r.verdict,
    afterLines: [
      ['Likely salary in this field', PFRoi.money(r.grossAfter) + ' a year'],
      ['After tax and ACC', PFRoi.money(r.netAfter) + ' a year'],
      ['Left over after living costs', PFRoi.money(r.annualSurplus) + ' a year'],
      ['Post-study work visa', r.pswYears + ' years, open work rights'],
      ['Time to earn the cost back', PFRoi.fmtYears(r.paybackYears)],
    ],
    alternatives: routes.map(a => ({ title: a.title, tradeoff: a.tradeoff, saving: a.saving })),
    quality: roiSheetQuality(),
    fx: r.fx,
    notes: [
      `Prepared by PathFinder on ${new Date().toLocaleDateString('en-GB')}. Cost data last checked ${PF_ROI.verified}.`,
      `Tuition from ${r.tuition.label}; living costs from PathFinder city data; wages at the NZ adult minimum of NZ$${PF_CONFIG.minWageHourly}/hr from 1 April 2026; tax at IRD ${PF_ROI.tax.asOf} rates.`,
      `Salary figures are published for DOMESTIC New Zealand graduates (${PF_ROI.earnings.src}) and are an upper reference, not a forecast: an international graduate holds a ${r.pswYears}-year work visa and no guarantee of residence.`,
      `Converted at NZ$1 = LKR ${PF_ROI.fx.nzdToLkr} (${PF_ROI.fx.asOf}) for reading only — the real transfer rate will differ.`,
      `Confirm every fee with the provider in writing before committing money. PathFinder takes no commission from any provider named here.`,
    ],
  });
  toast('Saved ' + name + ' — made to be printed and read on paper.');
}

/* ── 9d · Pricing (#pricing) — what's free, what's paid ─────────────────
   Freemium model: three plans, side by side — Free, Explorer, Premium.
   Each paid plan is a single one-time payment (no subscription) that
   bundles templates with mentor time, so the price is easy to justify
   next to a migration agent's LKR 50k-200k+ fee. Mentor pay-per-session
   add-ons remain available separately via #mentors for students who want
   more time beyond their plan. */
function renderPricing(main) {
  const p = PF_CONFIG.pricing || {};
  const t = PF_CONFIG.sessionTiers || {};
  const money = n => 'LKR ' + Number(n || 0).toLocaleString();

  // Same feature list on every card; each plan lights up more of it than
  // the last, so comparing plans is a glance, not a puzzle.
  //
  // The paid rows are GENERATED from PF_CONFIG.planGrants — the same table
  // the redemption flow spends against — so what a student is promised on
  // this page and what lands in their account can't drift apart. Editing
  // the grants edits the sales copy.
  const G = PF_CONFIG.planGrants || {};
  const ex = G.explorer || {}, pr = G.premium || {};
  const nTpl = (PF_CONFIG.premiumTemplateIds || []).length;
  const nFree = PF_TEMPLATES.length - nTpl;
  const credits = (g) => [
    g.sessions ? `${g.sessions} mentor session${g.sessions === 1 ? '' : 's'}` : '',
    g.audits ? `${g.fullAudit ? 'full CV/SOP/proposal audit' : 'SOP/proposal audit'}` : '',
    g.interview ? 'interview prep' : '',
  ].filter(Boolean).join(' + ');

  const rows = [
    'Eligibility assessment, roadmap &amp; university/supervisor explorer',
    `Scholarships &amp; visa hub, Research Studio, ${nFree} starter templates`,
    `Free ${PF_CONFIG.freeIntroMinutes}-min mentor intro call`,
    `All ${nTpl} premium templates + ${credits(ex)}`,
    credits(pr),
    'Priority mentor matching + a final review before you submit',
  ];
  // Government-data analysis rides on the Premium row above rather than
  // adding a seventh line to every card — the headline figures are free,
  // so the paid part is an extension, not a separate product.
  if (pr.officialData) rows[5] += ', plus the official visa-decision analysis';

  // Only the recommended plan gets a top ribbon — labelling every card
  // ("Free" chip sitting right above a "FREE" heading, etc.) just repeats
  // itself. The other two cards reserve the same slot height so all three
  // icons still line up in a row.
  // A one-time unlock is easy to buy twice. Where the student already owns
  // a plan, the buy button becomes a link to what they still have left.
  const owned = entitlements().plans || [];
  const buyCta = (item, label, cls) => owned.includes(item)
    ? `<a class="btn btn-quiet btn-sm" href="#billing" style="width:100%;justify-content:center">
         <span class="material-symbols-outlined" aria-hidden="true">check_circle</span> You have this — see what's left</a>`
    : `<button class="${cls} pf-buy" data-item="${item}" style="width:100%;justify-content:center">${label}</button>`;

  const plans = [
    { accent: 'teal', icon: 'lightbulb', name: 'Free', included: 3,
      price: 'LKR 0', unit: '', sub: 'No account needed — your work saves on this device.',
      cta: `<a class="btn btn-quiet btn-sm" href="#assessment" style="width:100%;justify-content:center">Start free</a>` },
    { accent: 'gold', icon: 'travel_explore', name: 'Explorer', included: 4,
      price: money(p.explorer), unit: 'one-time', sub: 'For students ready to start writing their application.',
      cta: buyCta('explorer', `Get Explorer · ${money(p.explorer)}`, 'btn btn-quiet btn-sm') },
    { accent: 'rose', best: true, chip: 'Best value', icon: 'workspace_premium', name: 'Premium', included: 6,
      price: money(p.premium), unit: 'one-time', sub: 'For students who want someone alongside them from first draft to submission.',
      cta: buyCta('premium', `Get Premium · ${money(p.premium)}`, 'btn btn-sm') },
  ];

  const card = pl => `<div class="price-tier price-tier-${pl.accent}${pl.best ? ' price-tier-best' : ''}">
      <span class="chip chip-neutral" style="align-self:flex-start${pl.chip ? '' : ';visibility:hidden'}" aria-hidden="${pl.chip ? 'false' : 'true'}">${pl.chip || 'Best value'}</span>
      <div class="price-tier-icon"><span class="material-symbols-outlined" aria-hidden="true">${pl.icon}</span></div>
      <h2 class="price-tier-name mono">${pl.name}</h2>
      <p class="muted price-tier-sub">${pl.sub}</p>
      <div class="price-tier-amount">${pl.price}${pl.unit ? `<span>${pl.unit}</span>` : ''}</div>
      <ul class="price-list">${rows.map((r, i) => {
        const yes = i < pl.included;
        return `<li class="${yes ? 'yes' : 'no'}"><span class="material-symbols-outlined" aria-hidden="true">${yes ? 'check_circle' : 'remove'}</span>${r}</li>`;
      }).join('')}</ul>
      <div style="margin-top:auto;padding-top:20px">${pl.cta}</div>
    </div>`;

  main.innerHTML = renderHero({
    kicker: 'Plans & pricing', title: 'Free to explore. Pay only when you need help.',
    body: 'Explorer and Premium are one-time payments, not subscriptions.',
  }) +
    `<div class="price-tiers">${plans.map(card).join('')}</div>
    <p class="row-sub mt-6" style="max-width:640px">Extra mentor sessions are ${money(t.quick)}–${money(t.standard)} each, and a standalone application audit is ${money(p.auditSop)}–${money(p.auditFull)} — <a href="#mentors">browse mentors</a>. Partner links (IELTS prep, money transfer, insurance, flights) are clearly labelled and free to you. ${cloudOn() ? `<a href="#billing">View your purchases →</a>` : 'Sign-in and purchases need Firebase configured.'}</p>`;

  // Resolve what they already own, then repaint — so a returning customer
  // isn't sold a plan they're still holding credits from.
  if (cloudOn() && !entState.loaded) loadEntitlements(() => {
    if (location.hash.slice(1).split('?')[0] === 'pricing') route();
  });
}

/* ── 9e · Billing (#billing) — your purchases & unlocks ───────────────── */
function renderBilling(main) {
  ensureInvoice();   // every row here can mint a PDF invoice or receipt
  const head = renderHero({ kicker: 'Billing', title: 'Your purchases & invoices',
    body: 'Every purchase and mentoring session, each with an invoice you can download.' });

  if (!cloudOn()) {
    main.innerHTML = head + `<div class="listcard"><p>Purchases are tied to an account, which needs Firebase configured. See <a href="#pricing">Plans</a>.</p></div>`;
    return;
  }
  if (!(window.PFCloud && PFCloud.isSignedIn && PFCloud.isSignedIn())) {
    main.innerHTML = head + `<div class="listcard"><p><a href="#account">Create a free account</a> to buy and keep premium unlocks across devices.</p></div>`;
    return;
  }

  main.innerHTML = head + `<div id="bill-body"><div class="listcard"><p>Loading…</p></div></div>`;
  const body = $('#bill-body');
  const money = n => 'LKR ' + Number(n || 0).toLocaleString();
  const label = it => (PFPay.items()[it] && PFPay.items()[it].label) || it;
  let sessions = [];

  const orderCard = o => `<div class="card" style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
        <div>
          <strong style="font-size:14.5px">${esc(label(o.item))}</strong>
          <div class="faint" style="font-size:12.5px;margin-top:2px">${o.createdAt ? new Date(o.createdAt).toLocaleDateString() : ''} · ${money(o.amountLKR)}${o.ref ? ` · ref <span class="mono">${esc(o.ref)}</span>` : ''}</div>
        </div>
        ${payStatusChip({ paymentStatus: o.status })}
      </div>
      ${o.status === 'reported' || o.status === 'pending' ? `<p class="muted" style="font-size:12.5px;margin:10px 0 0">We’re verifying your transfer — this unlocks within 24 hours of payment.</p>` : ''}
    </div>`;

  // Sessions a mentor has written up against this account. The student sees
  // what was covered and the next steps — never the mentor's private notes
  // (sessionCard's readOnly mode drops them) — and can download the invoice.
  const sessionSection = () => !sessions.length ? '' : `
    <h2 style="font-size:1.15rem;margin:26px 0 12px">Mentoring sessions</h2>
    <p class="faint" style="font-size:12.5px;margin:0 0 14px">${sessions.length} session${sessions.length === 1 ? '' : 's'} on record · download an invoice or receipt for any of them.</p>
    ${sessions.map(s => sessionCard(s, { showMentor: true, readOnly: true })).join('')}`;

  Promise.allSettled([PFCloud.fetchMyOrders(), PFCloud.fetchMySessionsAsStudent()]).then(([o, s]) => {
    const orders = o.status === 'fulfilled' ? o.value : [];
    sessions = s.status === 'fulfilled' ? s.value : [];
    if (o.status === 'rejected' && s.status === 'rejected') {
      body.innerHTML = `<div class="card" style="border-color:var(--alert)"><p class="muted" style="font-size:13.5px">Couldn’t load your purchases. Please try again.</p></div>`;
      return;
    }
    body.innerHTML = planBalanceCard(orders)
      + (orders.length
        ? orders.map(orderCard).join('')
        : `<div class="card"><p class="muted" style="font-size:14px">No purchases yet. Browse <a href="#pricing" class="route-link" style="color:var(--route)">Plans</a> to get Explorer or Premium.</p></div>`)
      + sessionSection();

    body.addEventListener('click', e => sessionCardAction(e, {
      get: id => sessions.find(x => x.id === id),
      save: () => Promise.reject(new Error('read-only')),
      repaint: () => {},
    }));
  });
}

/* What a paid plan still has left in it. A one-time unlock is easy to buy
   and then forget — an order row saying "Premium · LKR 24,990 · Paid"
   doesn't tell a student they still have two mentor sessions and an audit
   waiting. This does, and links to where they're spent.

   Computed from the same orders the page already fetched, against the
   student's own requests, so it costs no extra read. */
function planBalanceCard(orders) {
  const g = grantsFrom(orders);
  if (!g.plans.length) return '';
  const used = creditsUsed(PFStore.getMentorRequests());
  const sessions = Math.max(0, g.sessions - used.sessions);
  const audits = Math.max(0, g.audits - used.audits);
  const line = (n, one, many, granted) => `<div class="row">
      <div class="row-main">
        <div class="row-title">${n} ${n === 1 ? one : many} left</div>
        <div class="row-sub">${granted - n} of ${granted} used</div>
      </div>
      <div class="row-actions">${n > 0
        ? `<a class="btn btn-quiet btn-sm" href="#mentors">Use ${n === 1 ? 'it' : 'one'}</a>`
        : '<span class="chip chip-neutral">All used</span>'}</div>
    </div>`;

  return `<div class="listcard" style="margin-bottom:16px">
    <div class="listcard-head">
      <h2 class="listcard-title">Included in your plan</h2>
      <span class="listcard-summary">${g.plans.map(p => (PFPay.items()[p] && PFPay.items()[p].label) || p).join(' + ')}</span>
    </div>
    ${g.sessions ? line(sessions, 'mentor session', 'mentor sessions', g.sessions) : ''}
    ${g.audits ? line(audits, g.fullAudit ? 'full document audit' : 'document audit',
                      g.fullAudit ? 'full document audits' : 'document audits', g.audits) : ''}
    <div class="chip-row mt-4">
      ${g.toolkit ? '<span class="chip chip-ok">All premium templates unlocked</span>' : ''}
      ${g.priority ? '<span class="chip chip-gold">Priority mentor matching</span>' : ''}
      ${g.interview ? '<span class="chip chip-neutral">Interview prep included</span>' : ''}
    </div>
  </div>`;
}

/* ── 9c · Account (#account) — unified front door for all roles ──
   Login is OPTIONAL for clients/students: anonymous browsing always
   works and data is saved on-device regardless. This view lets a
   visitor create or sign into a client account (to sync across
   devices, no code), points vetted mentors at the invite-only mentor
   sign-up, and points the admin at the panel. Each role lands on its
   own dashboard from here. */
function renderAccount(main) {
  if (!window.PF_FIREBASE_CONFIG || !window.PF_FIREBASE_CONFIG.apiKey) {
    main.innerHTML = renderHero({ kicker: 'Account', title: 'Accounts need Firebase',
      body: 'Sign-in and cross-device sync run on Firebase — the app still works fully on this device without it.' });
    return;
  }
  if (!window.PFCloud) {
    main.innerHTML = renderHero({ kicker: 'Account', title: 'Connecting…', body: 'Loading the accounts layer.' });
    setTimeout(() => { if (location.hash.slice(1).split('?')[0] === 'account') route(); }, 400);
    return;
  }
  const role = PFCloud.role();
  if (role === 'anon') return accountAuth(main);
  return accountStatus(main, role);
}

/* Signed-in: who you are, your role, and the door to your dashboard. */
function accountStatus(main, role) {
  const email = (PFCloud.currentEmail && PFCloud.currentEmail()) || '';
  const prof = (PFCloud.getMentorProfile && PFCloud.getMentorProfile()) || null;
  const cfg = {
    admin:          ['admin_panel_settings', 'Admin', 'chip-alert', 'You are signed in as the platform admin.', 'Open Admin panel', '#admin'],
    mentor:         ['badge', 'Mentor · approved', 'chip-ok', 'Your mentor account is approved — claim requests from the shared queue.', 'Open Mentor Dashboard', '#mentor'],
    mentor_pending: ['hourglass_top', 'Mentor · pending', 'chip-warn', 'Your mentor application is awaiting admin approval.', 'View status', '#mentor'],
    client:         ['account_circle', 'Client / Student', 'chip-info', 'Your roadmap, applications and mentor requests sync across every device you sign into.', 'Open Dashboard', '#dashboard'],
  }[role] || ['account_circle', 'Signed in', 'chip-neutral', '', 'Open Dashboard', '#dashboard'];

  main.innerHTML = renderHero({ kicker: 'Account', title: 'Your account', body: "You're signed in — manage your session below." }) +
    `<div class="listcard" style="max-width:560px">
      <span class="chip ${cfg[2]}">${cfg[1]}</span>
      <p style="font-size:14.5px;margin:12px 0 0"><strong>${esc(email || (prof && prof.displayName) || 'Signed in')}</strong></p>
      <p class="mt-3">${cfg[3]}</p>
      <div class="hero-actions mt-5">
        <a class="btn" href="${cfg[5]}">${cfg[4]}</a>
        <button type="button" class="btn btn-quiet" id="acc-out">Sign out</button>
      </div>
    </div>`;
  $('#acc-out').onclick = () => (role === 'admin' ? PFCloud.signOutAdmin() : PFCloud.signOutUser());
}

/* Not signed in: client sign-up / sign-in (no code) + invite-only doors
   to the mentor and admin flows. */
function accountAuth(main) {
  main.innerHTML = renderHero({
    kicker: 'Account', title: 'Sign in or create an account',
    body: 'Optional, and free. Your work is already saved — an account is what makes it follow you to another device, and what a mentor request is tied to.',
  }) +
    `<div class="viewgrid">
      <div class="listcard">
        <span class="chip chip-info">Client / Student</span>
        <h2 class="listcard-title mt-3">Create a free account</h2>
        <p>No code needed. Sync your roadmap, applications and saved opportunities across devices.</p>
        <input class="field mt-4" id="ac-email" type="email" autocomplete="email" placeholder="you@example.com">
        <input class="field mt-3" id="ac-pass" type="password" autocomplete="current-password" placeholder="Password (6+ characters)">
        <p class="faint" id="ac-msg" style="font-size:12.5px;min-height:16px;margin-top:8px"></p>
        <div class="hero-actions mt-3">
          <button type="button" class="btn btn-sm" id="ac-signup">Create account</button>
          <button type="button" class="btn btn-quiet btn-sm" id="ac-signin">I already have one</button>
          <button type="button" class="btn btn-quiet btn-sm" id="ac-google"><span class="material-symbols-outlined" aria-hidden="true">login</span> Google</button>
        </div>
      </div>
      <div class="aside">
        <div class="sidecard">
          <span class="chip chip-ok">Mentor</span> <span class="chip chip-neutral">Invite-only</span>
          <h2 class="listcard-title mt-3" style="font-size:1.05rem">Mentor access</h2>
          <p>If you've been given an invite code, continue to set up your mentor account.</p>
          <a class="btn btn-quiet" href="#mentor"><span class="material-symbols-outlined" aria-hidden="true">badge</span> Enter mentor sign-up</a>
        </div>
        <div class="sidecard">
          <span class="chip chip-alert">Admin</span>
          <h2 class="listcard-title mt-3" style="font-size:1.05rem">Admin access</h2>
          <p>Platform owners only.</p>
          <a class="btn btn-quiet" href="#admin"><span class="material-symbols-outlined" aria-hidden="true">lock</span> Go to admin sign-in</a>
        </div>
      </div>
    </div>`;

  const email = $('#ac-email'), pass = $('#ac-pass'), msg = $('#ac-msg');
  const creds = () => ({ e: email.value.trim(), p: pass.value });
  $('#ac-signup').onclick = async () => {
    const { e, p } = creds();
    if (!e || p.length < 6) { msg.textContent = 'Enter an email and a 6+ character password.'; return; }
    msg.textContent = 'Creating account…';
    try { await PFCloud.signUpEmail(e, p); toast('Account created — your data now syncs'); resumeAfterAuth(); }
    catch (err) { msg.textContent = humanAuthError(err); }
  };
  $('#ac-signin').onclick = async () => {
    const { e, p } = creds();
    if (!e || !p) { msg.textContent = 'Enter your email and password.'; return; }
    msg.textContent = 'Signing in…';
    try { await PFCloud.signInEmail(e, p); toast('Signed in'); resumeAfterAuth(); }
    catch (err) { msg.textContent = humanAuthError(err); }
  };
  $('#ac-google').onclick = async () => {
    try { await PFCloud.signInGoogle(); toast('Signed in'); resumeAfterAuth(); }
    catch (err) { msg.textContent = humanAuthError(err); }
  };
}

/* ── 9b0 · People — the client book ──────────────────────────────────
   Someone rings in March, WhatsApps in May, and books a paid session in
   June. To a mentor that is one person. To Firestore it is a request doc
   and two session docs, with the phone number typed three different ways.

   This groups them back into people. It is derived entirely from records
   the dashboard has ALREADY loaded — there is no `people` collection, no
   extra read and nothing new to secure — so the client book costs nothing
   on the free plan and can never drift out of step with the records it
   summarises.

   The key is the last nine digits of the phone number, so 0771234567,
   +94 77 123 4567 and 94771234567 all land on the same person; then an
   email; then, if neither was written down, the name. */

function contactEmailOf(contact) {
  const m = String(contact || '').match(/[^\s,;<>()]+@[^\s,;<>()]+\.[^\s,;<>()]+/);
  return m ? m[0].toLowerCase() : '';
}

function contactPhoneOf(contact) {
  const email = contactEmailOf(contact);
  const digits = String(contact || '').replace(email, '').replace(/\D/g, '');
  return digits.length >= 7 ? digits : '';
}

function contactKey(contact, name) {
  const phone = contactPhoneOf(contact);
  if (phone) return 'p:' + phone.slice(-9);
  const email = contactEmailOf(contact);
  if (email) return 'e:' + email;
  const n = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return n ? 'n:' + n : '';
}

/* A Sri Lankan mobile written any of the usual ways → the international
   form wa.me needs (94771234567). A number that already carries some other
   country code is left as it is. */
function waNumber(contact) {
  const d = contactPhoneOf(contact);
  if (!d) return '';
  if (d.startsWith('94')) return d;
  if (d.startsWith('0')) return '94' + d.slice(1);
  if (d.length === 9) return '94' + d;
  return d;
}

/* Fold requests + sessions into one row per person. Both lists are
   optional — the mentor dashboard passes its own, the admin passes
   everyone's, and the shape that comes out is identical. */
function buildPeople({ sessions = [], requests = [] } = {}) {
  const map = new Map();

  const touch = (name, contact, uid) => {
    const key = contactKey(contact, name);
    if (!key) return null;
    if (!map.has(key)) {
      map.set(key, { key, name: '', contact: '', uid: '', sessions: [], requests: [],
                     lastAt: 0, paid: 0, due: 0, minutes: 0, topics: [] });
    }
    const p = map.get(key);
    if (!p.name && name) p.name = name;
    if (!p.contact && contact) p.contact = contact;
    if (!p.uid && uid) p.uid = uid;
    return p;
  };

  (requests || []).forEach(r => {
    const p = touch(r.name, r.contact, r.studentUid);
    if (!p) return;
    p.requests.push(r);
    p.lastAt = Math.max(p.lastAt, r.updatedAt || r.createdAt || Date.parse(r.at) || 0);
    if (r.topic && !p.topics.includes(r.topic)) p.topics.push(r.topic);
  });

  (sessions || []).forEach(s => {
    const p = touch(s.studentName, s.studentContact, s.studentUid);
    if (!p) return;
    p.sessions.push(s);
    const amt = Number(s.amountLKR) || 0;
    if (s.paymentStatus === 'paid') p.paid += amt;
    else if (s.paymentStatus !== 'waived') p.due += amt;
    p.minutes += Number(s.durationMin) || 0;
    p.lastAt = Math.max(p.lastAt, Date.parse(s.date) || s.createdAt || 0);
    if (s.topic && !p.topics.includes(s.topic)) p.topics.push(s.topic);
  });

  return [...map.values()].map(p => {
    p.sessions.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    p.requests.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return p;
  }).sort((a, b) => b.lastAt - a.lastAt);
}

/* The line that makes a returning caller obvious the moment their number
   is typed into the session form: "3rd session with Nimali. Last one was
   12 June — Visa documents." */
function peopleFind(people, contact, name) {
  const key = contactKey(contact, name);
  return key ? (people || []).find(p => p.key === key) || null : null;
}

const dayLabel = v => {
  const t = typeof v === 'number' ? v : Date.parse(v);
  return t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
};

/* Everything already known about one person, ready to read before the
   next call — what was covered, what was agreed, what is still owed. */
function personHistoryHTML(p, opts = {}) {
  if (!p) return '';
  const rows = [];
  p.sessions.forEach(s => rows.push({
    at: Date.parse(s.date) || s.createdAt || 0, kind: 'session',
    head: sessionTitle(s), when: dayLabel(s.date) || dayLabel(s.createdAt),
    meta: [PF_SESSION_CHANNELS[s.channel] || s.channel,
           Number(s.durationMin) ? s.durationMin + ' min' : '',
           opts.showMentor && s.mentorName ? 'by ' + s.mentorName : ''].filter(Boolean).join(' · '),
    body: s.summary, next: s.followUp, chip: sessionPayChip(s),
  }));
  p.requests.forEach(r => rows.push({
    at: r.updatedAt || r.createdAt || Date.parse(r.at) || 0, kind: 'request',
    head: PF_CONSULT_TOPICS[r.topic] || 'General guidance',
    when: dayLabel(r.createdAt || r.at),
    meta: PF_REQUEST_SOURCES[r.source] || 'Asked on PathFinder',
    body: r.note, next: r.callback ? 'Call back: ' + r.callback : '',
    chip: reqStatusChip(r.status),
  }));
  rows.sort((a, b) => b.at - a.at);

  if (!rows.length) return `<p class="muted" style="font-size:13px;margin:0">Nothing on record yet.</p>`;
  return rows.map(r => `<div style="padding:10px 0;border-top:1px dashed var(--line)">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:baseline">
        <strong style="font-size:13.5px">${esc(r.head)}</strong>
        <span class="faint" style="font-size:12px">${esc(r.when)}${r.meta ? ' · ' + esc(r.meta) : ''}</span>
        <span style="margin-left:auto">${r.chip}</span>
      </div>
      ${r.body ? `<p class="muted" style="font-size:13px;margin:5px 0 0;white-space:pre-wrap">${esc(r.body)}</p>` : ''}
      ${r.next ? `<p class="faint" style="font-size:12.5px;margin:5px 0 0;white-space:pre-wrap">→ ${esc(r.next)}</p>` : ''}
    </div>`).join('');
}

/* One person as a dashboard card. The buttons are the three things you
   actually do next: ring them, message them, or write up the session you
   just finished with them. */
function personCard(p, opts = {}) {
  const wa = waNumber(p.contact);
  const mail = contactEmailOf(p.contact);
  const phone = contactPhoneOf(p.contact);
  const openReq = p.requests.filter(r => !['completed', 'cancelled'].includes(r.status)).length;
  const chips = [
    p.sessions.length ? `<span class="chip chip-dim">${p.sessions.length} session${p.sessions.length === 1 ? '' : 's'}</span>` : '',
    openReq ? `<span class="chip chip-gold">${openReq} open request${openReq === 1 ? '' : 's'}</span>` : '',
    p.due ? `<span class="chip chip-gold">LKR ${p.due.toLocaleString()} due</span>` : '',
    p.paid ? `<span class="chip chip-teal">LKR ${p.paid.toLocaleString()} paid</span>` : '',
    p.uid ? `<span class="chip chip-dim">Has an account</span>` : `<span class="chip chip-dim">No account</span>`,
  ].filter(Boolean).join('');

  return `<div class="card" style="margin-bottom:12px" data-person="${esc(p.key)}">
    <div style="display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;align-items:flex-start">
      <div style="flex:1;min-width:220px">
        <strong style="font-size:14.5px">${esc(p.name || 'Unnamed')}</strong>
        ${p.contact ? `<span class="faint" style="font-size:12.5px"> · ${esc(p.contact)}</span>` : ''}
        <div class="faint" style="font-size:12.5px;margin-top:3px">
          ${p.lastAt ? 'Last contact ' + esc(dayLabel(p.lastAt)) : 'No date on record'}${p.minutes ? ' · ' + (p.minutes / 60).toFixed(1) + ' h together' : ''}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${chips}</div>
      </div>
    </div>
    <div style="margin-top:14px;padding-top:12px;border-top:1px dashed var(--line);display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      ${wa ? `<a class="btn btn-quiet btn-sm" href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
      ${phone ? `<a class="btn btn-quiet btn-sm" href="tel:${esc(phone)}">Call</a>` : ''}
      ${mail ? `<a class="btn btn-quiet btn-sm" href="mailto:${esc(mail)}">Email</a>` : ''}
      <button class="btn btn-quiet btn-sm px-history" data-person="${esc(p.key)}">History</button>
      ${opts.canLog ? `<button class="btn btn-primary btn-sm px-log" data-person="${esc(p.key)}" style="margin-left:auto">
        <span class="material-symbols-outlined" style="font-size:15px">edit_note</span> Log a session</button>` : ''}
    </div>
    <div class="px-hist hidden" data-person="${esc(p.key)}" style="margin-top:6px"></div>
  </div>`;
}

/* Delegated actions for person cards. `ctx = { people, canLog, onLog }`.
   Returns true when the click belonged to a person card. */
function personCardAction(e, ctx) {
  const btn = e.target.closest('button[data-person]');
  if (!btn) return false;
  const p = (ctx.people || []).find(x => x.key === btn.dataset.person);
  if (!p) return true;

  if (btn.classList.contains('px-history')) {
    const box = btn.closest('.card').querySelector('.px-hist');
    const open = !box.classList.contains('hidden');
    if (open) { box.classList.add('hidden'); btn.textContent = 'History'; }
    else {
      box.innerHTML = personHistoryHTML(p, { showMentor: ctx.showMentor });
      box.classList.remove('hidden');
      btn.textContent = 'Hide history';
    }
    return true;
  }
  if (btn.classList.contains('px-log') && ctx.onLog) { ctx.onLog(p); return true; }
  return true;
}

/* ── 9b0b · Phone / walk-in intake ───────────────────────────────────
   The call that starts everything. Someone rings the platform, or messages
   the WhatsApp line, and they have no account and no intention of making
   one before they know whether this is worth their money.

   Whoever picks up opens this form and writes down four things: who they
   are, how to reach them, what they need, and when to call back. Saving it
   creates an ordinary `mentor_requests` doc — the SAME record a request
   typed on the site produces — so from that moment the caller is in the
   queue, on a dashboard, in the client book, and eventually on an invoice,
   with no separate off-platform path to maintain.

   `mentors` (admin only) turns on the assign-to picker; a mentor taking
   their own call simply keeps it. */
function openIntakeForm(o = {}) {
  const opt = (v, lbl, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(lbl)}</option>`;
  const lbl = t => `<label class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;display:block;margin-bottom:5px">${t}</label>`;
  const mentors = o.mentors || null;

  const m = modal('Someone called', `
    <p class="muted" style="font-size:13.5px;margin:0 0 16px">
      Write down what they told you. They don’t need an account — this goes straight
      into the request queue, and you can log the session and send an invoice from it later.
    </p>
    <form id="ix-form" style="display:flex;flex-direction:column;gap:14px">
      <div class="grid-2" style="gap:14px">
        <div>${lbl('Their name')}<input class="field" name="name" required placeholder="e.g. Nimali Perera" autocomplete="off"></div>
        <div>${lbl('Phone / WhatsApp / email')}<input class="field" name="contact" required placeholder="077 123 4567" autocomplete="off"></div>
      </div>
      <div class="grid-2" style="gap:14px">
        <div>${lbl('How they reached us')}
          <select class="field" name="source">
            ${Object.entries(PF_REQUEST_SOURCES).filter(([k]) => k !== 'platform')
              .map(([k, v]) => opt(k, v, k === 'call')).join('')}
          </select></div>
        <div>${lbl('What they need help with')}
          <select class="field" name="topic">
            ${opt('', 'General guidance', true)}
            ${Object.entries(PF_CONSULT_TOPICS).map(([k, v]) => opt(k, v)).join('')}
          </select></div>
      </div>
      <div>${lbl('What they said')}
        <textarea class="field" name="note" rows="3" placeholder="Finished her degree at Peradeniya, wants a master's in data science, asking how much money she has to show for the visa."></textarea></div>
      <div class="grid-2" style="gap:14px">
        <div>${lbl('Best time to call back')}
          <input class="field" name="callback" placeholder="e.g. Weekdays after 6pm"></div>
        ${mentors ? `<div>${lbl('Give it to')}
          <select class="field" name="mentorId">
            ${opt('', 'Leave in the open queue', true)}
            ${mentors.map(x => opt(x.uid, x.displayName || x.uid.slice(0, 8))).join('')}
          </select></div>`
        : `<div>${lbl('Who handles it')}
          <select class="field" name="mine">
            ${opt('1', 'I’ll handle it', true)}
            ${opt('', 'Leave in the open queue')}
          </select></div>`}
      </div>
      <p class="faint" id="ix-msg" style="font-size:12.5px;min-height:16px;margin:0"></p>
      <button class="btn btn-primary" type="submit" style="justify-content:center">Save this request</button>
    </form>`);
  m.el.querySelector('.modal-card').style.maxWidth = '620px';

  const form = m.el.querySelector('#ix-form');
  const msg = m.el.querySelector('#ix-msg');

  form.onsubmit = async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    if (!data.name.trim())    { msg.textContent = 'Write down their name.'; return; }
    if (!data.contact.trim()) { msg.textContent = 'Write down a phone number or email.'; return; }
    // A mentor taking their own call assigns it to themselves; the admin
    // picks a mentor (or leaves it open for the queue).
    if (!mentors) data.mentorId = data.mine ? 'self' : '';
    delete data.mine;

    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    msg.textContent = 'Saving…';
    try {
      await o.onSave(data);
      m.close();
      toast('Saved — ' + data.name.trim() + ' is in the queue');
    } catch (err) {
      btn.disabled = false;
      msg.textContent = humanAuthError(err);
    }
  };
  form.querySelector('[name=name]').focus();
}

/* ── 9b1 · Mentoring session records ─────────────────────────────────
   A lot of real mentoring never touches the in-app request queue: a
   student messages a mentor on WhatsApp, or rings them. The session log
   records those the same way as platform requests — who, when, how long,
   over which channel, what was covered, private notes, the fee and its
   payment state — and every record can be turned into a PDF invoice or
   receipt (assets/js/invoice.js).

   Shared by BOTH dashboards: mentors log and invoice their own sessions
   (#mentor → Session log); the admin sees every mentor's and can log one
   on their behalf (#admin → Sessions). One card renderer, one form, one
   action handler — the only difference is which PFCloud call saves it. */

const SESSION_PAY_SHORT = { unpaid: 'Unpaid', reported: 'Payment reported', paid: 'Paid', waived: 'No charge' };

function sessionPayChip(s) {
  const ps = s.paymentStatus || 'unpaid';
  const amt = Number(s.amountLKR) || 0;
  const cls = { unpaid: 'chip-gold', reported: 'chip-violet', paid: 'chip-teal', waived: 'chip-dim' };
  const lbl = (ps === 'waived' || !amt) ? 'No charge'
    : `${SESSION_PAY_SHORT[ps] || ps} · LKR ${amt.toLocaleString()}`;
  return `<span class="chip ${cls[ps] || 'chip-dim'}">${lbl}</span>`;
}

const sessionTitle = s => s.title || PF_CONSULT_TOPICS[s.topic] || 'General guidance';

/* One session record as a dashboard card. `showMentor` adds the mentor's
   name (the admin view spans everyone); `readOnly` drops the edit and
   payment controls but keeps the invoice buttons. */
function sessionCard(s, opts = {}) {
  const mins = Number(s.durationMin) || 0;
  const amt = Number(s.amountLKR) || 0;
  const paid = s.paymentStatus === 'paid';
  const meta = [
    PF_SESSION_CHANNELS[s.channel] || s.channel,
    s.date,
    mins ? mins + ' min' : '',
    opts.showMentor && s.mentorName ? 'by ' + s.mentorName : '',
  ].filter(Boolean).map(esc).join(' · ');

  const block = (label, body) => body
    ? `<div style="margin-top:10px">
        <div class="faint" style="font-family:var(--font-mono);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase">${label}</div>
        <p class="muted" style="font-size:13px;margin:3px 0 0;white-space:pre-wrap">${esc(body)}</p>
      </div>` : '';

  return `<div class="card" style="margin-bottom:12px" data-sess-card="${esc(s.id)}">
    <div style="display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;align-items:flex-start">
      <div style="flex:1;min-width:220px">
        <strong style="font-size:14.5px">${esc(s.studentName || 'Student')}</strong>
        ${s.studentContact ? `<span class="faint" style="font-size:12.5px"> · ${esc(s.studentContact)}</span>` : ''}
        <div style="font-size:13.5px;margin-top:3px">${esc(sessionTitle(s))}</div>
        <div class="faint" style="font-size:12.5px;margin-top:2px">${meta}</div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
        ${sessionPayChip(s)}
        ${s.requestId ? `<span class="chip chip-dim">From request</span>` : ''}
      </div>
    </div>
    ${block('What we covered', s.summary)}
    ${block('Private notes', opts.readOnly ? '' : s.notes)}
    ${block('Next steps', s.followUp)}
    <div style="margin-top:14px;padding-top:12px;border-top:1px dashed var(--line);display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <span class="faint mono" style="font-size:11px">${esc(s.invoiceNo || '—')}</span>
      <button class="btn btn-primary btn-sm sx-send" data-sess="${esc(s.id)}" style="margin-left:auto">
        <span class="material-symbols-outlined" style="font-size:15px">send</span> Send it</button>
      <button class="btn btn-quiet btn-sm sx-invoice" data-sess="${esc(s.id)}">PDF</button>
      <button class="btn btn-quiet btn-sm sx-preview" data-sess="${esc(s.id)}">Preview</button>
      ${!opts.readOnly && !paid && amt ? `<button class="btn btn-quiet btn-sm sx-paid" data-sess="${esc(s.id)}">Mark paid</button>` : ''}
      ${!opts.readOnly ? `<button class="btn btn-quiet btn-sm sx-edit" data-sess="${esc(s.id)}">Edit</button>` : ''}
    </div>
  </div>`;
}

/* The log/edit form. Deliberately one screen: everything a mentor needs
   to write down straight after a WhatsApp call, including the fee, so the
   invoice can be generated in the same breath. */
function sessionFormHTML(s, mentors) {
  const opt = (v, lbl, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(lbl)}</option>`;
  const lbl = t => `<label class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;display:block;margin-bottom:5px">${t}</label>`;

  return `<form id="sx-form" style="display:flex;flex-direction:column;gap:14px">
    ${mentors ? `<div>${lbl('Which mentor did this session')}
      <select class="field" name="mentorId">
        ${mentors.map(m => opt(m.uid, m.displayName || m.uid.slice(0, 8), s.mentorId === m.uid)).join('')}
      </select></div>` : ''}
    <div class="grid-2" style="gap:14px">
      <div>${lbl('Their name')}<input class="field" name="studentName" required value="${esc(s.studentName)}" placeholder="e.g. Nimali Perera"></div>
      <div>${lbl('Phone / WhatsApp / email')}<input class="field" name="studentContact" value="${esc(s.studentContact)}" placeholder="077 123 4567"></div>
    </div>
    <div id="sx-known" class="hidden"></div>
    <div class="grid-2" style="gap:14px">
      <div>${lbl('How it happened')}
        <select class="field" name="channel">
          ${Object.entries(PF_SESSION_CHANNELS).map(([k, v]) => opt(k, v, s.channel === k)).join('')}
        </select></div>
      <div>${lbl('Topic')}
        <select class="field" name="topic">
          ${opt('', 'General guidance', !s.topic)}
          ${Object.entries(PF_CONSULT_TOPICS).map(([k, v]) => opt(k, v, s.topic === k)).join('')}
        </select></div>
    </div>
    <div>${lbl('Title (optional — the topic is used if you leave this)')}
      <input class="field" name="title" value="${esc(s.title)}" placeholder="e.g. Went through her proposal and picked three supervisors"></div>
    <div class="grid-2" style="gap:14px">
      <div>${lbl('Date')}<input class="field" type="date" name="date" value="${esc(s.date)}"></div>
      <div>${lbl('How long (minutes)')}<input class="field" type="number" name="durationMin" min="0" step="5" value="${esc(s.durationMin)}"></div>
    </div>
    <div>${lbl('What you covered — this goes on the invoice')}
      <textarea class="field" name="summary" rows="3" placeholder="Read through her SOP draft, picked three supervisors at Otago, and worked out what funding evidence she still needs.">${esc(s.summary)}</textarea></div>
    <div>${lbl('Private notes — only you see these')}
      <textarea class="field" name="notes" rows="2" placeholder="Anything you want to remember before the next call.">${esc(s.notes)}</textarea></div>
    <div>${lbl('What you agreed to do next — this goes on the invoice')}
      <textarea class="field" name="followUp" rows="2" placeholder="She sends the new SOP by Friday. I reply within two days.">${esc(s.followUp)}</textarea></div>
    <div class="grid-2" style="gap:14px">
      <div>${lbl('Fee in LKR — put 0 for a free intro')}
        <input class="field" type="number" name="amountLKR" min="0" step="100" value="${esc(s.amountLKR)}"></div>
      <div>${lbl('Has it been paid?')}
        <select class="field" name="paymentStatus">
          ${Object.entries(PF_SESSION_PAYMENT_STATES).map(([k, v]) => opt(k, v, s.paymentStatus === k)).join('')}
        </select></div>
    </div>
    <div class="grid-2" style="gap:14px">
      <div>${lbl('How they paid (optional)')}<input class="field" name="method" value="${esc(s.method)}" placeholder="Bank transfer / eZ Cash / FriMi"></div>
      <div>${lbl('Reference number (optional)')}<input class="field" name="ref" value="${esc(s.ref)}" placeholder="What they put on the transfer"></div>
    </div>
    <p class="faint" id="sx-msg" style="font-size:12.5px;min-height:16px;margin:0"></p>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-primary" type="submit" style="flex:1;justify-content:center">Save</button>
      <button class="btn btn-quiet" type="button" id="sx-save-inv" style="flex:1;justify-content:center">Save and make the invoice</button>
    </div>
  </form>`;
}

/* Open the log/edit modal. `onSave(data)` persists and should resolve to
   the stored record (so "Save & invoice" can print the real invoice
   number straight after a create). */
function openSessionForm(o = {}) {
  const base = {
    studentName: '', studentContact: '', studentUid: '', channel: 'whatsapp', topic: '',
    title: '', date: new Date().toISOString().slice(0, 10), durationMin: 45,
    summary: '', notes: '', followUp: '', requestId: '', mentorId: '',
    amountLKR: PF_CONFIG.defaultSessionPriceLKR, paymentStatus: 'unpaid',
    method: '', ref: '',
  };
  const s = Object.assign(base, o.session || o.prefill || {});
  const editing = !!o.session;
  const m = modal(editing ? 'Edit this session' : 'Write up a session',
    sessionFormHTML(s, o.mentors));
  m.el.querySelector('.modal-card').style.maxWidth = '640px';

  const form = m.el.querySelector('#sx-form');
  const msg = m.el.querySelector('#sx-msg');

  async function submit(alsoInvoice) {
    const fd = new FormData(form);
    const data = Object.fromEntries(fd.entries());
    data.durationMin = Number(data.durationMin) || 0;
    data.amountLKR = Math.max(0, Number(data.amountLKR) || 0);
    // Carry the fields the form doesn't expose but the record owns.
    data.studentUid = s.studentUid || '';
    data.requestId = s.requestId || '';
    if (!data.mentorId && s.mentorId) data.mentorId = s.mentorId;
    if (data.paymentStatus === 'paid' && !s.paidAt) data.paidAt = Date.now();
    if (!data.studentName.trim()) { msg.textContent = 'Write down their name.'; return; }

    const btns = [...form.querySelectorAll('button')];
    btns.forEach(b => b.disabled = true);
    msg.textContent = 'Saving…';
    try {
      const saved = await o.onSave(data);
      m.close();
      toast(editing ? 'Session updated' : 'Session saved');
      if (alsoInvoice) {
        const rec = Object.assign({}, s, data, saved || {});
        PFInvoice.download(PFInvoice.fromSession(rec));
      }
    } catch (err) {
      btns.forEach(b => b.disabled = false);
      msg.textContent = humanAuthError(err);
    }
  }

  /* Returning-caller strip. The moment the phone number matches someone
     already in the client book, show what was covered last time — the
     single most useful thing to have in front of you while writing up a
     repeat session, and free, because the people list was derived from
     records the dashboard already holds. */
  const known = m.el.querySelector('#sx-known');
  const nameIn = form.querySelector('[name=studentName]');
  const contactIn = form.querySelector('[name=studentContact]');

  function paintKnown() {
    const p = peopleFind(o.people, contactIn.value, nameIn.value);
    // Editing an existing record: its own row is the match, not a history.
    const past = p ? { ...p, sessions: p.sessions.filter(x => x.id !== (o.session && o.session.id)) } : null;
    if (!past || (!past.sessions.length && !past.requests.length)) { known.classList.add('hidden'); return; }
    const last = past.sessions[0];
    known.className = 'card';
    known.style.cssText = 'padding:12px 14px;background:var(--surface)';
    known.innerHTML = `
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <span class="material-symbols-outlined" style="font-size:18px;color:var(--route)">history</span>
        <p style="flex:1;min-width:200px;font-size:13px;margin:0">
          You’ve already worked with <strong>${esc(past.name || 'them')}</strong> —
          ${past.sessions.length} session${past.sessions.length === 1 ? '' : 's'}${past.due ? `, <strong>LKR ${past.due.toLocaleString()}</strong> still due` : ''}.
          ${last ? `Last time: ${esc(sessionTitle(last))}${last.date ? ' on ' + esc(dayLabel(last.date)) : ''}.` : ''}
        </p>
        <button class="btn btn-quiet btn-sm" type="button" id="sx-known-more">Show</button>
      </div>
      <div id="sx-known-body" class="hidden" style="margin-top:4px"></div>`;
    const more = known.querySelector('#sx-known-more');
    const bodyEl = known.querySelector('#sx-known-body');
    more.onclick = () => {
      const open = !bodyEl.classList.contains('hidden');
      if (open) { bodyEl.classList.add('hidden'); more.textContent = 'Show'; }
      else { bodyEl.innerHTML = personHistoryHTML(past); bodyEl.classList.remove('hidden'); more.textContent = 'Hide'; }
    };
  }
  if (o.people && o.people.length) {
    nameIn.addEventListener('input', paintKnown);
    contactIn.addEventListener('input', paintKnown);
    paintKnown();
  }

  form.onsubmit = e => { e.preventDefault(); submit(false); };
  m.el.querySelector('#sx-save-inv').onclick = () => submit(true);
  nameIn.focus();
}

/* ── 9b2 · Getting the invoice to the client ─────────────────────────
   Someone who rang the platform has no account, so they will never open
   #billing to find their receipt. It has to be sent to them, and here that
   means WhatsApp — which is where the conversation already happened.

   A browser cannot attach a file to a wa.me link, so the flow is honest
   about the two steps: download the PDF, then send the message with the
   PDF attached. The message itself is written out in full, so the mentor
   never has to compose one at 10pm after a call. */

/* Bank / wallet lines for an unpaid invoice, from PF_CONFIG.manualPay.
   Blank until the owner fills those in before launch — in which case the
   message simply omits the "to pay" block rather than printing "TODO". */
function payInstructionLines() {
  const m = PF_CONFIG.manualPay || {};
  if (!m.enabled) return [];
  const out = [];
  const bank = [m.bankName, m.accountName, m.accountNo, m.branch].filter(Boolean).join(' · ');
  if (m.accountNo) out.push(bank);
  (m.wallets || []).forEach(w => { if (w && w.number) out.push(w.name + ': ' + w.number); });
  return out;
}

function sessionInvoiceMessage(s) {
  const amt = Number(s.amountLKR) || 0;
  const paid = s.paymentStatus === 'paid';
  const waived = s.paymentStatus === 'waived' || !amt;
  const first = String(s.studentName || '').trim().split(/\s+/)[0] || 'there';
  const when = dayLabel(s.date) || dayLabel(s.createdAt);

  const out = [`Hi ${first},`, ''];
  out.push(waived ? `Here is the record of our session${when ? ' on ' + when : ''}. There is no charge for it.`
    : paid ? `Thanks for the payment. Here is your receipt for our session${when ? ' on ' + when : ''}.`
    : `Here is the invoice for our session${when ? ' on ' + when : ''}.`);
  out.push('', sessionTitle(s));
  out.push(waived ? 'Amount: no charge' : 'Amount: LKR ' + amt.toLocaleString());
  if (s.invoiceNo) out.push('Invoice no: ' + s.invoiceNo);
  if (s.followUp) out.push('', 'What we agreed:', s.followUp);
  if (!paid && !waived) {
    const pay = payInstructionLines();
    if (pay.length) out.push('', 'You can pay to:', ...pay, 'Please put the invoice number in the payment note.');
  }
  out.push('', 'The PDF is attached.', '', s.mentorName ? s.mentorName + ' — PathFinder' : 'PathFinder');
  return out.join('\n');
}

function openSendInvoice(s) {
  const msg = sessionInvoiceMessage(s);
  const wa = waNumber(s.studentContact);
  const mail = contactEmailOf(s.studentContact);
  const subject = (s.invoiceNo ? s.invoiceNo + ' — ' : '') + 'Your PathFinder session';
  const waHref = 'https://wa.me/' + wa + '?text=' + encodeURIComponent(msg);
  const mailHref = 'mailto:' + mail + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(msg);

  const m = modal('Send the invoice', `
    <p class="muted" style="font-size:13.5px;margin:0 0 14px">
      For <strong>${esc(s.studentName || 'this client')}</strong>${s.studentContact ? ` · ${esc(s.studentContact)}` : ''}.
      ${s.studentUid ? 'They also have an account, so this invoice already shows up under their Billing.'
        : 'They have no account, so send it to them directly.'}
    </p>
    <div class="card" style="margin-bottom:14px">
      <div class="faint" style="font-family:var(--font-mono);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase">Step 1</div>
      <p style="font-size:13.5px;margin:4px 0 10px">Download the PDF, then attach it to the message.</p>
      <button class="btn btn-primary btn-sm" id="ix-dl">
        <span class="material-symbols-outlined" style="font-size:15px">picture_as_pdf</span> Download ${esc(s.invoiceNo || 'the PDF')}</button>
    </div>
    <div class="card">
      <div class="faint" style="font-family:var(--font-mono);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase">Step 2</div>
      <p style="font-size:13.5px;margin:4px 0 10px">Send it. The message below is ready — change anything you like.</p>
      <textarea class="field" id="ix-msg-body" rows="9" style="font-size:13px">${esc(msg)}</textarea>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        ${wa ? `<a class="btn btn-primary btn-sm" id="ix-wa" href="${esc(waHref)}" target="_blank" rel="noopener">Open WhatsApp</a>`
             : `<span class="faint" style="font-size:12.5px">No phone number on this record — copy the message instead.</span>`}
        ${mail ? `<a class="btn btn-quiet btn-sm" id="ix-mail" href="${esc(mailHref)}">Open email</a>` : ''}
        <button class="btn btn-quiet btn-sm" id="ix-copy">Copy message</button>
      </div>
    </div>`);
  m.el.querySelector('.modal-card').style.maxWidth = '560px';

  const box = m.el.querySelector('#ix-msg-body');
  // Keep the share links in step with any edit the mentor makes.
  box.addEventListener('input', () => {
    const t = encodeURIComponent(box.value);
    const w = m.el.querySelector('#ix-wa');
    const e = m.el.querySelector('#ix-mail');
    if (w) w.href = 'https://wa.me/' + wa + '?text=' + t;
    if (e) e.href = 'mailto:' + mail + '?subject=' + encodeURIComponent(subject) + '&body=' + t;
  });

  m.el.querySelector('#ix-dl').onclick = () => {
    PFInvoice.download(PFInvoice.fromSession(s));
    toast('Downloaded ' + (s.invoiceNo || 'the invoice'));
  };
  m.el.querySelector('#ix-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(box.value); toast('Message copied'); }
    catch { box.select(); toast('Press Ctrl+C to copy'); }
  };
}

/* Delegated actions for session cards. Returns true when the click was a
   session action, so the host dashboard's handler can stop there.
   ctx = { get(id), save(id, patch), mentors, repaint() } */
async function sessionCardAction(e, ctx) {
  const btn = e.target.closest('button[data-sess]');
  if (!btn) return false;
  const s = ctx.get(btn.dataset.sess);
  if (!s) return true;

  if (btn.classList.contains('sx-send')) { openSendInvoice(s); return true; }
  if (btn.classList.contains('sx-invoice')) {
    PFInvoice.download(PFInvoice.fromSession(s));
    toast('Downloaded ' + (s.invoiceNo || 'invoice'));
    return true;
  }
  if (btn.classList.contains('sx-preview')) {
    if (!PFInvoice.open(PFInvoice.fromSession(s))) toast('Allow pop-ups to preview the invoice');
    return true;
  }
  if (btn.classList.contains('sx-paid')) {
    btn.disabled = true;
    const patch = { paymentStatus: 'paid', paidAt: Date.now() };
    try { await ctx.save(s.id, patch); Object.assign(s, patch); toast('Marked paid'); ctx.repaint(); }
    catch { btn.disabled = false; toast('Could not update'); }
    return true;
  }
  if (btn.classList.contains('sx-edit')) {
    openSessionForm({
      session: s, mentors: ctx.mentors, people: ctx.people,
      onSave: async data => { await ctx.save(s.id, data); Object.assign(s, data); ctx.repaint(); },
    });
    return true;
  }
  return true;
}

/* ── 9b · Mentor Dashboard (#mentor) ─────────────────────────
   Invite code + sign up (one screen) → profile → pending review →
   (admin approves) → claim queue. Visually a sibling of #admin: same
   chip-filter tabs, cards, ledgers. */
let mentorState = { tab: 'open', open: null, claimed: null, sessions: null, loading: false, loaded: false };

function renderMentor(main) {
  ensureInvoice();   // every row here can mint a PDF invoice or receipt
  if (!window.PF_FIREBASE_CONFIG || !window.PF_FIREBASE_CONFIG.apiKey) {
    main.innerHTML = renderHero({ kicker: 'Mentor Dashboard', title: 'Mentoring needs Firebase',
      body: 'The mentor marketplace runs on Firebase — configure firebase-config.js and deploy firestore.rules to enable it.' });
    return;
  }
  if (!window.PFCloud) {
    main.innerHTML = renderHero({ kicker: 'Mentor Dashboard', title: 'Connecting…', body: 'Loading the Firebase layer.' });
    setTimeout(() => { if (location.hash.slice(1).split('?')[0] === 'mentor') route(); }, 400);
    return;
  }

  if (PFCloud.isMentor()) return mentorDashboard(main);
  if (PFCloud.hasMentorProfile()) return mentorPending(main);
  return mentorApply(main);
}

/* Invite-only, one screen: mentoring is no longer a public self-service
   sign-up, but the invite code is a soft client-side check (the real gate
   is admin approval) — so it asks for the code alongside the account
   fields rather than as a separate page first. Whichever account action
   is clicked, the code is checked first. */
function mentorApply(main) {
  const signedIn = PFCloud.isSignedIn();

  if (!signedIn) {
    main.innerHTML = renderHero({ kicker: 'Mentor Dashboard', title: 'Mentor sign-up',
      body: 'Enter your invite code and create your account — an admin reviews your profile before you take requests.' }) +
      `<div class="card" style="max-width:440px">
        <label class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em">Mentor invite code</label>
        <input class="field" id="mt-code" autocomplete="off" placeholder="Enter your invite code" style="margin:6px 0 14px;text-transform:uppercase">
        <label class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em">Email &amp; password</label>
        <input class="field" id="mt-email" type="email" autocomplete="email" placeholder="you@example.com" style="margin:6px 0 10px">
        <input class="field" id="mt-pass" type="password" autocomplete="new-password" placeholder="Choose a password (6+ characters)" style="margin-bottom:12px">
        <p class="faint" id="mt-msg" style="font-size:12.5px;min-height:16px;margin-bottom:8px"></p>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" id="mt-signup">Create account</button>
          <button class="btn btn-quiet btn-sm" id="mt-signin">I already have one</button>
          <button class="btn btn-quiet btn-sm" id="mt-google"><span class="material-symbols-outlined" style="font-size:15px">login</span> Google</button>
        </div>
        <p class="faint" style="font-size:12px;margin-top:14px">Not a mentor? <a href="#account" style="color:var(--route)">Back to account</a> · <a href="#mentors" style="color:var(--route)">Ask a mentor instead</a></p>
      </div>`;

    const code = $('#mt-code'), email = $('#mt-email'), pass = $('#mt-pass'), msg = $('#mt-msg');
    const creds = () => ({ e: email.value.trim(), p: pass.value });
    const codeOk = () => {
      if (norm(code.value) !== norm(ROLE_CODES().mentor)) {
        msg.textContent = 'That invite code isn’t valid. Ask the PathFinder team for a current code.';
        return false;
      }
      return true;
    };
    $('#mt-signup').onclick = async () => {
      if (!codeOk()) return;
      const { e, p } = creds(); if (!e || p.length < 6) { msg.textContent = 'Enter an email and a 6+ character password.'; return; }
      msg.textContent = 'Creating account…';
      try { await PFCloud.signUpEmail(e, p); route(); } catch (err) { msg.textContent = humanAuthError(err); }
    };
    $('#mt-signin').onclick = async () => {
      if (!codeOk()) return;
      const { e, p } = creds(); if (!e || !p) { msg.textContent = 'Enter your email and password.'; return; }
      msg.textContent = 'Signing in…';
      try { await PFCloud.signInEmail(e, p); route(); } catch (err) { msg.textContent = humanAuthError(err); }
    };
    $('#mt-google').onclick = async () => {
      if (!codeOk()) return;
      try { await PFCloud.signInGoogle(); route(); } catch (err) { msg.textContent = humanAuthError(err); }
    };
    code.focus();
    return;
  }

  main.innerHTML = renderHero({ kicker: 'Mentor Dashboard', title: 'Your mentor profile',
    body: 'Tell us what you can help with — an admin reviews it before it goes live.' }) +
    `<div class="card" style="max-width:520px" id="mt-profile-card">
      <label class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em">Display name (students see this after they’re matched with you)</label>
      <input class="field" id="mp-name" placeholder="e.g. Kasun J." style="margin:5px 0 14px">
      <label class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em">Fields you can help with</label>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 14px" id="mp-fields">
        ${Object.entries(PF_CONSULT_TOPICS).map(([slug, lbl]) =>
          `<label class="chip chip-dim mp-field" style="cursor:pointer"><input type="checkbox" value="${slug}" style="margin-right:6px;vertical-align:-1px">${lbl}</label>`).join('')}
      </div>
      <div class="grid-2" style="gap:14px">
        <div><label class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em">City in NZ</label>
          <input class="field" id="mp-city" placeholder="e.g. Dunedin" style="margin-top:5px"></div>
        <div><label class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em">Languages</label>
          <input class="field" id="mp-langs" placeholder="Sinhala · English" style="margin-top:5px"></div>
      </div>
      <label class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;display:block;margin-top:14px">Availability</label>
      <input class="field" id="mp-avail" placeholder="e.g. Weekends, 7–10pm SL time" style="margin:5px 0 14px">
      <label class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em">Short bio</label>
      <textarea class="field" id="mp-bio" rows="3" placeholder="Where you study, when you moved, what you’re good at helping with." style="margin:5px 0 14px"></textarea>
      <p class="faint" id="mp-msg" style="font-size:12.5px;min-height:16px;margin-bottom:8px"></p>
      <button class="btn btn-primary" id="mp-submit" style="width:100%;justify-content:center">Submit application</button>
    </div>`;

  $$('#mp-fields .mp-field input').forEach(cb => cb.onchange = () =>
    cb.closest('.mp-field').classList.toggle('chip-rose', cb.checked));
  $('#mp-submit').onclick = async () => {
    const displayName = $('#mp-name').value.trim();
    const fields = $$('#mp-fields .mp-field input:checked').map(c => c.value);
    const msg = $('#mp-msg');
    if (!displayName) { msg.textContent = 'Add a display name.'; return; }
    if (!fields.length) { msg.textContent = 'Pick at least one field you can help with.'; return; }
    msg.textContent = 'Submitting…';
    try {
      await PFCloud.applyAsMentor({ displayName, fields, city: $('#mp-city').value.trim(),
        langs: $('#mp-langs').value.trim(), availability: $('#mp-avail').value.trim(), bio: $('#mp-bio').value.trim() });
      toast('Application submitted — pending review');
      route();
    } catch (err) { msg.textContent = humanAuthError(err); }
  };
}

function humanAuthError(err) {
  const c = (err && err.code) || '';
  if (c.includes('email-already-in-use')) return 'That email already has an account — use “I already have one”.';
  if (c.includes('invalid-email')) return 'That email doesn’t look right.';
  if (c.includes('weak-password')) return 'Password is too weak — use 6+ characters.';
  if (c.includes('wrong-password') || c.includes('invalid-credential')) return 'Email or password is incorrect.';
  if (c.includes('popup-closed')) return 'Sign-in was cancelled.';
  return (err && err.message) || 'Something went wrong — try again.';
}

function mentorPending(main) {
  const p = PFCloud.getMentorProfile() || {};
  main.innerHTML = renderHero({ kicker: 'Mentor Dashboard', title: 'Application pending review',
    body: 'An admin will review your profile shortly — the open request queue appears here once approved.' }) +
    `<div class="card" style="max-width:560px">
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <span class="chip chip-gold">Pending approval</span>
        ${(p.fields || []).map(f => `<span class="chip chip-dim">${PF_CONSULT_TOPICS[f] || f}</span>`).join('')}
      </div>
      <p style="font-size:14px;margin:0 0 4px"><strong>${esc(p.displayName || '')}</strong>${p.city ? ' · ' + esc(p.city) : ''}</p>
      ${p.bio ? `<p class="muted" style="font-size:13.5px;margin-top:8px">${esc(p.bio)}</p>` : ''}
      <button class="btn btn-quiet btn-sm" id="mt-out" style="margin-top:16px">Sign out</button>
    </div>`;
  $('#mt-out').onclick = () => PFCloud.signOutUser();
}

async function mentorLoad() {
  if (mentorState.loading) return;
  mentorState.loading = true;
  const [o, c, s] = await Promise.allSettled([
    PFCloud.fetchOpenRequests(), PFCloud.fetchMyClaimedRequests(), PFCloud.fetchMySessions(),
  ]);
  mentorState.open     = o.status === 'fulfilled' ? o.value : null;
  mentorState.claimed  = c.status === 'fulfilled' ? c.value : null;
  mentorState.sessions = s.status === 'fulfilled' ? s.value : null;
  mentorState.loading = false;
  mentorState.loaded = true;
}

/* The mentor's own client book, folded out of the two lists the dashboard
   already loaded. Zero extra reads. */
function mentorPeople() {
  return buildPeople({ sessions: mentorState.sessions || [], requests: mentorState.claimed || [] });
}

function mentorDashboard(main) {
  const p = PFCloud.getMentorProfile() || {};
  const active = p.active !== false;
  const people = mentorPeople();
  // "My claimed" used to be its own tab, but it's the same requests that
  // already show up inside People (buildPeople folds claimed + sessions
  // together) — one tab fewer, no data left out: active claimed requests
  // now surface as their own actionable section at the top of People.
  const TABS = [['open', 'Open requests'], ['people', 'My people'], ['sessions', 'Session log']];
  const counts = {
    open: mentorState.open ? mentorState.open.length : '·',
    sessions: mentorState.sessions ? mentorState.sessions.length : '·',
    people: mentorState.loaded ? people.length : '·',
  };

  // 4 stats max — "Invoiced, not yet paid" drops from the row (see
  // DEVIATIONS.md); it still surfaces inside the Session log tab itself.
  const claimed = mentorState.claimed || [];
  const sessions = mentorState.sessions || [];
  const activeReqs = claimed.filter(r => !['completed', 'cancelled'].includes(r.status)).length;
  const loggedFromReq = new Set(sessions.map(s => s.requestId).filter(Boolean));
  const completed = sessions.length + claimed.filter(r => r.status === 'completed' && !loggedFromReq.has(r.id)).length;
  const earned = sessions.filter(s => s.paymentStatus === 'paid').reduce((sum, s) => sum + (Number(s.amountLKR) || 0), 0)
    + claimed.filter(r => r.payment && r.payment.paymentStatus === 'paid' && !loggedFromReq.has(r.id)).reduce((sum, r) => sum + (Number(r.payment.amountLKR) || 0), 0);
  const n = v => (mentorState.loaded ? v : '·');

  main.innerHTML = renderHero({
    kicker: 'Mentor Dashboard', title: `Welcome, ${p.displayName || 'mentor'}`,
    body: 'Claim a request, run the free intro, and log sessions that come to you off-platform.',
    figure: active ? 'On' : 'Off', figureCaption: active ? 'Taking requests' : 'Not taking requests',
    primaryId: 'mt-intake', primaryLabel: 'Someone called', primaryIcon: 'phone_in_talk',
    secondaryId: 'mt-toggle', secondaryLabel: active ? 'Pause requests' : 'Resume requests',
  }) +
    `<div class="stat-grid" style="margin:24px 0">
      <div class="stat"><span class="material-symbols-outlined stat-icon" aria-hidden="true">hourglass_top</span>
        <div class="stat-figure">${n(mentorState.open ? mentorState.open.length : '·')}</div>
        <div class="stat-label">Open in queue</div></div>
      <div class="stat"><span class="material-symbols-outlined stat-icon" aria-hidden="true">assignment_ind</span>
        <div class="stat-figure">${n(activeReqs)}</div>
        <div class="stat-label">Active with you</div></div>
      <div class="stat"><span class="material-symbols-outlined stat-icon" aria-hidden="true">task_alt</span>
        <div class="stat-figure">${n(completed)}</div>
        <div class="stat-label">Sessions delivered</div></div>
      <div class="stat"><span class="material-symbols-outlined stat-icon" aria-hidden="true">payments</span>
        <div class="stat-figure">${mentorState.loaded ? 'LKR ' + earned.toLocaleString() : '·'}</div>
        <div class="stat-label">Earned (paid)</div></div>
    </div>

    <div class="tab-row" id="mtd-tabs" role="tablist" aria-label="Mentor dashboard sections">
      ${TABS.map(([id, lbl]) => `<button type="button" class="tab" role="tab" aria-selected="${mentorState.tab === id}" data-tab="${id}">${lbl} <span class="tab-n">${counts[id]}</span></button>`).join('')}
      <div class="tab-row-end">
        <button type="button" class="tab" id="mtd-refresh"><span class="material-symbols-outlined" aria-hidden="true">refresh</span> Refresh</button>
        <button type="button" class="btn-quiet" id="mt-out">Sign out</button>
      </div>
    </div>
    <div id="mtd-body"></div>`;

  const body = $('#mtd-body');

  $('#mt-out').onclick = () => PFCloud.signOutUser();
  $('#mt-toggle').onclick = async () => {
    try { await PFCloud.saveMentorProfile({ active: !active }); toast(active ? 'Paused' : 'Available again'); route(); }
    catch { toast('Could not update'); }
  };

  // Someone rang this mentor directly — write them into the queue as an
  // already-claimed request, so it behaves like any other from here on.
  $('#mt-intake').onclick = () => openIntakeForm({
    onSave: async data => {
      const saved = await PFCloud.createIntakeRequest(data);
      if (saved.mentorId) mentorState.claimed = [saved, ...(mentorState.claimed || [])];
      else mentorState.open = [saved, ...(mentorState.open || [])];
      mentorState.tab = saved.mentorId ? 'people' : 'open';
      route();
    },
  });

  /* Write up a session for someone already in the book — the form opens
     with their name and number filled in and their history on screen. */
  const logFor = (prefill = {}) => openSessionForm({
    people,
    prefill: Object.assign({ channel: 'whatsapp' }, prefill),
    onSave: async data => {
      const saved = await PFCloud.createSession(data);
      mentorState.sessions = [saved, ...(mentorState.sessions || [])];
      route();
      return saved;
    },
  });

  function paintPeople() {
    if (mentorState.sessions === null && mentorState.claimed === null) { body.innerHTML = admErrCard('your people'); return; }
    const claimed = mentorState.claimed || [];
    cacheReqs(claimed);
    const active = claimed.filter(r => !['completed', 'cancelled'].includes(r.status));
    const due = people.reduce((n, x) => n + x.due, 0);
    body.innerHTML = `
      ${active.length ? `<h3 style="font-size:1rem;margin:0 0 10px">${active.length} claimed and active</h3>${active.map(claimedReqCard).join('')}` : ''}
      <div class="card" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:${active.length ? '18px' : '0'} 0 16px">
        <span class="material-symbols-outlined" style="color:var(--route)">contacts</span>
        <p class="muted" style="flex:1;min-width:220px;font-size:13px;margin:0">
          Everyone you have spoken to, in one place — whether they came through the site or just rang you.
          Open their history before the next call so you don’t ask the same questions twice.
          ${due ? `<strong>LKR ${due.toLocaleString()}</strong> is still owed across them.` : ''}</p>
      </div>
      ${people.length ? people.map(x => personCard(x, { canLog: true })).join('')
        : `<div class="card"><p class="muted" style="font-size:14px">Nobody here yet. When someone calls, tap “Someone called” above — they’ll show up here with everything you write down about them.</p></div>`}`;
  }

  function paintSessions() {
    const list = mentorState.sessions;
    if (list === null) { body.innerHTML = admErrCard('your session log'); return; }
    const billable = list.filter(s => s.paymentStatus !== 'waived' && Number(s.amountLKR));
    const outstanding = billable.filter(s => s.paymentStatus !== 'paid')
      .reduce((sum, s) => sum + Number(s.amountLKR), 0);
    body.innerHTML = `
      <div class="card" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:16px">
        <span class="material-symbols-outlined" style="color:var(--route)">history_edu</span>
        <p class="muted" style="flex:1;min-width:220px;font-size:13px;margin:0">
          Write down every session you do — including the ones that come to you on WhatsApp or by phone.
          Each one keeps your notes and makes a PDF invoice or receipt you can send them.
          ${outstanding ? `<strong>LKR ${outstanding.toLocaleString()}</strong> invoiced and not paid yet.` : ''}</p>
        <button class="btn btn-primary btn-sm" id="mtd-log">
          <span class="material-symbols-outlined" style="font-size:15px">add</span> Log a session</button>
      </div>
      ${list.length ? list.map(s => sessionCard(s)).join('')
        : `<div class="card"><p class="muted" style="font-size:14px">Nothing here yet. Tap “Log a session” right after your next call — it takes under a minute, and it gives them an invoice.</p></div>`}`;

    $('#mtd-log', body).onclick = () => logFor();
  }

  function paint() {
    if (mentorState.loading) { body.innerHTML = `<div class="card"><p class="muted">Loading…</p></div>`; return; }
    if (mentorState.tab === 'people') return paintPeople();
    if (mentorState.tab === 'sessions') return paintSessions();
    // Only 'open' is left — claimed requests now live inside People.
    const list = mentorState.open;
    if (list === null) { body.innerHTML = `<div class="card" style="border-color:var(--alert)"><p class="muted">Couldn’t load the queue — your account may not be approved yet.</p></div>`; return; }
    cacheReqs(list);
    body.innerHTML = list.length ? list.map(openReqCard).join('')
      : `<div class="card"><p class="muted" style="font-size:14px">No open requests right now. New ones show up here — tap Refresh.</p></div>`;
  }

  $$('#mtd-tabs .tab[data-tab]').forEach(b => b.onclick = () => {
    mentorState.tab = b.dataset.tab;
    $$('#mtd-tabs .tab[data-tab]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    paint();
  });
  $('#mtd-refresh').onclick = async () => {
    mentorState.loaded = false;
    mentorState.open = mentorState.claimed = mentorState.sessions = null;
    body.innerHTML = `<div class="card"><p class="muted">Loading…</p></div>`;
    await mentorLoad(); route();
  };

  // delegated actions inside request cards (claim / status / payment),
  // session cards (send / invoice / mark paid / edit) and person cards
  // (history / log a session)
  body.addEventListener('click', async e => {
    if (await sessionCardAction(e, {
      get: id => (mentorState.sessions || []).find(s => s.id === id),
      save: (id, patch) => PFCloud.updateSession(id, patch),
      people,
      repaint: route,   // earnings live in the header strip, outside `body`
    })) return;
    if (personCardAction(e, {
      people,
      // studentUid is deliberately NOT carried over: firestore.rules only
      // lets a session name an account when it came from a request this
      // mentor owns (namedStudentIsOwn), and a fresh session has no request
      // behind it. The invoice is addressed by name and number instead —
      // which is the off-platform case anyway.
      onLog: x => logFor({ studentName: x.name, studentContact: x.contact }),
    })) return;
    mentorCardAction(e);
  });

  if (!mentorState.loaded && !mentorState.loading) {
    body.innerHTML = `<div class="card"><p class="muted">Loading…</p></div>`;
    mentorLoad().then(() => route());
  } else {
    paint();
  }
}

/* A request in the open queue. Identity stays hidden until it is claimed —
   but HOW it arrived does not, because a phone lead needs ringing back and
   a form on the site does not. */
function openReqCard(r) {
  const phoned = r.source && r.source !== 'platform';
  return `<div class="card" style="margin-bottom:12px" data-req="${r.id}">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
      <div style="flex:1;min-width:200px">
        <strong style="font-size:14.5px">${PF_CONSULT_TOPICS[r.topic] || 'General guidance'}</strong>
        <div class="faint" style="font-size:12.5px">${r.at ? new Date(r.at).toLocaleDateString() : ''}${phoned ? ' · ' + esc(PF_REQUEST_SOURCES[r.source] || r.source) : ''}</div>
        ${r.note ? `<div class="muted" style="font-size:13px;margin-top:6px">${esc(r.note)}</div>` : ''}
        ${r.callback ? `<div class="faint" style="font-size:12.5px;margin-top:6px">Call back: ${esc(r.callback)}</div>` : ''}
        ${redeemNote(r)}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
        ${r.priority ? `<span class="chip chip-gold">Priority</span>` : ''}
        ${phoned ? `<span class="chip chip-violet">Rang us</span>` : ''}
        ${r.redeem ? `<span class="chip chip-ok">${r.redeem === 'audit' ? 'Audit included' : 'Session included'}</span>` : ''}
        <button class="btn btn-primary btn-sm mt-claim" data-req="${r.id}">Claim</button>
      </div>
    </div>
  </div>`;
}

/* A request raised against a plan credit is already paid for — the student
   bought the plan from the platform, not from the mentor. Saying so on the
   card is what stops a mentor quoting a fee for work the student has
   already been promised, which is the one way a credit can go wrong. */
function redeemNote(r) {
  if (!r || !r.redeem) return '';
  const what = r.redeem === 'audit'
    ? 'a document audit (SOP / proposal) included in their plan'
    : 'a mentor session included in their plan';
  return `<div class="muted" style="font-size:12.5px;margin-top:8px;padding:8px 10px;border-radius:8px;background:var(--teal-soft)">
    Prepaid — this is ${what}. Deliver it as a normal session and log it; don't ask them to pay again.
  </div>`;
}

function claimedReqCard(r) {
  const price = (r.payment && r.payment.amountLKR) || PF_CONFIG.defaultSessionPriceLKR;
  let actions = '';
  if (r.status === 'claimed') {
    actions = `<button class="btn btn-quiet btn-sm mt-intro" data-req="${r.id}">Mark ${PF_CONFIG.freeIntroMinutes}-min intro complete</button>`;
  } else if (r.status === 'intro_done') {
    actions = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;width:100%">
        <label class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em">Follow-on price (LKR)</label>
        <input class="field mt-amount" type="number" min="1" value="${price}" style="width:130px">
        <button class="btn btn-primary btn-sm mt-genlink" data-req="${r.id}">Generate payment link</button>
      </div>`;
  } else if (r.status === 'awaiting_payment') {
    actions = `${PFPay.isPayHereLive() ? `<button class="btn btn-quiet btn-sm mt-checkout" data-req="${r.id}">Preview PayHere link</button>` : ''}
      <button class="btn btn-primary btn-sm mt-paid" data-req="${r.id}">Mark payment received</button>`;
  } else if (r.status === 'paid') {
    actions = `<button class="btn btn-primary btn-sm mt-complete" data-req="${r.id}">Mark session completed</button>`;
  }
  const canCancel = !['paid', 'completed', 'cancelled'].includes(r.status);
  const reported = r.payment && r.payment.paymentStatus === 'reported';
  return `<div class="card" style="margin-bottom:12px" data-req="${r.id}">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
      <div style="flex:1;min-width:200px">
        <strong style="font-size:14.5px">${esc(r.name || 'Student')}</strong>
        <span class="faint" style="font-size:12.5px"> · ${esc(r.contact || 'no contact')}</span>
        <div class="faint" style="font-size:12.5px;margin-top:2px">${PF_CONSULT_TOPICS[r.topic] || 'General guidance'} · ${r.at ? new Date(r.at).toLocaleDateString() : ''}${r.source && r.source !== 'platform' ? ' · ' + esc(PF_REQUEST_SOURCES[r.source] || r.source) : ''}</div>
        ${r.note ? `<div class="muted" style="font-size:13px;margin-top:6px">${esc(r.note)}</div>` : ''}
        ${r.callback ? `<div class="faint" style="font-size:12.5px;margin-top:6px">Call back: ${esc(r.callback)}</div>` : ''}
        ${(() => {
          // Someone with no account can only be reached the way they got in
          // touch — put those one-tap links right on the card.
          const wa = waNumber(r.contact), mail = contactEmailOf(r.contact), tel = contactPhoneOf(r.contact);
          if (r.studentUid || !(wa || mail)) return '';
          return `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
            ${wa ? `<a class="btn btn-quiet btn-sm" href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
            ${tel ? `<a class="btn btn-quiet btn-sm" href="tel:${esc(tel)}">Call</a>` : ''}
            ${mail ? `<a class="btn btn-quiet btn-sm" href="mailto:${esc(mail)}">Email</a>` : ''}
          </div>`;
        })()}
        ${reported ? `<div class="muted" style="font-size:12.5px;margin-top:8px;padding:8px 10px;background:var(--surface);border-radius:3px">Student reported payment via <strong>${esc(r.payment.method || 'transfer')}</strong>${r.payment.payerRef ? ` · ref <strong class="mono">${esc(r.payment.payerRef)}</strong>` : ''}${r.payment.payerTxn ? ` · txn <span class="mono">${esc(r.payment.payerTxn)}</span>` : ''}. Verify in your banking app, then “Mark payment received”.</div>` : ''}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
        ${reqStatusChip(r.status)}
        ${r.payment ? payStatusChip(r.payment) : ''}
      </div>
    </div>
    ${(() => {
      // Writing up the session is available at every live stage — the
      // conversation often happens (and is worth recording) well before
      // any money changes hands.
      const log = r.status === 'cancelled' ? '' : `<button class="btn btn-quiet btn-sm mt-log" data-req="${r.id}">
        <span class="material-symbols-outlined" style="font-size:15px">edit_note</span> Log session</button>`;
      const cancel = canCancel ? `<button class="btn btn-quiet btn-sm mt-cancel" data-req="${r.id}" style="margin-left:auto">Cancel</button>` : '';
      return (actions || log || cancel)
        ? `<div style="margin-top:14px;padding-top:14px;border-top:1px dashed var(--line);display:flex;gap:8px;flex-wrap:wrap;align-items:center">
             ${actions}${log}${cancel}
           </div>` : '';
    })()}
  </div>`;
}

async function mentorCardAction(e) {
  const btn = e.target.closest('button[data-req]');
  if (!btn) return;
  const id = btn.dataset.req;
  const doAction = async (fn, ok) => { btn.disabled = true; try { await fn(); toast(ok); await mentorLoad(); route(); } catch (err) { btn.disabled = false; toast(humanAuthError(err)); } };

  if (btn.classList.contains('mt-claim'))    return doAction(() => PFCloud.claimRequest(id), 'Claimed — it’s in “My people”');
  if (btn.classList.contains('mt-intro'))    return doAction(() => PFCloud.updateRequest(id, { status: 'intro_done', introDoneAt: Date.now() }), 'Intro marked complete');
  if (btn.classList.contains('mt-genlink')) {
    const amount = Math.round(+btn.closest('.card').querySelector('.mt-amount').value);
    if (!amount || amount <= 0) return toast('Enter a valid amount');
    return doAction(() => PFCloud.updateRequest(id, {
      status: 'awaiting_payment',
      payment: { amountLKR: amount, payhereLink: 'payhere', paymentStatus: 'requested', paidAt: null },
    }), 'Payment link generated — the student can now pay');
  }
  if (btn.classList.contains('mt-checkout')) {
    const r = reqCache.get(id);
    if (!PFPayHere.openCheckout(r)) toast('Set PF_CONFIG.payhere.merchantId to enable checkout');
    return;
  }
  if (btn.classList.contains('mt-paid')) {
    const r = reqCache.get(id);
    const pay = Object.assign({}, r && r.payment, { paymentStatus: 'paid', paidAt: Date.now() });
    return doAction(() => PFCloud.updateRequest(id, { status: 'paid', payment: pay }), 'Marked paid');
  }
  if (btn.classList.contains('mt-complete')) return doAction(() => PFCloud.updateRequest(id, { status: 'completed' }), 'Session completed');
  if (btn.classList.contains('mt-cancel'))   return doAction(() => PFCloud.updateRequest(id, { status: 'cancelled' }), 'Request cancelled');
  // Write up a request-born session — prefilled from the request so the
  // mentor only types what actually happened.
  if (btn.classList.contains('mt-log')) {
    const r = reqCache.get(id) || {};
    const existing = (mentorState.sessions || []).find(s => s.requestId === id);
    const people = mentorPeople();
    if (existing) return openSessionForm({
      session: existing, people,
      onSave: async data => { await PFCloud.updateSession(existing.id, data); Object.assign(existing, data); route(); },
    });
    return openSessionForm({
      people,
      prefill: {
        requestId: id, studentName: r.name || '', studentContact: r.contact || '',
        studentUid: r.studentUid || '', topic: r.topic || '',
        // A request that came in by phone was almost certainly delivered by
        // phone too — default the channel to how they first reached us.
        channel: r.source === 'whatsapp' ? 'whatsapp' : r.source === 'walkin' ? 'inperson'
          : r.source === 'call' ? 'call' : 'platform',
        amountLKR: (r.payment && r.payment.amountLKR) || PF_CONFIG.defaultSessionPriceLKR,
        paymentStatus: r.payment && r.payment.paymentStatus === 'paid' ? 'paid' : 'unpaid',
        method: (r.payment && r.payment.method) || '', ref: (r.payment && r.payment.payerRef) || '',
      },
      onSave: async data => {
        const saved = await PFCloud.createSession(data);
        mentorState.sessions = [saved, ...(mentorState.sessions || [])];
        route();
        return saved;
      },
    });
  }
}

/* re-render #mentor whenever the signed-in mentor's state resolves/changes
   (sign-in, approval, sign-out) — mirrors hookAdminAuth. */
(function hookMentorAuth(tries = 0) {
  if (window.PFCloud && window.PFCloud.onMentorState) {
    window.PFCloud.onMentorState(() => {
      paintMentorSidebarLink();
      // Re-derive the plan entitlements for the new session, and clear the
      // old ones outright — a balance from the previous account must never
      // paint on this one while the refetch is in flight.
      entState = { loaded: false, items: emptyEntitlements() };
      const v = (location.hash || '').slice(1).split('?')[0];
      if (v === 'mentor') { mentorState.loaded = false; route(); }
      else if (v === 'account') route();
      else if (v === 'kit' || v === 'billing' || v === 'mentors') route();
    });
  } else if (tries < 40 && (window.PF_FIREBASE_CONFIG && window.PF_FIREBASE_CONFIG.apiKey)) {
    setTimeout(() => hookMentorAuth(tries + 1), 100);
  }
})();

/* show the "Mentor Dashboard" sidebar link only for approved mentors */
function paintMentorSidebarLink() {
  const link = document.getElementById('mentor-link');
  if (link) link.classList.toggle('hidden', !(window.PFCloud && PFCloud.isMentor()));
}

/* ── 10 · Admin panel (#admin) ──────────────────────────────
   Opened with a single password box. The password is the Firebase
   Email/Password admin login (see firebase-config.js) — so the data
   reads below are enforced by Firestore rules, not by client JS.
   Shows: overview analytics · leads · mentors · requests · user records. */
let adminState = { tab: 'action', leads: null, mentors: null, requests: null, sessions: null, orders: null, users: null, loading: false, loaded: false, error: '' };
const ADMIN_BLANK = () => ({ tab: 'action', leads: null, mentors: null, requests: null, sessions: null, orders: null, users: null, loading: false, loaded: false, error: '' });

function renderAdmin(main) {
  ensureInvoice();   // every row here can mint a PDF invoice or receipt
  // Firebase off entirely → nothing to administer.
  if (!window.PF_FIREBASE_CONFIG || !window.PF_FIREBASE_CONFIG.apiKey) {
    main.innerHTML = renderHero({ kicker: 'Admin', title: 'Admin panel unavailable',
      body: 'Firebase is not configured — set up firebase-config.js and deploy firestore.rules to enable it.' });
    return;
  }
  // Sync layer still loading (deferred module) → wait, then re-render.
  if (!window.PFCloud) {
    main.innerHTML = renderHero({ kicker: 'Admin', title: 'Connecting…', body: 'Loading the Firebase admin layer.' });
    setTimeout(() => { if (location.hash.slice(1).split('?')[0] === 'admin') route(); }, 400);
    return;
  }

  if (!PFCloud.isAdmin()) return adminLogin(main);
  adminDashboard(main);
}

function adminLogin(main) {
  main.innerHTML = renderHero({ kicker: 'Admin', title: 'Admin sign-in',
    body: 'Enter the admin access code and password to view leads, mentors, requests and user records.' }) +
    `<div class="card" style="max-width:420px">
      <label class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em">Access code</label>
      <input class="field" id="adm-code" autocomplete="off" placeholder="Admin code" style="margin:6px 0 14px;text-transform:uppercase">
      <label class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em">Password</label>
      <input class="field" id="adm-pw" type="password" autocomplete="current-password" placeholder="••••••••" style="margin-top:6px">
      <p class="faint" id="adm-msg" style="font-size:12.5px;margin-top:10px;min-height:16px"></p>
      <button class="btn btn-primary" id="adm-go" style="margin-top:4px;width:100%;justify-content:center">Sign in</button>
    </div>`;

  const codeEl = $('#adm-code'), pw = $('#adm-pw'), msg = $('#adm-msg'), go = $('#adm-go');
  async function submit() {
    const val = pw.value;
    if (norm(codeEl.value) !== norm(ROLE_CODES().admin)) { msg.textContent = 'Incorrect admin access code.'; return; }
    if (!val) { msg.textContent = 'Enter the password.'; return; }
    go.disabled = true; msg.textContent = 'Checking…';
    try {
      await PFCloud.signInAdmin(val);
      adminState = ADMIN_BLANK();
      route();
    } catch (e) {
      go.disabled = false;
      msg.textContent = 'Incorrect password (or the admin account is not set up in Firebase yet).';
    }
  }
  go.onclick = submit;
  codeEl.onkeydown = e => { if (e.key === 'Enter') pw.focus(); };
  pw.onkeydown = e => { if (e.key === 'Enter') submit(); };
  codeEl.focus();
}

async function adminLoad() {
  if (adminState.loading) return;
  adminState.loading = true; adminState.error = '';
  // Each section loads independently — one failing read (e.g. a rules
  // gap) must not blank the others, and must never re-trigger a reload.
  const [l, m, r, s, o, u] = await Promise.allSettled([
    PFCloud.fetchLeads(), PFCloud.fetchMentors(), PFCloud.fetchAllRequests(),
    PFCloud.fetchAllSessions(), PFCloud.fetchAllOrders(), PFCloud.fetchUsers(),
  ]);
  adminState.leads    = l.status === 'fulfilled' ? l.value : null;
  adminState.mentors  = m.status === 'fulfilled' ? m.value : null;
  adminState.requests = r.status === 'fulfilled' ? r.value : null;
  adminState.sessions = s.status === 'fulfilled' ? s.value : null;
  adminState.orders   = o.status === 'fulfilled' ? o.value : null;
  adminState.users    = u.status === 'fulfilled' ? u.value : null;
  const settled = [l, m, r, s, o, u];
  const failed = settled.filter(x => x.status === 'rejected');
  if (failed.length) console.warn('PathFinder admin: some reads failed —', failed.map(f => f.reason && f.reason.message));
  if (settled.every(x => x.status === 'rejected')) {
    adminState.error = 'Could not load data. Make sure firestore.rules are deployed and the admin email matches.';
  }
  adminState.loading = false;
  adminState.loaded = true;     // load attempted — stops the render loop
}

function admErrCard(what) {
  return `<div class="card" style="border-color:var(--alert)"><p class="muted" style="font-size:13.5px">
    Couldn't load ${what} — your account may lack permission, or the rules need redeploying.</p></div>`;
}

function adminDashboard(main) {
  // "Action needed" is the landing tab — the handful of things that
  // actually require a click today. Everything else (Analytics, ledgers,
  // records) is one click away but no longer what greets a returning
  // admin. See admActionCount() for what counts as "needs action".
  const TABS = [['action', 'Action needed'], ['analytics', 'Analytics'], ['accounting', 'Accounting'], ['leads', 'Leads'], ['mentors', 'Mentors'], ['requests', 'Requests'], ['people', 'People'], ['sessions', 'Sessions'], ['orders', 'Orders'], ['users', 'User records']];
  const people = adminPeople();
  const counts = {
    action: adminState.loaded ? admActionCount() : '·',
    leads: adminState.leads ? adminState.leads.length : '·',
    mentors: adminState.mentors ? adminState.mentors.length : '·',
    requests: adminState.requests ? adminState.requests.length : '·',
    people: adminState.loaded ? people.length : '·',
    sessions: adminState.sessions ? adminState.sessions.length : '·',
    orders: adminState.orders ? adminState.orders.length : '·',
    users: adminState.users ? adminState.users.length : '·',
  };

  const actionN = adminState.loaded ? admActionCount() : '·';
  main.innerHTML = renderHero({
    kicker: 'Admin', title: 'Platform admin',
    body: 'Live data from Firestore, visible only to the admin account.',
    figure: actionN, figureCaption: 'Need action',
    primaryId: 'adm-intake', primaryLabel: 'Someone called', primaryIcon: 'phone_in_talk',
  }) +
    `<div class="tab-row" id="adm-tabs" role="tablist" aria-label="Admin sections">
      ${TABS.map(([id, lbl]) => `<button type="button" class="tab" role="tab" aria-selected="${adminState.tab === id}" data-tab="${id}">${lbl}${counts[id] !== undefined ? ` <span class="tab-n">${counts[id]}</span>` : ''}</button>`).join('')}
      <button type="button" class="tab tab-row-end" id="adm-refresh"><span class="material-symbols-outlined" aria-hidden="true">refresh</span> Refresh</button>
    </div>
    <div id="adm-body"></div>`;

  const body = $('#adm-body');

  function paint() {
    if (adminState.loading) { body.innerHTML = `<div class="card"><p class="muted">Loading…</p></div>`; return; }
    if (adminState.error)   { body.innerHTML = `<div class="card" style="border-color:var(--alert)"><p class="muted">${adminState.error}</p></div>`; return; }
    ({ action: admAction, analytics: admOverview, accounting: admAccounting, leads: admLeads, mentors: admMentors,
       requests: admRequests, people: admPeople, sessions: admSessions, orders: admOrders,
       users: admUsers })[adminState.tab](body, paint);
  }

  // Phone / walk-in intake. The admin can hand the caller to a mentor on
  // the spot, or leave it in the open queue for whoever is free.
  $('#adm-intake').onclick = () => openIntakeForm({
    mentors: (adminState.mentors || []).filter(m => m.approved && m.active !== false),
    onSave: async data => {
      const saved = await PFCloud.createIntakeRequest(data);
      adminState.requests = [saved, ...(adminState.requests || [])];
      adminState.tab = 'requests';
      route();
    },
  });

  $$('#adm-tabs .tab[data-tab]').forEach(b => b.onclick = () => {
    adminState.tab = b.dataset.tab;
    $$('#adm-tabs .tab[data-tab]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    paint();
  });
  $('#adm-refresh').onclick = async () => {
    adminState.loaded = false;
    adminState.leads = adminState.mentors = adminState.requests =
      adminState.sessions = adminState.orders = adminState.users = null;
    body.innerHTML = `<div class="card"><p class="muted">Loading…</p></div>`;
    await adminLoad();
    route();
  };

  // mentor approve/reject/deactivate + request payment reconciliation —
  // delegated once per render (body is rebuilt by route(), so handlers
  // never stack across tab switches).
  body.addEventListener('click', async e => {
    // session records (log / invoice / mark paid / edit) — admin may act on
    // any mentor's record, so the mentor picker is passed through
    if (await sessionCardAction(e, {
      get: id => (adminState.sessions || []).find(s => s.id === id),
      save: (id, patch) => PFCloud.updateSession(id, patch),
      mentors: (adminState.mentors || []).filter(m => m.approved),
      people,
      repaint: paint,
    })) return;

    // person cards (history / log a session on a mentor's behalf)
    if (personCardAction(e, { people, showMentor: true, onLog: x => admLogSession(paint, people, {
      studentName: x.name, studentContact: x.contact }) })) return;

    const mb = e.target.closest('button[data-muid]');
    if (mb) {
      const uid = mb.dataset.muid;
      const patch = mb.dataset.act === 'approve' ? { approved: true, active: true }
        : mb.dataset.act === 'reject' ? { approved: false }
        : { active: mb.dataset.act === 'activate' };
      mb.disabled = true;
      try {
        await PFCloud.setMentorFlag(uid, patch);
        const m = (adminState.mentors || []).find(x => x.uid === uid);
        if (m) Object.assign(m, patch);
        toast('Mentor updated'); paint();
      } catch { mb.disabled = false; toast('Update failed'); }
      return;
    }
    const rb = e.target.closest('button[data-radoc]');
    if (rb) {
      const id = rb.dataset.radoc;
      const r = (adminState.requests || []).find(x => x.id === id);
      const patch = rb.dataset.act === 'paid'
        ? { status: 'paid', payment: Object.assign({}, r && r.payment, { paymentStatus: 'paid', paidAt: Date.now() }) }
        : { status: 'cancelled' };
      rb.disabled = true;
      try {
        await PFCloud.updateRequestAdmin(id, patch);
        if (r) Object.assign(r, patch);
        toast('Request updated'); paint();
      } catch { rb.disabled = false; toast('Update failed'); }
      return;
    }
    const ob = e.target.closest('button[data-oid]');
    if (ob) {
      const id = ob.dataset.oid;
      const o = (adminState.orders || []).find(x => x.id === id);
      const patch = ob.dataset.act === 'paid' ? { status: 'paid', paidAt: Date.now() } : { status: 'cancelled' };
      ob.disabled = true;
      try {
        await PFCloud.updateOrderAdmin(id, patch);
        if (o) Object.assign(o, patch);
        toast('Order updated'); paint();
      } catch { ob.disabled = false; toast('Update failed'); }
      return;
    }
    // invoice / receipt for one accounting row — preview in a tab (with a
    // Download-PDF button), or download the PDF straight away
    const inv = e.target.closest('button[data-invoice]');
    if (inv) {
      const tx = accountingRows().find(t => t.invoiceNo === inv.dataset.invoice);
      if (!tx) return;
      const model = tx.session ? PFInvoice.fromSession(tx.session) : PFInvoice.fromTx(tx);
      if (inv.dataset.act === 'download') {
        PFInvoice.download(model);
        toast('Downloaded ' + tx.invoiceNo);
      } else if (!PFInvoice.open(model)) {
        toast('Allow pop-ups to open the receipt');
      }
    }
  });

  // first paint / first load — guarded by `loaded` so a failed load can
  // never re-trigger itself (that was the infinite reload loop)
  if (!adminState.loaded && !adminState.loading) {
    body.innerHTML = `<div class="card"><p class="muted">Loading…</p></div>`;
    adminLoad().then(() => route());
  } else {
    paint();
  }
}

function admMetric(ic, n, label) {
  return `<div class="card" style="display:block">
    <span class="material-symbols-outlined" style="color:var(--route);font-size:22px">${ic}</span>
    <div style="font-size:1.7rem;font-weight:700;margin-top:8px">${n}</div>
    <div class="faint" style="font-size:12.5px">${label}</div></div>`;
}

/* How many things on the landing tab need a click today — the tab's own
   count badge reads this, so it matches what's actually rendered below. */
function admActionCount() {
  const pendingMentors = (adminState.mentors || []).filter(m => !m.approved).length;
  const awaitingPay = (adminState.requests || []).filter(r => r.status === 'awaiting_payment').length;
  const unpaidSessions = (adminState.sessions || []).filter(s => Number(s.amountLKR) && s.paymentStatus !== 'paid' && s.paymentStatus !== 'waived').length;
  const ordersToConfirm = (adminState.orders || []).filter(o => o.status === 'reported' || o.status === 'pending').length;
  return pendingMentors + awaitingPay + unpaidSessions + ordersToConfirm;
}

/* The landing tab — only the things that actually need a click today.
   Pending mentor approvals and awaiting-payment requests reuse the exact
   same cards (and the same delegated data-muid/data-radoc click handling)
   as their full tabs, so approving or marking-paid here IS that one
   action, not a second copy of it. Unpaid sessions and orders-to-confirm
   are counted rather than itemised — confirming those needs the fuller
   session/order record, so they link straight through instead of
   duplicating that tab's cards here. */
function admAction(body) {
  const pendingMentors = (adminState.mentors || []).filter(m => !m.approved);
  const awaitingPay = (adminState.requests || []).filter(r => r.status === 'awaiting_payment');
  const unpaidSessions = (adminState.sessions || []).filter(s => Number(s.amountLKR) && s.paymentStatus !== 'paid' && s.paymentStatus !== 'waived').length;
  const ordersToConfirm = (adminState.orders || []).filter(o => o.status === 'reported' || o.status === 'pending').length;
  const nothing = !pendingMentors.length && !awaitingPay.length && !unpaidSessions && !ordersToConfirm;

  const jumpCard = (tab, icon, text) => `<a class="card" href="#" data-jump="${tab}" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px;border-color:var(--ochre)">
      <span class="material-symbols-outlined" style="color:var(--ochre)">${icon}</span>
      <p style="flex:1;min-width:220px;font-size:13.5px;margin:0">${text}</p>
      <span class="btn btn-quiet btn-sm">Open</span>
    </a>`;

  body.innerHTML = `
    ${unpaidSessions ? jumpCard('sessions', 'request_quote', `<strong>${unpaidSessions} session${unpaidSessions === 1 ? '' : 's'}</strong> invoiced, not yet paid.`) : ''}
    ${ordersToConfirm ? jumpCard('orders', 'receipt_long', `<strong>${ordersToConfirm} order${ordersToConfirm === 1 ? '' : 's'}</strong> reported paid, waiting to be confirmed.`) : ''}
    ${nothing ? `<div class="card"><p class="muted" style="font-size:14px">Nothing needs your attention right now — everything's approved, claimed or paid.</p></div>` : ''}
    ${pendingMentors.length ? `<h3 style="font-size:1rem;margin:18px 0 10px">${pendingMentors.length} mentor application${pendingMentors.length === 1 ? '' : 's'} awaiting approval</h3>${pendingMentors.map(mentorCard).join('')}` : ''}
    ${awaitingPay.length ? `<h3 style="font-size:1rem;margin:18px 0 10px">${awaitingPay.length} request${awaitingPay.length === 1 ? '' : 's'} awaiting payment confirmation</h3>${awaitingPay.map(requestCard).join('')}` : ''}`;

  $$('a[data-jump]', body).forEach(a => a.onclick = e => {
    e.preventDefault();
    $(`#adm-tabs .tab[data-tab="${a.dataset.jump}"]`)?.click();
  });
}

function admOverview(body) {
  const users = adminState.users || [];
  const assessments = users.filter(u => u.data.assessment).length;
  const totalApps = users.reduce((n, u) => n + (Array.isArray(u.data.applications) ? u.data.applications.length : 0), 0);
  const offers = users.reduce((n, u) => n + (Array.isArray(u.data.applications) ? u.data.applications.filter(a => ['Offer', 'Enrolled'].includes(a.status)).length : 0), 0);

  const mentors = adminState.mentors || [];
  const approvedM = mentors.filter(m => m.approved).length;
  const pendingM = mentors.filter(m => !m.approved).length;
  const requests = adminState.requests || [];
  const openReq = requests.filter(r => r.status === 'open').length;
  const awaitingPay = requests.filter(r => r.status === 'awaiting_payment').length;
  // Session revenue comes from the same de-duplicated ledger the Accounting
  // tab uses, so a logged session is never counted twice with its request.
  const paidTotal = accountingRows()
    .filter(t => t.kind === 'session' && t.status === 'paid')
    .reduce((sum, t) => sum + t.amountLKR, 0);
  const sessions = adminState.sessions || [];
  const unpaidSessions = sessions.filter(s => Number(s.amountLKR) && s.paymentStatus !== 'paid' && s.paymentStatus !== 'waived').length;
  const orders = adminState.orders || [];
  const orderRevenue = orders.filter(o => o.status === 'paid').reduce((s, o) => s + (Number(o.amountLKR) || 0), 0);
  const ordersToConfirm = orders.filter(o => o.status === 'reported' || o.status === 'pending').length;

  // field distribution from completed assessments
  const fields = {};
  users.forEach(u => { const f = u.data.assessment?.result?.field; if (f) fields[f] = (fields[f] || 0) + 1; });
  const fieldRows = Object.entries(fields).sort((a, b) => b[1] - a[1]);

  body.innerHTML = `
    <div class="grid-4" style="margin-bottom:28px">
      ${admMetric('mark_email_read', (adminState.leads || []).length, 'Email leads')}
      ${admMetric('support_agent', `${approvedM}/${pendingM}`, 'Mentors approved / pending')}
      ${admMetric('inbox', requests.length, 'Total requests')}
      ${admMetric('hourglass_top', openReq, 'Open (unclaimed)')}
      ${admMetric('payments', awaitingPay, 'Awaiting payment')}
      ${admMetric('history_edu', sessions.length, 'Sessions logged')}
      ${admMetric('request_quote', unpaidSessions, 'Sessions invoiced, unpaid')}
      ${admMetric('paid', 'LKR ' + paidTotal.toLocaleString(), 'Session revenue')}
      ${admMetric('shopping_bag', 'LKR ' + orderRevenue.toLocaleString(), 'Premium revenue')}
      ${admMetric('receipt_long', ordersToConfirm, 'Orders to confirm')}
      ${admMetric('group', users.length, 'Synced users')}
      ${admMetric('quiz', assessments, 'Assessments completed')}
      ${admMetric('folder_managed', totalApps, 'Applications tracked')}
      ${admMetric('workspace_premium', offers, 'Offers / enrolled')}
    </div>
    <div class="card">
      <h3 style="font-size:1.05rem;margin-bottom:14px">Interest by field <span class="faint" style="font-size:12px">(from completed assessments)</span></h3>
      ${fieldRows.length ? `<table class="ledger"><tbody>${fieldRows.map(([f, n]) => `
        <tr><td style="font-size:13px">${esc(f)}</td>
            <td style="width:50%"><div class="bar"><span style="width:${Math.round(n / assessments * 100)}%"></span></div></td>
            <td class="mono" style="width:1%;text-align:right">${n}</td></tr>`).join('')}</tbody></table>`
        : `<p class="muted" style="font-size:13.5px">No completed assessments synced yet.</p>`}
    </div>`;
}

function admLeads(body) {
  if (adminState.leads === null) { body.innerHTML = admErrCard('leads'); return; }
  const leads = adminState.leads;
  body.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px">
      <p class="faint" style="font-size:12.5px;margin:0">${leads.length} lead${leads.length === 1 ? '' : 's'}</p>
      ${leads.length ? `<button class="btn btn-quiet btn-sm" id="adm-dl-leads"><span class="material-symbols-outlined" style="font-size:15px">download</span> Export CSV</button>` : ''}
    </div>
    <div class="card">${leads.length ? `<table class="ledger"><tbody>
      ${leads.map(l => `<tr>
        <td style="font-size:13.5px"><a href="mailto:${esc(l.email)}" style="color:var(--route)">${esc(l.email)}</a></td>
        <td class="faint" style="font-size:12px">${esc(l.source || '')}</td>
        <td class="faint mono" style="font-size:11.5px;text-align:right;white-space:nowrap">${l.at ? new Date(l.at).toLocaleDateString() : ''}</td>
      </tr>`).join('')}
    </tbody></table>` : `<p class="muted" style="font-size:14px">No leads captured yet.</p>`}</div>`;

  const dl = $('#adm-dl-leads', body);
  if (dl) dl.onclick = () => csvDownload('pathfinder-leads.csv', ['email', 'source', 'at'], leads);
}

/* One mentor row — shared by the Mentors tab (everyone) and the Action
   needed tab (pending only), so approve/revoke wiring only exists once. */
function mentorCard(m) {
  const active = m.active !== false;
  return `<div class="card" style="margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;align-items:flex-start">
      <div style="flex:1;min-width:220px">
        <strong style="font-size:14.5px">${esc(m.displayName || 'Mentor')}</strong>
        <span class="faint" style="font-size:12.5px"> · ${esc(m.city || '')}</span>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
          <span class="chip ${m.approved ? 'chip-teal' : 'chip-gold'}">${m.approved ? 'Approved' : 'Pending'}</span>
          <span class="chip ${active ? 'chip-teal' : 'chip-dim'}">${active ? 'Active' : 'Inactive'}</span>
          ${(m.fields || []).map(f => `<span class="chip chip-dim">${PF_CONSULT_TOPICS[f] || f}</span>`).join('')}
        </div>
        ${m.bio ? `<div class="muted" style="font-size:13px;margin-top:8px">${esc(m.bio)}</div>` : ''}
        <div class="faint mono" style="font-size:11px;margin-top:6px">${esc(m.langs || '')}${m.availability ? ' · ' + esc(m.availability) : ''}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start">
        ${m.approved
          ? `<button class="btn btn-quiet btn-sm" data-muid="${m.uid}" data-act="${active ? 'deactivate' : 'activate'}">${active ? 'Deactivate' : 'Reactivate'}</button>`
          : `<button class="btn btn-primary btn-sm" data-muid="${m.uid}" data-act="approve">Approve</button>`}
        ${m.approved ? `<button class="btn btn-quiet btn-sm" data-muid="${m.uid}" data-act="reject">Revoke</button>` : ''}
      </div>
    </div>
  </div>`;
}

function admMentors(body) {
  if (adminState.mentors === null) { body.innerHTML = admErrCard('mentors'); return; }
  const mentors = adminState.mentors.slice().sort((a, b) => (a.approved === b.approved) ? 0 : (a.approved ? 1 : -1));
  body.innerHTML = `
    <p class="faint" style="font-size:12.5px;margin:0 0 14px">${mentors.length} mentor account${mentors.length === 1 ? '' : 's'} · pending first</p>
    ${mentors.length ? mentors.map(mentorCard).join('') : `<div class="card"><p class="muted" style="font-size:14px">No mentor applications yet.</p></div>`}`;
}

function admRequestNameOf(uid) {
  const m = (adminState.mentors || []).find(x => x.uid === uid);
  return m ? m.displayName : (uid ? uid.slice(0, 8) + '…' : '—');
}

/* One request row — shared by the Requests tab (everyone) and the Action
   needed tab (awaiting-payment only). */
function requestCard(r) {
  const canPaid = r.status === 'awaiting_payment';
  const canCancel = !['paid', 'completed', 'cancelled'].includes(r.status);
  return `<div class="card" style="margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;align-items:flex-start">
      <div style="flex:1;min-width:220px">
        <strong style="font-size:14.5px">${esc(r.name || 'Unknown')}</strong>
        <span class="faint" style="font-size:12.5px"> · ${esc(r.contact || 'no contact')}</span>
        <div class="faint" style="font-size:12.5px;margin-top:2px">
          ${PF_CONSULT_TOPICS[r.topic] || 'General'} · ${r.mentorId ? 'mentor: ' + esc(admRequestNameOf(r.mentorId)) : 'unclaimed'} · ${r.at ? new Date(r.at).toLocaleDateString() : ''}
          ${r.source && r.source !== 'platform' ? ' · ' + esc(PF_REQUEST_SOURCES[r.source] || r.source) + (r.takenByName ? ', taken by ' + esc(r.takenByName) : '') : ''}
        </div>
        ${r.note ? `<div class="muted" style="font-size:13px;margin-top:6px">${esc(r.note)}</div>` : ''}
        ${r.callback ? `<div class="faint" style="font-size:12.5px;margin-top:6px">Call back: ${esc(r.callback)}</div>` : ''}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
        ${reqStatusChip(r.status)}
        ${r.payment ? payStatusChip(r.payment) : ''}
      </div>
    </div>
    ${canPaid || canCancel ? `<div style="margin-top:12px;padding-top:12px;border-top:1px dashed var(--line);display:flex;gap:8px;flex-wrap:wrap">
      ${canPaid ? `<button class="btn btn-primary btn-sm" data-radoc="${r.id}" data-act="paid">Mark payment received</button>` : ''}
      ${canCancel ? `<button class="btn btn-quiet btn-sm" data-radoc="${r.id}" data-act="cancel" style="margin-left:auto">Cancel</button>` : ''}
    </div>` : ''}
  </div>`;
}

function admRequests(body) {
  if (adminState.requests === null) { body.innerHTML = admErrCard('mentor requests'); return; }
  const reqs = adminState.requests;
  body.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px">
      <p class="faint" style="font-size:12.5px;margin:0">${reqs.length} request${reqs.length === 1 ? '' : 's'}</p>
      ${reqs.length ? `<button class="btn btn-quiet btn-sm" id="adm-dl-reqs"><span class="material-symbols-outlined" style="font-size:15px">download</span> Export CSV</button>` : ''}
    </div>
    ${reqs.length ? reqs.map(requestCard).join('') : `<div class="card"><p class="muted" style="font-size:14px">No mentor requests yet.</p></div>`}`;

  const dl = $('#adm-dl-reqs', body);
  if (dl) dl.onclick = () => csvDownload('pathfinder-mentor-requests.csv',
    ['name', 'contact', 'topic', 'source', 'callback', 'status', 'mentorId', 'paymentStatus', 'amountLKR', 'note', 'at'],
    reqs.map(r => ({ ...r,
      source: PF_REQUEST_SOURCES[r.source] || 'Asked on PathFinder',
      callback: r.callback || '',
      mentorId: r.mentorId || '',
      paymentStatus: r.payment ? r.payment.paymentStatus : 'none',
      amountLKR: r.payment ? r.payment.amountLKR : '' })));
}

function admOrders(body) {
  if (adminState.orders === null) { body.innerHTML = admErrCard('orders'); return; }
  const orders = adminState.orders;
  const label = it => (PFPay.items()[it] && PFPay.items()[it].label) || it;
  const revenue = orders.filter(o => o.status === 'paid').reduce((s, o) => s + (Number(o.amountLKR) || 0), 0);
  body.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px">
      <p class="faint" style="font-size:12.5px;margin:0">${orders.length} order${orders.length === 1 ? '' : 's'} · LKR ${revenue.toLocaleString()} confirmed</p>
      ${orders.length ? `<button class="btn btn-quiet btn-sm" id="adm-dl-orders"><span class="material-symbols-outlined" style="font-size:15px">download</span> Export CSV</button>` : ''}
    </div>
    ${orders.length ? orders.map(o => {
      const canPaid = o.status === 'reported' || o.status === 'pending';
      const canCancel = o.status !== 'paid' && o.status !== 'cancelled';
      return `<div class="card" style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;align-items:flex-start">
          <div style="flex:1;min-width:220px">
            <strong style="font-size:14.5px">${esc(label(o.item))}</strong>
            <span class="faint" style="font-size:12.5px"> · LKR ${Number(o.amountLKR || 0).toLocaleString()}</span>
            <div class="faint" style="font-size:12.5px;margin-top:2px">
              ${o.createdAt ? new Date(o.createdAt).toLocaleDateString() : ''}${o.method ? ' · ' + esc(o.method) : ''}${o.ref ? ' · ref ' + esc(o.ref) : ''}${o.payerTxn ? ' · txn ' + esc(o.payerTxn) : ''}
            </div>
            <div class="faint mono" style="font-size:11px;margin-top:4px">uid ${esc((o.uid || '').slice(0, 12))}…</div>
          </div>
          ${payStatusChip({ paymentStatus: o.status })}
        </div>
        ${canPaid || canCancel ? `<div style="margin-top:12px;padding-top:12px;border-top:1px dashed var(--line);display:flex;gap:8px;flex-wrap:wrap">
          ${canPaid ? `<button class="btn btn-primary btn-sm" data-oid="${o.id}" data-act="paid">Mark paid &amp; unlock</button>` : ''}
          ${canCancel ? `<button class="btn btn-quiet btn-sm" data-oid="${o.id}" data-act="cancel" style="margin-left:auto">Cancel</button>` : ''}
        </div>` : ''}
      </div>`;
    }).join('') : `<div class="card"><p class="muted" style="font-size:14px">No premium orders yet.</p></div>`}`;

  const dl = $('#adm-dl-orders', body);
  if (dl) dl.onclick = () => csvDownload('pathfinder-orders.csv',
    ['item', 'amountLKR', 'status', 'method', 'ref', 'payerTxn', 'uid', 'createdAt'],
    orders.map(o => ({ ...o, createdAt: o.createdAt ? new Date(o.createdAt).toISOString() : '' })));
}

/* ── Sessions: every mentoring session delivered on the platform ────────
   The admin view of the same records mentors keep in their session log,
   across all mentors and including sessions that only ever happened on
   WhatsApp or a phone call. Filterable by mentor and payment state, with
   CSV export and one-click PDF invoices. */
let admSessionFilter = { mentor: '', pay: '' };
// Free-text filter for the admin People tab (name or phone number).
let admPeopleQuery = '';

function admSessions(body, repaint) {
  if (adminState.sessions === null) { body.innerHTML = admErrCard('session records'); return; }
  const mentors = (adminState.mentors || []).filter(m => m.approved);
  const all = adminState.sessions;
  const list = all.filter(s =>
    (!admSessionFilter.mentor || s.mentorId === admSessionFilter.mentor) &&
    (!admSessionFilter.pay || (s.paymentStatus || 'unpaid') === admSessionFilter.pay));

  const billed = list.filter(s => Number(s.amountLKR) && s.paymentStatus !== 'waived');
  const collected = billed.filter(s => s.paymentStatus === 'paid').reduce((n, s) => n + Number(s.amountLKR), 0);
  const outstanding = billed.filter(s => s.paymentStatus !== 'paid').reduce((n, s) => n + Number(s.amountLKR), 0);
  const minutes = list.reduce((n, s) => n + (Number(s.durationMin) || 0), 0);

  body.innerHTML = `
    <div class="grid-4" style="margin-bottom:20px">
      ${admMetric('history_edu', list.length, 'Sessions logged')}
      ${admMetric('schedule', (minutes / 60).toFixed(1) + ' h', 'Mentoring delivered')}
      ${admMetric('paid', 'LKR ' + collected.toLocaleString(), 'Collected')}
      ${admMetric('pending_actions', 'LKR ' + outstanding.toLocaleString(), 'Outstanding')}
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
      <select class="field" id="adm-sx-mentor" style="width:auto;min-width:170px">
        <option value="">All mentors</option>
        ${mentors.map(m => `<option value="${esc(m.uid)}" ${admSessionFilter.mentor === m.uid ? 'selected' : ''}>${esc(m.displayName || m.uid.slice(0, 8))}</option>`).join('')}
      </select>
      <select class="field" id="adm-sx-pay" style="width:auto;min-width:150px">
        <option value="">Any payment state</option>
        ${Object.entries(PF_SESSION_PAYMENT_STATES).map(([k, v]) => `<option value="${k}" ${admSessionFilter.pay === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
      </select>
      ${list.length ? `<button class="btn btn-quiet btn-sm" id="adm-dl-sx"><span class="material-symbols-outlined" style="font-size:15px">download</span> Export CSV</button>` : ''}
      <button class="btn btn-primary btn-sm" id="adm-sx-log" style="margin-left:auto">
        <span class="material-symbols-outlined" style="font-size:15px">add</span> Log a session</button>
    </div>
    ${list.length ? list.map(s => sessionCard(s, { showMentor: true })).join('')
      : `<div class="card"><p class="muted" style="font-size:14px">${all.length ? 'No sessions match those filters.' : 'No sessions yet. Mentors write theirs up from their own dashboard — or you can add one here for them after a WhatsApp or phone consultation.'}</p></div>`}`;

  $('#adm-sx-mentor', body).onchange = e => { admSessionFilter.mentor = e.target.value; repaint(); };
  $('#adm-sx-pay', body).onchange = e => { admSessionFilter.pay = e.target.value; repaint(); };

  const log = $('#adm-sx-log', body);
  log.onclick = () => admLogSession(repaint, adminPeople());

  const dl = $('#adm-dl-sx', body);
  if (dl) dl.onclick = () => csvDownload('pathfinder-mentoring-sessions.csv',
    ['invoiceNo', 'date', 'mentorName', 'studentName', 'studentContact', 'channel', 'topic',
     'title', 'durationMin', 'amountLKR', 'paymentStatus', 'method', 'ref', 'summary', 'followUp'],
    list.map(s => ({ ...s, channel: PF_SESSION_CHANNELS[s.channel] || s.channel,
      topic: PF_CONSULT_TOPICS[s.topic] || s.topic || 'General guidance' })));
}

/* Log a session on a mentor's behalf — the admin's version of the mentor's
   own "Log a session", with a mentor picker on top. Used from the Sessions
   tab and from a person card in the People tab. */
function admLogSession(repaint, people, prefill = {}) {
  const mentors = (adminState.mentors || []).filter(m => m.approved);
  if (!mentors.length) return toast('Approve a mentor first — a session belongs to one.');
  openSessionForm({
    mentors, people,
    prefill: Object.assign({ mentorId: mentors[0].uid }, prefill),
    onSave: async data => {
      const m = mentors.find(x => x.uid === data.mentorId);
      const saved = await PFCloud.createSession({ ...data, mentorName: m ? m.displayName : '' });
      adminState.sessions = [saved, ...(adminState.sessions || [])];
      repaint();
      return saved;
    },
  });
}

/* ── People (admin) ─────────────────────────────────────────────────────
   The whole client book across every mentor, folded out of the requests
   and sessions the panel already loaded — no extra query, no `people`
   collection. This is where a phone caller with no account becomes a
   person with a history rather than a row in a queue. */
function adminPeople() {
  return buildPeople({ sessions: adminState.sessions || [], requests: adminState.requests || [] });
}

function admPeople(body) {
  if (adminState.requests === null && adminState.sessions === null) { body.innerHTML = admErrCard('people'); return; }
  const people = adminPeople();
  const q = (admPeopleQuery || '').trim().toLowerCase();
  const list = q ? people.filter(p =>
    (p.name || '').toLowerCase().includes(q) || (p.contact || '').toLowerCase().includes(q)) : people;

  const noAccount = people.filter(p => !p.uid).length;
  const due = people.reduce((n, p) => n + p.due, 0);

  body.innerHTML = `
    <div class="grid-4" style="margin-bottom:20px">
      ${admMetric('contacts', people.length, 'People on record')}
      ${admMetric('phone_in_talk', noAccount, 'Without an account')}
      ${admMetric('pending_actions', 'LKR ' + due.toLocaleString(), 'Still owed')}
      ${admMetric('history_edu', people.reduce((n, p) => n + p.sessions.length, 0), 'Sessions across them')}
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
      <input class="field" id="adm-px-q" placeholder="Search by name or number" value="${esc(admPeopleQuery)}" style="width:auto;min-width:220px;flex:1;max-width:340px">
      ${list.length ? `<button class="btn btn-quiet btn-sm" id="adm-dl-px"><span class="material-symbols-outlined" style="font-size:15px">download</span> Export CSV</button>` : ''}
    </div>
    ${list.length ? list.map(p => personCard(p, { canLog: true })).join('')
      : `<div class="card"><p class="muted" style="font-size:14px">${people.length ? 'Nobody matches that search.' : 'No one on record yet. Requests from the site and calls you write down both land here.'}</p></div>`}`;

  const search = $('#adm-px-q', body);
  search.oninput = e => {
    admPeopleQuery = e.target.value;
    // Repaint the list only, so the caret stays where the admin is typing.
    const rows = body.querySelectorAll('[data-person].card');
    rows.forEach(r => r.remove());
    const term = admPeopleQuery.trim().toLowerCase();
    const next = term ? people.filter(p => (p.name || '').toLowerCase().includes(term)
      || (p.contact || '').toLowerCase().includes(term)) : people;
    body.insertAdjacentHTML('beforeend', next.length ? next.map(p => personCard(p, { canLog: true })).join('')
      : `<div class="card" data-person="none"><p class="muted" style="font-size:14px">Nobody matches that search.</p></div>`);
  };

  const dl = $('#adm-dl-px', body);
  if (dl) dl.onclick = () => csvDownload('pathfinder-people.csv',
    ['name', 'contact', 'sessions', 'requests', 'paidLKR', 'dueLKR', 'minutes', 'hasAccount', 'lastContact'],
    list.map(p => ({ name: p.name, contact: p.contact, sessions: p.sessions.length,
      requests: p.requests.length, paidLKR: p.paid, dueLKR: p.due, minutes: p.minutes,
      hasAccount: p.uid ? 'yes' : 'no', lastContact: p.lastAt ? new Date(p.lastAt).toISOString().slice(0, 10) : '' })));
}

/* ── Accounting: one ledger from every revenue source ───────────────────
   Reconstructs a unified transaction list from data the admin already
   loaded (mentor_sessions[] + mentor_requests[].payment + orders[]) — no
   extra Firestore reads and no new collection, so it stays inside the free
   Spark plan.

   Session records win over the request that spawned them: once a mentor
   has written up a session, that record is the fuller account of the same
   money, so the request's payment line is skipped and the ledger never
   double-counts. Off-platform sessions (WhatsApp, phone) have no request
   behind them and appear here for the first time. */
function accountingRows() {
  const prefix = (PF_CONFIG.org && PF_CONFIG.org.invoicePrefix) || 'PF';
  const tail = id => String(id || '').replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase() || '------';
  const rows = [];
  const mentorName = uid => {
    const m = (adminState.mentors || []).find(x => x.uid === uid);
    return m ? (m.displayName || '') : '';
  };

  const sessions = adminState.sessions || [];
  const loggedRequests = new Set(sessions.map(s => s.requestId).filter(Boolean));

  sessions.forEach(s => {
    const amount = Number(s.amountLKR) || 0;
    // A free intro (or an explicitly waived fee) is a record of delivered
    // work, not a transaction — it stays out of the money ledger.
    if (!amount || s.paymentStatus === 'waived') return;
    rows.push({
      invoiceNo: s.invoiceNo || `${prefix}-INV-M-${tail(s.id)}`, kind: 'session',
      item: sessionTitle(s) + ' — mentoring session',
      payer: s.studentName || '', payerContact: s.studentContact || '', payerUid: s.studentUid || '',
      mentorName: s.mentorName || mentorName(s.mentorId),
      method: s.method || '', ref: s.ref || '', txn: s.payerTxn || '',
      amountLKR: amount, status: s.paymentStatus === 'unpaid' ? 'requested' : s.paymentStatus,
      date: s.paidAt || s.date || s.createdAt || null, srcId: s.id,
      session: s,          // lets the invoice carry the notes, not just the money
    });
  });

  (adminState.requests || []).forEach(r => {
    const p = r.payment;
    if (!p || !p.paymentStatus || p.paymentStatus === 'none') return;
    if (loggedRequests.has(r.id)) return;      // superseded by its session record
    rows.push({
      invoiceNo: `${prefix}-INV-S-${tail(r.id)}`, kind: 'session',
      item: (PF_CONSULT_TOPICS[r.topic] ? PF_CONSULT_TOPICS[r.topic] + ' — ' : '') + 'mentoring session',
      payer: r.name || '', payerContact: r.contact || '', payerUid: r.studentUid || '',
      mentorName: mentorName(r.mentorId),
      method: p.method || '', ref: p.payerRef || '', txn: p.payerTxn || '',
      amountLKR: Number(p.amountLKR) || 0, status: p.paymentStatus,
      date: p.paidAt || p.reportedAt || r.at || null, srcId: r.id,
    });
  });

  (adminState.orders || []).forEach(o => {
    rows.push({
      invoiceNo: `${prefix}-INV-O-${tail(o.id)}`, kind: 'order',
      item: (PFPay.items()[o.item] && PFPay.items()[o.item].label) || o.item || 'Premium unlock',
      payer: '', payerContact: '', payerUid: o.uid || '',
      method: o.method || '', ref: o.ref || '', txn: o.payerTxn || '',
      amountLKR: Number(o.amountLKR) || 0, status: o.status,
      date: o.paidAt || o.createdAt || null, srcId: o.id,
    });
  });

  const ts = d => (d == null ? 0 : (typeof d === 'number' ? d : Date.parse(d) || 0));
  return rows.sort((a, b) => ts(b.date) - ts(a.date));
}

function admAccounting(body) {
  if (adminState.requests === null && adminState.orders === null && adminState.sessions === null) {
    body.innerHTML = admErrCard('accounting data'); return;
  }
  const rows = accountingRows();
  const take = Number(PF_CONFIG.platformTakeRate) || 0.20;
  const money = n => 'LKR ' + Number(n || 0).toLocaleString();
  const isPaid = s => s === 'paid';
  const isPending = s => s === 'reported' || s === 'pending' || s === 'requested';
  const dateStr = d => d ? new Date(typeof d === 'number' ? d : Date.parse(d)).toLocaleDateString() : '—';

  const received = rows.filter(r => isPaid(r.status)).reduce((s, r) => s + r.amountLKR, 0);
  const pending  = rows.filter(r => isPending(r.status)).reduce((s, r) => s + r.amountLKR, 0);
  const platform = rows.filter(r => isPaid(r.status))
    .reduce((s, r) => s + (r.kind === 'order' ? r.amountLKR : r.amountLKR * take), 0);
  const mentorShare = rows.filter(r => isPaid(r.status) && r.kind === 'session')
    .reduce((s, r) => s + r.amountLKR * (1 - take), 0);

  const byMethod = {};
  rows.filter(r => isPaid(r.status)).forEach(r => { const k = r.method || 'Unspecified'; byMethod[k] = (byMethod[k] || 0) + r.amountLKR; });
  const methodRows = Object.entries(byMethod).sort((a, b) => b[1] - a[1]);

  body.innerHTML = `
    <div class="grid-4" style="margin-bottom:24px">
      ${admMetric('account_balance_wallet', money(received), 'Total received')}
      ${admMetric('hourglass_top', money(pending), 'Pending confirmation')}
      ${admMetric('savings', money(platform), 'Platform earnings')}
      ${admMetric('receipt_long', rows.length, 'Transactions')}
    </div>
    ${methodRows.length ? `<div class="card" style="margin-bottom:20px">
      <h3 style="font-size:1.05rem;margin-bottom:12px">Received by method</h3>
      <table class="ledger"><tbody>${methodRows.map(([m, v]) => `
        <tr><td style="font-size:13px">${esc(m)}</td>
            <td style="width:55%"><div class="bar"><span style="width:${received ? Math.round(v / received * 100) : 0}%"></span></div></td>
            <td class="mono" style="text-align:right;white-space:nowrap">${money(v)}</td></tr>`).join('')}</tbody></table>
      <p class="faint" style="font-size:11.5px;margin-top:10px">Mentor payouts (paid sessions, ${Math.round((1 - take) * 100)}%): ${money(mentorShare)} · platform take-rate ${Math.round(take * 100)}%.</p>
    </div>` : ''}
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px">
      <p class="faint" style="font-size:12.5px;margin:0">${rows.length} transaction${rows.length === 1 ? '' : 's'} · ledger newest first</p>
      ${rows.length ? `<button class="btn btn-quiet btn-sm" id="adm-dl-acct"><span class="material-symbols-outlined" style="font-size:15px">download</span> Export ledger CSV</button>` : ''}
    </div>
    ${rows.length ? `<div class="card" style="overflow-x:auto"><table class="ledger" style="min-width:660px"><thead>
      <tr><th style="text-align:left">Date</th><th style="text-align:left">Invoice</th><th style="text-align:left">Item</th><th style="text-align:left">Method</th><th style="text-align:right">Amount</th><th style="text-align:left">Status</th><th></th></tr>
    </thead><tbody>
      ${rows.map(r => `<tr>
        <td class="mono" style="font-size:11.5px;white-space:nowrap">${dateStr(r.date)}</td>
        <td class="mono" style="font-size:11px">${esc(r.invoiceNo)}</td>
        <td style="font-size:13px">${esc(r.item)}${r.payer ? ` · <span class="faint">${esc(r.payer)}</span>` : ''}</td>
        <td style="font-size:12.5px">${esc(r.method || '—')}</td>
        <td class="mono" style="text-align:right;white-space:nowrap">${money(r.amountLKR)}</td>
        <td>${payStatusChip({ paymentStatus: r.status })}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-quiet btn-sm" data-invoice="${esc(r.invoiceNo)}" data-act="download" title="Download PDF invoice"><span class="material-symbols-outlined" style="font-size:15px">picture_as_pdf</span></button>
          <button class="btn btn-quiet btn-sm" data-invoice="${esc(r.invoiceNo)}" title="Preview / print"><span class="material-symbols-outlined" style="font-size:15px">receipt</span></button>
        </td>
      </tr>`).join('')}
    </tbody></table></div>` : `<div class="card"><p class="muted" style="font-size:14px">No payments recorded yet. Logged mentoring sessions, reported and confirmed request payments, and premium unlocks all appear here.</p></div>`}
    <p class="faint" style="font-size:11.5px;margin-top:14px">A management ledger reconstructed from live records. For statutory accounting, reconcile against your bank / PayHere / PayPal statements and register a business once revenue is steady (see <code>docs/PRICING.md</code>).</p>`;

  const dl = $('#adm-dl-acct', body);
  if (dl) dl.onclick = () => csvDownload('pathfinder-accounting-ledger.csv',
    ['invoiceNo', 'date', 'kind', 'item', 'payer', 'payerUid', 'mentorName', 'method', 'ref', 'txn', 'amountLKR', 'status'],
    rows.map(r => ({ ...r, date: r.date ? new Date(typeof r.date === 'number' ? r.date : Date.parse(r.date)).toISOString() : '' })));
}

/* Print-ready receipt / invoice for one transaction — now a thin wrapper
   over PFInvoice (assets/js/invoice.js), which renders the same document
   as a real downloadable PDF and as a printable preview. Kept as a named
   helper so any caller outside the admin ledger still works. */
function openInvoice(tx) {
  const model = tx && tx.session ? PFInvoice.fromSession(tx.session) : PFInvoice.fromTx(tx);
  if (!PFInvoice.open(model)) toast('Allow pop-ups to open the receipt');
}

function admUsers(body) {
  if (adminState.users === null) { body.innerHTML = admErrCard('user records'); return; }
  const users = adminState.users;
  body.innerHTML = `
    <p class="faint" style="font-size:12.5px;margin:0 0 14px">${users.length} synced user${users.length === 1 ? '' : 's'} · most recently active first</p>
    ${users.length ? users.map(u => {
      const a = u.data.assessment?.result;
      const apps = Array.isArray(u.data.applications) ? u.data.applications : [];
      const saved = Array.isArray(u.data.saved) ? u.data.saved : [];
      return `<div class="card" style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline">
          <strong class="mono" style="font-size:12.5px">${esc(u.uid.slice(0, 12))}…</strong>
          <span class="faint" style="font-size:11.5px">${u.updatedAt ? 'active ' + new Date(u.updatedAt).toLocaleDateString() : ''}</span>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          ${a ? `<span class="chip chip-teal">${a.readiness}% ready</span><span class="chip chip-dim">${esc(a.field)}</span>` : `<span class="chip chip-dim">No assessment</span>`}
          <span class="chip chip-dim">${apps.length} application${apps.length === 1 ? '' : 's'}</span>
          <span class="chip chip-dim">${saved.length} saved</span>
        </div>
        ${apps.length ? `<table class="ledger" style="margin-top:12px"><tbody>
          ${apps.map(ap => `<tr><td style="font-size:13px">${esc(ap.uni || '')}</td>
            <td class="faint" style="font-size:12px">${esc(ap.supervisor || '')}</td>
            <td class="mono" style="font-size:11.5px;text-align:right;white-space:nowrap">${esc(ap.status || '')}</td></tr>`).join('')}
        </tbody></table>` : ''}
      </div>`;
    }).join('') : `<div class="card"><p class="muted" style="font-size:14px">No users have signed in to sync yet. Records appear here once students sign in with Google.</p></div>`}`;
}

/* tiny CSV exporter for the admin tables */
function csvDownload(filename, cols, rows) {
  const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const csv = [cols.join(','), ...rows.map(r => cols.map(c => q(r[c])).join(','))].join('\r\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
    download: filename,
  });
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Exported ' + filename);
}

/* Template download/copy — delegated once so re-renders don't stack handlers */
document.addEventListener('click', e => {
  const dl = e.target.closest('.tpl-dl'), cp = e.target.closest('.tpl-copy');
  if (!dl && !cp) return;
  const t = PF_TEMPLATES.find(x => x.id === (dl || cp).dataset.id);
  if (cp) { navigator.clipboard.writeText(t.body).then(() => toast('Copied to clipboard')); return; }
  const blob = new Blob([t.body], { type: 'text/plain' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: t.name.replace(/\s+/g, '-').toLowerCase() + '.txt',
  });
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Template downloaded');
});
