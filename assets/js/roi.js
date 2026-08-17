/* ════════════════════════════════════════════════════════════
   PFRoi — "will this master's pay for itself?"

   The PhD track has a prize at the end of it: domestic fees and a
   stipend. The master's track has a bill — full international tuition,
   no stipend, for one to two years — and for a family in Sri Lanka that
   bill is a house. This models the bill honestly, end to end, and says
   how long it takes to earn back.

   Three things it does that a prospectus never will:

     1. TOTAL cost, not the sticker fee. Tuition is the number providers
        publish; airfares, the visa, medicals, insurance, a rental bond
        and a first set of furniture are the numbers families discover
        afterwards.
     2. The income side. Master's students may work 25 hours a week in
        semester and full-time in breaks — real money that materially
        changes the picture, and that nobody nets off for them.
     3. The alternatives. The NZQA register says a level 9 is a level 9;
        it does not say they cost the same. See cheaperRoutes().

   Everything here is pure: same input, same output, no DOM, no storage,
   no network. That is deliberate — these numbers get printed on a sheet
   a student hands to their father, so they have to be testable.

   Reads PF_ROI (roi-data.js) for every rate and figure, and PF_CITY_COSTS
   / PF_COST_MULT (data.js) for living costs, so the cost of living here
   and in the Funds Planner can never disagree.
   ════════════════════════════════════════════════════════════ */

