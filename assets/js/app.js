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
};

function route() {
  const view = (location.hash || '#dashboard').slice(1).split('?')[0];
  const fn = ROUTES[view] || renderDashboard;
  $$('.side-link').forEach(a => a.classList.toggle('active', a.dataset.view === view));
  const main = $('#view');
  main.innerHTML = '';
  fn(main);
  main.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }],
    { duration: 350, easing: 'cubic-bezier(.22,1,.36,1)' });
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', route);

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
  phases.push({ when: 'Months 2–4', title: 'Supervisor Discovery', color: 'violet', items: [
    r ? `Shortlist 8–10 supervisors in ${r.field} across your ${r.unis.length} matched universities` : 'Shortlist 8–10 supervisors across NZ universities',
    'Send personalized first-contact emails (template in Starter Kit) — expect a 20–30% reply rate',
    'Track every contact in your Application Dashboard',
  ]});
  phases.push({ when: 'Months 3–6', title: 'Proposal & Application', color: 'gold', items: [
    'Draft a 4–6 page research proposal with your interested supervisor’s feedback',
    'Gather transcripts (certified), 2–3 referee letters, and degree certificates',
    'Submit university applications (free at most NZ universities for PhD)',
    r && r.funding !== 'self' ? 'Apply for doctoral scholarships in the same cycle — most are automatic with admission' : 'Prepare evidence of funds (~NZ$20,000/yr living costs + fees)',
  ]});
  phases.push({ when: 'Months 6–9', title: 'Offer & Visa', color: 'rose', items: [
    'Receive offer of place (+ scholarship outcome)',
    'Apply for the Student Visa via Immigration NZ eVisa — allow 6–8 weeks',
    'Medical & chest X-ray at an INZ-approved panel physician in Colombo',
    'Book flights, arrange first-month accommodation through your university',
  ]});
  phases.push({ when: 'Month 9+', title: 'Arrival & Enrollment', color: 'teal', items: [
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
         ['workspace_premium', apps.filter(x => ['Offer','Enrolled'].includes(x.status)).length, 'Offers received', '#dashboard']]
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

    <h2 style="font-size:1.3rem;margin:48px 0 16px">Saved opportunities</h2>
    <div class="card">${savedHtml}</div>`;

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
}

/* ── 6 · Starter Kit ────────────────────────────────────── */
function renderKit(main) {
  const categories = [...new Set(PF_TEMPLATES.map(t => t.category))];
  const tplCard = t => `
    <div class="card">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
        <div style="width:40px;height:40px;border-radius:11px;background:var(--teal-soft);display:flex;align-items:center;justify-content:center;flex-shrink:0">
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

  main.innerHTML = viewHead('package_2', 'PhD Starter Kit', 'Templates & resources',
    '19 battle-tested templates across every stage — emails, documents, planning, and logistics. Preview, copy, or download. Personalise everything: generic emails get deleted.') +
    categories.map(cat => `
      <div style="margin-bottom:48px">
        <div style="display:flex;align-items:center;gap:14px;padding-top:18px;border-top:1px solid var(--ink);margin-bottom:22px">
          <span class="mono" style="color:var(--route);font-weight:600;font-size:12px">${cat.toUpperCase()}</span>
        </div>
        <div class="grid-2">${PF_TEMPLATES.filter(t => t.category === cat).map(tplCard).join('')}</div>
      </div>`).join('');
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
