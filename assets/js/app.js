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
  mentor:     renderMentor,
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
  const cls = { none:'chip-dim', requested:'chip-gold', paid:'chip-teal' };
  const lbl = { none:'No payment', requested:'Payment requested', paid:'Paid' };
  const amt = ps !== 'none' && payment && payment.amountLKR
    ? ` · LKR ${Number(payment.amountLKR).toLocaleString()}` : '';
  return `<span class="chip ${cls[ps]}">${lbl[ps]}${amt}</span>`;
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

/* ── 5 · Dashboard (saved + tracker) ────────────────────── */
function renderDashboard(main) {
  const a = PFStore.getAssessment();
  const saved = PFStore.getSaved();
  const apps = PFStore.getApps();
  const ST = PFStore.APP_STATUSES;
  const vp = visaProgress();
  const reqs = PFStore.getMentorRequests().slice().reverse();

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
         ['support_agent', reqs.length, 'Mentor requests', '#mentors?tab=mine']]
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
      </div>

      <div class="card" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
        <span class="material-symbols-outlined" style="color:var(--route)">volunteer_activism</span>
        <p class="muted" style="flex:1;min-width:220px;font-size:13.5px;margin:0">Already doing your PhD in New Zealand? Mentor the next batch — set your own fields and availability, take requests when you have time.</p>
        <a class="btn btn-ghost btn-sm" href="#mentor">Become a mentor</a>
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
    if (window.PFCloud && PFCloud.isSignedIn()) {
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
  const payable = r.status === 'awaiting_payment' && r.payment && r.payment.paymentStatus === 'requested';
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
      <p class="muted" style="font-size:13px;margin:0 0 10px">Your free ${PF_CONFIG.freeIntroMinutes}-minute intro is done. To continue with a paid follow-on session (LKR ${Number(r.payment.amountLKR).toLocaleString()}), pay securely below — then your mentor confirms and books the session.</p>
      <button class="btn btn-primary btn-sm pay-now" data-req="${r.id}" style="width:100%;justify-content:center">
        <span class="material-symbols-outlined" style="font-size:16px">lock</span>
        Pay securely (Cards, HelaPay, eZ Cash, Genie &amp; more — via PayHere)
      </button>
    </div>` : ''}
  </div>`;
}

/* student "Pay securely" → opens PayHere hosted checkout (Tier 1) */
document.addEventListener('click', e => {
  const b = e.target.closest('.pay-now');
  if (!b) return;
  const r = reqCache.get(b.dataset.req);
  if (!r) return;
  if (!PFPayHere.openCheckout(r)) {
    toast('Payment isn’t set up yet — your mentor will share a link.');
  }
});

/* ── 9b · Mentor Dashboard (#mentor) ─────────────────────────
   Sign up / apply → pending review → (admin approves) → claim queue.
   Visually a sibling of #admin: same chip-filter tabs, cards, ledgers. */
let mentorState = { tab: 'open', open: null, claimed: null, loading: false, loaded: false };

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
  return mentorApply(main);
}

function mentorApply(main) {
  const signedIn = PFCloud.isSignedIn();
  main.innerHTML = viewHead('support_agent', 'Mentor Dashboard', 'Become a mentor',
    'You’ve made the move — help the next batch make it too. Create an account, tell us what you can help with, and we’ll review your application.') +
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
    actions = `<button class="btn btn-ghost btn-sm mt-checkout" data-req="${r.id}">Preview PayHere link</button>
      <button class="btn btn-primary btn-sm mt-paid" data-req="${r.id}">Mark payment received</button>`;
  } else if (r.status === 'paid') {
    actions = `<button class="btn btn-primary btn-sm mt-complete" data-req="${r.id}">Mark session completed</button>`;
  }
  const canCancel = !['paid', 'completed', 'cancelled'].includes(r.status);
  return `<div class="card" style="margin-bottom:12px" data-req="${r.id}">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
      <div style="flex:1;min-width:200px">
        <strong style="font-size:14.5px">${esc(r.name || 'Student')}</strong>
        <span class="faint" style="font-size:12.5px"> · ${esc(r.contact || 'no contact')}</span>
        <div class="faint" style="font-size:12.5px;margin-top:2px">${PF_CONSULT_TOPICS[r.topic] || 'General guidance'} · ${r.at ? new Date(r.at).toLocaleDateString() : ''}</div>
        ${r.note ? `<div class="muted" style="font-size:13px;margin-top:6px">${esc(r.note)}</div>` : ''}
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
      if ((location.hash || '').slice(1).split('?')[0] === 'mentor') { mentorState.loaded = false; route(); }
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
let adminState = { tab: 'overview', leads: null, mentors: null, requests: null, users: null, loading: false, loaded: false, error: '' };

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
    'Enter the admin password to view leads, mentors, requests and user records.') +
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
      adminState = { tab: 'overview', leads: null, mentors: null, requests: null, users: null, loading: false, loaded: false, error: '' };
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
  const [l, m, r, u] = await Promise.allSettled([
    PFCloud.fetchLeads(), PFCloud.fetchMentors(), PFCloud.fetchAllRequests(), PFCloud.fetchUsers(),
  ]);
  adminState.leads    = l.status === 'fulfilled' ? l.value : null;
  adminState.mentors  = m.status === 'fulfilled' ? m.value : null;
  adminState.requests = r.status === 'fulfilled' ? r.value : null;
  adminState.users    = u.status === 'fulfilled' ? u.value : null;
  const settled = [l, m, r, u];
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
  const TABS = [['overview', 'Overview'], ['leads', 'Leads'], ['mentors', 'Mentors'], ['requests', 'Requests'], ['users', 'User records']];
  const counts = {
    leads: adminState.leads ? adminState.leads.length : '·',
    mentors: adminState.mentors ? adminState.mentors.length : '·',
    requests: adminState.requests ? adminState.requests.length : '·',
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
    ({ overview: admOverview, leads: admLeads, mentors: admMentors, requests: admRequests, users: admUsers })[adminState.tab](body);
  }

  $$('#adm-tabs .chip-filter[data-tab]').forEach(b => b.onclick = () => {
    adminState.tab = b.dataset.tab;
    $$('#adm-tabs .chip-filter').forEach(x => x.classList.toggle('active', x === b));
    paint();
  });
  $('#adm-refresh').onclick = async () => {
    adminState.loaded = false;
    adminState.leads = adminState.mentors = adminState.requests = adminState.users = null;
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
      ${admMetric('paid', 'LKR ' + paidTotal.toLocaleString(), 'Paid this period')}
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
