#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════
   sync-astra-catalogue.js — builds the NZQA postgraduate course catalogue.

   Pulls the live NZQA dataset out of AstraDB (qualifications, providers,
   programmes, scholarships), keeps the POSTGRADUATE slice and every provider
   that teaches any of it, joins it to the NZQA subject-area taxonomy in
   data/subject_areas.json, and writes:

     assets/js/catalogue.js                  — index (taxonomy + quals + providers)
     assets/js/catalogue/<subject-slug>.js   — one detail shard per subject area
     assets/js/catalogue/scholarships.js     — postgraduate-relevant scholarships
     assets/js/catalogue/programmes.js       — L8+ programme rows (fees where known)

   Same shape as the research corpus (scrape-nz-corpus.js → corpus/*.js): the
   Courses view loads the index once, then lazy-loads ONLY the shard for the
   subject area the student is browsing. Everything is committed, so the app
   works offline, costs nothing to serve, and never ships a database token to
   the browser.

   Why a build step and not a live query: the Astra Data API sends no CORS
   headers, so a browser cannot call it directly. And the collections, though
   configured for vector search, have no embeddings written — $vectorize,
   $lexical and findAndRerank all return empty — so search is client-side over
   the generated index anyway.

   Usage:  ASTRA_DB_TOKEN=AstraCS:... node scripts/sync-astra-catalogue.js
     ASTRA_DB_TOKEN      required — use a READ-ONLY token
     ASTRA_DB_ENDPOINT   defaults to the PathFinder database
     ASTRA_DB_KEYSPACE   defaults to default_keyspace
   ════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const TOKEN = process.env.ASTRA_DB_TOKEN || '';
const ENDPOINT = process.env.ASTRA_DB_ENDPOINT ||
  'https://cb986768-5cf1-4af2-8d46-6325e29456be-us-east-2.apps.astra.datastax.com';
const KEYSPACE = process.env.ASTRA_DB_KEYSPACE || 'default_keyspace';
const API = `${ENDPOINT}/api/json/v1/${KEYSPACE}`;

const ROOT = path.join(__dirname, '..');
const JS_DIR = path.join(ROOT, 'assets', 'js');
const SHARD_DIR = path.join(JS_DIR, 'catalogue');
const TAXONOMY_IN = path.join(ROOT, 'data', 'subject_areas.json');
const INDEX_OUT = path.join(JS_DIR, 'catalogue.js');

/* ── Scope ────────────────────────────────────────────────────────────
   Postgraduate only. Level 8 carries the bridging qualifications an
   under-qualified applicant actually needs (PGDip / PGCert / GradDip /
   Honours), level 9 is the master's degrees, level 10 the doctorates. */
const KEEP_LEVELS = ['8', '9', '10', '8 - 9'];
const KEEP_SCHOLARSHIP_LEVELS = ['Masters', 'Postgraduate', 'PhD / Doctorate', 'General'];

/* Providers are derived FROM THE DATA, not filtered by NZQA's category.
   Category is a bad proxy: most private training establishments only teach
   level 1–5 certificates, but 29 of them teach master's-level study —
   Yoobee has three master's degrees, Whitecliffe ten postgraduate
   qualifications, Media Design School six. Filtering by `type` dropped all of
   those along with the certificates. So: keep every provider that teaches at
   least one postgraduate qualification, whatever category it files under.
   Providers offering nothing above level 7 fall out on their own. */

/* Fields worth shipping. Everything else in a qualification document is either
   empty across the board (linkProgramme_*, opening_*, deadline,
   manualOverrideStatus) or build metadata (lastUpdated, $vector).

   `employmentPathway` is deliberately NOT here. Every one of the 1,716
   postgraduate rows carries the same CareersNZ boilerplate sentence and
   nothing else, so rendering it would show the student a section header with
   no information under it — worse than omitting it. Re-add it if NZQA ever
   populates the field for real. */
const QUAL_DETAIL_FIELDS = [
  'entryRequirements', 'strategicPurposeStatement', 'graduateProfile',
  'educationPathway', 'developedBy', 'qualityAssuredBy', 'nzqaLink',
];

/* Values that mean "not supplied" in this dataset. NZQA rows use a bare full
   stop, a literal "null", or a fragment of the CareersNZ boilerplate left
   behind when the real text was empty. */
const PLACEHOLDERS = /^(\.|null\.?|not available|,?\s*then the provider who offers this qualification\.?)$/i;

function cleanField(v) {
  let s = String(v || '').replace(/^null/, '').trim();
  s = s.replace(/\.?\s*To find out more about employment opportunities click on the CareersNZ logo.*$/is, '').trim();
  return PLACEHOLDERS.test(s) ? '' : s;
}

const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ── Astra Data API ───────────────────────────────────────────────────
   NOTE: `options.limit` caps the TOTAL number of documents across the whole
   pagination run, not the page size — set it and the loop silently stops at
   that number. So we omit it entirely and drain with pageState. */
async function command(collection, body) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const resp = await fetch(`${API}/${collection}`, {
        method: 'POST',
        headers: { Token: TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const json = await resp.json();
      if (json.errors) throw new Error(json.errors.map(e => e.message).join('; '));
      return json;
    } catch (e) {
      if (attempt === 4) throw e;
      const wait = 2000 * Math.pow(2, attempt);
      console.warn(`  retry ${attempt + 1} on ${collection} after ${wait / 1000}s (${e.message})`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

async function findAll(collection, filter) {
  const out = [];
  let pageState = null;
  do {
    const options = pageState ? { pageState } : {};
    const res = await command(collection, {
      find: { filter: filter || {}, projection: { $vector: 0 }, options },
    });
    out.push(...res.data.documents);
    pageState = res.data.nextPageState;
    process.stdout.write(`\r  ${collection}: ${out.length}…   `);
  } while (pageState);
  process.stdout.write('\n');
  return out;
}

/* ── Taxonomy ─────────────────────────────────────────────────────────
   data/subject_areas.json is the NZQA field-of-study tree (12 roots → 71
   sub-areas → 378 leaves). Qualifications reference its ids in subjectArea[],
   so flattening it gives us both the browse rail and the shard split. */
function flattenTaxonomy(tree) {
  const flat = {};
  const roots = [];
  (function walk(nodes, parent, root) {
    for (const n of nodes) {
      const r = root || n.id;
      if (!parent) roots.push(n.id);
      flat[n.id] = { n: n.name, l: n.level, p: parent || null, r };
      walk(n.subAreas || [], n.id, r);
    }
  })(tree, null, null);
  return { flat, roots };
}

function writeGenerated(file, header, body) {
  fs.writeFileSync(file, `/* ${header}\n   GENERATED FILE — do not hand-edit.\n` +
    `   Rebuild: ASTRA_DB_TOKEN=... node scripts/sync-astra-catalogue.js */\n${body}\n`);
  return (fs.statSync(file).size / 1024).toFixed(0);
}

(async () => {
  if (!TOKEN) {
    console.error('ASTRA_DB_TOKEN is not set.\n' +
      'Create a READ-ONLY token in the Astra console and run:\n' +
      '  ASTRA_DB_TOKEN=AstraCS:... node scripts/sync-astra-catalogue.js');
    process.exit(1);
  }

  const { flat: taxonomy, roots } = flattenTaxonomy(JSON.parse(fs.readFileSync(TAXONOMY_IN, 'utf8')));
  console.log(`Taxonomy: ${Object.keys(taxonomy).length} nodes across ${roots.length} subject areas\n`);

  console.log('Fetching from AstraDB…');
  const [rawQuals, rawProviders, rawProgrammes, rawScholarships] = [
    await findAll('qualifications', { level: { $in: KEEP_LEVELS } }),
    await findAll('providers'),
    await findAll('programmes', { level: { $in: KEEP_LEVELS.concat(['7 - 8']) } }),
    await findAll('scholarships', { studyLevels: { $in: KEEP_SCHOLARSHIP_LEVELS } }),
  ];

  /* ── Providers ──
     Only those that actually teach something postgraduate. */
  const teaching = new Set();
  for (const q of rawQuals) for (const o of q.offering_org || []) if (o) teaching.add(o);

  const providers = {};
  for (const p of rawProviders) {
    if (!teaching.has(p.id)) continue;
    providers[p.id] = {
      name: p.name, type: p.type, location: p.location || '', address: p.address || '',
      phone: p.phone || '', email: p.email || '', website: p.website || '',
      providerLink: p.providerLink || '', qualificationLink: p.qualificationLink || '',
    };
  }

  /* ── Qualifications ──
     Keep only those offered by an in-scope provider (a postgraduate
     qualification nobody in our provider set teaches is not actionable), and
     drop subjectArea entries that aren't real taxonomy ids — a handful of rows
     carry a name string in that column instead of an id. */
  const index = [];
  const detailByRoot = {};
  let droppedNoProvider = 0, droppedSubjectIds = 0, droppedNoSubject = 0;

  for (const q of rawQuals) {
    const orgs = (q.offering_org || []).filter(o => o && providers[o]);
    if (!orgs.length) { droppedNoProvider++; continue; }

    const subjects = [];
    for (const s of q.subjectArea || []) {
      if (!s) continue;
      if (taxonomy[s]) subjects.push(s); else droppedSubjectIds++;
    }
    if (!subjects.length) { droppedNoSubject++; continue; }

    index.push({
      i: q.qualificationID, t: q.qualificationTitle, y: q.qualificationType,
      l: q.level, c: q.credit || '', o: orgs, s: subjects,
    });

    const detail = { i: q.qualificationID };
    for (const f of QUAL_DETAIL_FIELDS) {
      const v = cleanField(q[f]);
      if (v) detail[f] = v;
    }
    for (const root of new Set(subjects.map(s => taxonomy[s].r))) {
      (detailByRoot[root] = detailByRoot[root] || {})[q.qualificationID] = detail;
    }
  }

  index.sort((a, b) => a.t.localeCompare(b.t));

  /* ── Detail shards, one per subject-area root ── */
  fs.mkdirSync(SHARD_DIR, { recursive: true });
  const shards = {};
  console.log('\nWriting subject-area shards:');
  for (const root of roots) {
    const detail = detailByRoot[root];
    if (!detail) { console.log(`  · ${taxonomy[root].n}: no postgraduate qualifications, skipped`); continue; }
    const slug = slugify(taxonomy[root].n);
    const file = `catalogue/${slug}.js`;
    const kb = writeGenerated(path.join(SHARD_DIR, `${slug}.js`),
      `PF_CAT_SHARD — course detail for ${taxonomy[root].n}.`,
      `(window.PF_CAT_SHARD=window.PF_CAT_SHARD||{})[${JSON.stringify(root)}]=${JSON.stringify(detail)};`);
    shards[root] = { slug, file, count: Object.keys(detail).length };
    console.log(`  → ${taxonomy[root].n}: ${shards[root].count} quals · ${kb} KB`);
  }

  /* ── Scholarships ──
     Trimmed to what the Funding view renders. `values` and `lengths` are
     condition-keyed arrays; we keep them whole because the conditions ("first
     year only", "domestic students") change what the award is actually worth. */
  const scholarships = rawScholarships.map(s => ({
    i: s.id, n: s.name, o: s.offeringOrg, about: s.about || '',
    levels: s.studyLevels || [], values: s.values || [], lengths: s.lengths || [],
    opening: s.openingDate || '', closing: s.closingDate || '',
    entry: s.entryRequirements || '', url: s.url || '',
    eligibility: s.eligibilityCriteria || {}, rounds: s.rounds || [],
  })).filter(s => providers[s.o]);
  const schKb = writeGenerated(path.join(SHARD_DIR, 'scholarships.js'),
    'PF_CAT_SCHOLARSHIPS — postgraduate-relevant NZ scholarships.',
    `window.PF_CAT_SCHOLARSHIPS=${JSON.stringify(scholarships)};`);

  /* ── Programmes ──
     The only place real fee figures exist. Coverage is thin (universities have
     no programme rows at all, and most polytechnic rows say "Refer to
     website"), so these attach to a qualification opportunistically — never as
     a required join — and the UI must not imply every course has a fee. */
  const hasNumber = v => /\d/.test(v || '');
  const programmes = rawProgrammes.map(p => ({
    i: p.id, n: p.name, o: p.offeringOrg, q: p.qualificationID || '',
    l: p.level, credits: p.credits || '', type: p.type || '',
    about: p.about || '', entry: p.entryRequirements || '',
    domesticFee: hasNumber(p.domesticFee) ? p.domesticFee : '',
    intlFee: hasNumber(p.internationalFee) ? p.internationalFee : '',
    url: p.url || p.directLink || '',
  })).filter(p => providers[p.o]);
  const prgKb = writeGenerated(path.join(SHARD_DIR, 'programmes.js'),
    'PF_CAT_PROGRAMMES — level 8+ programme rows (fees where published).',
    `window.PF_CAT_PROGRAMMES=${JSON.stringify(programmes)};`);

  /* ── Index ── */
  const catalogue = {
    meta: {
      generated: new Date().toISOString().slice(0, 10),
      source: 'NZQA qualifications register, via AstraDB',
      qualCount: index.length,
      providerCount: Object.keys(providers).length,
      scholarshipCount: scholarships.length,
      programmeCount: programmes.length,
    },
    roots: roots.filter(r => shards[r]),
    taxonomy, providers, shards,
    quals: index,
  };
  const idxKb = writeGenerated(INDEX_OUT,
    `PF_CATALOGUE — index for the NZQA postgraduate course catalogue.\n` +
    `   ${index.length} qualifications across ${Object.keys(providers).length} providers. ` +
    `Detail lives in per-subject shards under assets/js/catalogue/.`,
    `window.PF_CATALOGUE=${JSON.stringify(catalogue)};`);

  const byLevel = index.reduce((m, q) => (m[q.l] = (m[q.l] || 0) + 1, m), {});
  const byType = Object.values(providers).reduce((m, p) => (m[p.type] = (m[p.type] || 0) + 1, m), {});
  console.log(`\nScholarships: ${scholarships.length} · ${schKb} KB`);
  console.log(`Programmes:   ${programmes.length} (${programmes.filter(p => p.intlFee).length} with a published international fee) · ${prgKb} KB`);
  console.log(`Providers:    ${Object.keys(providers).length} teaching postgraduate study — ` +
    Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}=${n}`).join(' '));
  console.log(`Index:        ${index.length} qualifications · ${idxKb} KB`);
  console.log(`  by level: ${Object.entries(byLevel).sort().map(([l, n]) => `L${l}=${n}`).join(' ')}`);
  console.log(`  dropped: ${droppedNoProvider} with no in-scope provider, ${droppedNoSubject} with no usable subject area, ${droppedSubjectIds} malformed subject ids`);
  console.log('\nCatalogue sync complete.');
})();
