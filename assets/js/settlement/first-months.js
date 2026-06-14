/* ════════════════════════════════════════════════════════════
   PathFinder — "Your first months in NZ" simulator (Settlement Part A)

   A step-through of the first ~90 days. Part B (Funds Planner) supplies
   the assumptions — starting balance and recurring costs; Part A tells
   the story over time. A live balance gauge (3D tank + 2D bar fallback)
   drains as one-off and recurring costs accrue; partner income (from
   Part B) tops it back up. Existing PF_SETTLEMENT content is re-presented
   temporally, and tight-balance moments surface a mentor hook. The
   housing milestone is the literal Settlement → Viewing → Mentor path.

   Classic script — exposes window.PFFirstMonths (see app.js header note).
   ════════════════════════════════════════════════════════════ */

window.PFFirstMonths = (() => {
  const nz = n => 'NZ$' + Math.round(n).toLocaleString();
  const setItem = id => PF_SETTLEMENT.find(s => s.id === id);

  /* the day-by-day milestones, costed from the active plan */
  function milestones(plan) {
    const s = plan.c.setup;
    const hasPartner = plan.partnerIncome > 0;
    return [
      { day:0,  icon:'flight_land',     title:'You land in ' + plan.c.city, cost:25,
        set:'set1', consult:'settle-arrival', what:'Airport → your accommodation. Know the cheap route before you land.' },
      { day:0,  icon:'sim_card',        title:'SIM card on day one', cost:30,
        set:'set2', consult:'settle-arrival', what:'Get connected before leaving the airport — maps, banking, calling home.' },
      { day:2,  icon:'account_balance', title:'Open a bank account', cost:0,
        set:'set4', consult:'settle-banking', what:'Verify the account you pre-opened from Sri Lanka. No cost, but everything downstream needs it.' },
      { day:3,  icon:'badge',           title:'IRD number', cost:0,
        set:'set5', consult:'settle-banking', what:'Your tax ID — nothing pays you without it. Free, ~2 working days.' },
      { day:5,  icon:'directions_bus',  title:'Transit card + first top-up', cost:30,
        set:'set7', consult:'settle-arrival', what:'Register the card with your student email for the concession fare.' },
      { day:10, icon:'home_work',       title:'Bond + first rent', cost:Math.round(plan.bondAmount),
        set:'set9', consult:'settle-housing', housing:true,
        what:'The big one. Bond is up to 4 weeks’ rent (refundable, lodged with Tenancy Services) plus rent in advance.' },
      { day:14, icon:'chair',           title:'Furnishing your place', cost:s.furnishings + s.misc,
        set:'set9', consult:'settle-housing', what:'Bed, desk, kitchen basics. TradeMe second-hand keeps this down.' },
      { day:30, icon:'work',            title: hasPartner ? 'Partner starts work' : 'One month in', cost:0,
        set:'set11', consult:'settle-family', incomeStart:true,
        what: hasPartner ? 'Partner’s open work visa income starts flowing — your budget changes completely.' : 'The setup rush is over. From here it’s mostly recurring costs.' },
      { day:60, icon:'event_available', title:'Two months in', cost:0,
        what:'Routine has set in. Good moment to re-check your budget against reality.' },
      { day:90, icon:'self_improvement',title:'You’ve found your rhythm', cost:0,
        what:'Three months down. You know the buses, the cheap supermarket, your people.' },
    ];
  }

  function balanceAt(day, plan, ms) {
    let bal = plan.totalNeeded;                       // funds you arrived with
    bal -= (plan.monthly / 30) * day;                 // recurring living costs
    ms.forEach(m => { if (m.day <= day) bal -= m.cost; });
    if (plan.partnerIncome > 0) bal += (plan.partnerIncome / 30) * Math.max(0, day - 30);
    return bal;
  }

  function render(container) {
    const plan = PFFunds.activePlan();
    const ms = milestones(plan);
    const start = plan.totalNeeded;
    const saved = PFStore.getFirstMonthsProgress();
    let day = saved && typeof saved.day === 'number' ? Math.max(0, Math.min(90, saved.day)) : 0;
    let scene = null;

    const idxForDay = d => { let i = 0; ms.forEach((m, k) => { if (m.day <= d) i = k; }); return i; };

    container.innerHTML = `
      ${plan.personalised ? '' : `<div class="fm-prompt">
        <span class="material-symbols-outlined" style="font-size:16px;color:var(--ochre)">info</span>
        <span>Using the <strong>${plan.c.city} · just me</strong> baseline. <a href="#settlement" data-go-planner>Open the Funds planner</a> to personalise these numbers.</span>
      </div>`}

      <div class="card fm-card">
        <div class="fm-top">
          <div class="fm-gauge">
            <div class="mono" style="margin-bottom:8px">Funds remaining</div>
            <canvas id="fm-canvas" class="fm-canvas" role="img"
              aria-label="A draining tank showing funds remaining versus the funds you arrived with. The figures are shown below."></canvas>
            <div class="fm-balance" id="fm-balance"></div>
            <div class="bar fm-bar" style="margin-top:8px"><span id="fm-bar-span"></span></div>
            <div class="faint" id="fm-arrived" style="font-size:11.5px;margin-top:6px"></div>
          </div>

          <div class="fm-control">
            <div class="fm-day-head">
              <span class="mono">Day <span id="fm-daynum">0</span> of 90</span>
              <div class="fm-steps">
                <button class="btn btn-ghost btn-sm" id="fm-prev" aria-label="Previous milestone"><span class="material-symbols-outlined" style="font-size:16px">chevron_left</span></button>
                <button class="btn btn-ghost btn-sm" id="fm-next" aria-label="Next milestone">Next <span class="material-symbols-outlined" style="font-size:16px">chevron_right</span></button>
              </div>
            </div>
            <input type="range" id="fm-slider" class="bp-slider" min="0" max="90" step="1" value="${day}"
              aria-label="Day after arrival" style="margin-top:14px">
            <div id="fm-active"></div>
          </div>
        </div>
      </div>

      <div class="timeline fm-timeline" id="fm-timeline"></div>

      <p class="fp-disclaimer">A simulation from your Funds planner figures — indicative only. Data last verified ${PF_CONFIG.dataVerified}. Confirm costs with the university and Immigration New Zealand.</p>`;

    const $a = sel => container.querySelector(sel);

    function activeCard() {
      const i = idxForDay(day);
      const m = ms[i];
      const bal = balanceAt(day, plan, ms);
      const tight = bal < start * 0.2;
      const si = m.set ? setItem(m.set) : null;

      let extra = '';
      if (m.housing) {
        // Settlement → Viewing → Mentor: the literal click-path
        const proxy = setItem('set10');
        const mentor = PF_MENTORS.find(mn => mn.city === plan.c.city && mn.packages.some(p => /viewing|proxy|flat/i.test(p.name)))
                    || PF_MENTORS.find(mn => mn.packages.some(p => /viewing|proxy|flat/i.test(p.name)));
        extra = `<div class="fm-housing">
          <strong style="font-size:13.5px"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;color:var(--sea)">real_estate_agent</span> Can’t view a flat from Colombo?</strong>
          <p class="muted" style="font-size:13px;margin:6px 0 8px">${proxy.body}</p>
          <ul class="tl-list" style="margin:0 0 10px">${proxy.tips.map(t => `<li style="font-size:13px">${t}</li>`).join('')}</ul>
          <a class="btn btn-ghost btn-sm" href="#mentors?topic=settle-housing">
            <span class="material-symbols-outlined" style="font-size:15px">support_agent</span>
            ${mentor ? `Ask ${mentor.name.split(' ')[0]} to view a flat (${mentor.city})` : 'Find a mentor to view a flat'}
          </a>
        </div>`;
      }

      const tightNote = tight ? `<div class="fm-tight">
        <span class="material-symbols-outlined" style="font-size:16px;color:var(--route)">savings</span>
        <span>Funds are getting tight around here — many students top up with partner work, part-time work, or a scholarship advance.</span>
      </div>${consultCTA('settle-banking')}` : '';

      $a('#fm-active').innerHTML = `
        <div class="fm-active-card">
          <div class="fm-active-head">
            <span class="material-symbols-outlined" style="color:var(--route)">${m.icon}</span>
            <strong style="font-size:15px">${m.title}</strong>
            ${m.cost ? `<span class="chip chip-rose" style="margin-left:auto">−${nz(m.cost)}</span>` : `<span class="chip chip-dim" style="margin-left:auto">no cost</span>`}
          </div>
          <p class="muted" style="font-size:13.5px;margin-top:8px">${m.what}</p>
          ${si && (si.tips || si.perCity) ? `<button class="fm-expand" data-expand>
            <span class="material-symbols-outlined" style="font-size:16px">unfold_more</span> Show the full guide for this step</button>
            <div class="fm-detail hidden">
              ${si.tips ? `<ul class="tl-list">${si.tips.map(t => `<li style="font-size:13px">${t}</li>`).join('')}</ul>` : ''}
              ${si.perCity ? `<p class="muted" style="font-size:13px;margin-top:8px"><strong>${plan.c.city}:</strong> ${si.perCity[plan.c.city] || Object.values(si.perCity)[0]}</p>` : ''}
            </div>` : ''}
          ${extra}
          ${tightNote}
          ${m.consult && !tight ? consultCTA(m.consult) : ''}
        </div>`;

      const ex = $a('[data-expand]');
      if (ex) ex.onclick = () => $a('.fm-detail').classList.toggle('hidden');
    }

    function paintTimeline() {
      const i = idxForDay(day);
      $a('#fm-timeline').innerHTML = ms.map((m, k) => `
        <div class="tl-phase fm-phase ${k === i ? 'fm-on' : ''}" data-ms="${k}">
          <div class="tl-node"><span>${m.day}</span></div>
          <button class="card tl-card fm-node-card" data-ms="${k}">
            <div style="display:flex;align-items:center;gap:10px">
              <span class="material-symbols-outlined" style="font-size:18px;color:${k === i ? 'var(--route)' : 'var(--ink-faint)'}">${m.icon}</span>
              <strong style="font-size:14px">${m.title}</strong>
              ${m.cost ? `<span class="mono" style="margin-left:auto;color:var(--route)">−${nz(m.cost)}</span>` : ''}
            </div>
          </button>
        </div>`).join('');
    }

    function update() {
      const bal = balanceAt(day, plan, ms);
      const frac = Math.max(0, Math.min(1, bal / start));
      $a('#fm-daynum').textContent = day;
      $a('#fm-slider').value = day;
      $a('#fm-balance').innerHTML = `<strong style="color:${bal < 0 ? 'var(--route)' : 'var(--ink)'}">${bal < 0 ? '−' : ''}${nz(Math.abs(bal))}</strong>`;
      $a('#fm-arrived').textContent = `Arrived with ${nz(start)} · ${Math.round(frac * 100)}% remaining${bal < 0 ? ' — income needed to continue' : ''}`;
      const span = $a('#fm-bar-span');
      span.style.width = (frac * 100) + '%';
      span.style.background = bal < 0 ? 'var(--route)' : (frac < 0.2 ? 'var(--ochre)' : 'var(--pine)');
      activeCard();
      paintTimeline();
      PFStore.setFirstMonthsProgress({ day });
      if (scene) scene.update();
    }

    function goIdx(i) { i = Math.max(0, Math.min(ms.length - 1, i)); day = ms[i].day; update(); }

    $a('#fm-prev').onclick = () => goIdx(idxForDay(day) - 1);
    $a('#fm-next').onclick = () => goIdx(idxForDay(day) + 1);
    $a('#fm-slider').addEventListener('input', e => { day = +e.target.value; update(); });
    $a('#fm-timeline').addEventListener('click', e => {
      const b = e.target.closest('[data-ms]');
      if (b) goIdx(+b.dataset.ms);
    });
    const goPlanner = $a('[data-go-planner]');
    if (goPlanner) goPlanner.onclick = e => { e.preventDefault(); if (window.PFOpenSettleTab) window.PFOpenSettleTab('funds-planner'); };

    // 3D tank gauge (progressive) — 2D bar is always present
    if (PFScene3D.supported()) {
      scene = PFScene3D.mountTank($a('#fm-canvas'), () => {
        const bal = balanceAt(day, plan, ms);
        return { fraction: bal / start, over: bal < 0 };
      });
    } else {
      $a('#fm-canvas').classList.add('hidden');
    }

    update();
  }

  return { render };
})();
