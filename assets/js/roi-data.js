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

  /* ── Per-provider tuition ───────────────────────────────────────────
     Keyed by NZQA provider id, so a student picks the provider they are
     actually applying to and sees THAT provider's fee — not a stand-in.

     `bySubject` is keyed by NZQA subject-area root (PF_CATALOGUE.taxonomy)
     and holds [lo, hi] for one year of full-time study (120 points),
     INCLUDING the provider's compulsory student services fee where it is
     charged separately, because that is what lands on the invoice.

     `confidence`:
       'published'  every figure below is transcribed from that provider's
                    own current international fee schedule
       'band'       the provider publishes per-programme rather than in one
                    schedule, so only a whole-provider range is given and
                    the UI asks the student for their quoted fee

     Three providers are transcribed in full. That is deliberate rather
     than lazy: an invented per-subject figure for a provider that does
     not publish one would look identical to a real one on screen, and a
     family would act on it. Where the number is not known it is a band,
     and the UI says so and pushes for the real quote. */
  providers: {
    '700122001': {
      name: 'University of Auckland', tier: 'universities', confidence: 'published',
      asOf: '2026', servicesFee: 1133, band: [42219, 86561],
      src: 'auckland.ac.nz — 2026 international postgraduate fees, 120 points full-time',
      bySubject: {
        '76449': [55484, 55484, 'Science'],
        '76450': [55484, 55484, 'Science / Engineering'],
        '76451': [55484, 55485, 'Engineering'],
        '76452': [55484, 55484, 'Architecture'],
        '76453': [55484, 55484, 'Science'],
        '76454': [55214, 86561, 'Medical and Health Sciences'],
        '76455': [42219, 43674, 'Education'],
        '76456': [47675, 50105, 'Business and Economics'],
        '76457': [44970, 52838, 'Arts'],
        '76458': [48857, 55484, 'Fine Arts / Design'],
      },
    },
    '700800001': {
      name: 'Auckland University of Technology', tier: 'universities', confidence: 'published',
      asOf: '2026', servicesFee: 0, band: [35421, 53121],
      src: 'aut.ac.nz — International Student Fees 2026 (figures include the $1,221.60 services fee)',
      note: 'AUT publishes fees inclusive of its student services fee, so these are the invoice totals.',
      bySubject: {
        '76449': [45000, 48021, 'Science (postgraduate)'],
        '76450': [46000, 52321, 'Engineering, Computer & Mathematical Sciences'],
        '76451': [46000, 52321, 'Engineering, Computer & Mathematical Sciences'],
        '76452': [42300, 52321, 'Architecture & Built Environment'],
        '76453': [45000, 48021, 'Science (postgraduate)'],
        '76454': [45000, 53121, 'Health Sciences (postgraduate)'],
        '76456': [39921, 42721, 'Business (postgraduate)'],
        '76457': [38721, 38721, 'Social Sciences & Public Policy (postgraduate)'],
        '76458': [45800, 47021, 'Art & Design (postgraduate)'],
      },
    },
    '700277001': {
      name: 'University of Waikato', tier: 'universities', confidence: 'published',
      asOf: '2026', servicesFee: 0, band: [39580, 68370],
      src: 'waikato.ac.nz — 2026 estimated international tuition, 120-point master\'s',
      note: 'Waikato states its fees are approximate and subject to change.',
      bySubject: {
        '76449': [45920, 48195, 'Science / Science (Research)'],
        '76450': [46008, 46200, 'Information Technology / Cyber Security — the AI master\'s is far higher at 68,370'],
        '76451': [50445, 53640, 'Engineering Practice / Engineering'],
        '76453': [45920, 45920, 'Science'],
        '76454': [50030, 50030, 'Health Science'],
        '76456': [39840, 41180, 'Digital Business / Business'],
        '76457': [39580, 45920, 'Arts'],
        '76458': [50605, 50610, 'Music / Design'],
      },
    },
    /* Publish per programme rather than in one schedule — band only. */
    '700311001': { name: 'Massey University', tier: 'universities', confidence: 'band', asOf: '2026', band: [30000, 45000], src: 'massey.ac.nz — confirm per programme' },
    '700493001': { name: 'Victoria University of Wellington', tier: 'universities', confidence: 'band', asOf: '2026', band: [33000, 46000], src: 'wgtn.ac.nz fee calculator — confirm per programme' },
    '700571001': { name: 'University of Canterbury', tier: 'universities', confidence: 'band', asOf: '2026', band: [28000, 52000], src: 'canterbury.ac.nz — confirm per programme' },
    '700642001': { name: 'Lincoln University', tier: 'universities', confidence: 'band', asOf: '2026', band: [32500, 39000], src: 'lincoln.ac.nz — confirm per programme' },
    '700726001': { name: 'University of Otago', tier: 'universities', confidence: 'band', asOf: '2026', band: [24000, 63000], src: 'otago.ac.nz — confirm per programme' },

    '601915001': { name: 'Waikato Institute of Technology (Wintec)', tier: 'polytechnics', confidence: 'band', asOf: '2026', band: [19105, 23445], src: 'wintec.ac.nz — International Student Fees 2026' },
    '600627001': { name: 'Ara Institute of Canterbury', tier: 'polytechnics', confidence: 'band', asOf: '2026', band: [18400, 32500], src: 'ara.ac.nz — International fees 2026' },
    '601339001': { name: 'Otago Polytechnic', tier: 'polytechnics', confidence: 'band', asOf: '2026', band: [26000, 33500], src: 'op.ac.nz — International fees table' },
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
    // "From NZD $850" on the INZ Fee Paying Student Visa page — the floor,
    // so the model never understates it.
    visaNZD: 850,
    medicalsNZD: 250,         // INZ panel physician chest x-ray + exam
    policeCertNZD: 40,
    airfareOneWayNZD: 1400,   // Colombo → Auckland, one way, economy
    insurancePerYearNZD: 750, // compulsory for the duration of study
    asOf: '2026-08',
    src: 'Student visa fee from immigration.govt.nz (Fee Paying Student Visa, "from NZD $850"); the rest indicative — confirm insurance with the provider',
    /* Anyone already holding a 20-hour student visa who wants the 25-hour
       condition must apply to vary it. Not in the totals, because it only
       applies to students already onshore. */
    variationOfConditionsNZD: 325,
  },
};

