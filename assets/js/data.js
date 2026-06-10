/* ════════════════════════════════════════════════════════════
   PathFinder — Static dataset (NZ PhD ecosystem)
   In production this moves to Firestore; shapes are kept flat
   and ID-keyed so documents map 1:1 to collections.
   ════════════════════════════════════════════════════════════ */

const PF_FIELDS = [
  'Computer Science & AI', 'Engineering', 'Health & Medicine',
  'Business & Economics', 'Environmental Science', 'Agriculture & Food',
  'Physics & Mathematics', 'Social Sciences & Education',
];

const PF_UNIVERSITIES = [
  { id:'uoa', name:'University of Auckland', city:'Auckland', rank:'#65 QS World', phdFee:'~NZ$7,800/yr (domestic rate for PhD)',
    strengths:['Computer Science & AI','Engineering','Health & Medicine','Business & Economics'],
    note:'NZ’s largest research university. International PhD students pay domestic fees and can work full-time.' },
  { id:'uoo', name:'University of Otago', city:'Dunedin', rank:'#214 QS World', phdFee:'~NZ$8,000/yr',
    strengths:['Health & Medicine','Social Sciences & Education','Environmental Science'],
    note:'NZ’s oldest university; exceptional medical and health sciences research, generous doctoral scholarships.' },
  { id:'vuw', name:'Victoria University of Wellington', city:'Wellington', rank:'#244 QS World', phdFee:'~NZ$7,500/yr',
    strengths:['Social Sciences & Education','Computer Science & AI','Physics & Mathematics'],
    note:'Top-ranked in NZ for research intensity; strong government and policy research links in the capital.' },
  { id:'uc',  name:'University of Canterbury', city:'Christchurch', rank:'#261 QS World', phdFee:'~NZ$7,600/yr',
    strengths:['Engineering','Physics & Mathematics','Environmental Science'],
    note:'Engineering powerhouse with strong industry partnerships and the UC Doctoral Scholarship.' },
  { id:'massey', name:'Massey University', city:'Palmerston North / Auckland', rank:'#239 QS World', phdFee:'~NZ$7,400/yr',
    strengths:['Agriculture & Food','Business & Economics','Engineering'],
    note:'World leader in agri-food research; flexible part-time and distance PhD options.' },
  { id:'waikato', name:'University of Waikato', city:'Hamilton', rank:'#235 QS World', phdFee:'~NZ$7,300/yr',
    strengths:['Computer Science & AI','Environmental Science','Social Sciences & Education'],
    note:'Home of the WEKA machine-learning project; strong AI and data-science groups.' },
  { id:'aut', name:'Auckland University of Technology', city:'Auckland', rank:'#412 QS World', phdFee:'~NZ$7,200/yr',
    strengths:['Health & Medicine','Computer Science & AI','Business & Economics'],
    note:'Fast-growing research profile, applied focus, strong industry-linked doctorates.' },
  { id:'lincoln', name:'Lincoln University', city:'Lincoln (Canterbury)', rank:'#362 QS World', phdFee:'~NZ$7,000/yr',
    strengths:['Agriculture & Food','Environmental Science','Business & Economics'],
    note:'Specialist land-based university; highest research income per academic in NZ agriculture.' },
];

