#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════
   build-corpus-index.js — (re)build assets/js/research-corpus.js from the
   per-field shards in assets/js/corpus/.

   Besides the field → shard map, this now precomputes, per field, the TOP
   NZ AUTHORS (ranked by total citations across their corpus papers, then paper
   count) and the TOP NZ INSTITUTIONS. That author index ships in the small
   index file, so the Research Studio can surface the best-published NZ
   researchers in a field instantly and offline — even before (or without) any
   live API call. Rebuilding from shards also means an interrupted scrape never
   wastes gathered data.

   Usage:  node scripts/build-corpus-index.js
   Also exported as buildIndex() so the scraper can call it when it finishes.
   ════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.join(__dirname, '..', 'assets', 'js');
const SHARD_DIR = path.join(JS_DIR, 'corpus');
const INDEX_OUT = path.join(JS_DIR, 'research-corpus.js');

const slugify = s => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function readShard(abs) {
  const sb = { window: {} };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(abs, 'utf8'), sb);
  const shards = sb.window.PF_CORPUS_SHARDS || {};
  const field = Object.keys(shards)[0];
  return field ? { field, recs: shards[field] || [] } : null;
}

/* Per-field NZ author + institution rollups from a shard's records.
   Author record: { n:name, i:institution, p:papers, c:totalCitations }. */
function rollups(recs) {
  const aMap = {}, iMap = {};
  for (const r of recs) {
    const cited = r.c || 0;
    for (const a of (r.nz || [])) {
      const k = a.n;
      if (!aMap[k]) aMap[k] = { n: a.n, i: a.i || '', p: 0, c: 0 };
      aMap[k].p++; aMap[k].c += cited;
      if (!aMap[k].i && a.i) aMap[k].i = a.i;
      iMap[a.i] = (iMap[a.i] || 0) + 1;
    }
  }
  // Best published first: total citations, then breadth (paper count).
  const authors = Object.values(aMap).sort((x, y) => (y.c - x.c) || (y.p - x.p)).slice(0, 60);
  const institutions = Object.entries(iMap).filter(([n]) => n)
    .sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n, c]) => ({ n, c }));
  return { authors, institutions };
}

function buildIndex() {
  const files = fs.existsSync(SHARD_DIR) ? fs.readdirSync(SHARD_DIR).filter(f => f.endsWith('.js')) : [];
  const fieldIndex = {};
  let total = 0;
  for (const f of files) {
    const parsed = readShard(path.join(SHARD_DIR, f));
    if (!parsed || !parsed.recs.length) continue;
    const { authors, institutions } = rollups(parsed.recs);
    fieldIndex[parsed.field] = {
      slug: slugify(parsed.field), file: `corpus/${f}`, count: parsed.recs.length,
      authors, institutions,
    };
    total += parsed.recs.length;
  }

  const meta = {
    generated: new Date().toISOString().slice(0, 10),
    source: 'OpenAlex',
    fields: Object.keys(fieldIndex),
    paperCount: total,
  };

  const banner =
`/* ════════════════════════════════════════════════════════════
   PF_RESEARCH_CORPUS — INDEX for the pre-scraped New-Zealand-authored corpus.

   GENERATED FILE — do not hand-edit. Rebuild from shards with:
     node scripts/build-corpus-index.js
   or re-scrape with:
     node scripts/scrape-nz-corpus.js

   Holds: meta, the field → shard map, and a precomputed per-field index of the
   top NZ authors (ranked by total citations) and institutions. The papers
   themselves live in per-field shards under assets/js/corpus/<slug>.js,
   lazy-loaded one at a time by the Research Studio.
   ${total.toLocaleString()} papers across ${meta.fields.length} fields. Generated ${meta.generated}.
   ════════════════════════════════════════════════════════════ */`;

  const body =
`const PF_RESEARCH_CORPUS = ${JSON.stringify({ meta, fields: fieldIndex })};\n` +
`if (typeof window !== 'undefined') { window.PF_RESEARCH_CORPUS = PF_RESEARCH_CORPUS; window.PF_CORPUS_SHARDS = window.PF_CORPUS_SHARDS || {}; }\n`;

  fs.writeFileSync(INDEX_OUT, banner + '\n' + body);
  const kb = (fs.statSync(INDEX_OUT).size / 1024).toFixed(0);
  console.log(`Wrote ${INDEX_OUT} (${kb} KB)`);
  for (const [f, i] of Object.entries(fieldIndex)) console.log(`  ${f}: ${i.count} papers · ${i.authors.length} top authors`);
  console.log(`TOTAL: ${total} papers across ${meta.fields.length} fields`);
  return { total, fields: meta.fields.length };
}

module.exports = { buildIndex };
if (require.main === module) buildIndex();