/* ── Quality signals: how to read NZQA's record ────────────────────────
   Cost is one axis and the cheapest provider is not automatically the
   right one. PF_PROVIDER_QUALITY (generated by
   scripts/scrape-provider-quality.js) carries NZQA's own published record
   for all 51 providers; this is the vocabulary for presenting it.

   THE CRITICAL CONSTRAINT. The provider category comes from External
   Evaluation and Review, and EER ENDED on 19 January 2026 when the
   Quality Assurance of Tertiary Education Providers Rules 2026 revoked
   the EER Rules 2022. NZQA requires that a quoted category is shown with
   the year it was received AND a statement that the system no longer
   operates. `systemNote` is that statement and the UI always prints it
   next to a category — never a bare "Category 1" badge.

   Nothing here is a PathFinder score. We publish NZQA's finding, its
   date, and a link to the report, and let the student read it. */
const PF_ROI_QA = {
  systemEnded: '2026-01-19',
  systemNote: 'This category comes from NZQA\'s External Evaluation and Review system, which stopped operating on 19 January 2026. It is the last independent external judgement on record, not a current rating.',
  currentRegime: 'Providers are now covered by the Quality Assurance of Tertiary Education Providers Rules 2026 — their own quality management system, annual self-review, and NZQA monitoring.',
  src: 'nzqa.govt.nz — organisation records and external quality assurance reports',

  categories: {
    1: { label: 'Category 1', tone: 'chip-ok',
         meaning: 'NZQA was highly confident in this provider at its last external evaluation. Category 1 providers get the lightest-touch oversight and priority on new programme approvals.' },
    2: { label: 'Category 2', tone: 'chip-ok',
         meaning: 'NZQA was confident in this provider at its last external evaluation. A sound result — the great majority of providers sit at Category 1 or 2.' },
    3: { label: 'Category 3', tone: 'chip-warn',
         meaning: 'NZQA was not yet confident in this provider and it faced increased oversight, with a re-evaluation due within 12–24 months. Read the report before you pay anything.' },
    4: { label: 'Category 4', tone: 'chip-alert',
         meaning: 'The lowest category. NZQA was not confident in this provider and it could not make new applications. Do not commit money without reading the report and taking independent advice.' },
  },

  /* What this evidence genuinely cannot tell a student. Printed in full
     wherever a category is shown, because a badge with no caveat invites
     exactly the over-reading it should prevent. */
  limits: [
    'A category describes the provider as a whole at one moment, not the programme you would enrol in.',
    'It says nothing about teaching quality in your subject, class sizes, or how well the qualification is regarded by employers in your field.',
    'Universities carry no category at all — they are audited by the Academic Quality Agency instead, so a blank here is not a bad result.',
    'The rating may be several years old, and the system that produced it has since ended.',
  ],

  /* Why there is no star rating here. Left in the data rather than the
     markup so the reasoning survives a redesign. */
  noReviewsNote: 'PathFinder does not show Google or Glassdoor ratings. Those are a handful of self-selected reviews, frequently from people who never studied at the provider (and on Glassdoor, from staff rather than students), and republishing them would mean presenting opinion as evidence. For what a place is actually like to study at, ask someone who did — that is what the mentor network is for.',
};

/* Fields the NZQA taxonomy has but Education Counts does not break out.
   Used by the model to say "we do not have a field figure for this" in
   as many words, instead of silently substituting the average. */
const PF_ROI_NO_FIELD_EARNINGS = ['76449', '76452', '76453', '76455', '76457', '76460'];