const PF_LABS = [
  { id:'l1', uni:'uoa', name:'Strong AI Lab (NAOInstitute)', field:'Computer Science & AI',
    topics:['Deep learning','NLP','AI safety'], supervisor:'Prof. Michael Witbrock', email:'via faculty page',
    hint:'Welcomes PhD applicants with publications or strong ML project portfolios.' },
  { id:'l2', uni:'uoa', name:'Auckland Bioengineering Institute', field:'Health & Medicine',
    topics:['Computational physiology','Medical devices','Digital twins'], supervisor:'Multiple PIs', email:'abi@auckland.ac.nz',
    hint:'Large institute — identify a specific PI and project before emailing.' },
  { id:'l3', uni:'waikato', name:'Machine Learning Group (WEKA)', field:'Computer Science & AI',
    topics:['Data mining','Stream learning','Applied ML'], supervisor:'Prof. Albert Bifet / Prof. Eibe Frank', email:'via group page',
    hint:'Globally known group; strong fit for data-mining and ML-systems applicants.' },
  { id:'l4', uni:'uc', name:'Wireless Research Centre', field:'Engineering',
    topics:['5G/6G','IoT','Signal processing'], supervisor:'Assoc. Prof. Graeme Woodward', email:'wrc@canterbury.ac.nz',
    hint:'Industry-funded projects often come with stipends — ask about funded positions.' },
  { id:'l5', uni:'uoo', name:'Centre for Translational Cancer Research', field:'Health & Medicine',
    topics:['Cancer genomics','Immunotherapy','Biomarkers'], supervisor:'Multiple PIs', email:'via department',
    hint:'Otago Doctoral Scholarship covers fees + NZ$31k stipend for strong candidates.' },
  { id:'l6', uni:'vuw', name:'School of Engineering & CS — AI Group', field:'Computer Science & AI',
    topics:['Evolutionary computation','Computer vision','XAI'], supervisor:'Prof. Mengjie Zhang', email:'via faculty page',
    hint:'One of the largest evolutionary-computation groups in the world.' },
  { id:'l7', uni:'massey', name:'Riddet Institute', field:'Agriculture & Food',
    topics:['Food structure','Nutrition science','Dairy tech'], supervisor:'Multiple PIs', email:'riddet@massey.ac.nz',
    hint:'Centre of Research Excellence — multiple fully funded PhD positions advertised yearly.' },
  { id:'l8', uni:'lincoln', name:'Centre for Soil & Environmental Research', field:'Environmental Science',
    topics:['Soil carbon','Water quality','Climate adaptation'], supervisor:'Multiple PIs', email:'via department',
    hint:'Strong fit for agriculture/environment graduates from Peradeniya and Ruhuna.' },
  { id:'l9', uni:'uoa', name:'Business School — Energy Centre', field:'Business & Economics',
    topics:['Energy economics','Sustainability finance','Policy'], supervisor:'Multiple PIs', email:'energy@auckland.ac.nz',
    hint:'Quantitative background (economics/statistics) strongly preferred.' },
  { id:'l10', uni:'uc', name:'Gateway Antarctica', field:'Environmental Science',
    topics:['Glaciology','Antarctic ecosystems','Remote sensing'], supervisor:'Multiple PIs', email:'via centre page',
    hint:'Unique field-work opportunities; GIS/remote-sensing skills are a plus.' },
  { id:'l11', uni:'aut', name:'Knowledge Engineering & Discovery Research Institute', field:'Computer Science & AI',
    topics:['Neuromorphic computing','Brain data','Spiking neural networks'], supervisor:'Prof. Nikola Kasabov (founding)', email:'kedri@aut.ac.nz',
    hint:'Pioneers of evolving spiking neural networks (NeuCube).' },
  { id:'l12', uni:'vuw', name:'Ferrier Research Institute', field:'Physics & Mathematics',
    topics:['Carbohydrate chemistry','Drug discovery','Biotech'], supervisor:'Multiple PIs', email:'ferrier@vuw.ac.nz',
    hint:'Chemistry/biochem graduates: strong commercialisation track record.' },
];

