/* ════════════════════════════════════════════════════════════
   PathFinder — App SPA (assessment, roadmap, explorer,
   funding, dashboard, starter kit). Hash-routed, no build step.
   ════════════════════════════════════════════════════════════ */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uniById = id => PF_UNIVERSITIES.find(u => u.id === id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ── Router ─────────────────────────────────────────────── */
const ROUTES = {
  assessment: renderAssessment,
  roadmap:    renderRoadmap,
  explore:    renderExplore,
  funding:    renderFunding,
  dashboard:  renderDashboard,
  kit:        renderKit,
  visa:       renderVisa,
  settlement: renderSettlement,
  mentors:    renderMentors,
  admin:      renderAdmin,
};

function route() {
  const view = (location.hash || '#dashboard').slice(1).split('?')[0];
  const fn = ROUTES[view] || renderDashboard;
  $$('.side-link').forEach(a => a.classList.toggle('active', a.dataset.view === view));
  $('.side-link.active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  const main = $('#view');
  main.innerHTML = '';
  fn(main);
  main.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }],
    { duration: 350, easing: 'cubic-bezier(.22,1,.36,1)' });
  window.scrollTo(0, 0);
}

/* "#mentors?topic=visa-medical" → { topic:'visa-medical' } */
function hashQuery() {
  return Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
}

/* contextual mentor hook — quiet, helpful, pre-fills the topic */
function consultCTA(topic) {
  return `<div class="consult-hook">
    <span class="material-symbols-outlined" style="font-size:15px">support_agent</span>
    <span>Stuck at this step? <a href="#mentors?topic=${topic}">Talk to someone who's done it →</a></span>
  </div>`;
}

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
      if ((location.hash || '').slice(1).split('?')[0] === 'admin') route();
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
  main.innerHTML = viewHead('celebration', 'Assessment complete', 'Your personalized result',
    'Saved to your dashboard. Your roadmap has been generated from these answers.') +
    resultCard(result) +
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

