#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════
   build-corpus-index.js — (re)build assets/js/research-corpus.js from whatever
   per-field shards currently exist in assets/js/corpus/. Lets us recover a
   working, consistent index even if a scrape run was interrupted — so no
   already-gathered data is wasted.

   Usage:  node scripts/build-corpus-index.js
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

const files = fs.existsSync(SHARD_DIR) ? fs.readdirSync(SHARD_DIR).filter(f => f.endsWith('.js')) : [];
const fieldIndex = {};
let total = 0;
for (const f of files) {
  const parsed = readShard(path.join(SHARD_DIR, f));
  if (!parsed || !parsed.recs.length) continue;
  fieldIndex[parsed.field] = { slug: slugify(parsed.field), file: `corpus/${f}`, count: parsed.recs.length };
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

   Index only (meta + field → shard map). Papers live in per-field shards under
   assets/js/corpus/<slug>.js, lazy-loaded one at a time by the Research Studio.
   ${total.toLocaleString()} papers across ${meta.fields.length} fields. Generated ${meta.generated}.
   ════════════════════════════════════════════════════════════ */`;

const body =
`const PF_RESEARCH_CORPUS = ${JSON.stringify({ meta, fields: fieldIndex })};\n` +
`if (typeof window !== 'undefined') { window.PF_RESEARCH_CORPUS = PF_RESEARCH_CORPUS; window.PF_CORPUS_SHARDS = window.PF_CORPUS_SHARDS || {}; }\n`;

fs.writeFileSync(INDEX_OUT, banner + '\n' + body);
console.log(`Wrote ${INDEX_OUT}`);
for (const [f, i] of Object.entries(fieldIndex)) console.log(`  ${f}: ${i.count}`);
console.log(`TOTAL: ${total} papers across ${meta.fields.length} fields`);