const PF_SCHOLARSHIPS = [
  { id:'s1', name:'University of Auckland Doctoral Scholarship', value:'Fees + NZ$33,000/yr stipend', deadline:'Rolling (apply with admission)',
    fields:'All fields', eligibility:'First-class honours or high-GPA master’s; awarded on academic merit with admission.', link:'auckland.ac.nz/scholarships' },
  { id:'s2', name:'Otago Doctoral Scholarship', value:'Fees + NZ$31,300/yr (3 yrs)', deadline:'Rolling',
    fields:'All fields', eligibility:'A-/A average in research master’s or honours. Automatic consideration on application.', link:'otago.ac.nz/study/scholarships' },
  { id:'s3', name:'Victoria Doctoral Scholarship', value:'Fees + NZ$30,500/yr', deadline:'1 Mar / 1 Jul / 1 Nov',
    fields:'All fields', eligibility:'Research-based master’s with distinction or equivalent publications.', link:'wgtn.ac.nz/scholarships' },
  { id:'s4', name:'UC Doctoral Scholarship', value:'Fees + NZ$31,000/yr', deadline:'15 May / 15 Oct',
    fields:'All fields', eligibility:'GPA ~8/9 in final-year study; research experience weighted heavily.', link:'canterbury.ac.nz/scholarships' },
  { id:'s5', name:'NZ International Doctoral Research Scholarship (NZIDRS legacy / Manaaki)', value:'Full fees + living allowance + insurance', deadline:'Check Manaaki rounds (usually Feb)',
    fields:'Development-relevant fields', eligibility:'Sri Lanka is a Manaaki-eligible country. Highly competitive; development impact statement required.', link:'nzscholarships.govt.nz' },
  { id:'s6', name:'Massey Doctoral Scholarship', value:'Fees + NZ$30,000/yr', deadline:'1 Mar / 1 Jul / 1 Oct',
    fields:'All fields', eligibility:'Research master’s or honours with high distinction average.', link:'massey.ac.nz/scholarships' },
  { id:'s7', name:'Riddet Institute PhD Scholarships', value:'Fees + NZ$32,000/yr (project-tied)', deadline:'Advertised per project',
    fields:'Agriculture & Food', eligibility:'Food science / chemistry / engineering background; tied to specific funded projects.', link:'riddet.ac.nz' },
  { id:'s8', name:'AUT Vice-Chancellor’s Doctoral Scholarship', value:'Fees + NZ$28,000/yr', deadline:'30 Jun / 30 Nov',
    fields:'All fields', eligibility:'Outstanding academic record; aligned with AUT research priority areas.', link:'aut.ac.nz/scholarships' },
];

const PF_VISA_UPDATES = [
  { date:'2026-05', title:'PhD students keep domestic fee status', tag:'Policy',
    body:'International PhD candidates in NZ continue to pay domestic tuition rates — one of the few countries in the world with this policy.' },
  { date:'2026-04', title:'Full-time work rights confirmed for doctoral students', tag:'Work Rights',
    body:'Doctoral students may work unlimited hours during study. Partners of PhD students remain eligible for an open work visa.' },
  { date:'2026-03', title:'Post-study work visa: 3 years after PhD', tag:'Post-Study',
    body:'PhD graduates qualify for a 3-year open post-study work visa, a direct pathway toward the Skilled Migrant Category.' },
  { date:'2026-02', title:'Dependent children eligible for domestic schooling', tag:'Family',
    body:'School-age children of PhD students are treated as domestic students in NZ schools — no international fees.' },
  { date:'2026-01', title:'eVisa processing times: student visas averaging 6–8 weeks', tag:'Processing',
    body:'Apply at least 3 months before your intended start date. Funds evidence: NZ$20,000+/yr living costs or scholarship letter.' },
];