/* ── 5 · Dashboard (saved + tracker) ────────────────────── */
function renderDashboard(main) {
  const a = PFStore.getAssessment();
  const saved = PFStore.getSaved();
  const apps = PFStore.getApps();
  const ST = PFStore.APP_STATUSES;
  const vp = visaProgress();
  const consults = PFStore.getConsults();

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

    `<div class="grid-4" style="margin-bottom:40px">
      ${[['quiz', a ? a.result.readiness + '%' : '—', 'Readiness score', '#assessment'],
         ['bookmark', saved.length, 'Saved opportunities', '#explore'],
         ['folder_managed', apps.length, 'Applications tracked', '#dashboard'],
         ['workspace_premium', apps.filter(x => ['Offer','Enrolled'].includes(x.status)).length, 'Offers received', '#dashboard'],
         ['flight_takeoff', vp.done + '/' + vp.total, 'Visa steps done', '#visa'],
         ['support_agent', consults.length, 'Consultations', '#mentors']]
        .map(([ic, n, l, href]) => `<a class="card" href="${href}" style="display:block">
          <span class="material-symbols-outlined" style="color:var(--route);font-size:22px">${ic}</span>
          <div style="font-size:1.7rem;font-weight:700;margin-top:8px">${n}</div>
          <div class="faint" style="font-size:12.5px">${l}</div></a>`).join('')}
    </div>

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

    <h2 style="font-size:1.3rem;margin:48px 0 16px">Consultation requests</h2>
    <div id="con-list">${consults.length ? consults.map(conRow).join('') :
      `<p class="muted" style="font-size:14px">No requests yet — when a step gets confusing, <a href="#mentors" style="color:var(--route)">a mentor who has done it</a> is one message away.</p>`}</div>

    <h2 style="font-size:1.3rem;margin:48px 0 16px">Saved opportunities</h2>
    <div class="card">${savedHtml}</div>`;

  function conRow(c) {
    const CS = PFStore.CONSULT_STATUSES;
    const m = PF_MENTORS.find(x => x.id === c.mentorId);
    return `<div class="card" style="margin-bottom:12px" data-con="${c.id}">
      <div style="display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;align-items:center">
        <div style="flex:1;min-width:200px">
          <strong style="font-size:14.5px">${m ? m.name : 'Mentor'}</strong>
          <div class="faint" style="font-size:12.5px">${PF_CONSULT_TOPICS[c.topic] || 'General'} · ${new Date(c.at).toLocaleDateString()}</div>
          ${c.note ? `<div class="muted" style="font-size:13px;margin-top:4px">${esc(c.note)}</div>` : ''}
        </div>
        <select class="field con-status-sel" style="width:auto;padding:8px 36px 8px 12px;font-size:13px">
          ${CS.map(s => `<option ${s === c.status ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <button class="btn btn-ghost btn-sm con-del" title="Delete"><span class="material-symbols-outlined" style="font-size:16px">delete</span></button>
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
  $('#con-list').addEventListener('change', e => {
    const sel = e.target.closest('.con-status-sel');
    if (!sel) return;
    PFStore.updateConsult(sel.closest('[data-con]').dataset.con, { status: sel.value });
    toast('Status updated');
  });
  $('#con-list').addEventListener('click', e => {
    const d = e.target.closest('.con-del');
    if (!d) return;
    PFStore.deleteConsult(d.closest('[data-con]').dataset.con);
    toast('Request removed');
    route();
  });
}

/* ── 6 · Starter Kit ────────────────────────────────────── */
function renderKit(main) {
  main.innerHTML = viewHead('package_2', 'PhD Starter Kit', 'Templates & resources',
    'Battle-tested templates for every stage — preview, copy, or download. Personalize everything: generic emails get deleted.') +
    `<div class="grid-2">${PF_TEMPLATES.map(t => `
      <div class="card">
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
      </div>`).join('')}
    </div>`;

}

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

/* ── 8 · Settle In ──────────────────────────────────────── */
function renderSettlement(main) {
  main.innerHTML = viewHead('luggage', 'Settle In', 'Your first months in New Zealand',
    'Arrival, banking, transport, housing, family — and a cost calculator so you know exactly how much to bring.') +
    `<div id="set-tabs" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:28px">
      ${PF_SETTLEMENT_CATS.map((c, i) => `<button class="chip-filter ${i === 0 ? 'active' : ''}" data-cat="${c.id}">${c.label}</button>`).join('')}
      <button class="chip-filter" data-cat="calc">Cost calculator</button>
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

  function paintCalc() {
    const prefs = PFStore.getCalcPrefs() || {};
    const cityId = prefs.city || 'akl';
    const status = prefs.status || 'single';
    $('#set-body').innerHTML = `
      <div class="card" style="max-width:760px">
        <div class="grid-2" style="margin-bottom:20px">
          <div><label class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em">City</label>
            <select class="field" id="cc-city" style="margin-top:5px">
              ${PF_CITY_COSTS.map(c => `<option value="${c.id}" ${c.id === cityId ? 'selected' : ''}>${c.city}</option>`).join('')}
            </select></div>
          <div><label class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em">Who's coming</label>
            <select class="field" id="cc-status" style="margin-top:5px">
              <option value="single" ${status === 'single' ? 'selected' : ''}>Just me</option>
              <option value="couple" ${status === 'couple' ? 'selected' : ''}>Me + partner</option>
              <option value="family" ${status === 'family' ? 'selected' : ''}>Family with children</option>
            </select></div>
        </div>
        <p class="faint" style="font-size:12px;margin-bottom:14px">Defaults are typical student costs — every figure below is editable.</p>
        <div class="grid-3" id="cc-assumptions"></div>
        <div class="cc-results">
          <div><span class="mono">Monthly living</span><strong id="cc-monthly">—</strong></div>
          <div><span class="mono">One-off setup</span><strong id="cc-setup">—</strong></div>
        </div>
        <div class="bar" style="margin-top:16px"><span id="cc-stipend-bar" style="width:0%"></span></div>
        <p class="faint" id="cc-verdict" style="font-size:12.5px;margin-top:8px"></p>
        <p class="faint" id="cc-note" style="font-size:12px;margin-top:14px;padding-top:12px;border-top:1px solid var(--line-soft)"></p>
        ${partnerRow('forex')}
      </div>`;

    const FIELDS = [
      ['rent', 'Rent · NZ$/week'], ['food', 'Food · NZ$/mo'], ['transport', 'Transport · NZ$/mo'],
      ['utilities', 'Utilities · NZ$/mo'], ['phone', 'Phone · NZ$/mo'], ['other', 'Other · NZ$/mo'],
    ];

    function defaults(c, st) {
      const m = PF_COST_MULT[st];
      return {
        rent: c.rentWeekly[st],
        food: Math.round(c.monthly.food * m),
        transport: c.monthly.transport,
        utilities: Math.round(c.monthly.utilities * (st === 'single' ? 1 : 1.25)),
        phone: c.monthly.phone,
        other: Math.round(c.monthly.other * m),
      };
    }

    function fill(vals) {
      $('#cc-assumptions').innerHTML = FIELDS.map(([k, lbl]) => `
        <div><label class="faint" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.08em">${lbl}</label>
          <input type="number" min="0" class="field" data-cc="${k}" value="${vals[k]}" style="margin-top:5px"></div>`).join('');
    }

    function compute() {
      const v = {};
      $$('#cc-assumptions [data-cc]').forEach(i => v[i.dataset.cc] = +i.value || 0);
      const c = PF_CITY_COSTS.find(x => x.id === $('#cc-city').value);
      const monthly = Math.round((v.rent * 52 / 12 + v.food + v.transport + v.utilities + v.phone + v.other) / 10) * 10;
      const setup = Math.round((c.setup.bondWeeks * v.rent + c.setup.furnishings + c.setup.misc) / 10) * 10;
      $('#cc-monthly').textContent = 'NZ$' + monthly.toLocaleString();
      $('#cc-setup').textContent = 'NZ$' + setup.toLocaleString();
      const STIPEND_HI = 2750; // NZ$33k/yr ÷ 12
      const over = monthly > STIPEND_HI;
      const bar = $('#cc-stipend-bar');
      bar.style.width = Math.min(100, Math.round(monthly / STIPEND_HI * 100)) + '%';
      bar.style.background = over ? 'var(--route)' : 'var(--pine)';
      $('#cc-verdict').textContent = over
        ? `Above the top doctoral stipend (NZ$28–33k/yr ≈ NZ$2,330–2,750/mo) — you'd need NZ$${(monthly - STIPEND_HI).toLocaleString()}/mo extra income (partner work, part-time) or lower rent.`
        : `Fits inside a typical doctoral stipend (NZ$28–33k/yr ≈ NZ$2,330–2,750/mo) with NZ$${(STIPEND_HI - monthly).toLocaleString()}/mo headroom at the top of the band.`;
      $('#cc-note').textContent = c.note + ' First flight + visa costs are not included here — see the Visa Hub.';
      PFStore.setCalcPrefs({ city: c.id, status: $('#cc-status').value, overrides: v });
    }

    function reset() {
      const c = PF_CITY_COSTS.find(x => x.id === $('#cc-city').value);
      fill(defaults(c, $('#cc-status').value));
      compute();
    }

    $('#cc-city').onchange = reset;
    $('#cc-status').onchange = reset;
    $('#cc-assumptions').addEventListener('input', compute);

    // restore saved assumptions when city+status match; else fresh defaults
    const c0 = PF_CITY_COSTS.find(x => x.id === cityId);
    if (prefs.overrides && prefs.city === cityId && prefs.status === status) {
      fill({ ...defaults(c0, status), ...prefs.overrides });
    } else {
      fill(defaults(c0, status));
    }
    compute();
  }

  $('#set-tabs').addEventListener('click', e => {
    const b = e.target.closest('.chip-filter');
    if (!b) return;
    $$('#set-tabs .chip-filter').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    b.dataset.cat === 'calc' ? paintCalc() : paintCards(b.dataset.cat);
  });
  paintCards(PF_SETTLEMENT_CATS[0].id);
}

