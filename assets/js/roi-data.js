/* ════════════════════════════════════════════════════════════
   PF_ROI — the cost-and-payback dataset for the master's track.

   Every figure here decides a number a Sri Lankan family will act on, so
   each one carries its own `src` (where it came from) and `asOf` (when it
   was last checked). Nothing in this file is derived at build time and
   nothing is scraped: it is hand-maintained on purpose, because the
   sources are published schedules that move once a year on a known
   cadence, and a wrong figure here is worse than a missing one.

   HOW TO RE-VERIFY (do this every January, and again each April):
     · tuition       — each provider's published international fee schedule
     · earnings      — Education Counts, "What young graduates earn"
     · minWage       — employment.govt.nz (reviewed every April)
     · tax / ACC     — ird.govt.nz (levy is reset each April)
     · visaFunds     — immigration.govt.nz (INZ adjusts periodically)
     · fx            — any transfer service; this is an anchor, not a rate

   Bump `verified` when you finish a pass. The UI prints it, so a stale
   dataset says so out loud rather than quietly misleading someone.
   ════════════════════════════════════════════════════════════ */

const PF_ROI = {
  verified: '2026-08-15',

  /* ── Currency anchor ────────────────────────────────────────────────
     For display only, so a family can read the total in the currency they
     actually think in. Never used to decide anything — a real transfer
     rate differs and moves daily. */
  fx: {
    nzdToLkr: 196.7,
    asOf: '2026-08-02',
    note: 'Mid-market. Traded roughly 194–198 through August 2026.',
    src: 'exchange-rates.org / Wise mid-market',
  },

  /* ── Tuition by provider tier (international, per year, NZ$) ─────────
     This is the whole point of the feature. The NZQA register says a
     level 9 master's is a level 9 master's; the price of one is not.

     `mid` is what the model uses when a student has not entered a real
     quoted fee. `confidence` says how much to trust the band: 'high'
     means several current published schedules agree, 'medium' means the
     tier is thinly published and the band is inferred from a few. */
  tiers: {
    universities: {
      label: 'University', short: 'University', confidence: 'high',
      lo: 33000, mid: 45000, hi: 58000,
      asOf: '2026-08', src: 'Published 2026 international fee schedules (Auckland, Victoria, Waikato, Lincoln, Otago, Massey, Canterbury)',
      note: 'Taught master\'s. Medicine, dentistry and geothermal engineering sit far above this band and are excluded from it.',
    },
    polytechnics: {
      label: 'Polytechnic / Institute of Technology', short: 'Polytechnic', confidence: 'high',
      lo: 19000, mid: 26000, hi: 33500,
      asOf: '2026-08', src: 'Published 2026 international fee schedules (Wintec, Ara, Otago Polytechnic)',
      note: 'Same NZQF level as a university qualification, typically at close to half the fee.',
    },
    ptes: {
      label: 'Private college', short: 'Private college', confidence: 'medium',
      lo: 20000, mid: 27000, hi: 36000,
      asOf: '2026-08', src: 'Indicative — private colleges publish fees per programme rather than in one schedule',
      note: 'Twenty-nine private colleges award master\'s degrees. Fees vary widely and must be confirmed with the provider.',
    },
  },

  /* ── Real per-subject university tuition ────────────────────────────
     The University of Auckland publishes a full per-subject international
     schedule, which makes it the only provider whose 2026 numbers can be
     stated exactly rather than as a band. It is also the most expensive
     of the eight, so treating it as "the university option" is the
     conservative choice — a comparison built on it never flatters the
     cheaper route by understating the expensive one.

     Keyed by NZQA subject-area root id (see PF_CATALOGUE.taxonomy).
     `eg` names the UoA fee line the figure comes from. */
  uniBySubject: {
    '76449': { lo: 55484, hi: 55484, eg: 'Science' },
    '76450': { lo: 55484, hi: 55484, eg: 'Science / Engineering' },
    '76451': { lo: 55484, hi: 55485, eg: 'Engineering' },
    '76452': { lo: 55484, hi: 55484, eg: 'Architecture' },
    '76453': { lo: 55484, hi: 55484, eg: 'Science' },
    '76454': { lo: 55214, hi: 86561, eg: 'Medical and Health Sciences' },
    '76455': { lo: 42219, hi: 43674, eg: 'Education' },
    '76456': { lo: 47675, hi: 50105, eg: 'Business and Economics' },
    '76457': { lo: 44970, hi: 52838, eg: 'Arts' },
    '76458': { lo: 48857, hi: 55484, eg: 'Fine Arts / Design' },
    '76460': { lo: 44970, hi: 55484, eg: 'Arts – Science span' },
  },
  uniBySubjectMeta: {
    asOf: '2026-08', provider: 'University of Auckland',
    src: 'auckland.ac.nz — 2026 international postgraduate fees, based on 120 points full-time',
    servicesFee: 1133,   // student services fee, ~NZ$1,132.80/yr on top of tuition
  },

  /* ── Post-study earnings ────────────────────────────────────────────
     READ THIS BEFORE CHANGING ANYTHING HERE.

     The published New Zealand figures are for DOMESTIC graduates. An
     international graduate gets a 3-year post-study work visa and no
     guarantee of residence, so they are not the same population and
     these numbers are an upper reference, not a forecast. The UI says so
     on the same screen it shows them, and the payback verdict is scored
     against the 3-year visa rather than an open-ended career.

     `byField` holds Education Counts' published medians for young
     BACHELOR'S graduates five years after study, keyed to NZQA roots.
     Only fields with a genuinely published figure appear; everything
     else falls back to `allBachelor5yr` and is flagged in the UI as a
     fallback rather than dressed up as a field number. */
  earnings: {
    allBachelor5yr: 51600,
    asOf: '2024', src: 'Education Counts — "What young graduates earn when they leave study" (young domestic bachelor\'s graduates, 5 years after study)',

    /* Master's graduates sit 86% above the national median wage at five
       years; bachelor's graduates sit 53% above. 1.86 / 1.53 = 1.216, so
       a master's earns roughly 22% more than a bachelor's in the same
       field. Applied to the bachelor's medians below — a derivation, not
       a measurement, and labelled as one wherever it is shown. */
    mastersOverBachelor: 1.216,
    mastersPremiumSrc: 'Ministry of Education, "Moving on up" — master\'s +86% vs bachelor\'s +53% over the national median wage, 5 years after study',

    byField: {
      '76450': { lo: 59200, hi: 62100, eg: 'Computer science / other IT' },
      '76451': { lo: 63600, hi: 66800, eg: 'Manufacturing & engineering / civil engineering' },
      '76454': { lo: 67600, hi: 73000, eg: 'Dental / pharmacy — excludes medical studies, which a taught master\'s does not lead to' },
      '76456': { lo: 51600, hi: 61600, eg: 'All-graduate median to banking & finance' },
    },
    /* Published as the lowest-earning field group, without a figure we
       can quote. Flagged rather than invented. */
    belowMedianFields: ['76458'],
  },

  /* ── Work rights while studying ─────────────────────────────────────
     Raised from 20 to 25 hours a week on 3 November 2025. Existing visa
     holders keep 20 until they apply to vary their conditions, which is
     why the model lets the student choose. */
  work: {
    inSemesterHours: 25,
    priorHours: 20,
    changedOn: '2025-11-03',
    semesterWeeks: 34,        // two 17-week semesters
    breakWeeks: 12,           // summer + mid-year, worked full-time
    breakHours: 37.5,
    src: 'immigration.govt.nz — student visa work conditions',
    note: 'INZ will not count projected part-time earnings toward the visa funds requirement. This offsets real cost; it does not help the visa case.',
  },

  /* ── Post-study work visa ───────────────────────────────────────────
     The window in which the payback has to happen. */
  psw: {
    mastersYears: 3, minWeeksStudy: 30, fundsNZD: 5000,
    jobOfferRequired: false,
    src: 'immigration.govt.nz — post-study work visa',
    note: 'Three years, open work rights, no job offer needed for a level 9 master\'s studied full-time for 30+ weeks. Residence is a separate decision and is not guaranteed.',
  },

  /* ── Tax ────────────────────────────────────────────────────────────
     Brackets unchanged 2025-26 → 2026-27. ACC earner levy rose to 1.75%.
     Used to turn a gross salary into what actually lands in the bank,
     because a payback figure built on gross pay is a lie. */
  tax: {
    asOf: '2026-27', src: 'ird.govt.nz',
    brackets: [
      { upTo: 15600, rate: 0.105 },
      { upTo: 53500, rate: 0.175 },
      { upTo: 78100, rate: 0.30 },
      { upTo: 180000, rate: 0.33 },
      { upTo: Infinity, rate: 0.39 },
    ],
    accRate: 0.0175, accCap: 156641,
  },

  /* ── One-off costs of getting there and starting ────────────────────
     The numbers that never appear in a prospectus and always appear on a
     bank statement. */
  oneOff: {
    visaNZD: 750,             // student visa application, indicative
    medicalsNZD: 250,         // INZ panel physician chest x-ray + exam
    policeCertNZD: 40,
    airfareOneWayNZD: 1400,   // Colombo → Auckland, one way, economy
    insurancePerYearNZD: 750, // compulsory for the duration of study
    asOf: '2026-08',
    src: 'Indicative — confirm visa fee on immigration.govt.nz and insurance with the provider',
  },
};

/* Fields the NZQA taxonomy has but Education Counts does not break out.
   Used by the model to say "we do not have a field figure for this" in
   as many words, instead of silently substituting the average. */
const PF_ROI_NO_FIELD_EARNINGS = ['76449', '76452', '76453', '76455', '76457', '76460'];
