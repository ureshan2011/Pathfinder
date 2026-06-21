#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════
   scrape-nz-corpus.js — builds the pre-scraped NZ research corpus.

   Pulls a LARGE corpus (target ≥ 10,000 unique) of recent, highly-cited papers
   AUTHORED AT NEW ZEALAND INSTITUTIONS from the open OpenAlex catalogue, one
   slice per PathFinder field, globally de-duplicated, and writes:

     assets/js/research-corpus.js        — tiny index (meta + field → shard map)
     assets/js/corpus/<field-slug>.js    — one shard per field (lazy-loaded)

   The Research Studio loads the index once, then lazy-loads ONLY the shard for
   the field a student is searching — so the browser never downloads all 10k+,
   just the ~1 field's worth it needs. The shards are committed so the NZ side
   works offline and never hits a rate limit; the live API still runs for
   freshness/global context.

   Usage:  node scripts/scrape-nz-corpus.js
     MAILTO=you@example.com   polite-pool contact (defaults to project email)
     PER_FIELD=1400           papers to fetch per field before global de-dup
     FROM_YEAR=2018           earliest publication year
   ════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const MAILTO = process.env.MAILTO || 'yasassriofficial@gmail.com';
const FROM_YEAR = Number(process.env.FROM_YEAR || 2018);
const PER_FIELD = Number(process.env.PER_FIELD || 1400);
const JS_DIR = path.join(__dirname, '..', 'assets', 'js');
const SHARD_DIR = path.join(JS_DIR, 'corpus');
const INDEX_OUT = path.join(JS_DIR, 'research-corpus.js');

// Mirror of PF_FIELDS + PF_FIELD_KEYWORDS in assets/js/data.js (kept in sync by hand).
const FIELDS = {
  'Computer Science & AI':        ['machine learning', 'artificial intelligence', 'deep learning', 'algorithms', 'data science'],
  'Engineering':                  ['engineering', 'design optimisation', 'control systems', 'materials', 'robotics'],
  'Health & Medicine':            ['clinical', 'health outcomes', 'biomedical', 'public health', 'epidemiology'],
  'Business & Economics':         ['economics', 'management', 'policy', 'finance', 'marketing'],
  'Environmental Science':        ['climate', 'sustainability', 'ecology', 'freshwater', 'conservation'],
  'Agriculture & Food':           ['agriculture', 'food science', 'crop', 'dairy', 'soil'],
  'Physics & Mathematics':        ['physics', 'mathematics', 'modelling', 'quantum', 'statistics'],
  'Social Sciences & Education':  ['education', 'society', 'wellbeing', 'indigenous Māori', 'psychology'],
};

const slugify = s => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function abstractFrom(inv, max = 150) {
  if (!inv) return '';
  const words = [];
  for (const [w, pos] of Object.entries(inv)) pos.forEach(p => { words[p] = w; });
  const t = words.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trim() + '…' : t;
}

/* OpenAlex work → compact corpus record (short keys keep the shards small):
   t=title y=year v=venue c=citations a=authors nz=[{n,i}] k=concepts d=doi/url ab=abstract */
function toRecord(w) {
  const authorships = w.authorships || [];
  const nz = [];
  authorships.forEach(a => {
    const name = a.author && a.author.display_name;
    if (!name) return;
    const inst = (a.institutions || []).find(i => i.country_code === 'NZ');
    if (inst) nz.push({ n: name, i: inst.display_name || '' });
  });
  if (!nz.length) return null;
  return {
    t: w.title || w.display_name || '',
    y: w.publication_year || null,
    v: (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || '',
    c: w.cited_by_count || 0,
    a: authorships.map(a => a.author && a.author.display_name).filter(Boolean).slice(0, 6),
    nz,
    k: (w.concepts || []).filter(c => c.level >= 1 && c.score >= 0.3).map(c => c.display_name).slice(0, 5),
    d: w.doi || (w.primary_location && w.primary_location.landing_page_url) || '',
    ab: abstractFrom(w.abstract_inverted_index),
  };
}

const BASE_DELAY = Number(process.env.BASE_DELAY || 1500); // ms between requests (polite, avoids burst 429s)
const THIS_YEAR = new Date().getFullYear();

/* Returns parsed JSON, or null after exhausting retries. OpenAlex 429s are a
   per-second burst limit (and deep cursor pagination is throttled hardest), so
   we paginate SHALLOWLY — one page-1 request per (field, year) — and back off
   generously on the occasional 429. */
const PAGES_PER_YEAR = Number(process.env.PAGES_PER_YEAR || 2); // shallow cursor depth per year

async function fetchTop(search, year, cursor) {
  const params = new URLSearchParams({
    search,
    filter: `authorships.institutions.country_code:NZ,publication_year:${year},type:article`,
    sort: 'cited_by_count:desc',
    select: 'title,display_name,publication_year,primary_location,cited_by_count,authorships,concepts,abstract_inverted_index,doi',
    'per-page': '200',
    mailto: MAILTO,
    cursor,
  });
  const url = 'https://api.openalex.org/works?' + params.toString();
  for (let attempt = 0; attempt < 7; attempt++) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return await resp.json();
    } catch (e) {
      const wait = Math.min(45000, 2500 * Math.pow(2, attempt));
      console.warn(`\n  retry ${attempt + 1} after ${(wait / 1000)}s (${e.message})`);
      await sleep(wait);
    }
  }
  return null;
}