/* ── 9 · Mentors ────────────────────────────────────────── */
function renderMentors(main) {
  const topic = hashQuery().topic || '';
  const matched = topic ? PF_MENTORS.filter(m => m.tags.includes(topic)) : PF_MENTORS;
  const list = matched.length ? matched : PF_MENTORS;
  const topicLabel = PF_CONSULT_TOPICS[topic];

  main.innerHTML = viewHead('support_agent', 'Mentors', 'Talk to someone who has done it',
    'Sri Lankan PhD students and graduates already in New Zealand. A 15-minute intro call is free — paid sessions cover visa files, proposals, flat-hunting, and family logistics.') +
    (topicLabel ? `<div class="card" style="border-color:var(--route);margin-bottom:24px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:16px 20px">
      <span style="font-size:14px">Showing mentors for: <strong>${topicLabel}</strong>${matched.length ? '' : ' — no exact match, showing everyone'}</span>
      <a class="btn btn-ghost btn-sm" href="#mentors" style="margin-left:auto">Clear</a>
    </div>` : '') +
    `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:28px">
      <a class="chip-filter ${!topic ? 'active' : ''}" href="#mentors">All topics</a>
      ${Object.entries(PF_CONSULT_TOPICS).map(([slug, lbl]) =>
        `<a class="chip-filter ${slug === topic ? 'active' : ''}" href="#mentors?topic=${slug}">${lbl}</a>`).join('')}
    </div>
    <div class="grid-2">${list.map(m => `
      <div class="card mentor-card" data-mentor="${m.id}">
        <div class="m-head">
          <div class="m-initials">${m.name.split(' ').map(w => w[0]).slice(0, 2).join('')}</div>
          <div><strong style="font-size:15px">${m.name}</strong>
            <div class="faint" style="font-size:12.5px">${uniById(m.uni).name} · ${m.city}</div></div>
        </div>
        <p class="muted" style="font-size:13.5px">${m.bio}</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">
          ${m.tags.map(t => `<span class="chip ${t === topic ? 'chip-rose' : 'chip-dim'}">${PF_CONSULT_TOPICS[t]}</span>`).join('')}
        </div>
        <table class="m-pkgs"><tbody>
          ${m.packages.map(p => `<tr><td>${p.name}</td><td>${p.price}</td></tr>`).join('')}
        </tbody></table>
        <div class="faint" style="font-family:var(--font-mono);font-size:10.5px;letter-spacing:.06em;margin:8px 0 14px">${m.langs} · ${m.availability}</div>
        <button class="btn btn-primary btn-sm m-request">Request a consultation</button>
        <div class="m-form hidden">
          <input class="field m-name" placeholder="Your name">
          <input class="field m-contact" placeholder="Your email or WhatsApp number">
          <textarea class="field m-note" rows="3" placeholder="One or two lines about where you're stuck (optional)"></textarea>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn btn-primary btn-sm m-send" data-mentor="${m.id}" data-topic="${topic}">Send request</button>
            ${m.calendly ? `<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${m.calendly}">Book on Calendly</a>` : ''}
            ${m.whatsapp ? `<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://wa.me/${m.whatsapp.replace(/\D/g, '')}">WhatsApp</a>` : ''}
          </div>
        </div>
      </div>`).join('')}
    </div>
    <div class="card" style="margin-top:28px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
      <span class="material-symbols-outlined" style="color:var(--route)">volunteer_activism</span>
      <p class="muted" style="flex:1;min-width:220px;font-size:13.5px;margin:0">Already doing your PhD in New Zealand? Mentor the next batch — set your own topics, availability, and rates.</p>
      <a class="btn btn-ghost btn-sm" href="mailto:${PF_CONFIG.contactEmail}?subject=${encodeURIComponent('PathFinder — become a mentor')}">Become a mentor</a>
    </div>`;
}

