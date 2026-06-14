/* ════════════════════════════════════════════════════════════
   PathFinder — Funds & Cost Planner (Settlement Part B)

   Evolves the original cost calculator: monthly living cost PLUS the
   headline "total funds to arrange before departure", benchmark bars
   (INZ minimum · doctoral stipend band · partner income), a weekly/
   monthly toggle, a 3D cost "skyline" with a guaranteed 2D fallback,
   and saved named scenarios. The shared computePlan() is the single
   source of truth the First-Months simulator (Part A) also reads from.

   Classic script — exposes window.PFFunds (see app.js header note).
   ════════════════════════════════════════════════════════════ */

window.PFFunds = (() => {
  const WK_PER_MO = 52 / 12;            // weeks → months conversion
  const CAT_META = [                    // order + palette token + icon
    { key:'rent',      label:'Rent',      token:'route',  icon:'home' },
    { key:'food',      label:'Food',      token:'pine',   icon:'restaurant' },
    { key:'transport', label:'Transport', token:'sea',    icon:'directions_bus' },
    { key:'utilities', label:'Utilities', token:'ochre',  icon:'bolt' },
    { key:'phone',     label:'Phone',     token:'ink',    icon:'smartphone' },
    { key:'other',     label:'Other',     token:'paper2', icon:'category' },
  ];

  /* token → a CSS colour for the 2D bars (3D reads the same tokens live) */
  const cssVar = t => ({ route:'var(--route)', pine:'var(--pine)', sea:'var(--sea)',
    ochre:'var(--ochre)', ink:'var(--ink-faint)', paper2:'var(--line-2)' }[t] || 'var(--ink)');

  const nz = n => 'NZ$' + Math.round(n).toLocaleString();
  const lkr = n => 'LKR ' + Math.round(n * PF_CONFIG.nzdToLkr).toLocaleString();
  const round10 = n => Math.round(n / 10) * 10;

  /* default assumptions for a city + household (mirrors the original calc) */
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

  /* THE shared model — Part A and the saved-scenario compare both call this.
     `partner` = { on, rate, hours }. Returns everything the UI needs. */
  function computePlan(cityId, status, overrides, partner) {
    const c = PF_CITY_COSTS.find(x => x.id === cityId) || PF_CITY_COSTS[0];
    const v = { ...defaults(c, status), ...(overrides || {}) };
    const rentMonthly = v.rent * WK_PER_MO;
    const categories = CAT_META.map(meta => ({
      ...meta,
      monthly: meta.key === 'rent' ? rentMonthly : (+v[meta.key] || 0),
    }));
    const monthly = round10(categories.reduce((s, x) => s + x.monthly, 0));
    const setup = round10(c.setup.bondWeeks * v.rent + c.setup.furnishings + c.setup.misc);
    const buffer = monthly;                                 // one safety month
    const totalNeeded = round10(setup + monthly + buffer);  // bring/arrange before departure

    const p = partner || {};
    const partnerIncome = (p.on && status !== 'single')
      ? round10((+p.rate || 0) * (+p.hours || 0) * WK_PER_MO) : 0;

    return { c, status, v, categories, monthly, setup, buffer, totalNeeded,
             rentMonthly, partnerIncome, bondAmount: c.setup.bondWeeks * v.rent };
  }

  /* the plan currently in play — Part A defaults to this when the user
     hasn't personalised the planner yet (Christchurch · single baseline) */
  function activePlan() {
    const prefs = PFStore.getCalcPrefs();
    if (prefs && prefs.city) {
      const plan = computePlan(prefs.city, prefs.status || 'single', prefs.overrides, prefs.partner);
      return { ...plan, weekly: !!prefs.weekly, personalised: true };
    }
    return { ...computePlan('chc', 'single', null, null), weekly: false, personalised: false };
  }

  /* a money cell: NZD primary + indicative LKR secondary line */
  const moneyCell = (n, weekly) => {
    const val = weekly ? n / WK_PER_MO : n;
    return `<strong>${nz(val)}</strong><span class="fp-lkr">${lkr(val)}${weekly ? ' /wk' : ' /mo'}</span>`;
  };

  /* ── Render (Part B) ─────────────────────────────────────── */
  function render(container) {
    const prefs = PFStore.getCalcPrefs() || {};
    let cityId = prefs.city || 'akl';
    let status = prefs.status || 'single';
    let weekly = !!prefs.weekly;
    let partner = prefs.partner || { on: false, rate: PF_CONFIG.minWageHourly, hours: 30 };
    let scene = null;

    container.innerHTML = `
      <div class="card fp-card">
        <div class="grid-2" style="margin-bottom:18px">
          <div><label class="faint fp-lbl" for="fp-city">City</label>
            <select class="field" id="fp-city" style="margin-top:5px">
              ${PF_CITY_COSTS.map(c => `<option value="${c.id}" ${c.id === cityId ? 'selected' : ''}>${c.city}</option>`).join('')}
            </select></div>
          <div><label class="faint fp-lbl" for="fp-status">Who's coming</label>
            <select class="field" id="fp-status" style="margin-top:5px">
              <option value="single" ${status === 'single' ? 'selected' : ''}>Just me</option>
              <option value="couple" ${status === 'couple' ? 'selected' : ''}>Me + partner</option>
              <option value="family" ${status === 'family' ? 'selected' : ''}>Family with children</option>
            </select></div>
        </div>

        <div class="fp-toggle-row">
          <p class="faint" style="font-size:12px;margin:0">Defaults are typical student costs — every figure is editable.</p>
          <div class="fp-toggle" role="group" aria-label="Show figures per month or per week">
            <button type="button" class="fp-tg ${weekly ? '' : 'on'}" data-wk="0" aria-pressed="${!weekly}">Monthly</button>
            <button type="button" class="fp-tg ${weekly ? 'on' : ''}" data-wk="1" aria-pressed="${weekly}">Weekly</button>
          </div>
        </div>

        <div class="grid-3" id="fp-assumptions" style="margin-top:16px"></div>

        <div id="fp-partner"></div>

        <!-- headline outputs -->
        <div class="fp-results">
          <div class="fp-result">
            <span class="mono">Monthly living cost</span>
            <div id="fp-monthly" class="fp-money"></div>
          </div>
          <div class="fp-result fp-result-hero">
            <span class="mono"><span class="tick">●</span> Funds to arrange before departure</span>
            <div id="fp-total" class="fp-money"></div>
            <span class="faint" id="fp-total-break" style="font-size:11.5px"></span>
          </div>
        </div>

        <!-- benchmarks -->
        <div id="fp-bench" class="fp-bench"></div>

        <!-- breakdown: 3D skyline (progressive) + guaranteed 2D table -->
        <div class="fp-viz">
          <div class="fp-viz-3d">
            <div class="mono" style="margin-bottom:8px">Cost breakdown</div>
            <canvas id="fp-canvas" class="fp-canvas" role="img"
              aria-label="3D bar chart of monthly costs by category. The same figures are in the table beside it."></canvas>
          </div>
          <div class="fp-viz-2d">
            <table class="ledger fp-breakdown"><tbody id="fp-bars"></tbody></table>
          </div>
        </div>

        <div id="fp-consult"></div>

        <!-- save / compare scenarios -->
        <div class="fp-save">
          <label class="faint fp-lbl" for="fp-name">Save this plan to compare options</label>
          <div class="fp-save-row">
            <input class="field" id="fp-name" placeholder="e.g. Christchurch · single" style="margin-top:5px">
            <button class="btn btn-primary btn-sm" id="fp-save">Save plan</button>
          </div>
          <div id="fp-plans"></div>
        </div>

        <p class="faint fp-note" id="fp-note"></p>
        ${partnerRow('forex')}
        <p class="fp-disclaimer">Data last verified ${PF_CONFIG.dataVerified} — figures are indicative, always confirm with the university and Immigration New Zealand. LKR shown at an indicative rate of 1 NZD ≈ ${PF_CONFIG.nzdToLkr} LKR.</p>
      </div>`;

    const $a = sel => container.querySelector(sel);

    function fillAssumptions(v) {
      const LABELS = { rent:'Rent · NZ$/week', food:'Food · NZ$/mo', transport:'Transport · NZ$/mo',
        utilities:'Utilities · NZ$/mo', phone:'Phone · NZ$/mo', other:'Other · NZ$/mo' };
      $a('#fp-assumptions').innerHTML = Object.keys(LABELS).map(k => `
        <div><label class="faint fp-lbl" for="fp-in-${k}">${LABELS[k]}</label>
          <input type="number" min="0" inputmode="numeric" class="field" id="fp-in-${k}" data-cc="${k}" value="${v[k]}" style="margin-top:5px"></div>`).join('');
    }

    function readInputs() {
      const v = {};
      container.querySelectorAll('#fp-assumptions [data-cc]').forEach(i => v[i.dataset.cc] = +i.value || 0);
      return v;
    }

    function renderPartner() {
      const host = $a('#fp-partner');
      if (status === 'single') { host.innerHTML = ''; partner.on = false; return; }
      host.innerHTML = `
        <label class="fp-check">
          <input type="checkbox" id="fp-partner-on" ${partner.on ? 'checked' : ''}>
          <span class="ck-box"><span class="material-symbols-outlined" style="font-size:13px">check</span></span>
          <span>My partner expects to work (open work visa)</span>
        </label>
        <div class="grid-2 ${partner.on ? '' : 'hidden'}" id="fp-partner-fields" style="margin-top:10px">
          <div><label class="faint fp-lbl" for="fp-rate">Partner pay · NZ$/hour</label>
            <input type="number" min="0" step="0.05" class="field" id="fp-rate" value="${partner.rate}" style="margin-top:5px">
            <span class="faint" style="font-size:11px">Min wage is NZ$${PF_CONFIG.minWageHourly}/hr — edit to your estimate</span></div>
          <div><label class="faint fp-lbl" for="fp-hours">Hours · per week</label>
            <input type="number" min="0" max="60" class="field" id="fp-hours" value="${partner.hours}" style="margin-top:5px"></div>
        </div>`;
      $a('#fp-partner-on').onchange = e => { partner.on = e.target.checked; $a('#fp-partner-fields').classList.toggle('hidden', !partner.on); compute(); };
      const r = $a('#fp-rate'), h = $a('#fp-hours');
      if (r) r.oninput = () => { partner.rate = +r.value || 0; compute(); };
      if (h) h.oninput = () => { partner.hours = +h.value || 0; compute(); };
    }

    /* one benchmark bar — colour-coded AND text/icon-labelled (a11y) */
    function benchRow(label, value, mark, markLabel, goodUnder, help) {
      const ratio = mark > 0 ? Math.min(1, value / mark) : 0;
      const over = goodUnder ? value > mark : value < mark;
      const pct = Math.round((value / mark) * 100);
      return `<div class="fp-bench-row">
        <div class="fp-bench-head">
          <span class="material-symbols-outlined" style="font-size:15px;color:${over ? 'var(--route)' : 'var(--pine)'}">${over ? 'error' : 'check_circle'}</span>
          <strong style="font-size:13px">${label}</strong>
          <span class="faint mono" style="margin-left:auto;font-size:10.5px">${markLabel}</span>
        </div>
        <div class="bar" style="margin-top:8px"><span style="width:${Math.min(100, ratio * 100)}%;background:${over ? 'var(--route)' : 'var(--pine)'}"></span></div>
        <p class="faint" style="font-size:11.5px;margin-top:5px">${help} <span class="mono">(${pct}%)</span></p>
      </div>`;
    }

    function bars3DData() {
      const t = PFScene3D.tokens();
      const tk = { route:t.route, pine:t.pine, sea:t.sea, ochre:t.ochre, ink:t.ink, paper2:t.paper2 };
      return computePlan(cityId, status, readInputs(), partner).categories
        .map(c => ({ label: c.label, value: c.monthly, color: tk[c.token] || t.ink }));
    }

    function compute() {
      const overrides = readInputs();
      const plan = computePlan(cityId, status, overrides, partner);

      $a('#fp-monthly').innerHTML = moneyCell(plan.monthly, weekly);
      $a('#fp-total').innerHTML = `<strong>${nz(plan.totalNeeded)}</strong><span class="fp-lkr">${lkr(plan.totalNeeded)} total</span>`;
      $a('#fp-total-break').textContent =
        `= ${nz(plan.setup)} setup (bond + furnishings + misc) + ${nz(plan.monthly)} first month + ${nz(plan.buffer)} buffer`;

      // benchmarks
      const cfg = PF_CONFIG;
      const inzMo = cfg.visaFundsPerMonth, stipHi = cfg.stipendHi, stipLo = cfg.stipendLo;
      let bench = benchRow('Immigration NZ minimum', plan.monthly, inzMo,
        `${nz(inzMo)}/mo floor`, false,
        plan.monthly >= inzMo
          ? `Your budget clears the INZ minimum you must show funds for (${nz(cfg.visaFundsPerYear)}/yr).`
          : `Below the INZ minimum — you must still evidence at least ${nz(cfg.visaFundsPerYear)}/yr to get the visa.`);
      bench += benchRow('Doctoral stipend band', plan.monthly, stipHi,
        `${nz(stipLo)}–${nz(stipHi)}/mo`, true,
        plan.monthly > stipHi
          ? `Above the top stipend — you'd need ${nz(plan.monthly - stipHi)}/mo extra (partner/part-time work) or lower rent.`
          : `Fits inside a typical stipend with ${nz(stipHi - plan.monthly)}/mo headroom at the top of the band.`);
      if (status !== 'single' && partner.on) {
        const net = Math.max(0, plan.monthly - plan.partnerIncome);
        bench += benchRow('With partner income', net, plan.monthly,
          `+${nz(plan.partnerIncome)}/mo`, false,
          plan.partnerIncome >= plan.monthly
            ? `Partner income alone (${nz(plan.partnerIncome)}/mo) covers the whole monthly budget.`
            : `Partner income covers most of it — about ${nz(net)}/mo left for your stipend or savings to cover.`);
      }
      $a('#fp-bench').innerHTML = bench;

      // 2D breakdown (always present — also the 3D fallback)
      const maxCat = Math.max(1, ...plan.categories.map(c => c.monthly));
      $a('#fp-bars').innerHTML = plan.categories.map(c => {
        const shown = weekly ? c.monthly / WK_PER_MO : c.monthly;
        return `<tr>
          <td style="width:1%;white-space:nowrap"><span class="material-symbols-outlined" style="font-size:15px;vertical-align:-3px;color:${cssVar(c.token)}">${c.icon}</span> <span style="font-size:13px">${c.label}</span></td>
          <td style="width:55%"><div class="bar"><span style="width:${Math.round(c.monthly / maxCat * 100)}%;background:${cssVar(c.token)}"></span></div></td>
          <td class="mono" style="width:1%;text-align:right;white-space:nowrap">${nz(shown)}</td>
        </tr>`;
      }).join('');

      // contextual mentor hook when the budget is tight
      $a('#fp-consult').innerHTML = (plan.monthly > stipHi)
        ? `<div class="fp-tight"><span class="material-symbols-outlined" style="font-size:16px;color:var(--route)">savings</span>
             <span>This budget runs above a single stipend. Many students close the gap with partner work, part-time work, or a scholarship top-up.</span></div>`
           + consultCTA('settle-banking')
        : '';

      $a('#fp-note').textContent = plan.c.note + ' First flight + visa costs are not included here — see the Visa Hub. The INZ minimum funds requirement (NZ$' + cfg.visaFundsPerYear.toLocaleString() + '/yr) is the benchmark above.';

      // persist (mirrors original calcPrefs shape, extended)
      PFStore.setCalcPrefs({ city: cityId, status, overrides, weekly, partner });

      // 3D
      if (scene) scene.update();
    }

    function resetAssumptions() {
      const c = PF_CITY_COSTS.find(x => x.id === cityId);
      fillAssumptions(defaults(c, status));
    }

    function rebuildScene() {
      if (scene) { scene.dispose(); scene = null; }
      const cvs = $a('#fp-canvas');
      if (PFScene3D.supported()) {
        scene = PFScene3D.mountBars(cvs, bars3DData);
        $a('.fp-viz-3d').classList.remove('hidden');
      } else {
        // no 3D: hide the empty canvas, let the 2D table stand alone full-width
        $a('.fp-viz-3d').classList.add('hidden');
      }
    }

    // wiring
    $a('#fp-city').onchange = e => { cityId = e.target.value; resetAssumptions(); compute(); renderPlans(); if (scene) scene.rebuild(); };
    $a('#fp-status').onchange = e => { status = e.target.value; resetAssumptions(); renderPartner(); compute(); };
    container.querySelectorAll('.fp-tg').forEach(b => b.onclick = () => {
      weekly = b.dataset.wk === '1';
      container.querySelectorAll('.fp-tg').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
      compute();
    });
    $a('#fp-assumptions').addEventListener('input', compute); // compute() updates the 3D scene itself

    // saved scenarios
    function renderPlans() {
      const plans = PFStore.getFundsPlans();
      const host = $a('#fp-plans');
      if (!plans.length) { host.innerHTML = ''; return; }
      const computed = plans.map(p => ({ p, plan: computePlan(p.cityId, p.status, p.overrides, p.partner) }));
      host.innerHTML = `
        <table class="ledger fp-plans-table"><thead><tr>
          <th>Saved plan</th><th style="text-align:right">Monthly</th><th style="text-align:right">To arrange</th><th></th>
        </tr></thead><tbody>
          ${computed.map(({ p, plan }) => `<tr data-plan="${p.id}">
            <td style="font-size:13px"><strong>${esc(p.name)}</strong><div class="faint" style="font-size:11px">${plan.c.city} · ${({single:'Just me',couple:'Me + partner',family:'Family'})[p.status]}</div></td>
            <td class="mono" style="text-align:right;white-space:nowrap">${nz(plan.monthly)}</td>
            <td class="mono" style="text-align:right;white-space:nowrap">${nz(plan.totalNeeded)}</td>
            <td style="text-align:right;white-space:nowrap">
              <button class="btn btn-ghost btn-sm fp-load" data-plan="${p.id}" title="Load">Load</button>
              <button class="btn btn-ghost btn-sm fp-del" data-plan="${p.id}" title="Delete"><span class="material-symbols-outlined" style="font-size:15px">delete</span></button>
            </td></tr>`).join('')}
        </tbody></table>`;
    }

    $a('#fp-save').onclick = () => {
      const name = $a('#fp-name').value.trim() || `${PF_CITY_COSTS.find(c => c.id === cityId).city} · ${status}`;
      PFStore.saveFundsPlan({ name, cityId, status, overrides: readInputs(), weekly, partner: { ...partner } });
      $a('#fp-name').value = '';
      toast('Plan saved — compare it below');
      renderPlans();
    };
    $a('#fp-plans').addEventListener('click', e => {
      const load = e.target.closest('.fp-load'), del = e.target.closest('.fp-del');
      if (load) {
        const p = PFStore.getFundsPlans().find(x => x.id === load.dataset.plan);
        if (!p) return;
        cityId = p.cityId; status = p.status; weekly = !!p.weekly; partner = p.partner || partner;
        $a('#fp-city').value = cityId; $a('#fp-status').value = status;
        fillAssumptions({ ...defaults(PF_CITY_COSTS.find(c => c.id === cityId), status), ...(p.overrides || {}) });
        container.querySelectorAll('.fp-tg').forEach(x => { const on = x.dataset.wk === (weekly ? '1' : '0'); x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
        renderPartner(); compute(); if (scene) scene.rebuild();
        toast('Plan loaded');
      }
      if (del) { PFStore.deleteFundsPlan(del.dataset.plan); renderPlans(); toast('Plan removed'); }
    });

    // initial paint — restore saved overrides when city+status match
    const c0 = PF_CITY_COSTS.find(x => x.id === cityId);
    if (prefs.overrides && prefs.city === cityId && prefs.status === status) {
      fillAssumptions({ ...defaults(c0, status), ...prefs.overrides });
    } else {
      fillAssumptions(defaults(c0, status));
    }
    renderPartner();
    compute();
    renderPlans();
    rebuildScene();
  }

  return { render, computePlan, activePlan, CAT_META, WK_PER_MO,
           fmtNZ: nz, fmtLKR: lkr };
})();
