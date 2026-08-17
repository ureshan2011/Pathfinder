#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════
   stamp-assets.js

   Rewrites every local asset URL in the HTML to carry a ?v=<hash>
   of that file's own contents:

     <script src="assets/js/data.js">
       → <script src="assets/js/data.js?v=8f2a1c4d">

   ── Why this exists ────────────────────────────────────────────────
   PathFinder ships as plain scripts with no bundler, so app.js and
   data.js are two separate cacheable files that must agree with each
   other. They regularly do not, because caches expire independently:
   a browser holding data.js from an earlier deploy will happily fetch
   a fresh app.js, and then app.js calls a constant its data.js has
   never heard of. The whole view renders blank.

   That is exactly what happened once already: app.js gained
   visaNoticesCard() reading PF_VISA_NOTICES, hosting served JS with
   max-age=3600 and no version in the URL, and for an hour after the
   deploy returning visitors got a dead Funding page. A hard refresh
   fixed it, which is why it never showed up in testing.

   Content hashes fix the class, not the instance. A file that changes
   gets a new URL, so it cannot be served from an old cache entry; a
   file that has not changed keeps its URL and stays cached. That is
   what lets firebase.json mark assets `immutable` for a year, which
   is both faster and safer than the short max-age it replaced.

   ── Contract ───────────────────────────────────────────────────────
   · HTML must be served no-cache (firebase.json does this). The stamps
     live in the HTML, so stale HTML means stale stamps.
   · Idempotent: an existing ?v= is replaced, not appended.
   · Local assets only. Absolute URLs and protocol-relative CDN links
     are left alone — we do not control their caching.
   · A referenced file that does not exist is reported and the script
     exits non-zero rather than stamping a broken path.

   Run:  node scripts/stamp-assets.js
   Run it before every deploy, after any change under assets/.
   ════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

/* src="…" / href="…" pointing at a local file under assets/. The path is
   captured without any existing query so re-running replaces the stamp
   instead of stacking a second one. */
const ASSET_RE = /\b(src|href)="((?:\.\/)?assets\/[^"?#]+)(\?[^"#]*)?(#[^"]*)?"/g;

const hashes = new Map();
function hashOf(rel) {
  if (hashes.has(rel)) return hashes.get(rel);
  const file = path.join(ROOT, rel.replace(/^\.\//, ''));
  if (!fs.existsSync(file)) { hashes.set(rel, null); return null; }
  const h = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 8);
  hashes.set(rel, h);
  return h;
}

const missing = [];
let changedFiles = 0, stamped = 0;

for (const name of fs.readdirSync(ROOT).filter(f => f.endsWith('.html'))) {
  const file = path.join(ROOT, name);
  const before = fs.readFileSync(file, 'utf8');

  const after = before.replace(ASSET_RE, (whole, attr, rel, _q, frag) => {
    const h = hashOf(rel);
    if (!h) { missing.push(`${name} → ${rel}`); return whole; }
    stamped++;
    return `${attr}="${rel}?v=${h}${frag || ''}"`;
  });

  if (after !== before) {
    fs.writeFileSync(file, after);
    changedFiles++;
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  · ${name} (already current)`);
  }
}

if (missing.length) {
  console.error(`\n✗ ${missing.length} referenced asset(s) do not exist:`);
  missing.forEach(m => console.error('  ' + m));
  process.exit(1);
}

console.log(`\n✓ Stamped ${stamped} asset URL${stamped === 1 ? '' : 's'} across ${changedFiles} file${changedFiles === 1 ? '' : 's'}.`);