/* Top-cited NZ papers per field, gathered one publication-year at a time
   (newest → oldest), up to PAGES_PER_YEAR shallow pages each — so we never run
   a deep cursor (which OpenAlex throttles hardest) yet still get good depth. */
async function scrapeField(field, terms) {
  const search = terms.join(' ');
  const recs = [];
  for (let year = THIS_YEAR; year >= FROM_YEAR && recs.length < PER_FIELD; year--) {
    let cursor = '*';
    for (let page = 0; page < PAGES_PER_YEAR && cursor && recs.length < PER_FIELD; page++) {
      const data = await fetchTop(search, year, cursor);
      if (!data) { console.warn(`  ${field} ${year} p${page}: failed, keeping ${recs.length}`); await sleep(BASE_DELAY); break; }
      const items = data.results || [];
      for (const w of items) { const r = toRecord(w); if (r && r.t) recs.push(r); }
      cursor = data.meta && data.meta.next_cursor;
      process.stdout.write(`\r  ${field}: ${recs.length} (through ${year})…   `);
      await sleep(BASE_DELAY);
      if (items.length < 200) break; // year exhausted
    }
  }
  process.stdout.write('\n');
  return recs.slice(0, PER_FIELD);
}

/* Read an already-written shard's records back (for resume + global de-dup). */
function readShard(absFile) {
  const vm = require('vm');
  const sb = { window: {} };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(absFile, 'utf8'), sb);
  const shards = sb.window.PF_CORPUS_SHARDS || {};
  return Object.values(shards)[0] || [];
}

(async () => {
  fs.mkdirSync(SHARD_DIR, { recursive: true });
  const FORCE = /^(1|true)$/i.test(process.env.FORCE || '');
  const seenGlobal = new Set();          // global de-dup by DOI/title
  const key = r => (r.d || r.t).toLowerCase().replace(/\s+/g, ' ').trim();
  const fieldIndex = {};
  let total = 0;

  for (const [field, terms] of Object.entries(FIELDS)) {
    const slug = slugify(field);
    const file = `corpus/${slug}.js`;
    const abs = path.join(JS_DIR, file);
    let recs;
    if (!FORCE && fs.existsSync(abs)) {
      // Resume: reuse the existing shard, just register its keys for de-dup.
      recs = readShard(abs);
      recs.forEach(r => seenGlobal.add(key(r)));
      console.log(`  ↺ ${field}: reusing existing shard (${recs.length})`);
    } else {
      const raw = await scrapeField(field, terms);
      recs = [];
      for (const r of raw) { const k = key(r); if (!k || seenGlobal.has(k)) continue; seenGlobal.add(k); recs.push(r); }
      const shard = `/* GENERATED — NZ research corpus shard: ${field}. Rebuild: node scripts/scrape-nz-corpus.js */\n` +
        `(window.PF_CORPUS_SHARDS=window.PF_CORPUS_SHARDS||{})[${JSON.stringify(field)}]=${JSON.stringify(recs)};\n`;
      fs.writeFileSync(abs, shard);
      const kb = (fs.statSync(abs).size / 1024).toFixed(0);
      console.log(`  → ${field}: ${recs.length} unique · ${kb} KB`);
    }
    fieldIndex[field] = { slug, file, count: recs.length };
    total += recs.length;
  }

  // Single source of truth for the index (incl. per-field NZ author rollups).
  require('./build-corpus-index').buildIndex();
  console.log(`\nScrape complete: ${total} NZ papers across ${Object.keys(fieldIndex).length} fields`);
})();