/* mentor request flow — delegated once */
document.addEventListener('click', e => {
  const req = e.target.closest('.m-request');
  if (req) {
    const form = req.closest('.mentor-card').querySelector('.m-form');
    form.classList.toggle('hidden');
    return;
  }
  const send = e.target.closest('.m-send');
  if (!send) return;
  const card = send.closest('.mentor-card');
  const mentor = PF_MENTORS.find(m => m.id === send.dataset.mentor);
  const name = card.querySelector('.m-name').value.trim();
  const contact = card.querySelector('.m-contact').value.trim();
  const note = card.querySelector('.m-note').value.trim();
  if (!name || !contact) return toast('Add your name and a way to reach you');
  const topic = send.dataset.topic || mentor.tags[0];
  PFStore.addConsultation({ mentorId: mentor.id, topic, note, name, contact });
  const topicLabel = PF_CONSULT_TOPICS[topic] || 'General guidance';
  const body = [`Mentor: ${mentor.name} (${mentor.city})`, `Topic: ${topicLabel}`,
                `Student: ${name}`, `Contact: ${contact}`, '', note,
                '', '— sent from the PathFinder app'].join('\n');
  location.href = `mailto:${PF_CONFIG.contactEmail}?subject=${encodeURIComponent(`PathFinder consultation — ${mentor.name} — ${topicLabel}`)}&body=${encodeURIComponent(body)}`;
  toast('Request saved — track it on your dashboard');
});

