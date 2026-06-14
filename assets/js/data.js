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
  /* ── Emails & Correspondence ── */
  { id:'t1', name:'Supervisor First-Contact Email', type:'Email template', icon:'mail', category:'Emails & Correspondence',
    body:`Subject: Prospective PhD applicant — [Your research area] ([Intake] intake)

Dear Professor [Name],

I am [Your Name], a [degree] graduate in [field] from [University] (GPA [x]/4.0). I have followed your work on [specific paper/project], and your finding that [specific detail] closely relates to my research interest in [topic].

[2–3 sentences: your research experience, publications, or thesis — with one concrete result.]

I am preparing to apply for the [intake] PhD intake and would be honoured to explore whether my interests align with your group’s direction. I have attached my CV and a one-page research sketch.

Would you be open to a brief conversation, or could you advise whether you are accepting students for [year]?

Kind regards,
[Name] · [LinkedIn / Scholar profile] · [Phone]`},

  { id:'t5', name:'Follow-Up After No Supervisor Reply', type:'Email template', icon:'reply', category:'Emails & Correspondence',
    body:`Subject: Following up — PhD enquiry / [Your name] / [Research area]

Dear Professor [Name],

I hope this message finds you well. I wrote on [date] regarding potential PhD supervision in [topic] and wanted to follow up in case my email was missed.

I remain very interested in your group’s work on [specific project or paper]. My background in [field] — [one concrete credential: thesis title / publication / project result] — aligns closely with your current research direction.

If you are not accepting students at this time, I would appreciate knowing so I can plan accordingly. I would also welcome any recommendation of a colleague in your department whose work might be a good fit.

I have attached my CV and a one-page research sketch for convenience.

Thank you for your time.

Kind regards,
[Name] · [Email] · [LinkedIn/Scholar]

— Send this 2–3 weeks after the first email. One follow-up only; a second chase rarely helps.`},

  { id:'t6', name:'Reference Letter Request Email', type:'Email template', icon:'contact_mail', category:'Emails & Correspondence',
    body:`Subject: Request for academic reference — PhD application to [University]

Dear [Professor/Dr. Name],

I am applying for a PhD in [field] at [University] for the [year] intake, and I would be honoured if you would provide an academic reference on my behalf. The application deadline is [date].

During [course/project/thesis], you supervised my work on [topic]. I believe you are well placed to speak to [specific strength: analytical rigour / independence / research potential — pick one or two].

The reference will be submitted [online via a university portal / as a signed letter — specify]. I will send the official request link as soon as I submit my application.

I am happy to provide my CV, personal statement, and any other materials that would help you write a strong reference. Please let me know if you are willing and able to support my application, or if you have any questions.

Thank you very much for your time and support.

Kind regards,
[Name] · [email] · [phone]

— Ask at least 4–6 weeks before the deadline. Attach your CV to this email.`},

  { id:'t7', name:'Thank-You Email After Supervisor Meeting', type:'Email template', icon:'handshake', category:'Emails & Correspondence',
    body:`Subject: Thank you — our conversation on [date]

Dear Professor [Name],

Thank you for taking the time to speak with me on [date]. I found our discussion on [specific topic from the meeting] genuinely helpful, and your suggestion to [specific piece of advice] has already influenced how I am thinking about [aspect of your research].

To summarise what I understood from our conversation:
— [Key point 1]
— [Key point 2]
— [Next step agreed, e.g., "I will send you a revised research sketch by [date]"]

Please do let me know if I have misrepresented anything.

I look forward to [next agreed action: sending the draft / the formal application / staying in touch].

Kind regards,
[Name]

— Send within 24 hours of the meeting. Keep it concise: this email confirms intent and shows professionalism, not eloquence.`},

  { id:'t8', name:'Research Internship Application Email', type:'Email template', icon:'science', category:'Emails & Correspondence',
    body:`Subject: Research internship enquiry — [Your field] / [Your name]

Dear [Dr./Prof. Name],

I am [Name], a [degree year] student in [field] at [University], Sri Lanka. I am writing to enquire about the possibility of a short research internship (proposed: [duration, e.g., 6–8 weeks, remote or in-person]) in your group, ideally around [period].

I am particularly interested in your work on [specific project or paper]. My own background includes [2–3 relevant skills or experience], and I believe I could contribute to [specific aspect of their work] while gaining experience in [what you want to learn].

I have attached my CV. I am flexible on timing and format — including remote collaboration — and would be happy to discuss how such an arrangement could work.

Would you be open to a brief conversation?

Kind regards,
[Name] · [email] · [GitHub/LinkedIn]

— Even unpaid or remote internships build the publication record and supervisor relationship that make PhD applications stronger.`},

  { id:'t9', name:'Networking Email to PhD Peer / Alumnus', type:'Email template', icon:'group', category:'Emails & Correspondence',
    body:`Subject: PhD experience at [University] — quick question from a prospective student

Hi [Name],

My name is [Your Name], a final-year [degree] student in [field] at [University], Sri Lanka. I found your profile through [LinkedIn / the lab page / a publication] and noticed you are / were a PhD student in [Lab/Department] at [University].

I am seriously considering applying to [University] for [year] and would love to hear a few minutes’ worth of honest perspective on:
— Day-to-day life in the [department/lab]
— How approachable Professor [Supervisor name] is as a supervisor
— One thing you wish you had known before you arrived

I completely understand if you are too busy. Even a 10-minute call or a few lines by email would be enormously helpful.

Thank you for considering this.

Best,
[Name] · [email] · [LinkedIn]

— Current or recent PhD students are the most honest source of intelligence on a supervisor and lab. Most are willing to help a prospective student from the same country.`},

  { id:'t10', name:'Application Rejection — Graceful Response', type:'Email template', icon:'sentiment_neutral', category:'Emails & Correspondence',
    body:`Subject: Re: PhD application — [Your name]

Dear Professor [Name] / Admissions,

Thank you for letting me know. Although I am disappointed, I genuinely appreciate you taking the time to review my application.

If you have any brief feedback on the areas where my application was weakest, I would be grateful — it would help me strengthen a future application considerably.

I remain very interested in [the lab’s / the department’s] work and hope there may be an opportunity to apply again in a future round.

Thank you again for your time.

Kind regards,
[Name]

— A gracious response to rejection keeps a door open. Supervisors change their capacity; a good impression can lead to an invitation a year later. Never argue with a rejection.`},

  /* ── Application Documents ── */
  { id:'t2', name:'Research Proposal Outline', type:'Document outline', icon:'description', category:'Application Documents',
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

  { id:'t3', name:'Academic CV Skeleton', type:'CV structure', icon:'badge', category:'Application Documents',
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

  { id:'t4', name:'Statement of Purpose Framework', type:'Writing guide', icon:'edit_note', category:'Application Documents',
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

  { id:'t11', name:'Scholarship Personal Statement Framework', type:'Writing guide', icon:'workspace_premium', category:'Application Documents',
    body:`SCHOLARSHIP PERSONAL STATEMENT — framework (600–800 words typical)

Opening (1 short paragraph)
  State the specific scholarship by name. Anchor your application in one concrete research problem — not your desire to study, but the problem you intend to solve.

Academic & Research Record (1–2 paragraphs)
  Summarise your strongest qualification and research output. Use numbers: GPA, class rank, paper title, dataset size, accuracy improvement. One concrete outcome beats three vague claims.

Research Plan (1 paragraph)
  Describe what you will research, at which university, under which supervisor, and why that combination is the right one. Show you have already corresponded with the supervisor.

Development Impact (1 paragraph — critical for Manaaki NZ and similar awards)
  How will your PhD benefit Sri Lanka specifically? Be concrete: returning to teach, policy input, an industry application. Selection committees are funding development, not individual ambition.

Closing (2–3 sentences)
  Restate your fit for this scholarship (not all scholarships). End with one sentence about what you will do after the PhD.

Common mistakes: copying an SOP without tailoring; writing about your country’s problems in vague terms; not naming the scholarship funder’s priorities explicitly.`},

  { id:'t12', name:'Motivation Letter (Alternative to SOP)', type:'Writing guide', icon:'draw', category:'Application Documents',
    body:`MOTIVATION LETTER — when a university asks for this instead of an SOP
(Some NZ universities use this term for the same document; others treat it as a shorter, more personal version.)

Tone: First-person, direct. Less formal than an SOP but still professional.
Length: 600–800 words. No headers.

Paragraph 1 — Why this PhD, why now
  The specific intellectual problem that led you to this application. Not your background — the problem itself.

Paragraph 2 — Your evidence
  One or two research experiences that qualify you. What you built, found, or published. Show capability, not enthusiasm.

Paragraph 3 — Why this university and supervisor
  Name the supervisor. Reference a paper of theirs published in the last three years. Explain the connection to your proposed work in one sentence.

Paragraph 4 — What success looks like
  How you define a successful PhD: the contribution, not the credential. Mention plans beyond the degree if genuine.

Closing sentence: Confirm you have read the application requirements and are prepared to meet them.

Do not: open with "My name is…" or "Since I was a child…". Do not exceed the word limit.`},

  /* ── Research & Career ── */
  { id:'t13', name:'Conference / Seminar Abstract Template', type:'Research writing', icon:'article', category:'Research & Career',
    body:`CONFERENCE ABSTRACT — 250-word structure

Title: [Specific, informative — not "A study of X" but "X increases Y by Z under condition W"]

Background (40–50 words)
  The problem and why it matters. One or two sentences of context, ending on the specific gap your work addresses.

Objective (20–30 words)
  State what this study/paper sets out to do — one sentence, one verb.

Methods (50–60 words)
  Dataset or experimental design, key variables, analytical approach. Be precise about sample sizes, algorithms, or methods used.

Results (70–80 words)
  Your main finding(s), with numbers. If it’s a proposal or work-in-progress, describe expected/preliminary results and current status.

Conclusion / Significance (40–50 words)
  What the finding means for the field. One sentence on limitations or future work is optional but honest.

Keywords: [5 terms, comma-separated]

— Before submitting: read the CFP word limit carefully; abstract word counts are strict. Remove all jargon that is not defined in 3 words or fewer. Have a native-English-level reader review it.`},

  { id:'t14', name:'PhD Interview Preparation Guide', type:'Preparation checklist', icon:'quiz', category:'Research & Career',
    body:`PhD INTERVIEW PREPARATION — checklist & talking points

BEFORE THE INTERVIEW
□ Re-read your own research proposal and CV — supervisors ask about your own writing
□ Read 2–3 recent papers from the supervisor’s group (published last 2 years)
□ Prepare a 3-minute verbal summary of your research background
□ Know your GPA, thesis title, and publication titles from memory
□ Prepare 3 questions to ask the supervisor (see below)
□ Test your video/audio if it is a remote interview

LIKELY QUESTIONS (and how to approach them)
"Tell me about your research."
  → 3 minutes max. Problem, method, result, what you’d do differently.

"Why do you want to do a PhD?"
  → Specific intellectual problem, not career advancement. One concrete example.

"Why this supervisor / this lab?"
  → Name a paper. Describe the connection to your proposed work.

"What are your weaknesses as a researcher?"
  → Be honest. Name one real limitation, then show self-awareness of how to address it.

"What do you do when your research hits a dead end?"
  → Describe a real instance from your previous work if possible.

QUESTIONS TO ASK THE SUPERVISOR
  • What does a successful first year look like for your students?
  • How often do you meet with PhD students, and in what format?
  • Are there funded projects I would be expected to contribute to, or is my proposal fully independent?

AFTER THE INTERVIEW
  Send a brief thank-you email within 24 hours (use the thank-you template).`},

  { id:'t15', name:'3-Year PhD Research Plan', type:'Planning template', icon:'calendar_month', category:'Research & Career',
    body:`3-YEAR PhD RESEARCH PLAN — timeline template

YEAR 1 — Foundation & Confirmation
  Months 1–3:   Orientation, literature review, supervisor meetings weekly
  Months 4–6:   Narrow research questions; identify methods; ethics application if needed
  Months 7–9:   Preliminary experiments or data collection; first chapter draft
  Months 10–12: Confirmation of candidature document; internal seminar presentation
  Milestone:    Confirmation passed ✓

YEAR 2 — Core Research
  Months 13–15: Main data collection / experiments begin
  Months 16–18: Analysis and first full results chapter
  Months 19–21: Second results chapter; conference abstract submission
  Months 22–24: Conference presentation; journal paper draft submitted
  Milestone:    At least one submitted journal paper ✓

YEAR 3 — Writing & Completion
  Months 25–27: Final data analysis; third results chapter
  Months 28–30: Full thesis draft to supervisor
  Months 31–33: Revisions based on supervisor feedback
  Months 34–36: Submission; oral examination (viva)
  Milestone:    Thesis submitted ✓

NOTES
  — Build 2–3 months of contingency into any timeline; experiments rarely run on schedule.
  — Scholarship typically covers 3 years; some NZ universities allow a 6-month no-fee extension.
  — Update this plan each semester with your supervisor’s sign-off.`},

  { id:'t16', name:'Literature Review Notes Template', type:'Research tool', icon:'library_books', category:'Research & Career',
    body:`LITERATURE REVIEW — structured notes per paper

Paper reference: [Author(s), Year, Title, Journal, DOI]
Read date: [date]

1. Core argument / main finding (2–3 sentences in your own words)

2. Methods used
   — Design:
   — Data/sample:
   — Key analytical technique:

3. Key result(s) with numbers

4. Limitations acknowledged by the authors

5. How it relates to YOUR research question
   — Supports / contradicts / complements?
   — Gap it leaves that your work addresses?

6. Useful quotes (with page numbers for citation)
   — "[quote]" (p. XX)

7. Papers in its reference list worth reading next
   — [Author, Year] — reason to read

──────────────────────────────────────────
SYNTHESISING ACROSS PAPERS

Grouping themes (after reviewing 10+ papers):
  Theme A: [papers that agree on X]
  Theme B: [papers that challenge X using Y method]
  Gap:     [what nobody has studied — your entry point]

Running annotation: Keep one master spreadsheet with columns: Author/Year | Argument | Method | Finding | Relevance to me | Cited by

Target: 80–120 sources for a humanities/social sciences PhD; 40–80 for STEM.`},

  /* ── Practical & Logistics ── */
  { id:'t17', name:'NZ Student Visa — Evidence Checklist', type:'Checklist', icon:'checklist', category:'Practical & Logistics',
    body:`NEW ZEALAND STUDENT VISA — evidence checklist for PhD applicants

IDENTITY
□ Valid passport (at least 12 months beyond intended departure date)
□ Recent passport-size photos (as per Immigration NZ spec)

ADMISSION
□ Offer of Place letter from the NZ university (must show course, start date, duration)
□ If PhD scholarship awarded: scholarship letter (reduces funds evidence requirement)

FINANCIAL EVIDENCE (required if no full scholarship)
□ Bank statements — last 3–6 months showing consistent balance
□ Minimum NZ$20,000/yr for living costs (guideline; check INZ website for current figure)
□ Evidence of tuition fee payment or fee waiver (PhD domestic rate ~NZ$7–8k/yr)
□ If funded by family: evidence of their financial capacity + relationship

HEALTH & CHARACTER
□ Medical certificate (eMedical report via INZ-approved physician; required if stay > 24 months)
□ Police clearance certificate from Sri Lanka (apply via Sri Lanka Police; allow 6–8 weeks)
□ Character declaration (online form within visa application)

ENGLISH PROFICIENCY
□ IELTS Academic: overall 6.5, no band below 6.0 (most NZ universities)
□ Or: TOEFL iBT 90+, PTE 58+, or confirmation of prior study in English medium

APPLICATION
□ Apply online at immigration.govt.nz (eVisa)
□ Processing time: 6–8 weeks average (2026 — check INZ for current times)
□ Apply at least 3 months before intended start date

NOTES
  — PhD students may work unlimited hours; partners may apply for an open work visa.
  — Keep all originals; do not submit originals, only certified copies unless instructed.`},

  { id:'t18', name:'Pre-Departure NZ Orientation Checklist', type:'Checklist', icon:'flight_takeoff', category:'Practical & Logistics',
    body:`PRE-DEPARTURE CHECKLIST — arriving in New Zealand for your PhD

BEFORE YOU LEAVE SRI LANKA
□ Confirm accommodation (university hall or private — book 3+ months ahead for Jan/Feb intake)
□ Open a NZ bank account before arrival if possible (ASB, BNZ, ANZ all allow online pre-arrival setup)
□ Set up an IRD number application (Inland Revenue — needed to work; apply online 2 weeks after arrival)
□ Purchase travel insurance covering health and repatriation for full PhD duration
□ Notify your Sri Lankan bank of overseas use; order an international debit/credit card
□ Pack academic originals: degree certificates, transcripts, thesis (for university enrolment)
□ Obtain NZ power adapter (type I — 3-pin, same as Australia)

FIRST WEEK IN NZ
□ Complete university enrolment and collect student ID
□ Register with a GP (family doctor) — enrolment is free; do this early
□ Obtain NZ SIM card (Spark, One NZ, 2degrees)
□ Activate IRD number and give to employer/scholarship administrator
□ Find and join the Sri Lankan Students Association at your university
□ Attend PhD induction / orientation day

FINANCES
□ Scholarship first payment: confirm date and bank account with university finance office
□ Understand tax: PhD stipends are taxable in NZ (withholding tax auto-deducted)
□ Set up automatic rent payments if not in university halls

HEALTH
□ Register with university health services (separate from community GP)
□ ACC (Accident Compensation): covers injuries for everyone in NZ, including international students

CITY-SPECIFIC NOTES
□ Auckland: AT Hop card for buses/trains; cycling is feasible
□ Dunedin: warmest months Nov–Mar; bring thermals; student culture is very welcoming
□ Wellington: windy — budget for a decent coat; walkable city; good bus network
□ Christchurch: car useful; flat city good for cycling; rebuild is ongoing`},

  { id:'t19', name:'PhD Budget Planning Template', type:'Planning template', icon:'savings', category:'Practical & Logistics',
    body:`PhD BUDGET PLAN — annual (NZ dollars)

INCOME
  Scholarship stipend (gross):          NZ$ _________ /yr
  Less: withholding tax (~10.5%–17.5%): NZ$ _________ /yr
  Part-time work (estimate, optional):  NZ$ _________ /yr
  ─────────────────────────────────────
  TOTAL NET INCOME:                     NZ$ _________

FIXED COSTS (monthly × 12)
  Rent (incl. utilities if included):  NZ$ _________ /mo × 12 = _________
  Electricity / internet (if separate): NZ$ _________  /mo × 12 = _________
  Health insurance or GP visits:        NZ$ _________ /yr
  Phone plan:                           NZ$ _________ /mo × 12 = _________
  ─────────────────────────────────────
  TOTAL FIXED:                          NZ$ _________

VARIABLE COSTS (estimates)
  Groceries (self-catering):           ~NZ$180–250/mo → /yr = _________
  Transport (bus/cycling):             ~NZ$60–120/mo → /yr = _________
  Clothing & household:                ~NZ$600–1,200/yr
  Books & academic costs:              ~NZ$200–500/yr (most is online/library)
  Conference travel (budgeted):        NZ$ _________ /yr
  Travel to Sri Lanka (1 trip/yr):     ~NZ$1,400–2,000 return
  Entertainment & social:              NZ$ _________ /mo × 12 = _________
  Contingency (10%):                   NZ$ _________

TOTAL OUTGOINGS:                        NZ$ _________

SURPLUS / DEFICIT:                      NZ$ _________

NOTES
  — Dunedin and Hamilton cost 20–30% less than Auckland for rent.
  — PhD students are entitled to Working for Families tax credits if they have dependent children.
  — Scholarship stipends are reviewed annually; some include a cost-of-living adjustment.
  — University hardship funds exist; know yours before you need them.`},
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

/* ── Visa Hub: the NZ student-visa process, stage by stage ── */
const PF_VISA_STAGES = [
  { id:'vs1', title:'Offer of Place', when:'Weeks 0–2', dur:'1–2 weeks', cost:'Free', color:'teal',
    icon:'verified', consult:'visa-offer',
    summary:'Immigration NZ needs the unconditional Offer of Place from your university before you can apply. Conditional offers are not accepted.',
    where:[
      { name:'Your university’s international admissions office', detail:'Request the unconditional offer letter (PDF). If funded, also get the scholarship letter stating exact fees + stipend amounts in NZ$.' },
    ],
    steps:[
      { id:'vs1a', t:'Receive unconditional Offer of Place (PDF)', note:'Conditional offers are not accepted by INZ' },
      { id:'vs1b', t:'Scholarship / funding letter shows exact NZ$ amounts', note:'Fees coverage + annual stipend, on university letterhead' },
      { id:'vs1c', t:'Check offer start date gives you 3+ months for the visa', note:'Ask admissions to defer if the runway is too short' },
    ]},
  { id:'vs2', title:'Document Gathering', when:'Weeks 1–4', dur:'2–4 weeks', cost:'~LKR 10,000–25,000', color:'violet',
    icon:'folder_open', consult:'visa-docs',
    summary:'Certified copies, translations, and financial evidence. Start early — bank letters and certified copies have queues of their own.',
    where:[
      { name:'Your bank branch (BOC / Peoples / Commercial / HNB / Sampath)', detail:'Funds-evidence letter: 3–6 months of statements + a balance confirmation letter. If parents fund you, their statements + an affidavit of support.' },
      { name:'Justice of the Peace / Notary Public / Attorney-at-Law', detail:'Certified true copies of degree certificates, transcripts, passport bio page, and birth certificate.' },
      { name:'Sworn translator (if documents are in Sinhala/Tamil)', detail:'INZ requires certified English translations. The Department of Official Languages or a sworn translator can certify.' },
    ],
    steps:[
      { id:'vs2a', t:'Passport valid 12+ months beyond intended departure', note:'Renew first if it is close — Immigration & Emigration Dept, Battaramulla' },
      { id:'vs2b', t:'Certified copies of degree certificate + transcripts', note:'' },
      { id:'vs2c', t:'Funds evidence: NZ$20,000+/yr living costs OR scholarship letter', note:'Scholarship letter replaces most funds evidence' },
      { id:'vs2d', t:'Birth certificate (translated if needed)', note:'' },
      { id:'vs2e', t:'Passport-size photos to INZ spec', note:'White background, 900×1200 px digital' },
    ]},
  { id:'vs3', title:'Medical & Police Clearance', when:'Weeks 3–7', dur:'3–5 weeks', cost:'~LKR 50,000–70,000', color:'gold',
    icon:'medical_services', consult:'visa-medical',
    summary:'Both run in parallel. Start the police certificate first — it is the slow one.',
    where:[
      { name:'Sri Lanka Police HQ, Colombo 01', detail:'Police Clearance Certificate — apply online at police.lk or in person; allow 2–3 weeks; ~LKR 1,500–3,000. Needed if you are 17+ and staying more than 24 months.' },
      { name:'INZ panel physician, Colombo (IOM Health Assessment Centre or approved hospitals)', detail:'eMedical + chest X-ray; book 1–2 weeks ahead; bring passport; results transmit electronically to INZ. ~LKR 45,000–60,000.' },
    ],
    steps:[
      { id:'vs3a', t:'Apply for Police Clearance Certificate at police.lk', note:'Needed if 17+ and staying >24 months' },
      { id:'vs3b', t:'Book eMedical with an INZ panel physician', note:'Only panel physicians count — list on immigration.govt.nz' },
      { id:'vs3c', t:'Complete medical examination + chest X-ray', note:'Results go directly to INZ — note your eMedical reference (NZER)' },
      { id:'vs3d', t:'Collect Police Clearance Certificate', note:'' },
    ]},
  { id:'vs4', title:'eVisa Application', when:'Weeks 6–8', dur:'2–4 hours of work', cost:'~NZ$430 (fee + levy)', color:'rose',
    icon:'edit_document', consult:'visa-evisa',
    summary:'Everything is online at immigration.govt.nz. Set aside an afternoon, upload clean scans, and pay by card.',
    where:[
      { name:'immigration.govt.nz — Fee Paying Student Visa (online)', detail:'Create a RealMe account, complete the form, upload all documents as clear PDFs, pay the application fee + immigration levy by credit/debit card.' },
    ],
    steps:[
      { id:'vs4a', t:'Create RealMe / INZ online account', note:'' },
      { id:'vs4b', t:'Complete the Fee Paying Student Visa form', note:'PhD students choose this category — domestic fees still apply' },
      { id:'vs4c', t:'Upload all documents as clear PDF scans', note:'Photographs of documents are commonly rejected — scan properly' },
      { id:'vs4d', t:'Pay fee + levy (~NZ$430) by card', note:'An international-enabled card — call your bank to unlock online foreign payments' },
      { id:'vs4e', t:'Note your application number', note:'' },
    ]},
  { id:'vs5', title:'Processing & Follow-ups', when:'Weeks 8–16', dur:'6–8 weeks typical', cost:'Free', color:'teal',
    icon:'hourglass_top', consult:'visa-evisa',
    summary:'INZ may request additional documents mid-way. Respond within days, not weeks — silence stalls your file.',
    where:[
      { name:'INZ online portal + your email', detail:'All correspondence is electronic. Check spam folders. Case officers commonly ask for updated bank statements or clarification of funds.' },
    ],
    steps:[
      { id:'vs5a', t:'Application status shows "In progress"', note:'' },
      { id:'vs5b', t:'Respond to any INZ requests within 3–5 days', note:'Slow replies push you to the back of the queue' },
      { id:'vs5c', t:'Keep funds untouched in the evidenced account', note:'INZ can re-check balances before decision' },
    ]},
  { id:'vs6', title:'Decision', when:'Week 12–16', dur:'—', cost:'Free', color:'violet',
    icon:'task_alt', consult:'visa-evisa',
    summary:'Your eVisa arrives by email. Check every detail on it the day it arrives.',
    where:[
      { name:'Email + INZ portal', detail:'The eVisa letter states your visa conditions: institution, course, work rights (unlimited hours for PhD), and validity dates.' },
    ],
    steps:[
      { id:'vs6a', t:'eVisa received — check name spelling and passport number', note:'Errors must be corrected before travel' },
      { id:'vs6b', t:'Confirm work rights show unlimited hours (PhD)', note:'' },
      { id:'vs6c', t:'Confirm validity covers your full first year+', note:'' },
    ]},
  { id:'vs7', title:'Pre-Departure', when:'Final 4–6 weeks', dur:'4–6 weeks', cost:'Flights ~LKR 250,000–400,000', color:'gold',
    icon:'flight_takeoff', consult:'visa-predeparture',
    summary:'Flights, insurance, accommodation, money. The Settle In guide takes over from here.',
    where:[
      { name:'Airlines (SriLankan / Singapore Airlines / Emirates via AUS)', detail:'CMB → AKL/WLG/CHC typically 1–2 stops. Book 6–8 weeks out; student fares sometimes allow extra baggage.' },
      { name:'University accommodation office', detail:'Book at least first-month accommodation before you fly — university halls or temporary studios.' },
    ],
    steps:[
      { id:'vs7a', t:'Book flights', note:'Check baggage allowance — 30kg+ is worth paying for' },
      { id:'vs7b', t:'Travel/health insurance for the journey + first weeks', note:'' },
      { id:'vs7c', t:'First-month accommodation confirmed', note:'' },
      { id:'vs7d', t:'Carry NZ$200–400 cash + an international card', note:'' },
      { id:'vs7e', t:'Open the Settle In guide and work the first-48-hours list', note:'' },
    ]},
];

/* ── Settle In: life setup in New Zealand ── */
const PF_SETTLEMENT_CATS = [
  { id:'first',     label:'First 48 hours',   icon:'flight_land' },
  { id:'money',     label:'Money & banking',  icon:'account_balance' },
  { id:'transport', label:'Getting around',   icon:'directions_bus' },
  { id:'housing',   label:'Finding a home',   icon:'home' },
  { id:'family',    label:'Family & partner', icon:'family_restroom' },
  { id:'apps',      label:'Apps to install',  icon:'apps' },
];

const PF_SETTLEMENT = [
  { id:'set1', cat:'first', icon:'flight_land', title:'Airport → your accommodation', consult:'settle-arrival',
    body:'Every NZ university city has a cheap, reliable airport route. Don’t pre-book an expensive taxi — but do know your route before you land.',
    perCity:{
      'Auckland':'SkyDrive bus to CBD ~NZ$18, 45 min. Buy an AT HOP card at the airport kiosk.',
      'Wellington':'Metlink Airport Express (AX) ~NZ$10 to the railway station.',
      'Christchurch':'Purple Line bus to the city ~NZ$4 with a Metrocard, ~NZ$8.50 cash.',
      'Dunedin':'Super Shuttle shared van ~NZ$25 — book online; no public bus from the airport.',
      'Hamilton':'Fly into Auckland, then InterCity bus to Hamilton ~NZ$25–35, 2 hrs.',
      'Palmerston North':'Direct flights from AKL/WLG; taxi to city ~NZ$25 or Uber.',
    }},
  { id:'set2', cat:'first', icon:'sim_card', title:'SIM card on day one', consult:'settle-arrival',
    body:'Get connected before you leave the airport — you’ll need data for maps, banking, and calling home.',
    tips:[ 'Spark, One NZ, or 2degrees — all sell tourist/starter SIMs at airports',
           '2degrees and Skinny are usually cheapest for students (~NZ$20–30/mo)',
           'Bring an unlocked phone from Sri Lanka — locked phones are a headache',
           'WhatsApp works as at home — your family is one tap away' ]},
  { id:'set3', cat:'first', icon:'checklist', title:'Your first-week checklist', consult:'settle-arrival',
    body:'Six things to finish in week one — each unlocks the next.',
    tips:[ 'Complete university enrolment, collect student ID',
           'Open a bank account (booked from Sri Lanka — see Money tab)',
           'Apply for an IRD number via myIR (needed before any stipend/work payment)',
           'Register with a GP (family doctor) — enrolment is free, do it before you are sick',
           'Register with university health + international student support',
           'Find the Sri Lankan Students Association — instant community' ]},
  { id:'set4', cat:'money', icon:'account_balance', title:'Open a bank account (ANZ / BNZ / Kiwibank / ASB)', consult:'settle-banking',
    body:'Most NZ banks let you start the account opening online from Sri Lanka before you fly, then verify in-branch after arrival.',
    tips:[ 'Start online 2–4 weeks before flying; book the in-branch verification slot',
           'Bring: passport + visa, university offer/enrolment letter, NZ address (your hall counts)',
           'Ask for a fee-free student account',
           'Get the debit card before your scholarship’s first payment date' ]},
  { id:'set5', cat:'money', icon:'badge', title:'IRD number — your tax ID', consult:'settle-banking',
    body:'Nothing pays you in NZ without an IRD number — not your stipend, not a part-time job. Apply in week one.',
    tips:[ 'Apply free online at ird.govt.nz via myIR once you have a bank account',
           'Takes ~2 working days (up to 10)',
           'PhD stipends are typically tax-exempt scholarship income, but salaried work is taxed — give your employer the IRD number',
           'Without it you are emergency-taxed at the highest rate' ]},
  { id:'set6', cat:'money', icon:'currency_exchange', title:'Sending & receiving money from Sri Lanka', consult:'settle-banking',
    body:'Bank-to-bank international transfers are slow and expensive. Most students use a transfer service.',
    tips:[ 'Wise (formerly TransferWise) is the most-used LKR↔NZD route',
           'Western Union / Ria work for cash pickup by family at home',
           'Carry NZ$200–400 cash for the first days; exchange a little at a Colombo bank before flying',
           'Avoid airport currency counters — worst rates in the country' ]},
  { id:'set7', cat:'transport', icon:'directions_bus', title:'Bus cards & getting around', consult:'settle-arrival',
    body:'Each city has its own transit card. Student fares cut costs significantly — register your card with your student email.',
    perCity:{
      'Auckland':'AT HOP card + AT Mobile app. Tertiary concession ≈ 30% off.',
      'Wellington':'Snapper card + Metlink app. Very walkable city core.',
      'Christchurch':'Metrocard — flat fares; flat city is great for cycling.',
      'Dunedin':'Bee Card. Most students walk — the campus and flats are close.',
      'Hamilton':'Bee Card (same as Dunedin) on Waikato buses.',
      'Palmerston North':'Bee Card; Massey shuttle runs to the campus.',
    }},
  { id:'set8', cat:'transport', icon:'pedal_bike', title:'Bikes, cars & licences', consult:'settle-arrival',
    body:'You can drive on your Sri Lankan licence (with an English translation or IDP) for 12 months. Many PhD students never need a car.',
    tips:[ 'Christchurch and Hamilton are flat — a second-hand bike (~NZ$100–250 on TradeMe) covers everything',
           'A used car costs NZ$3,000–6,000 + insurance + WOF + registration — only worth it for families',
           'Convert to a NZ licence within 12 months if you will keep driving',
           'Uber exists in all the university cities; intercity buses (InterCity) are cheap' ]},
  { id:'set9', cat:'housing', icon:'home_work', title:'Flat-hunting: TradeMe & flatmates', consult:'settle-housing',
    body:'TradeMe Property is the rental market. "Flatting" (sharing a house) is the NZ norm for students — and the only way Auckland rents stay sane.',
    tips:[ 'TradeMe Property + Flatmates Wanted (Facebook groups) are where everything is listed',
           'Rent is quoted PER WEEK, not per month — NZ$220/wk ≈ NZ$950/mo',
           'Bond = up to 4 weeks rent, lodged with Tenancy Services (refundable)',
           'Never pay anything before viewing — scams target overseas students',
           'University accommodation for the first 1–3 months gives you time to flat-hunt properly' ]},
  { id:'set10', cat:'housing', icon:'real_estate_agent', title:'Can’t view a flat from Colombo? Use a proxy viewer', consult:'settle-housing',
    body:'The classic trap: you must secure housing before you arrive, but you can’t inspect anything from Sri Lanka. A PathFinder mentor in your city can view flats for you — photos, video call walkthrough, and an honest opinion about the street.',
    tips:[ 'Ask the mentor to check: insulation/heating (critical in Dunedin/Christchurch), mould, water pressure, distance to campus',
           'A 20-minute video viewing has saved students from year-long mistakes',
           'Alternatively: book university halls for semester one and hunt in person' ]},
  { id:'set11', cat:'family', icon:'work', title:'Partner’s open work visa', consult:'settle-family',
    body:'Your partner can apply for an open work visa tied to your PhD enrolment — full-time work, any employer.',
    tips:[ 'Apply together with your visa or after arrival — together is usually faster',
           'Evidence of relationship: marriage certificate + shared life evidence (photos, joint accounts)',
           'Partner’s income changes your budget completely — see the cost calculator',
           'Your children attend school as domestic students (free state schooling)' ]},
  { id:'set12', cat:'family', icon:'school', title:'Schools & early childhood for your kids', consult:'settle-family',
    body:'School-age children of PhD students are treated as domestic students — no international fees. Enrolment is by home address ("school zone").',
    tips:[ 'Pick the suburb by its school zone — check schoolzones.co.nz before signing a lease',
           'School year runs Feb–Dec in 4 terms',
           'ECE: 20 free hours/week from age 3',
           'Enrol with the school directly; you need proof of address + child’s passport/visa' ]},
  { id:'set13', cat:'family', icon:'medical_information', title:'Healthcare, pregnancy & babies', consult:'settle-family',
    body:'PhD students (visa 2+ years) and their families are generally eligible for publicly funded healthcare — a major hidden benefit of NZ.',
    tips:[ 'Enrol the whole family with a GP practice (PHO) in week one',
           'Maternity care is free for eligible students — register with a midwife (LMC) early',
           'Plunket supports new parents free — nurse visits, helpline, parent groups',
           'ACC covers accident treatment for everyone in NZ, visitor or resident',
           'Dentists are NOT subsidised — fix your teeth in Sri Lanka before flying' ]},
  { id:'set14', cat:'apps', icon:'apps', title:'The apps to install in week one', consult:'settle-arrival',
    body:'The short list every student ends up with — install before you fly.',
    tips:[ 'Transit: AT Mobile (Auckland) / Metlink (Wellington) / Transit app (anywhere)',
           'Your bank’s app: ANZ goMoney, BNZ, Kiwibank, ASB',
           'TradeMe — rentals, second-hand furniture, bikes, cars',
           'MetService — NZ weather changes by the hour, take it seriously',
           'Wise — money to/from Sri Lanka',
           'myIR (web) — tax + IRD number',
           'Uber + Menulog/UberEats — they work in all university cities',
           'Google Maps offline maps of your city — for day one' ]},
];

/* ── Cost of living: per-city baselines for the calculator ──
   Rent/living figures reviewed Jun 2026 against Tenancy Services bond
   data, the Trade Me Rental Price Index and Numbeo. `lastVerified`
   stamps each entry so future audits are quick. Figures are indicative
   flat-share/whole-flat costs — always confirm with the university.
   See PF_CONFIG.dataVerified for the module-wide disclaimer date. */
const PF_COST_MULT = { single:1, couple:1.65, family:2.2 };
const PF_CITY_COSTS = [
  { id:'akl', city:'Auckland', unis:['uoa','aut','massey'], lastVerified:'2026-06',
    rentWeekly:{ single:320, couple:450, family:620 },
    monthly:{ food:500, transport:175, utilities:170, phone:30, other:190 },
    setup:{ bondWeeks:4, furnishings:1200, misc:500 },
    note:'Most expensive city. Many PhD students flat-share in Sandringham, Mt Roskill, or near Symonds St.' },
  { id:'wlg', city:'Wellington', unis:['vuw'], lastVerified:'2026-06',
    rentWeekly:{ single:270, couple:400, family:560 },
    monthly:{ food:470, transport:90, utilities:175, phone:30, other:175 },
    setup:{ bondWeeks:4, furnishings:1000, misc:450 },
    note:'Compact and walkable — many students skip transport costs entirely. Budget for a serious raincoat.' },
  { id:'chc', city:'Christchurch', unis:['uc'], lastVerified:'2026-06',
    rentWeekly:{ single:230, couple:350, family:490 },
    monthly:{ food:455, transport:80, utilities:185, phone:30, other:160 },
    setup:{ bondWeeks:4, furnishings:950, misc:400 },
    note:'Flat city, great for cycling. Riccarton and Ilam are the student suburbs next to UC.' },
  { id:'dud', city:'Dunedin', unis:['uoo'], lastVerified:'2026-06',
    rentWeekly:{ single:190, couple:310, family:440 },
    monthly:{ food:445, transport:60, utilities:205, phone:30, other:160 },
    setup:{ bondWeeks:4, furnishings:900, misc:400 },
    note:'Cheapest rents in the country; budget extra for heating — the housing stock is old and the winters are real.' },
  { id:'ham', city:'Hamilton', unis:['waikato'], lastVerified:'2026-06',
    rentWeekly:{ single:210, couple:330, family:470 },
    monthly:{ food:445, transport:70, utilities:175, phone:30, other:150 },
    setup:{ bondWeeks:4, furnishings:900, misc:400 },
    note:'Affordable and close to Auckland (2 hrs). Hillcrest and Hamilton East are walking distance to Waikato.' },
  { id:'pn', city:'Palmerston North', unis:['massey'], lastVerified:'2026-06',
    rentWeekly:{ single:185, couple:300, family:420 },
    monthly:{ food:435, transport:60, utilities:175, phone:30, other:150 },
    setup:{ bondWeeks:4, furnishings:850, misc:380 },
    note:'One of the cheapest university cities; a Massey stipend goes a long way here.' },
];

/* ── Everyday price reference for "What can NZD$20 buy?" ──
   Short, dated list of typical 2026 NZ retail prices. `perCity` overrides
   the value where it varies (e.g. student bus fares). Always indicative —
   see PF_CONFIG.dataVerified. // TODO: verify each figure annually. */
const PF_PRICE_REFERENCE = [
  { id:'coffee',    label:'Café flat white',                 icon:'local_cafe',          nzd:5.5,  note:'Standard café price nationwide' },
  { id:'lunch',     label:'Supermarket lunch (meal deal)',   icon:'lunch_dining',        nzd:8,    note:'Sandwich + drink combo' },
  { id:'bus',       label:'Bus ride (student concession)',   icon:'directions_bus',      nzd:2.5,  note:'Tertiary concession fare',
    perCity:{ akl:2.65, wlg:2.41, chc:2.00, dud:2.00, ham:2.42, pn:2.42 } },
  { id:'bread',     label:'Loaf of bread',                   icon:'bakery_dining',       nzd:3,    note:'Mid-range supermarket loaf' },
  { id:'milk',      label:'2L milk',                         icon:'water_full',          nzd:4.6,  note:'Standard supermarket price' },
  { id:'data',      label:'1GB mobile data top-up',          icon:'signal_cellular_alt', nzd:5,    note:'Prepay add-on (Skinny/2degrees)' },
  { id:'groceries', label:'A day of self-catered groceries', icon:'shopping_cart',       nzd:15,   note:'Cooking for one' },
  { id:'movie',     label:'Student cinema ticket',           icon:'movie',               nzd:14,   note:'Weekday student price' },
];

/* ── Mentors & consultations ── */
const PF_CONSULT_TOPICS = {
  'visa-offer':        'Offer & admission',
  'visa-docs':         'Visa documents',
  'visa-medical':      'Medical & police clearance',
  'visa-evisa':        'eVisa application',
  'visa-predeparture': 'Pre-departure',
  'settle-arrival':    'First days in NZ',
  'settle-banking':    'Banking & IRD',
  'settle-housing':    'Finding a flat',
  'settle-family':     'Family & schools',
  'roadmap-supervisor':'Supervisor outreach',
  'roadmap-proposal':  'Research proposal',
};

/* NOTE: placeholder profiles — swap in real mentors here.
   Each field maps 1:1 to what renders on the mentor card;
   email/whatsapp/calendly are optional (buttons appear only when set). */
const PF_MENTORS = [
  { id:'m1', name:'Kasun Jayawardena', city:'Dunedin', uni:'uoo', field:'Health & Medicine',
    tags:['visa-medical','visa-evisa','settle-arrival','settle-housing'],
    bio:'3rd-year PhD at Otago. Moved from Kandy with his wife in 2023 — did the entire visa file and the flat hunt remotely, and remembers every trap.',
    langs:'Sinhala · English', availability:'Weekends, 7–10pm SL time',
    packages:[
      { name:'Intro call · 15 min', price:'Free' },
      { name:'Visa file review · 60 min', price:'LKR 6,000 · ~NZ$30' },
      { name:'Flat viewing by proxy (Dunedin)', price:'LKR 4,000 · ~NZ$20' },
    ],
    email:'', whatsapp:'', calendly:'' },
  { id:'m2', name:'Tharushi Fernando', city:'Auckland', uni:'uoa', field:'Computer Science & AI',
    tags:['roadmap-supervisor','roadmap-proposal','visa-offer'],
    bio:'PhD candidate at the Strong AI Lab. Has reviewed 40+ proposal drafts and supervisor emails for Sri Lankan applicants.',
    langs:'Sinhala · Tamil · English', availability:'Wed & Sat evenings NZ time',
    packages:[
      { name:'Intro call · 15 min', price:'Free' },
      { name:'Proposal review + written notes', price:'LKR 7,500 · ~NZ$37' },
      { name:'Mock supervisor interview · 45 min', price:'LKR 5,000 · ~NZ$25' },
    ],
    email:'', whatsapp:'', calendly:'' },
  { id:'m3', name:'Dilan Wickramasinghe', city:'Christchurch', uni:'uc', field:'Engineering',
    tags:['visa-docs','visa-predeparture','settle-family'],
    bio:'Final-year PhD at Canterbury. Relocated with two school-age kids — knows school zones, partner work visas, and family budgets first-hand.',
    langs:'Sinhala · English', availability:'Sunday mornings SL time',
    packages:[
      { name:'Intro call · 15 min', price:'Free' },
      { name:'Family relocation planning · 60 min', price:'LKR 6,500 · ~NZ$32' },
      { name:'Full visa file review (family application)', price:'LKR 9,000 · ~NZ$45' },
    ],
    email:'', whatsapp:'', calendly:'' },
  { id:'m4', name:'Nadeesha Perera', city:'Wellington', uni:'vuw', field:'Social Sciences & Education',
    tags:['roadmap-proposal','visa-evisa','settle-banking','settle-arrival'],
    bio:'PhD candidate and former bank officer from Colombo — walks students through funds evidence, IRD, and the first-week money setup.',
    langs:'Sinhala · English', availability:'Weekday evenings SL time',
    packages:[
      { name:'Intro call · 15 min', price:'Free' },
      { name:'Funds-evidence & banking session · 45 min', price:'LKR 4,500 · ~NZ$22' },
      { name:'Scholarship statement rewrite', price:'LKR 8,000 · ~NZ$40' },
    ],
    email:'', whatsapp:'', calendly:'' },
  { id:'m5', name:'Ramesh Sivakumar', city:'Hamilton', uni:'waikato', field:'Computer Science & AI',
    tags:['roadmap-supervisor','settle-housing','settle-arrival'],
    bio:'2nd-year PhD in the ML group at Waikato, from Jaffna. Helps with supervisor shortlists and finding flats in Hamilton East.',
    langs:'Tamil · English', availability:'Sat & Sun, flexible',
    packages:[
      { name:'Intro call · 15 min', price:'Free' },
      { name:'Supervisor shortlist + email review', price:'LKR 5,000 · ~NZ$25' },
      { name:'Hamilton arrival package (pickup advice, flat viewing)', price:'LKR 4,000 · ~NZ$20' },
    ],
    email:'', whatsapp:'', calendly:'' },
  { id:'m6', name:'Ishara Gunasekara', city:'Palmerston North', uni:'massey', field:'Agriculture & Food',
    tags:['visa-offer','visa-docs','settle-family','settle-arrival'],
    bio:'Completed her PhD at the Riddet Institute in 2025; now a postdoc. Mentors agriculture and food-science applicants from application to arrival.',
    langs:'Sinhala · English', availability:'Tue & Thu evenings SL time',
    packages:[
      { name:'Intro call · 15 min', price:'Free' },
      { name:'Application audit (CV + SOP + proposal) ', price:'LKR 10,000 · ~NZ$50' },
      { name:'Pre-departure call · 45 min', price:'LKR 3,500 · ~NZ$17' },
    ],
    email:'', whatsapp:'', calendly:'' },
];

/* Platform routing for consultation requests — set before launch */
const PF_CONFIG = {
  contactEmail: 'consult@pathfinder.example',   // TODO: replace with the real inbox
  fallbackWhatsapp: '',                          // optional platform WhatsApp line

  /* ── Settlement & cost-of-living benchmarks (re-verify periodically) ──
     These change with policy and the market — confirm the dates below. */

  // Immigration NZ minimum living-cost requirement for student visas.
  // Raised from $15,000 to $20,000/yr for 2-year+ tertiary study.
  // VERIFY on immigration.govt.nz — INZ adjusts this periodically.
  visaFundsPerYear: 20000,
  visaFundsPerMonth: 1667,           // 20000 ÷ 12, rounded

  // Typical NZ doctoral scholarship stipend band (NZ$/month).
  // ~NZ$28k–33k per year across the eight universities.
  stipendLo: 2333,                   // 28,000 ÷ 12
  stipendHi: 2750,                   // 33,000 ÷ 12

  // NZ adult minimum wage from 1 April 2026 (NZ$/hour).
  // VERIFY on employment.govt.nz — reviewed every April.
  minWageHourly: 23.95,

  // Indicative LKR per 1 NZD for home-currency anchoring. NOT a live rate —
  // update by hand. Always check a transfer service for the real rate.
  nzdToLkr: 185,                     // indicative — rates move daily

  // Stamp shown in the "data last verified" disclaimer across the module.
  dataVerified: 'June 2026',
};

/* ── Partner placements (affiliate) — clearly labelled in the UI ── */
const PF_PARTNERS = [
  { id:'p1', placement:'ielts', name:'IELTS preparation', blurb:'Structured prep courses with band-score guarantees — most NZ PhDs need 6.5+ with no band below 6.0.', url:'#', cta:'Explore prep options' },
  { id:'p2', placement:'forex', name:'Wise — money between LKR and NZD', blurb:'The route most students use for stipend-to-home transfers and bringing funds over.', url:'https://wise.com', cta:'Compare rates' },
  { id:'p3', placement:'insurance', name:'Student travel & health insurance', blurb:'INZ-compliant cover for the journey and your first weeks before university insurance kicks in.', url:'#', cta:'Get a quote' },
  { id:'p4', placement:'flights', name:'Student fares CMB → NZ', blurb:'Student tickets often include extra baggage — worth it when you are moving your whole life.', url:'#', cta:'Search flights' },
];