const PF_TEMPLATES = [
  { id:'t1', name:'Supervisor First-Contact Email', type:'Email template', icon:'mail',
    body:`Subject: Prospective PhD applicant — [Your research area] ([Intake] intake)

Dear Professor [Name],

I am [Your Name], a [degree] graduate in [field] from [University] (GPA [x]/4.0). I have followed your work on [specific paper/project], and your finding that [specific detail] closely relates to my research interest in [topic].

[2–3 sentences: your research experience, publications, or thesis — with one concrete result.]

I am preparing to apply for the [intake] PhD intake and would be honoured to explore whether my interests align with your group’s direction. I have attached my CV and a one-page research sketch.

Would you be open to a brief conversation, or could you advise whether you are accepting students for [year]?

Kind regards,
[Name] · [LinkedIn / Scholar profile] · [Phone]`},
  { id:'t2', name:'Research Proposal Outline', type:'Document outline', icon:'description',
    body:`RESEARCH PROPOSAL — [Working Title]

1. Background & Motivation (½ page)
   — The gap: what is unknown and why it matters.
2. Research Questions (3 max, each falsifiable)
3. Literature Positioning (¾ page)
   — 3–5 key works; where your work departs from them.
4. Methodology (1 page)
   — Design, data, methods, validation strategy, ethics.
5. Timeline (3-year Gantt: Y1 confirmation, Y2 data/experiments, Y3 write-up)
6. Expected Contributions (theoretical + practical)
7. Fit with Supervisor/Lab (cite their recent work)
8. References

Length target: 4–6 pages. Write for an intelligent non-specialist.`},
  { id:'t3', name:'Academic CV Skeleton', type:'CV structure', icon:'badge',
    body:`[NAME] — Academic CV
[email] · [Google Scholar] · [GitHub/ORCID] · [City, Sri Lanka]

EDUCATION — degree, university, GPA/class, thesis title (one line each)
PUBLICATIONS — reverse chronological; bold your name; include DOI
RESEARCH EXPERIENCE — role, lab, dates, 2 bullet results each (quantified)
TECHNICAL SKILLS — grouped: methods / tools / languages
AWARDS & FUNDING — include amounts where known
TEACHING & MENTORING
REFEREES — 3, with relationship stated

Rules: 2 pages max pre-PhD. No photo. No "objective" section. Every bullet starts with a verb and ends with evidence.`},
  { id:'t4', name:'Statement of Purpose Framework', type:'Writing guide', icon:'edit_note',
    body:`STATEMENT OF PURPOSE — 4-paragraph framework (max 1,000 words)

P1 — The Hook (research, not biography)
  Open with the research problem that drives you. One specific moment or result, not "since childhood".

P2 — Evidence of Capability
  Your strongest research experience: what you did, what you found, what you’d do differently. Numbers beat adjectives.

P3 — Why This University, This Lab
  Name the supervisor. Cite their recent work. Show your proposed direction extends theirs.

P4 — Trajectory
  What the PhD enables: your 10-year research vision and why NZ is the right place for it.

Avoid: rankings flattery, dictionary definitions, life stories before university.`},
];

/* Assessment definition */
const PF_QUESTIONS = [
  { id:'degree', q:'What is your highest completed (or in-progress) qualification?', opts:[
    { v:0, t:'Bachelor’s (3-year general)' },
    { v:2, t:'Bachelor’s Honours / 4-year special degree' },
    { v:3, t:'Master’s (coursework)' },
    { v:4, t:'Master’s (with research thesis) / MPhil' } ] },
  { id:'gpa', q:'How would you describe your academic results?', opts:[
    { v:1, t:'Second lower / GPA below 3.0' },
    { v:2, t:'Second upper / GPA 3.0–3.4' },
    { v:3, t:'First class / GPA 3.5–3.7' },
    { v:4, t:'Top of class / GPA 3.7+' } ] },
  { id:'research', q:'What is your research experience so far?', opts:[
    { v:0, t:'None yet' },
    { v:1, t:'Final-year undergraduate project' },
    { v:2, t:'Research assistant work or industry R&D' },
    { v:3, t:'Completed research thesis' },
    { v:4, t:'Peer-reviewed publication(s)' } ] },
  { id:'field', q:'Which field best matches your research interest?', opts: PF_FIELDS.map(f => ({ v:f, t:f })) },
  { id:'english', q:'Where are you with English proficiency tests?', opts:[
    { v:0, t:'Not started' },
    { v:1, t:'Preparing for IELTS / TOEFL' },
    { v:2, t:'Scored — below requirements (IELTS < 6.5)' },
    { v:3, t:'Scored — meets PhD requirements (IELTS 6.5+, no band < 6.0)' } ] },
  { id:'funding', q:'How will you fund your PhD?', opts:[
    { v:'scholarship', t:'I need a full scholarship' },
    { v:'partial', t:'Partial self-funding + scholarship' },
    { v:'self', t:'Fully self-funded' } ] },
  { id:'timeline', q:'When do you want to start your PhD?', opts:[
    { v:'6m', t:'Within 6 months' },
    { v:'1y', t:'In about a year' },
    { v:'2y', t:'1–2 years from now' },
    { v:'explore', t:'Just exploring for now' } ] },
];