/* ── 10 · Admin panel (#admin) ──────────────────────────────
   Opened with a single password box. The password is the Firebase
   Email/Password admin login (see firebase-config.js) — so the data
   reads below are enforced by Firestore rules, not by client JS.
   Shows: overview analytics · leads · consultations · user records. */
let adminState = { tab: 'overview', leads: null, consults: null, users: null, loading: false, loaded: false, error: '' };

function renderAdmin(main) {
  // Firebase off entirely → nothing to administer.
  if (!window.PF_FIREBASE_CONFIG || !window.PF_FIREBASE_CONFIG.apiKey) {
    main.innerHTML = viewHead('admin_panel_settings', 'Admin', 'Admin panel unavailable',
      'Firebase is not configured. Paste your project config into <code>assets/js/firebase-config.js</code> and deploy <code>firestore.rules</code> to enable leads, consultations and user records here.');
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
    'Enter the admin password to view leads, consultation requests and user records.') +
    `<div class="card" style="max-width:420px">
      <label class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em">Password</label>
      <input class="field" id="adm-pw" type="password" autocomplete="current-password" placeholder="••••••••" style="margin-top:6px">
      <p class="faint" id="adm-msg" style="font-size:12.5px;margin-top:10px;min-height:16px"></p>
      <button class="btn btn-primary" id="adm-go" style="margin-top:4px;width:100%;justify-content:center">Sign in</button>
    </div>`;

  const pw = $('#adm-pw'), msg = $('#adm-msg'), go = $('#adm-go');
  async function submit() {
    const val = pw.value;
    if (!val) { msg.textContent = 'Enter the password.'; return; }
    go.disabled = true; msg.textContent = 'Checking…';
    try {
      await PFCloud.signInAdmin(val);
      adminState = { tab: 'overview', leads: null, consults: null, users: null, loading: false, loaded: false, error: '' };
      route();
    } catch (e) {
      go.disabled = false;
      msg.textContent = 'Incorrect password (or the admin account is not set up in Firebase yet).';
    }
  }
  go.onclick = submit;
  pw.onkeydown = e => { if (e.key === 'Enter') submit(); };
  pw.focus();
}

