/* ════════════════════════════════════════════════════════════
   PathFinder — App SPA (assessment, roadmap, explorer,
   funding, dashboard, starter kit). Hash-routed, no build step.
   ════════════════════════════════════════════════════════════ */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uniById = id => PF_UNIVERSITIES.find(u => u.id === id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

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

/* ── Entitlements (one-time premium unlocks) ─────────────────────────────
   Derived once per session from the signed-in user's paid `orders`, cached
   in a JS variable so gating reads (renderKit etc.) cost zero Firestore
   reads on navigation. The Sprint bundle also grants the Toolkit. */
let entState = { loaded: false, items: {} };
function entitlements() { return entState.items; }
function cloudOn() { return !!(window.PF_FIREBASE_CONFIG && window.PF_FIREBASE_CONFIG.apiKey); }
function loadEntitlements(cb) {
  if (!(cloudOn() && window.PFCloud && PFCloud.hasUser && PFCloud.hasUser())) {
    entState = { loaded: true, items: {} };
    if (cb) cb();
    return;
  }
  PFCloud.fetchMyOrders().then(orders => {
    const items = {};
    (orders || []).filter(o => o.status === 'paid').forEach(o => {
      items[o.item] = true;
      if (o.item === 'sprint') items.toolkit = true;   // bundle grants toolkit
    });
    entState = { loaded: true, items };
    if (cb) cb();
  }).catch(() => { entState = { loaded: true, items: {} }; if (cb) cb(); });
}

/* ── Router ─────────────────────────────────────────────── */
const ROUTES = {
  assessment: renderAssessment,
  roadmap:    renderRoadmap,
  research:   renderResearch,
  explore:    renderExplore,
  funding:    renderFunding,
  funds:      renderFunds,
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
  const fn = ROUTES[view] || renderDashboard;
  if (ROUTES[view]) markSeen(view);
  $$('.side-link').forEach(a => a.classList.toggle('active', a.dataset.view === view));
  $('.side-link.active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  const main = $('#view');
  main.innerHTML = '';
  fn(main);
  updateJourneyMeter();
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
      blurb: 'Find your fit — pathway, fields, labs and funding.',
      steps: [
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
      blurb: 'Contact supervisors and track every application.',
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

/* where a phase chip jumps to: the next unfinished milestone, else its home view */
function journeyJump(p) { return p.nextStep ? p.nextStep[2] : '#' + p.view; }

function journeyBlurb(J) {
  if (J.overall === 0) return 'Five stages from your first question to enrolment in New Zealand. It starts with a 5-minute assessment.';
  if (J.overall >= 100) return 'Every milestone done — you’re ready. Keep a mentor close for the final stretch.';
  const left = 100 - J.overall;
  return `You’re in <strong>${J.current.label}</strong>. ${J.current.blurb}${left <= 35 ? ' Almost there.' : ''}`;
}

/* The dashboard hero: a visual, clickable map of the whole journey. */
function renderJourneyMap() {
  const J = journeyModel();
  const synced = !!(window.PFCloud && PFCloud.isSignedIn && PFCloud.isSignedIn());
  const hasData = !!PFStore.getAssessment() || PFStore.getApps().length > 0 || PFStore.getSaved().length > 0;
  const cont = J.nextStep;

  const cards = J.phases.map((p, idx) => {
    const isCur = p.id === J.current.id && !p.complete;
    const badge = p.complete
      ? '<span class="material-symbols-outlined" style="font-size:17px">check</span>'
      : (idx + 1);
    return `<a class="jp ${p.complete ? 'jp-done' : ''} ${isCur ? 'jp-cur' : ''}" href="${journeyJump(p)}" data-phase="${p.id}">
      <div class="jp-top">
        <span class="jp-num">${badge}</span>
        <span class="material-symbols-outlined jp-ic">${p.icon}</span>
      </div>
      <div class="jp-name">${p.label}</div>
      <div class="jp-bar"><span style="width:${p.pct}%"></span></div>
      <div class="jp-meta">${isCur ? 'You’re here · ' : ''}${p.done}/${p.total}</div>
    </a>`;
  }).join('');

  return `<section class="journey" aria-label="Your journey to a PhD in New Zealand">
    <div class="journey-head">
      <div style="min-width:240px">
        <span class="tag"><span class="material-symbols-outlined" style="font-size:14px">map</span>Your journey to a NZ PhD</span>
        <h2 class="journey-pct">${J.overall}<small>% complete</small></h2>
        <p class="muted" style="font-size:13.5px;margin:4px 0 0;max-width:460px">${journeyBlurb(J)}</p>
      </div>
      ${cont
        ? `<a class="btn btn-primary journey-cta" href="${cont[2]}"><span class="material-symbols-outlined" style="font-size:17px">bolt</span>${cont[0]}</a>`
        : `<a class="btn btn-primary journey-cta" href="#mentors"><span class="material-symbols-outlined" style="font-size:17px">support_agent</span>Pressure-test with a mentor</a>`}
    </div>
    <div class="journey-track">${cards}</div>
    ${!synced && hasData
      ? `<a class="journey-nudge" href="#account"><span class="material-symbols-outlined" style="font-size:17px">cloud_sync</span><span>You’ve built real progress — <strong>create a free account</strong> to keep it safe across devices.</span><span class="material-symbols-outlined" style="margin-left:auto;font-size:18px">arrow_forward</span></a>`
      : ''}
  </section>`;
}

/* keep the sidebar journey meter in sync after every route */
function updateJourneyMeter() {
  const el = document.getElementById('journey-meter');
  if (!el) return;
  const J = journeyModel();
  const bar = el.querySelector('.jm-bar span'); if (bar) bar.style.width = J.overall + '%';
  const pct = el.querySelector('.jm-pct'); if (pct) pct.textContent = J.overall + '%';
  const lbl = el.querySelector('.jm-lbl'); if (lbl) lbl.textContent = J.overall >= 100 ? 'Journey complete' : 'In ' + J.current.label;
}

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

function newsItemRow(x, compact) {
  const sum = x.summary && x.summary.length > 160 ? x.summary.slice(0, 160) + '…' : (x.summary || '');
  return `<a class="news-row" href="${esc(x.link)}" target="_blank" rel="noopener">
    <div class="news-main">
      <div class="news-meta"><span class="chip chip-${x.accent || 'dim'}">${esc(x.tag)}</span>
        <span class="news-src">${esc(x.source)}</span>${x.ts ? `<span class="news-time">· ${relTime(x.ts)}</span>` : ''}</div>
      <strong class="news-title">${esc(x.title)}</strong>
      ${!compact && sum ? `<p class="news-sum">${esc(sum)}</p>` : ''}
    </div>
    <span class="material-symbols-outlined news-go">north_east</span>
  </a>`;
}

/* compact 3-item strip for the dashboard (a high-traffic, "good for
   students" surface). Filled async by loadNews after first paint. */
function newsStrip() {
  const items = (newsState.items || []).slice(0, 3);
  const inner = items.length ? items.map(x => newsItemRow(x, true)).join('')
    : `<p class="muted" style="font-size:13.5px;margin:0">Loading the latest immigration & PhD news…</p>`;
  return `<section class="card" style="margin-bottom:40px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:10px">
      <h2 style="font-size:1.15rem;margin:0"><span class="material-symbols-outlined" style="font-size:19px;color:var(--route);vertical-align:-4px">newspaper</span> Latest briefing</h2>
      <a href="#news" class="route-link" style="color:var(--route);font-size:13px">All news →</a>
    </div>
    <div id="dash-news" class="news-list">${inner}</div>
  </section>`;
}

function renderNews(main) {
  main.innerHTML = viewHead('newspaper', 'Briefing', 'Immigration & PhD news, live',
    'Only what matters for a Sri Lankan student heading to New Zealand — visa & immigration changes and PhD / postgraduate news, pulled fresh from across the web and refreshed continuously.') +
    `<div id="news-body"></div>`;
  const body = $('#news-body', main);

  const paint = () => {
    const items = newsState.items || [];
    const tags = ['all', ...new Set((PF_NEWS.feeds || []).map(f => f.tag))];
    const chips = tags.map(t => `<button class="chip-filter news-fil ${newsFilter === t ? 'active' : ''}" data-fil="${esc(t)}">${t === 'all' ? 'All' : esc(t)}</button>`).join('');
    const shown = items.filter(x => newsFilter === 'all' || x.tag === newsFilter);
    const updated = newsState.fetchedAt ? `Updated ${relTime(newsState.fetchedAt)}` : '';

    let listHtml;
    if (newsState.loading && !items.length) listHtml = `<div class="card"><p class="muted" style="margin:0">Fetching the latest immigration & PhD news…</p></div>`;
    else if (!items.length) listHtml = `<div class="card"><p class="muted" style="margin:0">Couldn’t reach the news sources right now. <button class="btn btn-ghost btn-sm news-refresh">Try again</button></p></div>`;
    else listHtml = shown.length ? shown.map(x => newsItemRow(x)).join('')
      : `<div class="card"><p class="muted" style="margin:0">Nothing in this category right now — try “All”.</p></div>`;

    body.innerHTML = `<div class="news-bar">
        <div class="news-fils">${chips}</div>
        <div class="news-upd">${updated}${newsState.loading ? ' · refreshing…' : ''}
          <button class="btn btn-ghost btn-sm news-refresh" title="Refresh"><span class="material-symbols-outlined" style="font-size:15px">refresh</span></button></div>
      </div>
      <div class="news-list">${listHtml}</div>
      <p class="faint" style="font-size:11.5px;margin-top:20px;max-width:640px">Headlines are aggregated live from public news sources via Google News — PathFinder doesn’t write or endorse them. Always confirm visa rules with <a href="https://www.immigration.govt.nz" target="_blank" rel="noopener" style="color:var(--route)">Immigration New Zealand</a>.</p>`;
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
  const cls = { open:'chip-rose', claimed:'chip-violet', intro_done:'chip-gold',
    awaiting_payment:'chip-gold', paid:'chip-teal', completed:'chip-teal', cancelled:'chip-dim' };
  const lbl = { open:'Open', claimed:'Claimed', intro_done:'Intro done',
    awaiting_payment:'Awaiting payment', paid:'Paid', completed:'Completed', cancelled:'Cancelled' };
  return `<span class="chip ${cls[status] || 'chip-dim'}">${lbl[status] || status}</span>`;
}

/* payment-status chip — works whether paymentStatus was set manually
   (Tier 1) or by the PayHere webhook (Tier 2): both write the same field */
function payStatusChip(payment) {
  const ps = (payment && payment.paymentStatus) || 'none';
  const cls = { none:'chip-dim', requested:'chip-gold', reported:'chip-violet', pending:'chip-gold', paid:'chip-teal' };
  const lbl = { none:'No payment', requested:'Payment requested', reported:'Payment reported', pending:'Awaiting payment', paid:'Paid' };
  const amt = ps !== 'none' && payment && payment.amountLKR
    ? ` · LKR ${Number(payment.amountLKR).toLocaleString()}` : '';
  return `<span class="chip ${cls[ps] || 'chip-dim'}">${lbl[ps] || ps}${amt}</span>`;
}

/* inline "Ask a mentor" hook — expand + submit, no navigation */
document.addEventListener('click', e => {
  const tgl = e.target.closest('.consult-hook-toggle');
  if (!tgl) return;
  const form = tgl.parentElement.querySelector('.consult-hook-form');
  form.classList.toggle('hidden');
  if (!form.classList.contains('hidden')) form.querySelector('.ch-name').focus();
});
document.addEventListener('submit', e => {
  const form = e.target.closest('.consult-hook-form');
  if (!form) return;
  e.preventDefault();
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
    <a class="btn btn-ghost btn-sm" href="${p.url}" target="_blank" rel="noopener sponsored">${p.cta}</a>
  </div>`;
}
window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', route);

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

function saveBtn(kind, id) {
  const saved = PFStore.isSaved(kind, id);
  return `<button class="btn btn-ghost btn-sm save-btn ${saved ? 'saved' : ''}" data-kind="${kind}" data-id="${id}">
    <span class="material-symbols-outlined" style="font-size:16px">${saved ? 'bookmark_added' : 'bookmark_add'}</span>
    ${saved ? 'Saved' : 'Save'}
  </button>`;
}

document.addEventListener('click', e => {
  const b = e.target.closest('.save-btn');
  if (!b) return;
  const nowSaved = PFStore.toggleSaved(b.dataset.kind, b.dataset.id);
  b.classList.toggle('saved', nowSaved);
  b.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px">${nowSaved ? 'bookmark_added' : 'bookmark_add'}</span> ${nowSaved ? 'Saved' : 'Save'}`;
  toast(nowSaved ? 'Saved to your dashboard' : 'Removed from dashboard');
});

/* ── 1 · Assessment ─────────────────────────────────────── */
let asmState = { step: 0, answers: {} };

function renderAssessment(main) {
  const done = PFStore.getAssessment();
  if (done && asmState.step === 0 && !asmState.retake) {
    main.innerHTML = viewHead('quiz', 'Pathway Assessment', 'You’ve completed your assessment', 'Your personalized result is below. Retake anytime — your roadmap updates automatically.') +
      resultCard(done.result) +
      `<div style="margin-top:20px;display:flex;gap:12px;flex-wrap:wrap">
        <a class="btn btn-primary" href="#roadmap">View my roadmap <span class="material-symbols-outlined" style="font-size:16px">arrow_forward</span></a>
        <button class="btn btn-ghost" id="retake">Retake assessment</button>
      </div>`;
    $('#retake').onclick = () => { asmState = { step: 0, answers: {}, retake: true }; route(); };
    return;
  }

  const i = asmState.step;
  if (i >= PF_QUESTIONS.length) return finishAssessment(main);
  const q = PF_QUESTIONS[i];
  const pct = Math.round((i / PF_QUESTIONS.length) * 100);

  main.innerHTML = viewHead('quiz', `Question ${i + 1} of ${PF_QUESTIONS.length}`, 'Pathway Assessment',
    'Seven quick questions. Under five minutes. A roadmap built for you.') +
    `<div class="bar" style="max-width:560px;margin-bottom:36px"><span style="width:${pct}%"></span></div>
     <div class="card" style="max-width:680px">
       <h2 style="font-size:1.25rem;margin-bottom:22px">${q.q}</h2>
       <div class="asm-opts">${q.opts.map((o, k) =>
         `<button class="asm-opt" data-k="${k}"><span class="asm-radio"></span>${o.t}</button>`).join('')}
       </div>
       ${i > 0 ? `<button class="btn btn-ghost btn-sm" id="asm-back" style="margin-top:22px">← Back</button>` : ''}
     </div>`;

  $$('.asm-opt', main).forEach(b => b.onclick = () => {
    asmState.answers[q.id] = q.opts[+b.dataset.k].v;
    asmState.step++;
    route();
  });
  const back = $('#asm-back', main);
  if (back) back.onclick = () => { asmState.step--; route(); };
}

function computeResult(a) {
  const score = (+a.degree || 0) + (+a.gpa || 0) + (+a.research || 0) + (+a.english || 0); // max 15
  const readiness = Math.round((score / 15) * 100);

  let pathway, pathwayWhy;
  if (a.degree >= 3 && a.research >= 3) {
    pathway = 'Direct PhD Entry';
    pathwayWhy = 'Your research master’s/thesis experience makes you a strong direct-PhD candidate at all eight NZ universities.';
  } else if (a.degree >= 2 && (a.research >= 2 || a.gpa >= 3)) {
    pathway = 'Direct PhD (with strong proposal) or 1-year MPhil bridge';
    pathwayWhy = 'Honours graduates with first-class results can enter NZ PhDs directly. A compelling research proposal and supervisor backing are the deciding factors.';
  } else {
    pathway = 'Research Master’s first → PhD';
    pathwayWhy = 'A 1–2 year research master’s (in NZ or Sri Lanka) builds the thesis experience and supervisor references NZ PhD admissions committees expect.';
  }

  const unis = PF_UNIVERSITIES.filter(u => u.strengths.includes(a.field)).map(u => u.id);
  const labs = PF_LABS.filter(l => l.field === a.field).map(l => l.id);
  const schols = PF_SCHOLARSHIPS.filter(s => s.fields === 'All fields' || s.fields === a.field).map(s => s.id);

  return { readiness, pathway, pathwayWhy, field: a.field, funding: a.funding, timeline: a.timeline,
           english: a.english, unis, labs, schols };
}

function finishAssessment(main) {
  const result = computeResult(asmState.answers);
  PFStore.setAssessment({ answers: asmState.answers, result, completedAt: Date.now() });
  asmState = { step: 0, answers: {} };
  const synced = !!(window.PFCloud && PFCloud.isSignedIn && PFCloud.isSignedIn());
  main.innerHTML = viewHead('celebration', 'Assessment complete', 'Your personalized result',
    'Saved to your dashboard. Your roadmap has been generated from these answers.') +
    resultCard(result) +
    // Endowed-progress login moment: the student now HAS a result worth
    // keeping — the strongest point to offer a free account (never forced).
    (cloudOn() && !synced
      ? `<a class="journey-nudge" href="#account" style="margin-top:18px">
          <span class="material-symbols-outlined" style="font-size:18px">workspace_premium</span>
          <span>You’re <strong>${result.readiness}% PhD-ready</strong>. Create a free account to lock in your result and roadmap across every device.</span>
          <span class="material-symbols-outlined" style="margin-left:auto;font-size:18px">arrow_forward</span>
        </a>`
      : '') +
    `<div style="margin-top:20px;display:flex;gap:12px;flex-wrap:wrap">
      <a class="btn btn-primary" href="#roadmap">Open my roadmap <span class="material-symbols-outlined" style="font-size:16px">arrow_forward</span></a>
      <a class="btn btn-ghost" href="#explore">Explore matched labs</a>
    </div>`;
}

function resultCard(r) {
  const ring = 2 * Math.PI * 42;
  return `<div class="card" style="max-width:720px">
    <div style="display:flex;gap:28px;align-items:center;flex-wrap:wrap">
      <svg width="110" height="110" viewBox="0 0 100 100" style="flex-shrink:0">
        <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(28,26,21,.1)" stroke-width="2"/>
        <circle cx="50" cy="50" r="42" fill="none" stroke="#C2401C" stroke-width="4" stroke-linecap="butt"
          stroke-dasharray="${ring}" stroke-dashoffset="${ring * (1 - r.readiness / 100)}" transform="rotate(-90 50 50)"/>
        <text x="50" y="56" text-anchor="middle" fill="#1C1A15" font-size="18" font-weight="600" font-family="IBM Plex Mono">${r.readiness}%</text>
      </svg>
      <div style="flex:1;min-width:240px">
        <span class="chip chip-teal">Recommended pathway</span>
        <h3 style="font-size:1.25rem;margin:8px 0 6px">${r.pathway}</h3>
        <p class="muted" style="font-size:14px">${r.pathwayWhy}</p>
      </div>
    </div>
    <div style="display:flex;gap:24px;flex-wrap:wrap;margin-top:24px;padding-top:20px;border-top:1px solid var(--line)">
      <div><div class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.1em">Field</div><strong>${r.field}</strong></div>
      <div><div class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.1em">Matched universities</div><strong>${r.unis.length}</strong></div>
      <div><div class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.1em">Matched labs</div><strong>${r.labs.length}</strong></div>
      <div><div class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.1em">Eligible scholarships</div><strong>${r.schols.length}</strong></div>
    </div>
    ${r.english < 3 ? partnerRow('ielts') : ''}
  </div>`;
}

/* ── 2 · Roadmap ────────────────────────────────────────── */
function buildRoadmap(r) {
  const phases = [];
  phases.push({ when: 'Months 1–2', title: 'Foundation', color: 'teal', items: [
    r && r.english < 3 ? 'Book and prepare for IELTS Academic — target 6.5+ overall, no band below 6.0' : 'English requirement met ✓ — keep your IELTS score certificate handy (valid 2 years)',
    'Finalize your research area and read 10–15 recent papers in it',
    'Polish your academic CV using the Starter Kit template',
  ]});
  phases.push({ when: 'Months 2–4', title: 'Supervisor Discovery', color: 'violet', consult: 'roadmap-supervisor', items: [
    r ? `Shortlist 8–10 supervisors in ${r.field} across your ${r.unis.length} matched universities` : 'Shortlist 8–10 supervisors across NZ universities',
    'Send personalized first-contact emails (template in Starter Kit) — expect a 20–30% reply rate',
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

function renderRoadmap(main) {
  const a = PFStore.getAssessment();
  const r = a && a.result;
  const phases = buildRoadmap(r);
  main.innerHTML = viewHead('route', 'Interactive Roadmap', r ? `Your roadmap to a PhD in ${r.field}` : 'Your PhD roadmap',
    r ? `Personalized for the <strong>${r.pathway}</strong> pathway, ${({'6m':'starting within 6 months','1y':'starting in about a year','2y':'starting in 1–2 years','explore':'exploration'})[r.timeline] || ''}.`
      : 'This is the standard NZ PhD timeline. <a href="#assessment" style="color:var(--route)">Take the 5-minute assessment</a> to personalize it.') +
    `<div class="timeline">${phases.map((p, i) => `
      <div class="tl-phase" data-reveal style="transition-delay:${i * 90}ms">
        <div class="tl-node tl-${p.color}"><span>${i + 1}</span></div>
        <div class="card tl-card">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
            <h3 style="font-size:1.1rem">${p.title}</h3>
            <span class="chip chip-${p.color}">${p.when}</span>
          </div>
          <ul class="tl-list">${p.items.map(it => `<li>${it}</li>`).join('')}</ul>
          ${p.link ? `<div style="margin-top:16px"><a class="btn btn-ghost btn-sm" href="${p.link.href}">${p.link.label}</a></div>` : ''}
          ${p.consult ? consultCTA(p.consult) : ''}
        </div>
      </div>`).join('')}
    </div>`;
  requestAnimationFrame(() => $$('[data-reveal]', main).forEach(el => el.classList.add('visible')));
}

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
    ? 'Several of the researchers whose recent papers match your topic are based at New Zealand universities — publishing right now, and supervising doctoral students. A PhD here could put you in the same corridor as them.'
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
      <a class="btn btn-ghost btn-sm" href="#kit">First-contact email template</a>
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
        <button class="btn btn-ghost" id="rs-new">Start a new topic</button>
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
  const prefField = (a && a.result && a.result.field) || '';
  const prev = researchState.intake || {};
  main.innerHTML = viewHead('lightbulb', 'Research Studio', 'Find your PhD topic & draft a proposal',
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
    `<div style="margin-bottom:24px"><button class="btn btn-ghost btn-sm" id="rs-back">← Edit answers</button></div>
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
      <button class="btn btn-ghost btn-sm" id="rs-back2">← Back to directions</button>
      <button class="btn btn-primary btn-sm rs-copy"><span class="material-symbols-outlined" style="font-size:15px">content_copy</span> Copy</button>
      <button class="btn btn-ghost btn-sm rs-dl" data-fmt="md"><span class="material-symbols-outlined" style="font-size:15px">download</span> .md</button>
      <button class="btn btn-ghost btn-sm rs-dl" data-fmt="txt"><span class="material-symbols-outlined" style="font-size:15px">download</span> .txt</button>
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
      ${(p.nzAuthors || []).length ? sec('The people behind your citations — in New Zealand', `<p style="font-size:13.5px;color:var(--ink-soft);margin-bottom:12px">Several authors of the work you cite above are based at New Zealand universities. These are exactly the kind of researchers a doctoral student in this area works alongside.</p><ul class="rs-sup">${p.nzAuthors.map(a => { const place = (a.home && a.home.uni && a.home.uni.name) || (a.home && a.home.institute) || a.institution; return `<li><strong>${esc(a.name)}</strong>${a.cited ? ' <span class="chip chip-gold">in your citations</span>' : ''}<br><span class="faint" style="font-size:12.5px">${esc(place)}</span></li>`; }).join('')}</ul>`) : ''}
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
});

/* ── 3 · Explore (universities, labs, supervisors) ──────── */
function renderExplore(main) {
  const a = PFStore.getAssessment();
  const myField = a ? a.result.field : '';
  main.innerHTML = viewHead('science', 'Research Lab Explorer', 'Universities, labs & supervisors',
    'All eight NZ universities and their flagship research groups. Filter by field, save what fits, then reach out with the Starter Kit email template.') +
    `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:28px" id="field-filters">
      <button class="chip-filter ${!myField ? 'active' : ''}" data-f="">All fields</button>
      ${PF_FIELDS.map(f => `<button class="chip-filter ${f === myField ? 'active' : ''}" data-f="${f}">${f}</button>`).join('')}
    </div>
    <div id="explore-list"></div>`;

  function paint(field) {
    const unis = PF_UNIVERSITIES.filter(u => !field || u.strengths.includes(field));
    $('#explore-list').innerHTML = unis.map(u => {
      const labs = PF_LABS.filter(l => l.uni === u.id && (!field || l.field === field));
      return `<div class="card" style="margin-bottom:18px">
        <div style="display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;align-items:flex-start">
          <div>
            <h3 style="font-size:1.15rem">${u.name}</h3>
            <p class="faint" style="font-size:13px;margin-top:2px">${u.city} · ${u.rank} · ${u.phdFee}</p>
          </div>
          ${saveBtn('uni', u.id)}
        </div>
        <p class="muted" style="font-size:13.5px;margin:10px 0 14px">${u.note}</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:${labs.length ? '16px' : 0}">
          ${u.strengths.map(s => `<span class="chip chip-dim">${s}</span>`).join('')}
        </div>
        ${labs.map(l => `
          <div class="lab-row">
            <div style="flex:1;min-width:220px">
              <strong style="font-size:14px">${l.name}</strong>
              <div class="faint" style="font-size:12.5px;margin-top:2px">
                <span class="material-symbols-outlined" style="font-size:13px;vertical-align:-2px">person</span> ${l.supervisor}
                &nbsp;·&nbsp; ${l.topics.join(' · ')}
              </div>
              <div style="font-size:12.5px;color:var(--ochre);margin-top:5px;font-family:var(--font-mono)">N.B. — ${l.hint}</div>
            </div>
            ${saveBtn('lab', l.id)}
          </div>`).join('')}
        ${labs.length ? consultCTA('roadmap-supervisor') : ''}
      </div>`;
    }).join('') || '<p class="muted">No universities match this field.</p>';
  }
  paint(myField);
  $$('#field-filters .chip-filter').forEach(b => b.onclick = () => {
    $$('#field-filters .chip-filter').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    paint(b.dataset.f);
  });
}

/* ── 4 · Funding (scholarships + visa) ──────────────────── */
function renderFunding(main) {
  const a = PFStore.getAssessment();
  const matched = a ? new Set(a.result.schols) : null;
  main.innerHTML = viewHead('payments', 'Scholarship & Funding Hub', 'Fund your PhD',
    'NZ PhD students pay domestic fees (~NZ$7–8k/yr) and most doctoral scholarships cover fees plus a NZ$28–33k living stipend.' +
    (matched ? ' Scholarships matching your assessment are highlighted.' : '')) +
    fundsCheckBanner() +
    `<div class="grid-2">${PF_SCHOLARSHIPS.map(s => `
      <div class="card" ${matched && matched.has(s.id) ? 'style="border-color:var(--route)"' : ''}>
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
          <h3 style="font-size:1.02rem;line-height:1.35">${s.name}</h3>
          ${saveBtn('scholarship', s.id)}
        </div>
        <div style="margin:12px 0 10px;display:flex;gap:8px;flex-wrap:wrap">
          <span class="chip chip-teal">${s.value}</span>
          <span class="chip chip-gold">Deadline: ${s.deadline}</span>
          <span class="chip chip-dim">${s.fields}</span>
        </div>
        <p class="muted" style="font-size:13.5px">${s.eligibility}</p>
        <p class="faint" style="font-size:12px;margin-top:10px">↗ ${s.link}</p>
        ${consultCTA('visa-offer')}
      </div>`).join('')}
    </div>

    <div class="sec-head" style="margin:72px 0 28px">
      <span class="tag"><span class="material-symbols-outlined" style="font-size:14px">flight_takeoff</span>Immigration & Visa</span>
      <h2 style="font-size:1.6rem;margin-top:14px">Latest visa updates for PhD students</h2>
    </div>
    <div>${PF_VISA_UPDATES.map(v => `
      <div class="visa-row">
        <span class="chip chip-violet" style="flex-shrink:0">${v.tag}</span>
        <div>
          <strong style="font-size:14.5px">${v.title}</strong>
          <span class="faint" style="font-size:12px;margin-left:8px">${v.date}</span>
          <p class="muted" style="font-size:13.5px;margin-top:4px">${v.body}</p>
        </div>
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

const FUNDS_Q = [
  { id: 'tuition', q: 'Will a scholarship cover your PhD tuition?',
    help: 'Good news: international PhD students in NZ pay domestic fees (~NZ$7–9k/yr), far below other countries.',
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

const fundsMoney = n => 'NZ$' + Math.round(n).toLocaleString();
const fundsLkr = n => 'LKR ' + Math.round(n * (PF_CONFIG.nzdToLkr || 185)).toLocaleString();

function computeFunds(a) {
  const C = PF_CONFIG;
  const fx = C.nzdToLkr || 185;
  const amount = Number(a.fundsAmount) || 0;
  const fundsNZD = a.fundsCurrency === 'NZD' ? amount : amount / fx;

  const tuition = a.tuition === 'scholarship' ? 0 : (C.phdFeesDomesticPerYear || 8500);
  const depMult = (C.dependentFundsMult && C.dependentFundsMult[a.who]) || 1;
  const livingReq = (C.visaFundsPerYear || 20000) * depMult;
  const heads = a.who === 'single' ? 1 : a.who === 'couple' ? 2 : 3;
  const airfare = (C.returnAirfareBuffer || 2500) * heads;
  const requiredTotal = tuition + livingReq + airfare;

  const stipendCover = a.stipend === 'full' ? livingReq : a.stipend === 'partial' ? livingReq * 0.5 : 0;
  const livingCovered = Math.min(stipendCover, livingReq);
  const counted = fundsNZD + livingCovered;
  const gap = Math.max(0, requiredTotal - counted);
  const ratio = requiredTotal > 0 ? counted / requiredTotal : 1;

  const flags = [];
  if (a.tuition === 'unsure') flags.push('Confirm whether your scholarship covers tuition — it changes your total by ~' + fundsMoney(C.phdFeesDomesticPerYear || 8500) + '.');
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
  if (score >= 95 && gap === 0) { band = 'Visa-funds ready'; bandCls = 'chip-teal'; verdict = 'You meet the indicative funds bar. The work now is evidence, not money.'; }
  else if (score >= 75) { band = 'Nearly there'; bandCls = 'chip-gold'; verdict = 'A small gap stands between you and a strong funds case — very closeable.'; }
  else if (score >= 45) { band = 'Notable gap'; bandCls = 'chip-violet'; verdict = 'There’s a real gap to plan for — best to start now, with a clear strategy.'; }
  else { band = 'Significant gap'; bandCls = 'chip-rose'; verdict = 'A sizeable gap today — a funded scholarship route is likely your strongest path.'; }

  return { fundsNZD, tuition, livingReq, airfare, requiredTotal, livingCovered, counted, gap, score, band, bandCls, verdict, flags, depMult, heads };
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
    main.innerHTML = viewHead('savings', 'Funds Readiness Check', 'Your visa-funds readiness',
      'How your money stacks up against what Immigration New Zealand expects to see. Indicative — always confirm current figures with INZ.') +
      fundsResultCard(saved.result) +
      `<div style="margin-top:20px;display:flex;gap:12px;flex-wrap:wrap">
        <button class="btn btn-primary" id="fc-redo">Re-check my funds</button>
        <a class="btn btn-ghost" href="#settlement">Detailed funds planner</a>
      </div>`;
    $('#fc-redo').onclick = () => { fundsState = { step: 0, answers: {}, retake: true }; route(); };
    return;
  }

  const i = fundsState.step;
  if (i >= FUNDS_Q.length) {
    // funds-amount step sits at the end (needs an input, not a radio)
    return renderFundsAmount(main);
  }
  const q = FUNDS_Q[i];
  const pct = Math.round((i / (FUNDS_Q.length + 1)) * 100);

  main.innerHTML = viewHead('savings', `Funds check · ${i + 1} of ${FUNDS_Q.length + 1}`, 'Funds Readiness Check',
    'A quick self-check of your visa funds — answers stay on your device.') +
    `<div class="bar" style="max-width:560px;margin-bottom:36px"><span style="width:${pct}%"></span></div>
     <div class="card" style="max-width:680px">
       <h2 style="font-size:1.25rem;margin-bottom:8px">${q.q}</h2>
       <p class="muted" style="font-size:13.5px;margin-bottom:20px">${q.help}</p>
       <div class="asm-opts">${q.opts.map((o, k) =>
         `<button class="asm-opt" data-k="${k}"><span class="asm-radio"></span>${o.t}</button>`).join('')}
       </div>
       ${i > 0 ? `<button class="btn btn-ghost btn-sm" id="fc-back" style="margin-top:22px">← Back</button>` : ''}
     </div>`;

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
  const pct = Math.round((FUNDS_Q.length / (FUNDS_Q.length + 1)) * 100);

  main.innerHTML = viewHead('savings', `Funds check · ${FUNDS_Q.length + 1} of ${FUNDS_Q.length + 1}`, 'Funds Readiness Check',
    'A quick self-check of your visa funds — answers stay on your device.') +
    `<div class="bar" style="max-width:560px;margin-bottom:36px"><span style="width:${pct}%"></span></div>
     <div class="card" style="max-width:680px">
       <h2 style="font-size:1.25rem;margin-bottom:8px">Roughly how much in liquid funds can you show?</h2>
       <p class="muted" style="font-size:13.5px;margin-bottom:20px">Money you (or your sponsor) can actually evidence in a bank account — savings, fixed deposits, scholarship funds. A rough figure is fine.</p>
       <div style="display:flex;gap:10px;align-items:stretch;flex-wrap:wrap">
         <div style="display:flex;border:1px solid var(--line);border-radius:3px;overflow:hidden">
           <button class="fc-cur ${cur === 'LKR' ? 'active' : ''}" data-cur="LKR">LKR</button>
           <button class="fc-cur ${cur === 'NZD' ? 'active' : ''}" data-cur="NZD">NZ$</button>
         </div>
         <input class="field" id="fc-amount" type="number" inputmode="numeric" min="0" step="10000"
           placeholder="${cur === 'LKR' ? 'e.g. 4500000' : 'e.g. 25000'}" value="${a.fundsAmount != null ? a.fundsAmount : ''}"
           style="flex:1;min-width:160px;font-size:16px">
       </div>
       <div style="margin-top:24px;display:flex;gap:12px;flex-wrap:wrap">
         <button class="btn btn-primary" id="fc-finish">See my readiness <span class="material-symbols-outlined" style="font-size:16px">arrow_forward</span></button>
         <button class="btn btn-ghost btn-sm" id="fc-back">← Back</button>
       </div>
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
  const ring = 2 * Math.PI * 42;
  const row = (label, nzd, strong) => `<div class="fc-row ${strong ? 'fc-row-strong' : ''}">
    <span>${label}</span><strong>${fundsMoney(nzd)} <em style="font-style:normal;color:var(--ink-faint);font-weight:400">· ${fundsLkr(nzd)}</em></strong></div>`;

  return `<div class="card" style="max-width:760px">
    <div style="display:flex;gap:28px;align-items:center;flex-wrap:wrap">
      <svg width="110" height="110" viewBox="0 0 100 100" style="flex-shrink:0">
        <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(28,26,21,.1)" stroke-width="2"/>
        <circle cx="50" cy="50" r="42" fill="none" stroke="#C2401C" stroke-width="4" stroke-linecap="butt"
          stroke-dasharray="${ring}" stroke-dashoffset="${ring * (1 - r.score / 100)}" transform="rotate(-90 50 50)"/>
        <text x="50" y="56" text-anchor="middle" fill="#1C1A15" font-size="18" font-weight="600" font-family="IBM Plex Mono">${r.score}%</text>
      </svg>
      <div style="flex:1;min-width:240px">
        <span class="chip ${r.bandCls}">${r.band}</span>
        <h3 style="font-size:1.2rem;margin:8px 0 6px">${r.gap > 0 ? fundsMoney(r.gap) + ' gap to close' : 'Funds bar met'}</h3>
        <p class="muted" style="font-size:14px">${r.verdict}</p>
      </div>
    </div>

    <div class="fc-break" style="margin-top:24px;padding-top:20px;border-top:1px solid var(--line)">
      <div class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px">What INZ expects to see (indicative)</div>
      ${row('Tuition — first year (domestic PhD rate)', r.tuition)}
      ${row(`Living costs — 12 months${r.depMult > 1 ? ` (incl. family ×${r.depMult})` : ''}`, r.livingReq)}
      ${row(`Travel evidence buffer${r.heads > 1 ? ` (×${r.heads})` : ''}`, r.airfare)}
      ${row('Total required', r.requiredTotal, true)}
      <div class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.1em;margin:18px 0 8px">What you can cover</div>
      ${row('Your liquid funds', r.fundsNZD)}
      ${row('Stipend / scholarship toward living', r.livingCovered)}
      ${row('Total you can evidence', r.counted, true)}
      ${r.gap > 0 ? `<div class="fc-row fc-row-gap"><span>Shortfall</span><strong>${fundsMoney(r.gap)} · ${fundsLkr(r.gap)}</strong></div>` : ''}
    </div>

    ${r.flags.length ? `<div style="margin-top:20px;padding-top:18px;border-top:1px solid var(--line)">
      <div class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px">Make sure your funds count</div>
      <ul class="fc-flags">${r.flags.map(f => `<li><span class="material-symbols-outlined">info</span><span>${esc(f)}</span></li>`).join('')}</ul>
    </div>` : ''}

    <div style="margin-top:22px;padding-top:18px;border-top:1px solid var(--line)">
      ${r.gap > 0
        ? `<p style="font-size:14px;margin:0 0 12px">You’re about <strong>${fundsMoney(r.gap)}</strong> (~${fundsLkr(r.gap)}) short. The strongest fixes: win a <a href="#funding" style="color:var(--route)">doctoral scholarship + stipend</a> (covers fees and most living costs), add a documented family sponsor, or start building evidenced savings now.</p>${partnerRow('forex')}`
        : `<p style="font-size:14px;margin:0 0 12px">You meet the indicative bar. Now organise the <strong>evidence</strong>: 6 months of bank statements, your scholarship/sponsor letters, and proof the funds are available to you. Get it checked before you submit — a rejected funds case can cost you an intake.</p>`}
    </div>

    <!-- premium upsell: a mentor who passed the same check reviews the evidence -->
    <div class="fc-upsell" style="margin-top:16px;padding:16px;border:1px dashed var(--line-2);border-radius:6px;background:var(--gold-soft)">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <span class="material-symbols-outlined" style="color:var(--route);font-size:19px">verified</span>
        <strong style="font-size:14.5px">Funds Evidence Review</strong>
        <span class="chip chip-gold" style="margin-left:auto">First 15 min free</span>
      </div>
      <p class="muted" style="font-size:13px;margin:0 0 12px">A Sri Lankan postgrad who has already cleared the NZ visa funds check looks over your bank statements, sponsor letter and figures — and flags anything INZ would query — before you submit.</p>
      <a class="btn btn-primary btn-sm" href="#mentors?topic=visa-funds" style="width:100%;justify-content:center">Get my funds evidence reviewed</a>
    </div>

    <p class="faint" style="font-size:11.5px;margin-top:18px">Figures are indicative and change with policy — always confirm the current living-cost minimum, fees and dependent requirements with <a href="https://www.immigration.govt.nz" target="_blank" rel="noopener" style="color:var(--route)">Immigration New Zealand</a> and your university.</p>
  </div>`;
}

/* ── 5 · Dashboard (saved + tracker) ────────────────────── */
function renderDashboard(main) {
  const a = PFStore.getAssessment();
  const saved = PFStore.getSaved();
  const apps = PFStore.getApps();
  const ST = PFStore.APP_STATUSES;
  const vp = visaProgress();
  const reqs = PFStore.getMentorRequests().slice().reverse();

  // ── Derived insights (client/student dashboard) ──
  const inProg = apps.filter(x => ['Contacted Supervisor', 'Preparing Documents', 'Applied', 'Interview'].includes(x.status)).length;
  const offers = apps.filter(x => ['Offer', 'Enrolled'].includes(x.status)).length;
  const activeReqs = reqs.filter(r => !['completed', 'cancelled'].includes(r.status)).length;
  // single source of truth — same engine that drives the Journey Map + meter
  const J = journeyModel();
  const nextAction = J.nextStep
    ? [J.current.icon, J.nextStep[0], J.nextStep[2]]
    : ['support_agent', 'You’re on track — ask a mentor to pressure-test your plan', '#mentors'];
  const synced = window.PFCloud && PFCloud.isSignedIn && PFCloud.isSignedIn();

  const savedHtml = saved.length ? saved.map(s => {
    let title = '', sub = '', href = '#explore';
    if (s.kind === 'uni') { const u = uniById(s.id); if (!u) return ''; title = u.name; sub = u.city; }
    if (s.kind === 'lab') { const l = PF_LABS.find(x => x.id === s.id); if (!l) return ''; title = l.name; sub = uniById(l.uni).name; }
    if (s.kind === 'scholarship') { const sc = PF_SCHOLARSHIPS.find(x => x.id === s.id); if (!sc) return ''; title = sc.name; sub = sc.value; href = '#funding'; }
    return `<div class="lab-row">
      <div style="flex:1"><strong style="font-size:14px">${title}</strong>
        <div class="faint" style="font-size:12.5px">${({uni:'University',lab:'Research lab',scholarship:'Scholarship'})[s.kind]} · ${sub}</div></div>
      <a class="btn btn-ghost btn-sm" href="${href}">View</a>
      ${saveBtn(s.kind, s.id)}
    </div>`;
  }).join('') : `<p class="muted" style="font-size:14px">Nothing saved yet — bookmark labs and scholarships from the <a href="#explore" style="color:var(--route)">Explorer</a>.</p>`;

  main.innerHTML = viewHead('space_dashboard', 'Your Dashboard', a ? `Welcome back — ${a.result.readiness}% PhD-ready` : 'Welcome to PathFinder',
    a ? `Pathway: <strong>${a.result.pathway}</strong> in ${a.result.field}.`
      : 'Start with the <a href="#assessment" style="color:var(--route)">5-minute assessment</a> to unlock your personalized roadmap.') +

    renderJourneyMap() +

    `<div class="grid-4" style="margin:40px 0">
      ${[['quiz', a ? a.result.readiness + '%' : '—', 'Readiness score', '#assessment'],
         ['bookmark', saved.length, 'Saved opportunities', '#explore'],
         ['folder_managed', apps.length, 'Applications tracked', '#dashboard'],
         ['workspace_premium', apps.filter(x => ['Offer','Enrolled'].includes(x.status)).length, 'Offers received', '#dashboard'],
         ['flight_takeoff', vp.done + '/' + vp.total, 'Visa steps done', '#visa'],
         ['support_agent', reqs.length, 'Mentor requests', '#mentors?tab=mine']]
        .map(([ic, n, l, href]) => `<a class="card" href="${href}" style="display:block">
          <span class="material-symbols-outlined" style="color:var(--route);font-size:22px">${ic}</span>
          <div style="font-size:1.7rem;font-weight:700;margin-top:8px">${n}</div>
          <div class="faint" style="font-size:12.5px">${l}</div></a>`).join('')}
    </div>

    <div class="card" style="margin-bottom:40px">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline;margin-bottom:6px">
        <h2 style="font-size:1.15rem;margin:0">Your insights</h2>
        <span class="chip ${synced ? 'chip-teal' : 'chip-dim'}">${synced ? 'Synced across devices' : 'Saved on this device'}</span>
      </div>
      <p class="muted" style="font-size:13.5px;margin:0 0 12px">${a
        ? `You’re <strong>${a.result.readiness}% PhD-ready</strong> on the <strong>${esc(a.result.pathway)}</strong> pathway in ${esc(a.result.field)}.`
        : `Complete the <a href="#assessment" style="color:var(--route)">assessment</a> to see personalised insights.`}${synced ? '' : ` <a href="#account" style="color:var(--route)">Create a free account</a> to sync.`}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px">
        <span class="chip chip-dim">${apps.length} tracked</span>
        <span class="chip chip-violet">${inProg} in progress</span>
        <span class="chip chip-teal">${offers} offer${offers === 1 ? '' : 's'}</span>
        <span class="chip chip-gold">${activeReqs} active mentor request${activeReqs === 1 ? '' : 's'}</span>
        <span class="chip chip-dim">visa ${vp.done}/${vp.total}</span>
      </div>
      <div class="consult-hook" style="margin-top:12px">
        <span class="material-symbols-outlined" style="font-size:15px">${nextAction[0]}</span>
        Next step: <a href="${nextAction[2]}" style="color:var(--route)">${nextAction[1]}</a>
      </div>
    </div>

    ${newsStrip()}

    <h2 style="font-size:1.3rem;margin-bottom:16px">Application tracker</h2>
    <div class="card" style="margin-bottom:18px">
      <div style="display:grid;grid-template-columns:1.2fr 1fr 1fr auto;gap:10px;align-items:end" class="app-form">
        <div><label class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em">University / Program</label>
          <input class="field" id="app-uni" placeholder="e.g. UoA — PhD Computer Science" style="margin-top:5px"></div>
        <div><label class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em">Supervisor</label>
          <input class="field" id="app-sup" placeholder="Prof. ..." style="margin-top:5px"></div>
        <div><label class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em">Status</label>
          <select class="field" id="app-status" style="margin-top:5px">${ST.map(s => `<option>${s}</option>`).join('')}</select></div>
        <button class="btn btn-primary" id="app-add">Add</button>
      </div>
    </div>
    <div id="app-list">${apps.length ? apps.map(appRow).join('') :
      '<p class="muted" style="font-size:14px">No applications yet. Add your first one above — every supervisor email counts as “Contacted Supervisor”.</p>'}</div>

    <h2 style="font-size:1.3rem;margin:48px 0 16px">Your mentor requests</h2>
    <div id="con-list">${reqs.length ? reqs.map(conRow).join('') :
      `<p class="muted" style="font-size:14px">No requests yet — when a step gets confusing, <a href="#mentors" style="color:var(--route)">ask a mentor who has done it</a>. Your first ${PF_CONFIG.freeIntroMinutes} minutes are free.</p>`}</div>

    <h2 style="font-size:1.3rem;margin:48px 0 16px">Saved opportunities</h2>
    <div class="card">${savedHtml}</div>`;

  // read-only summary row — status is mentor-driven; students track here and
  // can pay / see full detail under Mentors → My requests.
  function conRow(c) {
    return `<div class="card" style="margin-bottom:12px" data-con="${c.id}">
      <div style="display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;align-items:center">
        <div style="flex:1;min-width:200px">
          <strong style="font-size:14.5px">${PF_CONSULT_TOPICS[c.topic] || 'General guidance'}</strong>
          <div class="faint" style="font-size:12.5px">${c.at ? new Date(c.at).toLocaleDateString() : ''}</div>
          ${c.note ? `<div class="muted" style="font-size:13px;margin-top:4px">${esc(c.note)}</div>` : ''}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;align-items:center">
          ${reqStatusChip(c.status)}
          ${c.payment ? payStatusChip(c.payment) : ''}
          <a class="btn btn-ghost btn-sm" href="#mentors?tab=mine">Open</a>
          <button class="btn btn-ghost btn-sm con-del" title="Remove from this device"><span class="material-symbols-outlined" style="font-size:16px">delete</span></button>
        </div>
      </div>
    </div>`;
  }

  function appRow(app) {
    const pct = Math.round(((ST.indexOf(app.status) + 1) / ST.length) * 100);
    return `<div class="card" style="margin-bottom:12px" data-app="${app.id}">
      <div style="display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;align-items:center">
        <div style="flex:1;min-width:200px">
          <strong style="font-size:14.5px">${esc(app.uni)}</strong>
          <div class="faint" style="font-size:12.5px">${esc(app.supervisor || 'No supervisor listed')}</div>
        </div>
        <select class="field app-status-sel" style="width:auto;padding:8px 36px 8px 12px;font-size:13px">
          ${ST.map(s => `<option ${s === app.status ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <button class="btn btn-ghost btn-sm app-del" title="Delete"><span class="material-symbols-outlined" style="font-size:16px">delete</span></button>
      </div>
      <div class="bar" style="margin-top:14px"><span style="width:${pct}%"></span></div>
      <div class="faint" style="font-size:11.5px;margin-top:6px">${pct}% — ${app.status}</div>
    </div>`;
  }

  $('#app-add').onclick = () => {
    const uni = $('#app-uni').value.trim();
    if (!uni) return toast('Enter a university or program name');
    PFStore.upsertApp({ uni, supervisor: $('#app-sup').value.trim(), status: $('#app-status').value });
    toast('Application added');
    route();
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
  $('#con-list').addEventListener('click', e => {
    const d = e.target.closest('.con-del');
    if (!d) return;
    PFStore.deleteMentorRequest(d.closest('[data-con]').dataset.con);
    toast('Removed from this device');
    route();
  });

  // fill the briefing strip async (won't block the dashboard render)
  loadNews(() => {
    const el = document.getElementById('dash-news');
    if (!el) return;
    const items = (newsState.items || []).slice(0, 3);
    if (items.length) el.innerHTML = items.map(x => newsItemRow(x, true)).join('');
    else if (!newsState.loading) el.innerHTML = `<p class="muted" style="font-size:13px;margin:0">News sources are unreachable right now — <a href="#news" style="color:var(--route)">open the Briefing</a> to retry.</p>`;
  }, false);
}

/* ── 6 · Starter Kit ────────────────────────────────────── */
function renderKit(main) {
  // Gate the advanced templates behind the Premium Toolkit — but only when
  // the cloud (accounts/orders) is configured. Offline/static deploys keep
  // every template free, preserving the original behaviour.
  const premiumIds = (PF_CONFIG.premiumTemplateIds || []);
  const gate = cloudOn() && premiumIds.length > 0;
  const unlocked = !gate || entitlements().toolkit === true;
  const price = (PF_CONFIG.pricing && PF_CONFIG.pricing.toolkit) || 0;

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
        <button class="btn btn-ghost btn-sm tpl-copy" data-id="${t.id}">
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
      <p class="muted" style="font-size:13px;margin:0 0 14px">Part of the Premium Toolkit — unlock all ${premiumIds.length} advanced templates plus the application guides.</p>
      <button class="btn btn-primary btn-sm pf-buy" data-item="toolkit" style="width:100%;justify-content:center">
        <span class="material-symbols-outlined" style="font-size:15px">lock_open</span> Unlock Premium Toolkit · LKR ${price.toLocaleString()}</button>
    </div>`;

  const banner = (gate && !unlocked) ? `<div class="card" style="margin-bottom:24px;border-color:var(--ochre);display:flex;gap:14px;flex-wrap:wrap;align-items:center">
      <span class="material-symbols-outlined" style="color:var(--ochre)">workspace_premium</span>
      <p style="flex:1;min-width:220px;font-size:13.5px;margin:0">${PF_TEMPLATES.length - premiumIds.length} templates are free. Unlock the ${premiumIds.length} advanced ones (research proposal, interview prep, 3-year plan, budgets &amp; more) with the <strong>Premium Toolkit</strong>.</p>
      <a class="btn btn-ghost btn-sm" href="#pricing">See plans</a>
    </div>` : '';

  main.innerHTML = viewHead('package_2', 'PhD Starter Kit', 'Templates & resources',
    'Battle-tested templates for every stage — preview, copy, or download. Personalize everything: generic emails get deleted.') +
    banner +
    `<div class="grid-2">${PF_TEMPLATES.map(t => {
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

function renderVisa(main) {
  const { done, total } = visaProgress();
  const firstOpen = PF_VISA_STAGES.find(s => s.steps.some(st => !PFStore.isChecked('visa', st.id)));

  main.innerHTML = viewHead('flight_takeoff', 'NZ Student Visa Hub', 'The visa, stage by stage',
    'Every stage of the Fee Paying Student Visa — where to go in Sri Lanka, who to consult, what it costs, and a checklist that remembers your progress.') +
    `<div class="card" style="max-width:760px;margin-bottom:32px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap">
        <strong>Your visa progress</strong>
        <span class="mono" id="visa-pct">${done} / ${total} steps</span>
      </div>
      <div class="bar" style="margin-top:12px"><span id="visa-bar" style="width:${total ? Math.round(done / total * 100) : 0}%"></span></div>
    </div>
    <div class="timeline">${PF_VISA_STAGES.map((s, i) => {
      const sDone = s.steps.filter(st => PFStore.isChecked('visa', st.id)).length;
      const open = firstOpen && firstOpen.id === s.id;
      return `
      <div class="tl-phase">
        <div class="tl-node tl-${s.color}"><span>${i + 1}</span></div>
        <div class="card tl-card vh-stage ${sDone === s.steps.length ? 'done' : ''} ${open ? 'open' : ''}" data-stage="${s.id}">
          <button class="vh-head" data-vh-toggle="${s.id}" aria-expanded="${open}">
            <h3>${s.title}</h3>
            <span class="chip chip-${s.color}">${s.dur}</span>
            <span class="chip chip-dim">${s.cost}</span>
            <span class="mono vh-count">${sDone}/${s.steps.length}</span>
            <span class="material-symbols-outlined vh-caret">expand_more</span>
          </button>
          <p class="muted" style="font-size:13.5px;margin-top:10px">${s.summary}</p>
          <div class="vh-body ${open ? '' : 'hidden'}">
            ${s.where.map(w => `
              <div class="visa-row" style="padding:14px 0">
                <span class="material-symbols-outlined" style="font-size:18px;color:var(--sea);flex-shrink:0;margin-top:2px">location_on</span>
                <div><strong style="font-size:13.5px">${w.name}</strong>
                  <p class="muted" style="font-size:13px;margin-top:3px">${w.detail}</p></div>
              </div>`).join('')}
            <ul class="ck-list">${s.steps.map(st => {
              const c = PFStore.isChecked('visa', st.id);
              return `<li class="ck-item ${c ? 'done' : ''}">
                <label><input type="checkbox" data-ck="visa" data-id="${st.id}" ${c ? 'checked' : ''}>
                  <span class="ck-box"><span class="material-symbols-outlined" style="font-size:13px">check</span></span>
                  <span class="ck-t">${st.t}${st.note ? `<em>${st.note}</em>` : ''}</span></label>
              </li>`;
            }).join('')}</ul>
            ${s.id === 'vs7' ? partnerRow('insurance') + partnerRow('flights') : ''}
            ${s.id === 'vs2' ? fundsStageCTA() : ''}
            ${consultCTA(s.consult)}
          </div>
        </div>
      </div>`;
    }).join('')}
    </div>
    <p class="faint" style="font-family:var(--font-mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-top:8px">
      Figures are estimates — verify with immigration.govt.nz before relying on them.
    </p>`;
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
    const { done, total } = visaProgress();
    const pct = $('#visa-pct'), bar = $('#visa-bar');
    if (pct) pct.textContent = `${done} / ${total} steps`;
    if (bar) bar.style.width = (total ? Math.round(done / total * 100) : 0) + '%';
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
function renderSettlement(main) {
  if (window.PFScene3D) PFScene3D.disposeAll();

  const TOOLS = [
    { id: 'first-months',  label: 'Your first months' },
    { id: 'funds-planner', label: 'Funds planner' },
    { id: 'buying-power',  label: 'What NZ$20 buys' },
  ];

  main.innerHTML = viewHead('luggage', 'Settle In', 'Your first months in New Zealand',
    'Arrival, banking, transport, housing, family — plus a funds planner, a 90-day cost simulator, and a reality check on what NZ money actually buys.') +
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
        <p class="muted" style="font-size:13.5px">${s.body}</p>
        ${s.tips ? `<ul class="tl-list" style="margin-top:12px">${s.tips.map(t => `<li style="font-size:13.5px">${t}</li>`).join('')}</ul>` : ''}
        ${s.perCity ? `<table class="ledger" style="margin-top:14px"><tbody>
          ${Object.entries(s.perCity).map(([city, how]) => `
            <tr><td style="font-family:var(--font-mono);font-size:11px;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;width:1%">${city}</td>
                <td style="font-size:13px">${how}</td></tr>`).join('')}
        </tbody></table>` : ''}
        ${consultCTA(s.consult)}
      </div>`).join('')}
    </div>`;
  }

  function open(cat) {
    if (window.PFScene3D) PFScene3D.disposeAll();
    const body = $('#set-body');
    if (cat === 'first-months')  return PFFirstMonths.render(body);
    if (cat === 'funds-planner') return PFFunds.render(body);
    if (cat === 'buying-power')   return PFBuying.render(body);
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

function renderMentors(main) {
  const topic = hashQuery().topic || '';
  if (hashQuery().tab === 'mine') mentorsTab = 'mine';
  const topicLabel = PF_CONSULT_TOPICS[topic] || '';
  const st = mentorStats();

  main.innerHTML = viewHead('support_agent', 'Mentors', 'Ask someone who has done it',
    `Ask anything about your move to New Zealand — a Sri Lankan postgrad who has been through it will pick it up. Your first ${PF_CONFIG.freeIntroMinutes} minutes are free; paid follow-on sessions are optional and only if you want to continue.`) +
    `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:24px" id="mtr-tabs">
      <button class="chip-filter ${mentorsTab === 'ask' ? 'active' : ''}" data-mtab="ask">Ask a mentor</button>
      <button class="chip-filter ${mentorsTab === 'mine' ? 'active' : ''}" data-mtab="mine">My requests</button>
    </div>
    <div id="mtr-body"></div>`;

  const body = $('#mtr-body');

  function paintAsk() {
    body.innerHTML = `
      <div class="card" style="max-width:680px;margin-bottom:24px">
        <h2 style="font-size:1.15rem;margin-bottom:6px">Ask a mentor</h2>
        <p class="muted" style="font-size:13.5px;margin-bottom:16px">
          One question, one form. No need to pick a person — your request joins a shared queue and the first available mentor in the right area claims it.${topicLabel ? ` Pre-filled topic: <strong>${topicLabel}</strong>.` : ''}
        </p>
        <form id="ask-form" style="display:flex;flex-direction:column;gap:12px">
          <select class="field" id="ask-topic">
            <option value="">General guidance</option>
            ${Object.entries(PF_CONSULT_TOPICS).map(([slug, lbl]) =>
              `<option value="${slug}" ${slug === topic ? 'selected' : ''}>${lbl}</option>`).join('')}
          </select>
          <input class="field" id="ask-name" placeholder="Your name" autocomplete="name">
          <input class="field" id="ask-contact" placeholder="Email or WhatsApp — how a mentor reaches you">
          <textarea class="field" id="ask-note" rows="3" placeholder="What do you want to ask? (a line or two)"></textarea>
          <button class="btn btn-primary" type="submit" style="align-self:flex-start">Ask a mentor</button>
        </form>
      </div>

      <div class="card" style="max-width:680px;margin-bottom:24px">
        <div class="faint" style="font-family:var(--font-mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">The mentor network</div>
        <p style="font-size:14px;margin:0 0 12px"><strong>${st.count} mentor${st.count === 1 ? '' : 's'}</strong> active across <strong>${st.fields.length} field${st.fields.length === 1 ? '' : 's'}</strong> — current PhD students and graduates from Sri Lanka, already in New Zealand.</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${st.fields.map(([f, n]) => `<span class="chip chip-dim">${esc(f)} · ${n}</span>`).join('')}
        </div>
      </div>`;

    $('#ask-form').addEventListener('submit', e => {
      e.preventDefault();
      const name = $('#ask-name').value.trim();
      const contact = $('#ask-contact').value.trim();
      if (!name || !contact) return toast('Add your name and a way to reach you');
      PFStore.addMentorRequest({ topic: $('#ask-topic').value, note: $('#ask-note').value.trim(), name, contact });
      toast('Request sent — a mentor will pick this up. Track it under “My requests”.');
      mentorsTab = 'mine';
      route();
    });
  }

  function paintMine() {
    const render = (list, live) => {
      cacheReqs(list);
      body.innerHTML = list.length ? `
        ${live ? '' : `<p class="faint" style="font-size:12.5px;margin:0 0 14px">Showing requests saved on this device.${window.PFCloud && PFCloud.isSignedIn() ? '' : ' Sign in to track them across devices.'}</p>`}
        ${list.map(r => studentReqCard(r)).join('')}`
        : `<div class="card"><p class="muted" style="font-size:14px">No requests yet. Use <a href="#mentors" class="route-link" style="color:var(--route)">Ask a mentor</a> above whenever a step gets confusing — your first ${PF_CONFIG.freeIntroMinutes} minutes are free.</p></div>`;
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

  $$('#mtr-tabs .chip-filter').forEach(b => b.onclick = () => {
    mentorsTab = b.dataset.mtab;
    $$('#mtr-tabs .chip-filter').forEach(x => x.classList.toggle('active', x === b));
    paint();
  });
  paint();
}

/* a student-facing request card: status + payment + (when due) a Pay button */
function studentReqCard(r) {
  const ps = r.payment && r.payment.paymentStatus;
  const payable = r.status === 'awaiting_payment' && ps === 'requested';
  const reported = r.status === 'awaiting_payment' && ps === 'reported';
  const payLabel = PFPay.isPayHereLive()
    ? 'Pay securely (Cards, HelaPay, eZ Cash, Genie &amp; more)'
    : 'Pay now (bank transfer / mobile wallet)';
  return `<div class="card" style="margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
      <div style="flex:1;min-width:200px">
        <strong style="font-size:14.5px">${PF_CONSULT_TOPICS[r.topic] || 'General guidance'}</strong>
        <div class="faint" style="font-size:12.5px">${r.at ? new Date(r.at).toLocaleDateString() : ''}</div>
        ${r.note ? `<div class="muted" style="font-size:13px;margin-top:6px">${esc(r.note)}</div>` : ''}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
        ${reqStatusChip(r.status)}
        ${r.payment ? payStatusChip(r.payment) : ''}
      </div>
    </div>
    ${payable ? `<div style="margin-top:14px;padding-top:14px;border-top:1px dashed var(--line)">
      <p class="muted" style="font-size:13px;margin:0 0 10px">Your free ${PF_CONFIG.freeIntroMinutes}-minute intro is done. To continue with a paid follow-on session (LKR ${Number(r.payment.amountLKR).toLocaleString()}), pay below — then your mentor confirms and books the session.</p>
      <button class="btn btn-primary btn-sm pay-now" data-req="${r.id}" style="width:100%;justify-content:center">
        <span class="material-symbols-outlined" style="font-size:16px">lock</span>
        ${payLabel}
      </button>
    </div>` : ''}
    ${reported ? `<div style="margin-top:14px;padding-top:14px;border-top:1px dashed var(--line)">
      <p class="muted" style="font-size:13px;margin:0">Payment reported — your mentor will confirm receipt and book the session shortly.${r.payment.payerRef ? ` Reference: <strong class="mono">${esc(r.payment.payerRef)}</strong>.` : ''}</p>
    </div>` : ''}
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

/* ── 9d · Pricing (#pricing) — what's free, what's paid ─────────────────
   Freemium model: discovery is free; pay only for high-stakes human help
   (mentor sessions) and one-time premium unlocks. No subscription. */
function renderPricing(main) {
  const p = PF_CONFIG.pricing || {};
  const t = PF_CONFIG.sessionTiers || {};
  const money = n => 'LKR ' + Number(n || 0).toLocaleString();
  const freeList = ['Eligibility assessment & roadmap', 'University, lab & supervisor explorer',
    'Scholarships hub & visa checklist', 'Research Studio (topic & proposal help)', '12 starter templates'];

  const tier = (badge, badgeCls, title, price, sub, lines, cta) => `<div class="card" style="display:flex;flex-direction:column">
      <span class="chip ${badgeCls}" style="align-self:flex-start;margin-bottom:12px">${badge}</span>
      <h2 style="font-size:1.2rem;margin:0 0 2px">${title}</h2>
      <div style="font-size:1.5rem;font-weight:700;margin:6px 0">${price}</div>
      <p class="muted" style="font-size:13px;margin:0 0 14px">${sub}</p>
      <ul class="price-list">${lines.map(l => `<li>${l}</li>`).join('')}</ul>
      <div style="margin-top:auto;padding-top:16px">${cta}</div>
    </div>`;

  main.innerHTML = viewHead('payments', 'Plans & pricing', 'Free to explore. Pay only for the big moments.',
    'Everything you need to find a funded PhD in New Zealand is free. Pay only when you want a mentor who has done it, or the premium toolkit that sharpens your application.') +
    `<div class="grid-2" style="align-items:stretch">
      ${tier('Free', 'chip-teal', 'Explorer', 'LKR 0', 'No account needed — your work saves on this device.',
        freeList, `<a class="btn btn-ghost btn-sm" href="#assessment" style="width:100%;justify-content:center">Start the assessment</a>`)}
      ${tier('One-time', 'chip-gold', 'Premium Toolkit', money(p.toolkit), 'Unlock every advanced template + the application guides.',
        ['All 7 premium templates', 'Research proposal & interview prep', '3-year plan & budget planners', 'Yours for good — no subscription'],
        `<button class="btn btn-primary btn-sm pf-buy" data-item="toolkit" style="width:100%;justify-content:center">Unlock for ${money(p.toolkit)}</button>`)}
    </div>
    <div class="grid-2" style="align-items:stretch;margin-top:18px">
      ${tier('Mentorship', 'chip-violet', 'Talk to a mentor', `Free + ${money(t.quick)}–${money(t.standard)}`, 'A Sri Lankan postgrad already in NZ. First 15 minutes free.',
        ['Free 15-min intro call', `Follow-on session ${money(t.quick)}–${money(t.standard)}`, `Application audit ${money(p.auditSop)}–${money(p.auditFull)}`, 'Pay only if you continue'],
        `<a class="btn btn-primary btn-sm" href="#mentors" style="width:100%;justify-content:center">Ask a mentor</a>`)}
      ${tier('Best value', 'chip-rose', 'Application Sprint', money(p.sprint), 'Everything to go from idea to submitted application.',
        ['Premium Toolkit included', '2 mentor sessions', '1 full proposal review', 'Cheaper than a single agent fee'],
        `<button class="btn btn-primary btn-sm pf-buy" data-item="sprint" style="width:100%;justify-content:center">Get the Sprint · ${money(p.sprint)}</button>`)}
    </div>
    <p class="faint" style="font-size:12px;margin-top:22px;max-width:640px">Partner links (IELTS prep, money transfer, insurance, flights) are clearly labelled and free to you — we may earn a small commission. ${cloudOn() ? `<a href="#billing" class="route-link" style="color:var(--route)">View your purchases →</a>` : 'Sign-in and purchases need Firebase configured.'}</p>`;
}

/* ── 9e · Billing (#billing) — your purchases & unlocks ───────────────── */
function renderBilling(main) {
  const head = viewHead('receipt_long', 'Billing', 'Your purchases', 'One-time unlocks and their status. Nothing recurring — you only ever pay once per item.');

  if (!cloudOn()) {
    main.innerHTML = head + `<div class="card"><p class="muted" style="font-size:14px">Purchases are tied to an account, which needs Firebase configured. See <a href="#pricing" class="route-link" style="color:var(--route)">Plans</a>.</p></div>`;
    return;
  }
  if (!(window.PFCloud && PFCloud.isSignedIn && PFCloud.isSignedIn())) {
    main.innerHTML = head + `<div class="card"><p class="muted" style="font-size:14px"><a href="#account" class="route-link" style="color:var(--route)">Create a free account</a> to buy and keep premium unlocks across devices.</p></div>`;
    return;
  }

  main.innerHTML = head + `<div id="bill-body"><div class="card"><p class="muted">Loading…</p></div></div>`;
  const body = $('#bill-body');
  const money = n => 'LKR ' + Number(n || 0).toLocaleString();
  const label = it => (PFPay.items()[it] && PFPay.items()[it].label) || it;

  PFCloud.fetchMyOrders().then(orders => {
    if (!orders.length) {
      body.innerHTML = `<div class="card"><p class="muted" style="font-size:14px">No purchases yet. Browse <a href="#pricing" class="route-link" style="color:var(--route)">Plans</a> to unlock the Premium Toolkit or Sprint.</p></div>`;
      return;
    }
    body.innerHTML = orders.map(o => `<div class="card" style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
        <div>
          <strong style="font-size:14.5px">${esc(label(o.item))}</strong>
          <div class="faint" style="font-size:12.5px;margin-top:2px">${o.createdAt ? new Date(o.createdAt).toLocaleDateString() : ''} · ${money(o.amountLKR)}${o.ref ? ` · ref <span class="mono">${esc(o.ref)}</span>` : ''}</div>
        </div>
        ${payStatusChip({ paymentStatus: o.status })}
      </div>
      ${o.status === 'reported' || o.status === 'pending' ? `<p class="muted" style="font-size:12.5px;margin:10px 0 0">We’re verifying your transfer — this unlocks within 24 hours of payment.</p>` : ''}
    </div>`).join('');
  }).catch(() => {
    body.innerHTML = `<div class="card" style="border-color:var(--route)"><p class="muted" style="font-size:13.5px">Couldn’t load your purchases. Please try again.</p></div>`;
  });
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
    main.innerHTML = viewHead('account_circle', 'Account', 'Accounts need Firebase',
      'Sign-in and cross-device sync run on Firebase. The app still works fully on this device without it — configure <code>assets/js/firebase-config.js</code> to enable accounts.');
    return;
  }
  if (!window.PFCloud) {
    main.innerHTML = viewHead('account_circle', 'Account', 'Connecting…', 'Loading the accounts layer.');
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
    admin:          ['admin_panel_settings', 'Admin', 'chip-rose', 'You are signed in as the platform admin. View leads, mentors, requests and user records.', 'Open Admin panel', '#admin'],
    mentor:         ['badge', 'Mentor · approved', 'chip-teal', 'Your mentor account is approved. Claim requests from the shared queue and manage your sessions.', 'Open Mentor Dashboard', '#mentor'],
    mentor_pending: ['hourglass_top', 'Mentor · pending', 'chip-gold', 'Your mentor application is awaiting admin approval. The request queue unlocks once an admin approves you.', 'View status', '#mentor'],
    client:         ['account_circle', 'Client / Student', 'chip-violet', 'Your roadmap, applications, saved opportunities and mentor requests now sync across every device you sign into.', 'Open Dashboard', '#dashboard'],
  }[role] || ['account_circle', 'Signed in', 'chip-dim', '', 'Open Dashboard', '#dashboard'];

  main.innerHTML = viewHead('account_circle', 'Account', 'Your account', 'You’re signed in. Manage your session below.') +
    `<div class="card" style="max-width:560px">
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
        <span class="chip ${cfg[2]}"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px;margin-right:4px">${cfg[0]}</span>${cfg[1]}</span>
      </div>
      <p style="font-size:14.5px;margin:0 0 2px"><strong>${esc(email || (prof && prof.displayName) || 'Signed in')}</strong></p>
      <p class="muted" style="font-size:13.5px;margin:8px 0 18px">${cfg[3]}</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <a class="btn btn-primary btn-sm" href="${cfg[5]}">${cfg[4]}</a>
        <button class="btn btn-ghost btn-sm" id="acc-out">Sign out</button>
      </div>
    </div>`;
  $('#acc-out').onclick = () => (role === 'admin' ? PFCloud.signOutAdmin() : PFCloud.signOutUser());
}

/* Not signed in: client sign-up / sign-in (no code) + invite-only doors
   to the mentor and admin flows. */
function accountAuth(main) {
  main.innerHTML = viewHead('account_circle', 'Account', 'Sign in or create an account',
    'Signing in is optional — your data is already saved on this device. Create a free client account to sync it across devices. Mentors and admins use their own doors below.') +
    `<div class="grid-2" style="gap:18px;align-items:start">
      <div class="card">
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px"><span class="chip chip-violet">Client / Student</span></div>
        <h2 style="font-size:1.15rem;margin-bottom:4px">Create a free account</h2>
        <p class="muted" style="font-size:13px;margin-bottom:14px">No code needed. Sync your roadmap, applications and saved opportunities across devices.</p>
        <input class="field" id="ac-email" type="email" autocomplete="email" placeholder="you@example.com" style="margin-bottom:10px">
        <input class="field" id="ac-pass" type="password" autocomplete="current-password" placeholder="Password (6+ characters)" style="margin-bottom:12px">
        <p class="faint" id="ac-msg" style="font-size:12.5px;min-height:16px;margin-bottom:8px"></p>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" id="ac-signup">Create account</button>
          <button class="btn btn-ghost btn-sm" id="ac-signin">I already have one</button>
          <button class="btn btn-ghost btn-sm" id="ac-google"><span class="material-symbols-outlined" style="font-size:15px">login</span> Google</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:18px">
        <div class="card">
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px"><span class="chip chip-teal">Mentor</span><span class="chip chip-dim">Invite-only</span></div>
          <h2 style="font-size:1.05rem;margin-bottom:4px">Mentor access</h2>
          <p class="muted" style="font-size:13px;margin-bottom:14px">Mentoring is invite-only. If you’ve been given an invite code, continue to set up your mentor account — an admin approves it before you take requests.</p>
          <a class="btn btn-ghost btn-sm" href="#mentor"><span class="material-symbols-outlined" style="font-size:15px">badge</span> Enter mentor sign-up</a>
        </div>
        <div class="card">
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px"><span class="chip chip-rose">Admin</span></div>
          <h2 style="font-size:1.05rem;margin-bottom:4px">Admin access</h2>
          <p class="muted" style="font-size:13px;margin-bottom:14px">Platform owners only.</p>
          <a class="btn btn-ghost btn-sm" href="#admin"><span class="material-symbols-outlined" style="font-size:15px">lock</span> Go to admin sign-in</a>
        </div>
      </div>
    </div>`;

  const email = $('#ac-email'), pass = $('#ac-pass'), msg = $('#ac-msg');
  const creds = () => ({ e: email.value.trim(), p: pass.value });
  $('#ac-signup').onclick = async () => {
    const { e, p } = creds();
    if (!e || p.length < 6) { msg.textContent = 'Enter an email and a 6+ character password.'; return; }
    msg.textContent = 'Creating account…';
    try { await PFCloud.signUpEmail(e, p); toast('Account created — your data now syncs'); location.hash = '#dashboard'; }
    catch (err) { msg.textContent = humanAuthError(err); }
  };
  $('#ac-signin').onclick = async () => {
    const { e, p } = creds();
    if (!e || !p) { msg.textContent = 'Enter your email and password.'; return; }
    msg.textContent = 'Signing in…';
    try { await PFCloud.signInEmail(e, p); toast('Signed in'); location.hash = '#dashboard'; }
    catch (err) { msg.textContent = humanAuthError(err); }
  };
  $('#ac-google').onclick = async () => {
    try { await PFCloud.signInGoogle(); toast('Signed in'); location.hash = '#dashboard'; }
    catch (err) { msg.textContent = humanAuthError(err); }
  };
}

/* ── 9b · Mentor Dashboard (#mentor) ─────────────────────────
   Invite code → sign up → pending review → (admin approves) → claim queue.
   Visually a sibling of #admin: same chip-filter tabs, cards, ledgers. */
let mentorState = { tab: 'open', open: null, claimed: null, loading: false, loaded: false };
// Set once the visitor enters the correct mentor invite code this session.
let mentorInviteOk = false;

function renderMentor(main) {
  if (!window.PF_FIREBASE_CONFIG || !window.PF_FIREBASE_CONFIG.apiKey) {
    main.innerHTML = viewHead('support_agent', 'Mentor Dashboard', 'Mentoring needs Firebase',
      'The mentor marketplace (accounts, the request queue, payments) runs on Firebase. Configure <code>assets/js/firebase-config.js</code> and deploy <code>firestore.rules</code> to enable it.');
    return;
  }
  if (!window.PFCloud) {
    main.innerHTML = viewHead('support_agent', 'Mentor Dashboard', 'Connecting…', 'Loading the Firebase layer.');
    setTimeout(() => { if (location.hash.slice(1).split('?')[0] === 'mentor') route(); }, 400);
    return;
  }

  if (PFCloud.isMentor()) return mentorDashboard(main);
  if (PFCloud.hasMentorProfile()) return mentorPending(main);
  if (!mentorInviteOk) return mentorInviteGate(main);
  return mentorApply(main);
}

/* Invite-only gate: mentoring is no longer a public self-service sign-up.
   A vetted person enters the mentor invite code (shared privately by the
   admin) before they can create a mentor account — and even then the new
   account is PENDING until an admin approves it. */
function mentorInviteGate(main) {
  main.innerHTML = viewHead('badge', 'Mentor Dashboard', 'Mentoring is invite-only',
    'PathFinder mentors are vetted Sri Lankan postgrads already in New Zealand. If an admin has given you an invite code, enter it to set up your mentor account — it’s reviewed and approved before you take any requests.') +
    `<div class="card" style="max-width:440px">
      <label class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em">Mentor invite code</label>
      <input class="field" id="mt-code" autocomplete="off" placeholder="Enter your invite code" style="margin-top:6px;text-transform:uppercase">
      <p class="faint" id="mt-code-msg" style="font-size:12.5px;margin-top:10px;min-height:16px"></p>
      <button class="btn btn-primary" id="mt-code-go" style="margin-top:4px;width:100%;justify-content:center">Continue</button>
      <p class="faint" style="font-size:12px;margin-top:14px">Not a mentor? <a href="#account" style="color:var(--route)">Back to account</a> · <a href="#mentors" style="color:var(--route)">Ask a mentor instead</a></p>
    </div>`;

  const code = $('#mt-code'), msg = $('#mt-code-msg'), go = $('#mt-code-go');
  const submit = () => {
    if (norm(code.value) !== norm(ROLE_CODES().mentor)) {
      msg.textContent = 'That invite code isn’t valid. Ask the PathFinder team for a current code.';
      return;
    }
    mentorInviteOk = true;
    route();
  };
  go.onclick = submit;
  code.onkeydown = e => { if (e.key === 'Enter') submit(); };
  code.focus();
}

function mentorApply(main) {
  const signedIn = PFCloud.isSignedIn();
  main.innerHTML = viewHead('badge', 'Mentor Dashboard', 'Set up your mentor account',
    'Invite confirmed. Create your account, tell us what you can help with, and an admin will review and approve your profile before it goes live.') +
    (signedIn ? '' : `<div class="card" style="max-width:520px;margin-bottom:18px">
      <h2 style="font-size:1.1rem;margin-bottom:4px">1 · Create your mentor account</h2>
      <p class="muted" style="font-size:13px;margin-bottom:14px">Use email and a password, or continue with Google.</p>
      <input class="field" id="mt-email" type="email" autocomplete="email" placeholder="you@example.com" style="margin-bottom:10px">
      <input class="field" id="mt-pass" type="password" autocomplete="new-password" placeholder="Choose a password (6+ characters)" style="margin-bottom:12px">
      <p class="faint" id="mt-msg" style="font-size:12.5px;min-height:16px;margin-bottom:8px"></p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" id="mt-signup">Create account</button>
        <button class="btn btn-ghost btn-sm" id="mt-signin">I already have one</button>
        <button class="btn btn-ghost btn-sm" id="mt-google"><span class="material-symbols-outlined" style="font-size:15px">login</span> Google</button>
      </div>
    </div>`) +
    `<div class="card" style="max-width:520px ${signedIn ? '' : ';opacity:.5;pointer-events:none'}" id="mt-profile-card">
      <h2 style="font-size:1.1rem;margin-bottom:14px">${signedIn ? '' : '2 · '}Your mentor profile</h2>
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
      <button class="btn btn-primary" id="mp-submit" style="width:100%;justify-content:center" ${signedIn ? '' : 'disabled'}>Submit application</button>
    </div>`;

  if (!signedIn) {
    const email = $('#mt-email'), pass = $('#mt-pass'), msg = $('#mt-msg');
    const creds = () => ({ e: email.value.trim(), p: pass.value });
    $('#mt-signup').onclick = async () => {
      const { e, p } = creds(); if (!e || p.length < 6) { msg.textContent = 'Enter an email and a 6+ character password.'; return; }
      msg.textContent = 'Creating account…';
      try { await PFCloud.signUpEmail(e, p); route(); } catch (err) { msg.textContent = humanAuthError(err); }
    };
    $('#mt-signin').onclick = async () => {
      const { e, p } = creds(); if (!e || !p) { msg.textContent = 'Enter your email and password.'; return; }
      msg.textContent = 'Signing in…';
      try { await PFCloud.signInEmail(e, p); route(); } catch (err) { msg.textContent = humanAuthError(err); }
    };
    $('#mt-google').onclick = async () => {
      try { await PFCloud.signInGoogle(); route(); } catch (err) { msg.textContent = humanAuthError(err); }
    };
    return;
  }

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
  main.innerHTML = viewHead('hourglass_top', 'Mentor Dashboard', 'Application pending review',
    'Thanks for applying. An admin will review your profile shortly — once approved, the open request queue appears here.') +
    `<div class="card" style="max-width:560px">
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <span class="chip chip-gold">Pending approval</span>
        ${(p.fields || []).map(f => `<span class="chip chip-dim">${PF_CONSULT_TOPICS[f] || f}</span>`).join('')}
      </div>
      <p style="font-size:14px;margin:0 0 4px"><strong>${esc(p.displayName || '')}</strong>${p.city ? ' · ' + esc(p.city) : ''}</p>
      ${p.bio ? `<p class="muted" style="font-size:13.5px;margin-top:8px">${esc(p.bio)}</p>` : ''}
      <button class="btn btn-ghost btn-sm" id="mt-out" style="margin-top:16px">Sign out</button>
    </div>`;
  $('#mt-out').onclick = () => PFCloud.signOutUser();
}

async function mentorLoad() {
  if (mentorState.loading) return;
  mentorState.loading = true;
  const [o, c] = await Promise.allSettled([PFCloud.fetchOpenRequests(), PFCloud.fetchMyClaimedRequests()]);
  mentorState.open    = o.status === 'fulfilled' ? o.value : null;
  mentorState.claimed = c.status === 'fulfilled' ? c.value : null;
  mentorState.loading = false;
  mentorState.loaded = true;
}

/* At-a-glance insights strip for the mentor dashboard, derived from the
   already-loaded queue + claimed lists (no extra Firestore reads). */
function mentorInsights() {
  const open = mentorState.open || [];
  const claimed = mentorState.claimed || [];
  const active = claimed.filter(r => !['completed', 'cancelled'].includes(r.status)).length;
  const completed = claimed.filter(r => r.status === 'completed').length;
  const earned = claimed
    .filter(r => r.payment && r.payment.paymentStatus === 'paid')
    .reduce((s, r) => s + (Number(r.payment.amountLKR) || 0), 0);
  const n = v => (mentorState.loaded ? v : '·');
  const earnedLbl = mentorState.loaded ? 'LKR ' + earned.toLocaleString() : '·';
  return `<div class="grid-4" style="margin-bottom:24px">
    ${admMetric('hourglass_top', n(open.length), 'Open in queue')}
    ${admMetric('assignment_ind', n(active), 'Active with you')}
    ${admMetric('task_alt', n(completed), 'Sessions completed')}
    ${admMetric('payments', earnedLbl, 'Earned (paid)')}
  </div>`;
}

function mentorDashboard(main) {
  const p = PFCloud.getMentorProfile() || {};
  const active = p.active !== false;
  const TABS = [['open', 'Open requests'], ['claimed', 'My claimed']];
  const counts = { open: mentorState.open ? mentorState.open.length : '·', claimed: mentorState.claimed ? mentorState.claimed.length : '·' };

  main.innerHTML = viewHead('support_agent', 'Mentor Dashboard', `Welcome, ${esc(p.displayName || 'mentor')}`,
    'Claim requests from the shared queue, run the free intro, then — if the student wants more — generate a PayHere link for a paid follow-on session.') +
    `<div class="card" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:18px">
      <span class="chip ${active ? 'chip-teal' : 'chip-dim'}">${active ? 'Available for requests' : 'Not taking requests'}</span>
      <p class="muted" style="flex:1;min-width:200px;font-size:13px;margin:0">${active ? 'You appear in the active mentor count and can claim from the queue.' : 'You’re paused — toggle back on when you have time.'}</p>
      <button class="btn btn-ghost btn-sm" id="mt-toggle">${active ? 'Pause requests' : 'Resume requests'}</button>
      <button class="btn btn-ghost btn-sm" id="mt-out">Sign out</button>
    </div>
    ${mentorInsights()}
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px" id="mtd-tabs">
      ${TABS.map(([id, lbl]) => `<button class="chip-filter ${mentorState.tab === id ? 'active' : ''}" data-tab="${id}">${lbl} <span class="mono" style="opacity:.6">${counts[id]}</span></button>`).join('')}
      <button class="chip-filter" id="mtd-refresh" style="margin-left:auto"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px">refresh</span> Refresh</button>
    </div>
    <div id="mtd-body"></div>`;

  const body = $('#mtd-body');

  $('#mt-out').onclick = () => PFCloud.signOutUser();
  $('#mt-toggle').onclick = async () => {
    try { await PFCloud.saveMentorProfile({ active: !active }); toast(active ? 'Paused' : 'Available again'); route(); }
    catch { toast('Could not update'); }
  };

  function paint() {
    if (mentorState.loading) { body.innerHTML = `<div class="card"><p class="muted">Loading…</p></div>`; return; }
    if (mentorState.tab === 'open') {
      const list = mentorState.open;
      if (list === null) { body.innerHTML = `<div class="card" style="border-color:var(--route)"><p class="muted">Couldn’t load the queue — your account may not be approved yet.</p></div>`; return; }
      cacheReqs(list);
      body.innerHTML = list.length ? list.map(openReqCard).join('')
        : `<div class="card"><p class="muted" style="font-size:14px">No open requests right now. New ones appear here — hit Refresh.</p></div>`;
    } else {
      const list = mentorState.claimed;
      if (list === null) { body.innerHTML = admErrCard('your requests'); return; }
      cacheReqs(list);
      body.innerHTML = list.length ? list.map(claimedReqCard).join('')
        : `<div class="card"><p class="muted" style="font-size:14px">You haven’t claimed any requests yet. Open the queue and claim one.</p></div>`;
    }
  }

  $$('#mtd-tabs .chip-filter[data-tab]').forEach(b => b.onclick = () => {
    mentorState.tab = b.dataset.tab;
    $$('#mtd-tabs .chip-filter').forEach(x => x.classList.toggle('active', x === b));
    paint();
  });
  $('#mtd-refresh').onclick = async () => {
    mentorState.loaded = false; mentorState.open = mentorState.claimed = null;
    body.innerHTML = `<div class="card"><p class="muted">Loading…</p></div>`;
    await mentorLoad(); route();
  };

  // delegated actions inside request cards (claim / status / payment)
  body.addEventListener('click', mentorCardAction);

  if (!mentorState.loaded && !mentorState.loading) {
    body.innerHTML = `<div class="card"><p class="muted">Loading…</p></div>`;
    mentorLoad().then(() => route());
  } else {
    paint();
  }
}

function openReqCard(r) {
  return `<div class="card" style="margin-bottom:12px" data-req="${r.id}">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
      <div style="flex:1;min-width:200px">
        <strong style="font-size:14.5px">${PF_CONSULT_TOPICS[r.topic] || 'General guidance'}</strong>
        <div class="faint" style="font-size:12.5px">${r.at ? new Date(r.at).toLocaleDateString() : ''}</div>
        ${r.note ? `<div class="muted" style="font-size:13px;margin-top:6px">${esc(r.note)}</div>` : ''}
      </div>
      <button class="btn btn-primary btn-sm mt-claim" data-req="${r.id}">Claim</button>
    </div>
  </div>`;
}

function claimedReqCard(r) {
  const price = (r.payment && r.payment.amountLKR) || PF_CONFIG.defaultSessionPriceLKR;
  let actions = '';
  if (r.status === 'claimed') {
    actions = `<button class="btn btn-ghost btn-sm mt-intro" data-req="${r.id}">Mark ${PF_CONFIG.freeIntroMinutes}-min intro complete</button>`;
  } else if (r.status === 'intro_done') {
    actions = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;width:100%">
        <label class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em">Follow-on price (LKR)</label>
        <input class="field mt-amount" type="number" min="1" value="${price}" style="width:130px">
        <button class="btn btn-primary btn-sm mt-genlink" data-req="${r.id}">Generate payment link</button>
      </div>`;
  } else if (r.status === 'awaiting_payment') {
    actions = `${PFPay.isPayHereLive() ? `<button class="btn btn-ghost btn-sm mt-checkout" data-req="${r.id}">Preview PayHere link</button>` : ''}
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
        <div class="faint" style="font-size:12.5px;margin-top:2px">${PF_CONSULT_TOPICS[r.topic] || 'General guidance'} · ${r.at ? new Date(r.at).toLocaleDateString() : ''}</div>
        ${r.note ? `<div class="muted" style="font-size:13px;margin-top:6px">${esc(r.note)}</div>` : ''}
        ${reported ? `<div class="muted" style="font-size:12.5px;margin-top:8px;padding:8px 10px;background:var(--surface);border-radius:3px">Student reported payment via <strong>${esc(r.payment.method || 'transfer')}</strong>${r.payment.payerRef ? ` · ref <strong class="mono">${esc(r.payment.payerRef)}</strong>` : ''}${r.payment.payerTxn ? ` · txn <span class="mono">${esc(r.payment.payerTxn)}</span>` : ''}. Verify in your banking app, then “Mark payment received”.</div>` : ''}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
        ${reqStatusChip(r.status)}
        ${r.payment ? payStatusChip(r.payment) : ''}
      </div>
    </div>
    ${actions || canCancel ? `<div style="margin-top:14px;padding-top:14px;border-top:1px dashed var(--line);display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      ${actions}
      ${canCancel ? `<button class="btn btn-ghost btn-sm mt-cancel" data-req="${r.id}" style="margin-left:auto">Cancel</button>` : ''}
    </div>` : ''}
  </div>`;
}

async function mentorCardAction(e) {
  const btn = e.target.closest('button[data-req]');
  if (!btn) return;
  const id = btn.dataset.req;
  const doAction = async (fn, ok) => { btn.disabled = true; try { await fn(); toast(ok); await mentorLoad(); route(); } catch (err) { btn.disabled = false; toast(humanAuthError(err)); } };

  if (btn.classList.contains('mt-claim'))    return doAction(() => PFCloud.claimRequest(id), 'Claimed — it’s in “My claimed”');
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
}

/* re-render #mentor whenever the signed-in mentor's state resolves/changes
   (sign-in, approval, sign-out) — mirrors hookAdminAuth. */
(function hookMentorAuth(tries = 0) {
  if (window.PFCloud && window.PFCloud.onMentorState) {
    window.PFCloud.onMentorState(() => {
      paintMentorSidebarLink();
      entState.loaded = false;   // re-derive premium unlocks for the new session
      const v = (location.hash || '').slice(1).split('?')[0];
      if (v === 'mentor') { mentorState.loaded = false; route(); }
      else if (v === 'account') route();
      else if (v === 'kit' || v === 'billing') route();
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
let adminState = { tab: 'overview', leads: null, mentors: null, requests: null, orders: null, users: null, loading: false, loaded: false, error: '' };

function renderAdmin(main) {
  // Firebase off entirely → nothing to administer.
  if (!window.PF_FIREBASE_CONFIG || !window.PF_FIREBASE_CONFIG.apiKey) {
    main.innerHTML = viewHead('admin_panel_settings', 'Admin', 'Admin panel unavailable',
      'Firebase is not configured. Paste your project config into <code>assets/js/firebase-config.js</code> and deploy <code>firestore.rules</code> to enable leads, mentors, requests and user records here.');
    return;
  }
  // Sync layer still loading (deferred module) → wait, then re-render.
  if (!window.PFCloud) {
    main.innerHTML = viewHead('admin_panel_settings', 'Admin', 'Connecting…', 'Loading the Firebase admin layer.');
    setTimeout(() => { if (location.hash.slice(1).split('?')[0] === 'admin') route(); }, 400);
    return;
  }

  if (!PFCloud.isAdmin()) return adminLogin(main);
  adminDashboard(main);
}

function adminLogin(main) {
  main.innerHTML = viewHead('lock', 'Admin', 'Admin sign-in',
    'Enter the admin access code and password to view leads, mentors, requests and user records.') +
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
      adminState = { tab: 'overview', leads: null, mentors: null, requests: null, orders: null, users: null, loading: false, loaded: false, error: '' };
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
  const [l, m, r, o, u] = await Promise.allSettled([
    PFCloud.fetchLeads(), PFCloud.fetchMentors(), PFCloud.fetchAllRequests(), PFCloud.fetchAllOrders(), PFCloud.fetchUsers(),
  ]);
  adminState.leads    = l.status === 'fulfilled' ? l.value : null;
  adminState.mentors  = m.status === 'fulfilled' ? m.value : null;
  adminState.requests = r.status === 'fulfilled' ? r.value : null;
  adminState.orders   = o.status === 'fulfilled' ? o.value : null;
  adminState.users    = u.status === 'fulfilled' ? u.value : null;
  const settled = [l, m, r, o, u];
  const failed = settled.filter(x => x.status === 'rejected');
  if (failed.length) console.warn('PathFinder admin: some reads failed —', failed.map(f => f.reason && f.reason.message));
  if (settled.every(x => x.status === 'rejected')) {
    adminState.error = 'Could not load data. Make sure firestore.rules are deployed and the admin email matches.';
  }
  adminState.loading = false;
  adminState.loaded = true;     // load attempted — stops the render loop
}

function admErrCard(what) {
  return `<div class="card" style="border-color:var(--route)"><p class="muted" style="font-size:13.5px">
    Couldn't load ${what} — your account may lack permission, or the rules need redeploying.</p></div>`;
}

function adminDashboard(main) {
  const TABS = [['overview', 'Overview'], ['accounting', 'Accounting'], ['leads', 'Leads'], ['mentors', 'Mentors'], ['requests', 'Requests'], ['orders', 'Orders'], ['users', 'User records']];
  const counts = {
    leads: adminState.leads ? adminState.leads.length : '·',
    mentors: adminState.mentors ? adminState.mentors.length : '·',
    requests: adminState.requests ? adminState.requests.length : '·',
    orders: adminState.orders ? adminState.orders.length : '·',
    users: adminState.users ? adminState.users.length : '·',
  };

  main.innerHTML = viewHead('admin_panel_settings', 'Admin', 'Platform admin',
    'Live data from Firestore. Visible only to the admin account — ordinary visitors are blocked by security rules.') +
    `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px" id="adm-tabs">
      ${TABS.map(([id, lbl]) => `<button class="chip-filter ${adminState.tab === id ? 'active' : ''}" data-tab="${id}">${lbl}${counts[id] !== undefined ? ` <span class="mono" style="opacity:.6">${counts[id]}</span>` : ''}</button>`).join('')}
      <button class="chip-filter" id="adm-refresh" style="margin-left:auto"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px">refresh</span> Refresh</button>
    </div>
    <div id="adm-body"></div>`;

  const body = $('#adm-body');

  function paint() {
    if (adminState.loading) { body.innerHTML = `<div class="card"><p class="muted">Loading…</p></div>`; return; }
    if (adminState.error)   { body.innerHTML = `<div class="card" style="border-color:var(--route)"><p class="muted">${adminState.error}</p></div>`; return; }
    ({ overview: admOverview, accounting: admAccounting, leads: admLeads, mentors: admMentors, requests: admRequests, orders: admOrders, users: admUsers })[adminState.tab](body);
  }

  $$('#adm-tabs .chip-filter[data-tab]').forEach(b => b.onclick = () => {
    adminState.tab = b.dataset.tab;
    $$('#adm-tabs .chip-filter').forEach(x => x.classList.toggle('active', x === b));
    paint();
  });
  $('#adm-refresh').onclick = async () => {
    adminState.loaded = false;
    adminState.leads = adminState.mentors = adminState.requests = adminState.orders = adminState.users = null;
    body.innerHTML = `<div class="card"><p class="muted">Loading…</p></div>`;
    await adminLoad();
    route();
  };

  // mentor approve/reject/deactivate + request payment reconciliation —
  // delegated once per render (body is rebuilt by route(), so handlers
  // never stack across tab switches).
  body.addEventListener('click', async e => {
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
    // open a print-ready receipt/invoice for one accounting row
    const inv = e.target.closest('button[data-invoice]');
    if (inv) {
      const tx = accountingRows().find(t => t.invoiceNo === inv.dataset.invoice);
      if (tx) openInvoice(tx);
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
  const paidTotal = requests
    .filter(r => r.payment && r.payment.paymentStatus === 'paid')
    .reduce((sum, r) => sum + (Number(r.payment.amountLKR) || 0), 0);
  const orders = adminState.orders || [];
  const orderRevenue = orders.filter(o => o.status === 'paid').reduce((s, o) => s + (Number(o.amountLKR) || 0), 0);
  const ordersToConfirm = orders.filter(o => o.status === 'reported' || o.status === 'pending').length;

  // field distribution from completed assessments
  const fields = {};
  users.forEach(u => { const f = u.data.assessment?.result?.field; if (f) fields[f] = (fields[f] || 0) + 1; });
  const fieldRows = Object.entries(fields).sort((a, b) => b[1] - a[1]);

  body.innerHTML = `
    ${pendingM ? `<a class="card" href="#" id="adm-pending-jump" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:20px;border-color:var(--ochre)">
      <span class="material-symbols-outlined" style="color:var(--ochre)">hourglass_top</span>
      <p style="flex:1;min-width:220px;font-size:13.5px;margin:0"><strong>${pendingM} mentor application${pendingM === 1 ? '' : 's'}</strong> waiting for approval. Review and approve them in the Mentors tab.</p>
      <span class="btn btn-ghost btn-sm">Review now</span>
    </a>` : ''}
    <div class="grid-4" style="margin-bottom:28px">
      ${admMetric('mark_email_read', (adminState.leads || []).length, 'Email leads')}
      ${admMetric('support_agent', `${approvedM}/${pendingM}`, 'Mentors approved / pending')}
      ${admMetric('inbox', requests.length, 'Total requests')}
      ${admMetric('hourglass_top', openReq, 'Open (unclaimed)')}
      ${admMetric('payments', awaitingPay, 'Awaiting payment')}
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

  const jump = $('#adm-pending-jump', body);
  if (jump) jump.onclick = e => { e.preventDefault(); $('#adm-tabs .chip-filter[data-tab="mentors"]')?.click(); };
}

function admLeads(body) {
  if (adminState.leads === null) { body.innerHTML = admErrCard('leads'); return; }
  const leads = adminState.leads;
  body.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px">
      <p class="faint" style="font-size:12.5px;margin:0">${leads.length} lead${leads.length === 1 ? '' : 's'}</p>
      ${leads.length ? `<button class="btn btn-ghost btn-sm" id="adm-dl-leads"><span class="material-symbols-outlined" style="font-size:15px">download</span> Export CSV</button>` : ''}
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

function admMentors(body) {
  if (adminState.mentors === null) { body.innerHTML = admErrCard('mentors'); return; }
  const mentors = adminState.mentors.slice().sort((a, b) => (a.approved === b.approved) ? 0 : (a.approved ? 1 : -1));
  body.innerHTML = `
    <p class="faint" style="font-size:12.5px;margin:0 0 14px">${mentors.length} mentor account${mentors.length === 1 ? '' : 's'} · pending first</p>
    ${mentors.length ? mentors.map(m => {
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
              ? `<button class="btn btn-ghost btn-sm" data-muid="${m.uid}" data-act="${active ? 'deactivate' : 'activate'}">${active ? 'Deactivate' : 'Reactivate'}</button>`
              : `<button class="btn btn-primary btn-sm" data-muid="${m.uid}" data-act="approve">Approve</button>`}
            ${m.approved ? `<button class="btn btn-ghost btn-sm" data-muid="${m.uid}" data-act="reject">Revoke</button>` : ''}
          </div>
        </div>
      </div>`;
    }).join('') : `<div class="card"><p class="muted" style="font-size:14px">No mentor applications yet.</p></div>`}`;
}

function admRequests(body) {
  if (adminState.requests === null) { body.innerHTML = admErrCard('mentor requests'); return; }
  const reqs = adminState.requests;
  const nameOf = uid => { const m = (adminState.mentors || []).find(x => x.uid === uid); return m ? m.displayName : (uid ? uid.slice(0, 8) + '…' : '—'); };
  body.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px">
      <p class="faint" style="font-size:12.5px;margin:0">${reqs.length} request${reqs.length === 1 ? '' : 's'}</p>
      ${reqs.length ? `<button class="btn btn-ghost btn-sm" id="adm-dl-reqs"><span class="material-symbols-outlined" style="font-size:15px">download</span> Export CSV</button>` : ''}
    </div>
    ${reqs.length ? reqs.map(r => {
      const canPaid = r.status === 'awaiting_payment';
      const canCancel = !['paid', 'completed', 'cancelled'].includes(r.status);
      return `<div class="card" style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;align-items:flex-start">
          <div style="flex:1;min-width:220px">
            <strong style="font-size:14.5px">${esc(r.name || 'Unknown')}</strong>
            <span class="faint" style="font-size:12.5px"> · ${esc(r.contact || 'no contact')}</span>
            <div class="faint" style="font-size:12.5px;margin-top:2px">
              ${PF_CONSULT_TOPICS[r.topic] || 'General'} · ${r.mentorId ? 'mentor: ' + esc(nameOf(r.mentorId)) : 'unclaimed'} · ${r.at ? new Date(r.at).toLocaleDateString() : ''}
            </div>
            ${r.note ? `<div class="muted" style="font-size:13px;margin-top:6px">${esc(r.note)}</div>` : ''}
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
            ${reqStatusChip(r.status)}
            ${r.payment ? payStatusChip(r.payment) : ''}
          </div>
        </div>
        ${canPaid || canCancel ? `<div style="margin-top:12px;padding-top:12px;border-top:1px dashed var(--line);display:flex;gap:8px;flex-wrap:wrap">
          ${canPaid ? `<button class="btn btn-primary btn-sm" data-radoc="${r.id}" data-act="paid">Mark payment received</button>` : ''}
          ${canCancel ? `<button class="btn btn-ghost btn-sm" data-radoc="${r.id}" data-act="cancel" style="margin-left:auto">Cancel</button>` : ''}
        </div>` : ''}
      </div>`;
    }).join('') : `<div class="card"><p class="muted" style="font-size:14px">No mentor requests yet.</p></div>`}`;

  const dl = $('#adm-dl-reqs', body);
  if (dl) dl.onclick = () => csvDownload('pathfinder-mentor-requests.csv',
    ['name', 'contact', 'topic', 'status', 'mentorId', 'paymentStatus', 'amountLKR', 'note', 'at'],
    reqs.map(r => ({ ...r,
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
      ${orders.length ? `<button class="btn btn-ghost btn-sm" id="adm-dl-orders"><span class="material-symbols-outlined" style="font-size:15px">download</span> Export CSV</button>` : ''}
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
          ${canCancel ? `<button class="btn btn-ghost btn-sm" data-oid="${o.id}" data-act="cancel" style="margin-left:auto">Cancel</button>` : ''}
        </div>` : ''}
      </div>`;
    }).join('') : `<div class="card"><p class="muted" style="font-size:14px">No premium orders yet.</p></div>`}`;

  const dl = $('#adm-dl-orders', body);
  if (dl) dl.onclick = () => csvDownload('pathfinder-orders.csv',
    ['item', 'amountLKR', 'status', 'method', 'ref', 'payerTxn', 'uid', 'createdAt'],
    orders.map(o => ({ ...o, createdAt: o.createdAt ? new Date(o.createdAt).toISOString() : '' })));
}

/* ── Accounting: one ledger from both revenue sources ───────────────────
   Reconstructs a unified transaction list from data the admin already
   loaded (mentor_requests[].payment + orders[]) — no extra Firestore reads
   and no new collection, so it stays inside the free Spark plan. */
function accountingRows() {
  const prefix = (PF_CONFIG.org && PF_CONFIG.org.invoicePrefix) || 'PF';
  const tail = id => String(id || '').replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase() || '------';
  const rows = [];

  (adminState.requests || []).forEach(r => {
    const p = r.payment;
    if (!p || !p.paymentStatus || p.paymentStatus === 'none') return;
    rows.push({
      invoiceNo: `${prefix}-INV-S-${tail(r.id)}`, kind: 'session',
      item: (PF_CONSULT_TOPICS[r.topic] ? PF_CONSULT_TOPICS[r.topic] + ' — ' : '') + 'mentoring session',
      payer: r.name || '', payerContact: r.contact || '', payerUid: r.studentUid || '',
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
  if (adminState.requests === null && adminState.orders === null) { body.innerHTML = admErrCard('accounting data'); return; }
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
      ${rows.length ? `<button class="btn btn-ghost btn-sm" id="adm-dl-acct"><span class="material-symbols-outlined" style="font-size:15px">download</span> Export ledger CSV</button>` : ''}
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
        <td style="text-align:right"><button class="btn btn-ghost btn-sm" data-invoice="${esc(r.invoiceNo)}" title="Open receipt"><span class="material-symbols-outlined" style="font-size:15px">receipt</span></button></td>
      </tr>`).join('')}
    </tbody></table></div>` : `<div class="card"><p class="muted" style="font-size:14px">No payments recorded yet. Reported and confirmed payments from mentor sessions and premium unlocks appear here.</p></div>`}
    <p class="faint" style="font-size:11.5px;margin-top:14px">A management ledger reconstructed from live records. For statutory accounting, reconcile against your bank / PayHere / PayPal statements and register a business once revenue is steady (see <code>docs/PRICING.md</code>).</p>`;

  const dl = $('#adm-dl-acct', body);
  if (dl) dl.onclick = () => csvDownload('pathfinder-accounting-ledger.csv',
    ['invoiceNo', 'date', 'kind', 'item', 'payer', 'payerUid', 'method', 'ref', 'txn', 'amountLKR', 'status'],
    rows.map(r => ({ ...r, date: r.date ? new Date(typeof r.date === 'number' ? r.date : Date.parse(r.date)).toISOString() : '' })));
}

/* Print-ready receipt / invoice for one transaction. Opens a clean,
   self-contained doc in a new tab with a Print button (print-to-PDF gives a
   downloadable record). Issuer identity comes from PF_CONFIG.org. */
function openInvoice(tx) {
  const org = PF_CONFIG.org || {};
  const money = n => 'LKR ' + Number(n || 0).toLocaleString();
  const paid = tx.status === 'paid';
  const e = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const dateStr = tx.date ? new Date(typeof tx.date === 'number' ? tx.date : Date.parse(tx.date)).toLocaleDateString() : new Date().toLocaleDateString();
  const issuer = org.legalName || org.name || 'PathFinder';
  const title = paid ? 'RECEIPT' : 'INVOICE';
  const statusLabel = paid ? 'PAID' : (tx.status === 'reported' ? 'PAYMENT REPORTED — AWAITING CONFIRMATION' : 'UNPAID');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${e(tx.invoiceNo)}</title><style>
    *{box-sizing:border-box}body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1C1A15;max-width:720px;margin:32px auto;padding:0 28px;line-height:1.5}
    .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1C1A15;padding-bottom:18px;margin-bottom:24px}
    .brand{font-size:24px;font-weight:700;letter-spacing:-.02em}.brand i{color:#C2401C;font-style:italic}
    .doc{font-size:13px;text-transform:uppercase;letter-spacing:.16em;color:#C2401C;font-weight:600;text-align:right}
    .muted{color:#666;font-size:12.5px}h2{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#888;margin:0 0 6px}
    .cols{display:flex;gap:40px;flex-wrap:wrap;margin-bottom:28px}.cols>div{flex:1;min-width:200px}
    table{width:100%;border-collapse:collapse;margin:8px 0 18px}th,td{text-align:left;padding:11px 8px;border-bottom:1px solid #ddd;font-size:14px}
    th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#888}.r{text-align:right}
    .total{font-size:20px;font-weight:700}.status{display:inline-block;margin-top:8px;padding:4px 12px;border-radius:3px;font-size:12px;font-weight:600;background:${paid ? '#e7f0ea' : '#f7efda'};color:${paid ? '#2D5A41' : '#8A6A2F'}}
    .foot{margin-top:32px;padding-top:16px;border-top:1px solid #ddd;font-size:11.5px;color:#888}
    .noprint{margin:24px 0;text-align:center}button{font:inherit;padding:10px 22px;border:1px solid #1C1A15;background:#1C1A15;color:#fff;border-radius:3px;cursor:pointer}
    @media print{.noprint{display:none}}
  </style></head><body>
    <div class="top">
      <div><div class="brand">Path<i>finder</i></div><div class="muted">${e(issuer)}${org.email ? ' · ' + e(org.email) : ''}${org.address ? '<br>' + e(org.address) : ''}${org.taxId ? '<br>Tax ID: ' + e(org.taxId) : ''}</div></div>
      <div class="doc">${title}<div class="muted" style="text-transform:none;letter-spacing:0;color:#1C1A15;font-weight:400;margin-top:6px">${e(tx.invoiceNo)}</div></div>
    </div>
    <div class="cols">
      <div><h2>Billed to</h2>${e(tx.payer || 'PathFinder student')}${tx.payerContact ? '<br>' + e(tx.payerContact) : ''}${tx.payerUid ? '<br><span class="muted">acct ' + e(tx.payerUid.slice(0, 16)) + '…</span>' : ''}</div>
      <div class="r"><h2>Details</h2>Date: ${e(dateStr)}<br>Method: ${e(tx.method || '—')}${tx.ref ? '<br>Reference: ' + e(tx.ref) : ''}${tx.txn ? '<br>Txn: ' + e(tx.txn) : ''}</div>
    </div>
    <table>
      <thead><tr><th>Description</th><th class="r">Amount</th></tr></thead>
      <tbody><tr><td>${e(tx.item)}</td><td class="r">${money(tx.amountLKR)}</td></tr></tbody>
      <tfoot><tr><td class="total">Total</td><td class="r total">${money(tx.amountLKR)}</td></tr></tfoot>
    </table>
    <span class="status">${statusLabel}</span>
    <div class="foot">${org.legalName ? '' : 'Issued by an unregistered sole trader — this is a payment confirmation, not a tax invoice. '}Amounts in Sri Lankan Rupees (LKR). Generated by PathFinder on ${new Date().toLocaleString()}.</div>
    <div class="noprint"><button onclick="window.print()">Print / Save as PDF</button></div>
  </body></html>`;

  const w = window.open('', '_blank');
  if (!w) { toast('Allow pop-ups to open the receipt'); return; }
  w.document.write(html);
  w.document.close();
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