const PFRoi = (() => {

  const D = () => (typeof PF_ROI !== 'undefined' && PF_ROI) || {};
  const round = n => Math.round(Number(n) || 0);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  /* ── Tax ──────────────────────────────────────────────────────────
     Progressive PAYE plus the ACC earner levy. A payback period built on
     gross pay overstates what a graduate can actually save, which is the
     single easiest way to make this whole tool dishonest. */
  function afterTax(gross) {
    const t = D().tax || {};
    const brackets = t.brackets || [];
    let tax = 0, prev = 0;
    for (const b of brackets) {
      if (gross <= prev) break;
      tax += (Math.min(gross, b.upTo) - prev) * b.rate;
      prev = b.upTo;
    }
    const acc = Math.min(gross, t.accCap || Infinity) * (t.accRate || 0);
    return Math.max(0, gross - tax - acc);
  }

  /* ── Living costs ─────────────────────────────────────────────────
     Straight from PF_CITY_COSTS so this tool and the Funds Planner can
     never quote a family two different rents for the same city. */
  function cityById(id) {
    const list = (typeof PF_CITY_COSTS !== 'undefined' && PF_CITY_COSTS) || [];
    return list.find(c => c.id === id) || list[0] || null;
  }

  function livingPerYear(cityId, who) {
    const c = cityById(cityId);
    if (!c) return { total: 0, rent: 0, other: 0, city: null };
    const w = who || 'single';
    const rentWeekly = (c.rentWeekly && c.rentWeekly[w]) || (c.rentWeekly && c.rentWeekly.single) || 0;
    const mult = (typeof PF_COST_MULT !== 'undefined' && PF_COST_MULT[w]) || 1;
    const m = c.monthly || {};
    const otherMonthly = (m.food || 0) + (m.transport || 0) + (m.utilities || 0) + (m.phone || 0) + (m.other || 0);
    const rent = rentWeekly * 52;
    const other = otherMonthly * 12 * mult;
    return { total: round(rent + other), rent: round(rent), other: round(other), city: c };
  }

  function setupCost(cityId, who) {
    const c = cityById(cityId);
    if (!c || !c.setup) return 0;
    const w = who || 'single';
    const rentWeekly = (c.rentWeekly && c.rentWeekly[w]) || 0;
    const s = c.setup;
    return round(rentWeekly * (s.bondWeeks || 0) + (s.furnishings || 0) + (s.misc || 0));
  }

  /* ── Tuition ──────────────────────────────────────────────────────
     A real quoted fee always wins. Failing that, use the exact published
     per-subject figure for a university, then the tier band. Every path
     reports `basis` so the UI can say where the number came from — a
     student showing this to their family must be able to answer "where
     did you get that?". */
  function providerOf(id) { return (D().providers || {})[id] || null; }

  /* Which providers can this student actually pick? Everything in the fee
     table, plus — once the catalogue has loaded — every other provider on
     the NZQA register that teaches at this level, so the picker is the
     real world rather than the subset we happen to have fees for. */
  function providerChoices(subjectRoot) {
    const d = D();
    const out = [];
    Object.entries(d.providers || {}).forEach(([id, p]) => {
      const s = p.bySubject && subjectRoot && p.bySubject[subjectRoot];
      out.push({ id, name: p.name, tier: p.tier, confidence: s ? 'published' : (p.confidence === 'published' ? 'band' : p.confidence) });
    });
    const C = typeof window !== 'undefined' && window.PF_CATALOGUE;
    if (C && C.providers) {
      Object.entries(C.providers).forEach(([id, p]) => {
        if (d.providers && d.providers[id]) return;
        out.push({ id, name: p.name, tier: p.type, confidence: 'tier' });
      });
    }
    const rank = { universities: 0, polytechnics: 1, ptes: 2 };
    return out.sort((a, b) => (rank[a.tier] ?? 3) - (rank[b.tier] ?? 3) || a.name.localeCompare(b.name));
  }

  /* Resolve one year's tuition, most-specific source first. Every branch
     reports `basis` and `label` so the screen can always answer the only
     question that matters when a family is looking at it: where did you
     get that number? */
  function tuitionPerYear({ tier, providerId, subjectRoot, feeOverride }) {
    const d = D();
    if (Number(feeOverride) > 0) {
      return { amount: round(feeOverride), basis: 'quoted', confidence: 'exact',
               label: 'the fee you were quoted' };
    }

    const p = providerOf(providerId);

    // 1. That provider's own published figure for that subject.
    const s = p && p.bySubject && subjectRoot && p.bySubject[subjectRoot];
    if (s) {
      const [lo, hi, eg] = s;
      return {
        amount: round((lo + hi) / 2 + (p.servicesFee || 0)),
        lo, hi, basis: 'provider-subject', confidence: 'published',
        provider: p.name, eg,
        label: `${p.name}'s published ${p.asOf} rate for ${eg}`,
      };
    }

    // 2. That provider's own overall range.
    if (p && p.band) {
      return {
        amount: round((p.band[0] + p.band[1]) / 2 + (p.servicesFee || 0)),
        lo: p.band[0], hi: p.band[1], basis: 'provider-band', confidence: 'band',
        provider: p.name,
        label: `${p.name}'s published range — they set fees per programme, so confirm yours`,
      };
    }

    // 3. A provider we hold no fees for: the tier it belongs to.
    const catP = (typeof window !== 'undefined' && window.PF_CATALOGUE
                  && window.PF_CATALOGUE.providers || {})[providerId];
    const useTier = (catP && catP.type) || tier || 'universities';
    const t = (d.tiers && d.tiers[useTier]) || (d.tiers && d.tiers.universities) || {};
    return {
      amount: round(t.mid || 0), lo: t.lo, hi: t.hi, basis: 'tier-band',
      confidence: 'estimate', provider: catP && catP.name,
      label: catP
        ? `the typical ${(t.short || '').toLowerCase()} band — we don't hold ${catP.name}'s published fees, so ask them`
        : `the typical ${(t.short || 'provider').toLowerCase()} band`,
    };
  }

  /* ── Income while studying ────────────────────────────────────────
     25 hours a week in semester (since 3 Nov 2025) and full-time across
     the breaks, at the adult minimum wage — deliberately the floor, not
     an average, because a student who beats it is pleasantly surprised
     and one who does not has still budgeted correctly.

     Note the asymmetry the UI has to keep repeating: this money reduces
     what the family actually spends, but INZ will not count it toward
     the visa funds requirement. It is real, and it does not help the
     visa case. */
  function studyIncomePerYear({ hours, partner }) {
    const d = D();
    const w = d.work || {};
    const wage = (typeof PF_CONFIG !== 'undefined' && PF_CONFIG.minWageHourly) || 23.95;
    const inSem = Number(hours) > 0 ? Number(hours) : (w.inSemesterHours || 25);
    const gross = inSem * (w.semesterWeeks || 34) * wage
                + (w.breakHours || 37.5) * (w.breakWeeks || 12) * wage;
    const partnerGross = partner ? (w.breakHours || 37.5) * 48 * wage : 0;
    return {
      grossSelf: round(gross), grossPartner: round(partnerGross),
      netSelf: round(afterTax(gross)), netPartner: round(afterTax(partnerGross)),
      net: round(afterTax(gross) + (partnerGross ? afterTax(partnerGross) : 0)),
      hours: inSem, wage,
    };
  }

  /* ── Post-study earnings ──────────────────────────────────────────
     Education Counts' bachelor's medians, lifted by the master's premium.
     Where a field has no published figure we say so and fall back to the
     all-graduate median rather than inventing a number for it. */
  function graduateEarnings(subjectRoot) {
    const e = (D().earnings) || {};
    const mult = e.mastersOverBachelor || 1;
    const f = e.byField && e.byField[subjectRoot];
    const below = (e.belowMedianFields || []).includes(subjectRoot);
    if (f) {
      return {
        lo: round(f.lo * mult), hi: round(f.hi * mult), mid: round(((f.lo + f.hi) / 2) * mult),
        basis: 'field', eg: f.eg, derived: true,
      };
    }
    const base = e.allBachelor5yr || 0;
    return {
      lo: round(base * mult), hi: round(base * mult), mid: round(base * mult),
      basis: below ? 'below-median' : 'all-graduate', derived: true,
      note: below
        ? 'This field group is published as the lowest-earning of all. No separate figure is published for it, so the all-graduate median below is optimistic for this subject.'
        : 'No separate figure is published for this field, so this is the median across all graduates.',
    };
  }

  /* ── The model ────────────────────────────────────────────────────
     Everything above, assembled. */
  function compute(input) {
    const i = input || {};
    const d = D();
    const years = clamp(Number(i.years) || 2, 0.5, 4);
    const who = i.who || 'single';
    const cityId = i.city || 'akl';

    const tuition = tuitionPerYear(i);
    const scholarshipPct = clamp(Number(i.scholarshipPct) || 0, 0, 100);
    const tuitionGross = round(tuition.amount * years);
    const tuitionCovered = round(tuitionGross * (scholarshipPct / 100));
    const tuitionNet = tuitionGross - tuitionCovered;

    const living = livingPerYear(cityId, who);
    const livingTotal = round(living.total * years);
    const setup = setupCost(cityId, who);

    const o = d.oneOff || {};
    const heads = who === 'single' ? 1 : who === 'couple' ? 2 : 3;
    const travel = round((o.airfareOneWayNZD || 0) * heads * 2);   // there, and home again
    const insurance = round((o.insurancePerYearNZD || 0) * years * heads);
    const visaAdmin = round(((o.visaNZD || 0) + (o.medicalsNZD || 0) + (o.policeCertNZD || 0)) * heads);

    const costLines = [
      { k: 'tuition',   label: 'Tuition', detail: tuition.label, amount: tuitionNet, perYear: tuition.amount },
      { k: 'living',    label: 'Living costs', detail: `${living.city ? living.city.city : ''} — rent, food, transport, utilities`, amount: livingTotal, perYear: living.total },
      { k: 'setup',     label: 'Setting up', detail: 'Rental bond, furniture, first shop', amount: setup },
      { k: 'travel',    label: 'Flights', detail: `Colombo–Auckland, return, ${heads} ${heads === 1 ? 'person' : 'people'}`, amount: travel },
      { k: 'insurance', label: 'Health insurance', detail: 'Compulsory for the length of study', amount: insurance },
      { k: 'visa',      label: 'Visa, medicals & police certificate', detail: 'One-off application costs', amount: visaAdmin },
    ].filter(l => l.amount > 0);

    const totalCost = costLines.reduce((s, l) => s + l.amount, 0);

    const income = studyIncomePerYear({ hours: i.workHours, partner: who !== 'single' && i.partnerWorks });
    const studyIncomeTotal = round(income.net * years);
    const netCost = Math.max(0, totalCost - studyIncomeTotal);

    /* What they can actually put aside per year afterwards: take-home pay
       less the cost of living in the same city. That surplus — not the
       salary — is what repays the family. */
    const earn = graduateEarnings(i.subjectRoot);
    const grossAfter = earn.mid;
    const netAfter = round(afterTax(grossAfter));
    const annualSurplus = Math.max(0, netAfter - living.total);
    const paybackYears = annualSurplus > 0 ? netCost / annualSurplus : Infinity;

    const psw = d.psw || {};
    const pswYears = psw.mastersYears || 3;

    /* The verdict, in words a family reads once and understands.

       These strings used to be written as if the reader already knew the
       model: "Does not pay back inside the visa" was a headline on this
       screen, and it fails three ways at once. It is jargon ("the visa" —
       which one?). It sounds like a refusal rather than a timing fact. And
       it is shouted at someone who has usually not entered their own plan
       yet, so the first thing this product ever tells them about their
       future is a red alarm about a default.

       So: `band` is now a short, plain STATUS — never the page's headline
       (see roiHeroCopy in app.js) — and `verdict` explains it by naming
       the actual numbers and the actual visa, in the order a person asks:
       how long, against what, and what that means. */
    let band, bandCls, verdict;
    if (!isFinite(paybackYears)) {
      band = 'Earns back: not on these numbers'; bandCls = 'chip-alert';
      verdict = `On these figures the typical starting salary in this field would not cover the cost of living in ${living.city}, so there is nothing left over each year to put back toward the cost. A cheaper provider or a cheaper city changes this — both are below.`;
    } else if (paybackYears <= pswYears * 0.6) {
      band = `Earns back in ${fmtYears(paybackYears)}`; bandCls = 'chip-ok';
      verdict = `At the typical starting salary for this field, the money comes back in about ${fmtYears(paybackYears)} of full-time work. This is measured against the ${pswYears}-year post-study work window INZ currently publishes for this qualification level, so it fits comfortably — with room if it takes you a while to find the first job. Whether you would be granted that visa is a separate question, for INZ or a licensed adviser.`;
    } else if (paybackYears <= pswYears) {
      band = `Earns back in ${fmtYears(paybackYears)}`; bandCls = 'chip-warn';
      verdict = `At the typical starting salary for this field, the money comes back in about ${fmtYears(paybackYears)} of full-time work. Measured against the ${pswYears}-year post-study work window INZ currently publishes for this qualification level, it fits — but only if you find work in the field early. A slow start pushes it past that window, and eligibility for the visa is not something this tool can tell you.`;
    } else {
      band = `Earns back in ${fmtYears(paybackYears)}`; bandCls = 'chip-alert';
      verdict = `At the typical starting salary for this field, the money comes back in about ${fmtYears(paybackYears)} of full-time work. Measured against the ${pswYears}-year post-study work window INZ currently publishes for this qualification level, on these numbers you would still be repaying it when that window closes. Staying longer means residence, a separate application that is never guaranteed — and eligibility for either is a question for INZ or a licensed adviser, not for this tool.`;
    }

    return {
      years, who, cityId, city: living.city,
      tuition, tuitionGross, tuitionCovered, tuitionNet, scholarshipPct,
      living, livingTotal, setup, travel, insurance, visaAdmin,
      costLines, totalCost,
      income, studyIncomeTotal, netCost,
      earnings: earn, grossAfter, netAfter, annualSurplus,
      paybackYears, pswYears, band, bandCls, verdict,
      ownFunds: round(i.ownFundsNZD || 0),
      gap: Math.max(0, netCost - round(i.ownFundsNZD || 0)),
      verified: d.verified, fx: d.fx || {},
    };
  }

  function fmtYears(y) {
    if (!isFinite(y)) return 'never';
    if (y < 1) return Math.round(y * 12) + ' months';
    const whole = Math.floor(y), months = Math.round((y - whole) * 12);
    if (months === 0) return whole + (whole === 1 ? ' year' : ' years');
    if (months === 12) return (whole + 1) + ' years';
    return `${whole} ${whole === 1 ? 'year' : 'years'} ${months} months`;
  }

  /* ── Cheaper routes to the same place ─────────────────────────────
     The register holds 700 level-9 master's qualifications, and 111 of
     those offerings are at polytechnics and private colleges rather than
     universities. On the qualifications framework they are the same
     level. Nobody tells a family in Colombo this, because the people
     advising them are paid a percentage of the tuition.

     Returns comparison rows against the student's current plan. Each one
     is a real, checkable claim — a level, a provider tier, a fee band —
     never a recommendation, and never a promise that the outcome is
     identical. Where the trade-off is real, it is stated. */
  function cheaperRoutes(base, opts) {
    const d = D();
    const o = opts || {};
    const rows = [];
    const currentTier = o.tier || 'universities';
    const subjectRoot = o.subjectRoot;

    const re = (over) => compute(Object.assign({}, o, over));

    /* Named providers first — a real institution the student can look up
       beats an abstract "a polytechnic" every time, and it is the only
       form of this claim a family can check. Only providers whose fees we
       actually hold are offered, and each row says how solid its number
       is, so nothing here is a guess dressed as a comparison. */
    Object.entries(d.providers || {}).forEach(([id, p]) => {
      if (id === o.providerId) return;
      // Skip a provider that has no figure for this subject AND no band.
      const hasSubject = p.bySubject && subjectRoot && p.bySubject[subjectRoot];
      if (!hasSubject && !p.band) return;
      const alt = re({ providerId: id, tier: p.tier, feeOverride: 0 });
      if (alt.totalCost >= base.totalCost) return;
      const t = (d.tiers && d.tiers[p.tier]) || {};
      const sameTier = p.tier === currentTier;
      rows.push({
        id: 'prov-' + id,
        title: `${p.name}`,
        kicker: sameTier ? 'Same kind of provider, lower fee' : `The same NZQF level at a ${(t.short || p.tier).toLowerCase()}`,
        why: hasSubject
          ? `Their published ${p.asOf} rate for this subject is ${money(alt.tuition.lo)}–${money(alt.tuition.hi)} a year.`
          : `They publish a range of ${money(p.band[0])}–${money(p.band[1])} a year and set fees per programme.`,
        tradeoff: p.tier === 'ptes'
          ? 'Private colleges vary widely in size, support and standing with employers. Check the provider\'s NZQA category and talk to a graduate first.'
          : p.tier === 'polytechnics'
            ? 'Polytechnics are strongly applied and industry-linked. Fewer research pathways if a doctorate is the eventual goal.'
            // Deliberately does not assert a change of city: several of
            // these sit in the same one as each other (AUT and Auckland
            // both being in Auckland), and a trade-off that is wrong on a
            // checkable fact costs the whole comparison its credibility.
            : 'A different university means different entry requirements and a different graduate network, and may mean a different city. Check the programme actually matches what you want.',
        saving: base.totalCost - alt.totalCost,
        total: alt.totalCost, payback: alt.paybackYears,
        confidence: hasSubject ? 'published' : 'band',
        providerId: id,
      });
    });

    // Level 8 first, then ladder.
    const l8 = re({ tier: currentTier, years: 1, feeOverride: 0 });
    if (l8.totalCost < base.totalCost) {
      rows.push({
        id: 'level8',
        title: 'A level 8 postgraduate diploma first',
        why: 'A PGDip is one year rather than two, and at most providers credits toward the master\'s if you carry on. It is also the standard bridge for an applicant whose bachelor\'s is not a close enough match.',
        tradeoff: 'A PGDip on its own is not a master\'s: the three-year post-study work visa is for a level 9, and a level 8 does not earn the master\'s salary premium. Confirm the ladder into the master\'s in writing before you enrol.',
        saving: base.totalCost - l8.totalCost,
        total: l8.totalCost,
        // Deliberately no payback figure. Scoring a PGDip with a master's
        // earnings premium and a master's visa length would flatter it on
        // exactly the two counts where it is weaker.
        payback: null,
        paybackNote: 'Not comparable — a level 8 earns neither the master\'s premium nor the 3-year visa.',
        confidence: 'high',
      });
    }

    // Same qualification, cheaper city.
    const cities = (typeof PF_CITY_COSTS !== 'undefined' && PF_CITY_COSTS) || [];
    let bestCity = null;
    cities.forEach(c => {
      if (c.id === base.cityId) return;
      const alt = re({ city: c.id });
      if (alt.totalCost < base.totalCost && (!bestCity || alt.totalCost < bestCity.total)) {
        bestCity = { city: c, total: alt.totalCost, payback: alt.paybackYears };
      }
    });
    if (bestCity) {
      rows.push({
        id: 'city',
        title: `The same study in ${bestCity.city.city}`,
        why: `Living costs, not tuition. Rent and everyday costs in ${bestCity.city.city} run below ${base.city ? base.city.city : 'your chosen city'}, across a two-year degree that compounds.`,
        tradeoff: 'Fewer part-time jobs in smaller cities, and a thinner graduate market afterwards — which can cost more than the rent saved.',
        saving: base.totalCost - bestCity.total,
        total: bestCity.total, payback: bestCity.payback, confidence: 'high',
      });
    }

    // Named, published-fee providers lead; then anything else by saving.
    const weight = r => (r.confidence === 'published' ? 0 : r.confidence === 'band' ? 1 : 2);
    return rows.sort((a, b) => weight(a) - weight(b) || b.saving - a.saving).slice(0, 6);
  }

  /* Count the register's own evidence for the cheaper-tier claim, so the
     UI can cite a real number instead of asserting one. Returns null when
     the catalogue has not been loaded. */
  function levelNineTierCounts() {
    const C = typeof window !== 'undefined' && window.PF_CATALOGUE;
    if (!C || !C.quals) return null;
    const out = { universities: 0, polytechnics: 0, ptes: 0, quals: 0 };
    C.quals.forEach(q => {
      if (q.l !== '9') return;
      out.quals++;
      (q.o || []).forEach(id => {
        const p = C.providers[id];
        if (p && out[p.type] != null) out[p.type]++;
      });
    });
    return out;
  }

  /* ── Quality signals ──────────────────────────────────────────────
     NZQA's own published record for a provider, shaped for display. This
     deliberately returns findings and their dates, never a PathFinder
     score: our job is to put the regulator's evidence in front of the
     student with a link, not to rate institutions ourselves.

     Returns null when the quality dataset has not been loaded, so every
     caller degrades to showing nothing rather than showing "unrated". */
  function qualityFor(providerId) {
    const Q = typeof window !== 'undefined' && window.PF_PROVIDER_QUALITY;
    if (!Q || !Q.providers) return null;
    const rec = Q.providers[providerId];
    if (!rec) return null;
    const QA = typeof PF_ROI_QA !== 'undefined' ? PF_ROI_QA : {};
    const cat = rec.category != null && QA.categories ? QA.categories[rec.category] : null;

    // The year the category was received — NZQA requires it to be shown
    // alongside, because the system that issued it has ended.
    const years = (rec.statements || []).map(s => {
      const m = String(s.date).match(/\b(19|20)\d{2}\b/);
      return m ? Number(m[0]) : null;
    }).filter(Boolean);
    const statementYear = years.length ? Math.max(...years) : (rec.reports && rec.reports[0] && rec.reports[0].year) || null;

    return {
      id: providerId, name: rec.name, type: rec.type, link: rec.link,
      category: rec.category, cat, statementYear,
      statements: rec.statements || [],
      reports: rec.reports || [],
      codeSignatory: rec.codeSignatory === true,
      codeUnknown: rec.codeSignatory == null,
      naReason: rec.naReason || null,
      limited: rec.detail === 'limited',
      scraped: Q.scraped,
      // A category a student should not skip past on their way to a
      // lower price. 3 and 4 both carried real regulatory consequences.
      concern: rec.category === 3 || rec.category === 4,
    };
  }

  /* Does moving to this cheaper provider mean accepting a materially
     worse regulatory record? Returns null when either side is unknown —
     a university has no category by design, and comparing a number to a
     blank would manufacture a warning out of nothing. */
  function qualityDelta(fromId, toId) {
    const a = qualityFor(fromId), b = qualityFor(toId);
    if (!a || !b || a.category == null || b.category == null) return null;
    if (b.category <= a.category) return null;
    return { from: a.category, to: b.category, worse: b.category - a.category, target: b };
  }

  const money = n => 'NZ$' + Number(n || 0).toLocaleString('en-US');
  const lkr = (nzd) => {
    const r = (D().fx && D().fx.nzdToLkr) || 0;
    return 'LKR ' + Math.round((Number(nzd) || 0) * r).toLocaleString('en-US');
  };

  return { compute, cheaperRoutes, tuitionPerYear, graduateEarnings, studyIncomePerYear,
           livingPerYear, setupCost, afterTax, levelNineTierCounts, fmtYears, money, lkr,
           providerChoices, providerOf, qualityFor, qualityDelta };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PFRoi;