async function adminLoad() {
  if (adminState.loading) return;
  adminState.loading = true; adminState.error = '';
  // Each section loads independently — one failing read (e.g. a rules
  // gap) must not blank the others, and must never re-trigger a reload.
  const [l, c, u] = await Promise.allSettled([
    PFCloud.fetchLeads(), PFCloud.fetchConsultations(), PFCloud.fetchUsers(),
  ]);
  adminState.leads    = l.status === 'fulfilled' ? l.value : null;
  adminState.consults = c.status === 'fulfilled' ? c.value : null;
  adminState.users    = u.status === 'fulfilled' ? u.value : null;
  const failed = [l, c, u].filter(x => x.status === 'rejected');
  if (failed.length) console.warn('PathFinder admin: some reads failed —', failed.map(f => f.reason && f.reason.message));
  if (l.status === 'rejected' && c.status === 'rejected' && u.status === 'rejected') {
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
  const TABS = [['overview', 'Overview'], ['leads', 'Leads'], ['consults', 'Consultations'], ['users', 'User records']];
  const counts = {
    leads: adminState.leads ? adminState.leads.length : '·',
    consults: adminState.consults ? adminState.consults.length : '·',
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
    ({ overview: admOverview, leads: admLeads, consults: admConsults, users: admUsers })[adminState.tab](body);
  }

  $$('#adm-tabs .chip-filter[data-tab]').forEach(b => b.onclick = () => {
    adminState.tab = b.dataset.tab;
    $$('#adm-tabs .chip-filter').forEach(x => x.classList.toggle('active', x === b));
    paint();
  });
  $('#adm-refresh').onclick = async () => {
    adminState.loaded = false;
    adminState.leads = adminState.consults = adminState.users = null;
    body.innerHTML = `<div class="card"><p class="muted">Loading…</p></div>`;
    await adminLoad();
    route();
  };

  // consultation status changes — delegated once per render (body is
  // rebuilt by route(), so handlers never stack across tab switches)
  body.addEventListener('change', async e => {
    const sel = e.target.closest('.adm-cstatus');
    if (!sel) return;
    const id = sel.closest('[data-cdoc]').dataset.cdoc;
    sel.disabled = true;
    try {
      await PFCloud.updateConsultStatus(id, sel.value);
      const c = (adminState.consults || []).find(x => x.id === id);
      if (c) c.status = sel.value;
      toast('Status updated');
    } catch { toast('Update failed'); }
    sel.disabled = false;
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
  const open = (adminState.consults || []).filter(c => c.status === 'Requested').length;

  // field distribution from completed assessments
  const fields = {};
  users.forEach(u => { const f = u.data.assessment?.result?.field; if (f) fields[f] = (fields[f] || 0) + 1; });
  const fieldRows = Object.entries(fields).sort((a, b) => b[1] - a[1]);

  body.innerHTML = `
    <div class="grid-4" style="margin-bottom:28px">
      ${admMetric('mark_email_read', (adminState.leads || []).length, 'Email leads')}
      ${admMetric('support_agent', (adminState.consults || []).length, 'Consultation requests')}
      ${admMetric('hourglass_top', open, 'Open (Requested)')}
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

function admConsults(body) {
  if (adminState.consults === null) { body.innerHTML = admErrCard('consultations'); return; }
  const cons = adminState.consults;
  const CS = PFStore.CONSULT_STATUSES;
  body.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px">
      <p class="faint" style="font-size:12.5px;margin:0">${cons.length} request${cons.length === 1 ? '' : 's'}</p>
      ${cons.length ? `<button class="btn btn-ghost btn-sm" id="adm-dl-cons"><span class="material-symbols-outlined" style="font-size:15px">download</span> Export CSV</button>` : ''}
    </div>
    ${cons.length ? cons.map(c => {
      const m = PF_MENTORS.find(x => x.id === c.mentorId);
      return `<div class="card" style="margin-bottom:12px" data-cdoc="${c.id}">
        <div style="display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;align-items:flex-start">
          <div style="flex:1;min-width:220px">
            <strong style="font-size:14.5px">${esc(c.name || 'Unknown')}</strong>
            <span class="faint" style="font-size:12.5px"> · ${esc(c.contact || 'no contact')}</span>
            <div class="faint" style="font-size:12.5px;margin-top:2px">
              ${m ? esc(m.name) : 'Mentor'} · ${PF_CONSULT_TOPICS[c.topic] || 'General'} · ${c.at ? new Date(c.at).toLocaleDateString() : ''}
            </div>
            ${c.note ? `<div class="muted" style="font-size:13px;margin-top:6px">${esc(c.note)}</div>` : ''}
          </div>
          <select class="field adm-cstatus" style="width:auto;padding:8px 36px 8px 12px;font-size:13px">
            ${CS.map(s => `<option ${s === c.status ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>`;
    }).join('') : `<div class="card"><p class="muted" style="font-size:14px">No consultation requests yet.</p></div>`}`;

  const dl = $('#adm-dl-cons', body);
  if (dl) dl.onclick = () => csvDownload('pathfinder-consultations.csv',
    ['name', 'contact', 'mentorId', 'topic', 'status', 'note', 'at'], cons);
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
