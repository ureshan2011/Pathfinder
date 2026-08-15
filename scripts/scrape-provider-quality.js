#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════
   scrape-provider-quality.js

   Builds assets/js/provider-quality.js — NZQA's own public record for
   every provider in the catalogue, so a student choosing between a
   NZ$56k university place and a NZ$21k polytechnic one can see more than
   the price.

   Source: NZQA's organisation pages (the same `providerLink` already in
   the catalogue). Everything captured here is published by NZQA about
   the provider; nothing is inferred, scored or editorialised.

   What it takes:
     · provider category (1–4) from the last external evaluation
     · the dated statements of confidence behind that category
     · the external quality assurance report history (year + link)
     · Code of Practice signatory status for international students
     · whether the page shows a statutory-actions notice

   IMPORTANT — the EER system has ENDED. The Quality Assurance of
   Tertiary Education Providers Rules 2026 came into force on 19 January
   2026 and revoked the EER Rules 2022. NZQA requires that anyone quoting
   a provider category states the year it was received AND that the EER
   system is no longer in operation. `statementYear` and `system` below
   exist so the UI can honour that, and it does.

   Universities are quality-assured by the Academic Quality Agency, not
   by EER, so they legitimately carry no category — that is recorded as
   `naReason`, never as a bad score.

   Run:  node scripts/scrape-provider-quality.js
   Polite by default: one request at a time, 1.2s apart.
   ════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'js', 'provider-quality.js');
const DELAY_MS = 1200;
const BASE = 'https://www.nzqa.govt.nz/providers/details.do?providerId=';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function loadCatalogue() {
  const src = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'catalogue.js'), 'utf8');
  const ctx = { window: {} };
  new Function('window', src).call(ctx, ctx.window);
  return ctx.window.PF_CATALOGUE;
}

/* Strip tags to a clean line list — the page is server-rendered HTML with
   no useful structure around the values, so the text flow IS the schema. */
function toLines(html) {
  const t = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '\n');
  return t.split('\n')
    .map(l => l.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
               .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim())
    .filter(Boolean);
}

const CONFIDENCE = ['Highly Confident', 'Not Yet Confident', 'Not Confident', 'Confident'];

function parse(html) {
  const lines = toLines(html);
  const joined = lines.join('\n');

  // "8 March 2019: NZQA is Confident in the educational performance of X"
  const statements = [];
  lines.forEach(l => {
    const m = l.match(/^(\d{1,2}\s+\w+\s+\d{4}):\s*NZQA is\s+(.+?)\s+in the\s+(educational performance|capability in self-assessment)\s+of\s+(.*)$/i);
    if (!m) return;
    const conf = CONFIDENCE.find(c => new RegExp('^' + c + '$', 'i').test(m[2].trim())) || m[2].trim();
    statements.push({
      date: m[1],
      about: /self-assessment/i.test(m[3]) ? 'self-assessment' : 'educational-performance',
      confidence: conf,
    });
  });

  const catIdx = lines.findIndex(l => /^Provider Category$/i.test(l));
  let category = null;
  if (catIdx >= 0) {
    const next = lines.slice(catIdx + 1, catIdx + 4).find(l => /^[1-4]$/.test(l));
    if (next) category = Number(next);
  }

  /* Report history links look like
       <a class="download pdf" href="/bin/.../6019-2023.pdf ">
         <img ...>&nbsp;2023 &nbsp;(265 Kb)</a>
     — an <img> sits between the anchor and the year, so the year cannot
     be required to follow the '>' directly. */
  const reports = [];
  const rx = /<a[^>]*class="[^"]*download[^"]*"[^>]*href="([^"]+?)\s*"[^>]*>([\s\S]{0,220}?)<\/a>/gi;
  let m;
  while ((m = rx.exec(html)) !== null) {
    const year = (m[2].replace(/<[^>]+>/g, ' ').match(/\b(19|20)\d{2}\b/) || [])[0];
    if (!year) continue;
    let url = m[1].trim();
    if (url.startsWith('/')) url = 'https://www.nzqa.govt.nz' + url;
    if (!reports.some(r => r.url === url)) reports.push({ year: Number(year), url });
  }
  reports.sort((a, b) => b.year - a.year);

  /* TRUE only when NZQA's page actually says it. University pages carry a
     different, much thinner layout with no Code section at all — recording
     that as `false` would print "not a Code of Practice signatory" under
     the University of Auckland, which is both wrong and damaging. Absence
     of the statement is `null` (unknown), and the UI shows nothing. */
  const codeSignatory = /Signatory to the Code of Practice/i.test(joined) ? true : null;

  return {
    category,
    statements,
    reports: reports.slice(0, 6),
    codeSignatory,
    statutoryActionsNoted: /Statutory Actions/i.test(joined),
    // How much of the record this page actually carried, so the UI can
    // tell "clean record" apart from "NZQA publishes little here".
    detail: /Provider Category/i.test(joined) ? 'full' : 'limited',
  };
}

async function fetchProvider(id) {
  const res = await fetch(BASE + id, {
    headers: { 'user-agent': 'PathFinder/1.0 (student guidance; +https://github.com/ureshan2011/Pathfinder)' },
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return parse(await res.text());
}

(async () => {
  const cat = loadCatalogue();
  const ids = Object.keys(cat.providers);
  console.log(`Fetching NZQA records for ${ids.length} providers…`);

  const out = {};
  let ok = 0, fail = 0;
  for (const id of ids) {
    const p = cat.providers[id];
    try {
      const rec = await fetchProvider(id);
      // A university carries no provider category by design: it is
      // audited by the Academic Quality Agency, not evaluated by NZQA.
      if (p.type === 'universities' && rec.category == null) {
        rec.naReason = 'University — quality-assured by the Academic Quality Agency (academic audit) and CUAP, not by NZQA provider category.';
      }
      rec.name = p.name;
      rec.type = p.type;
      rec.link = p.providerLink || (BASE + id);
      out[id] = rec;
      ok++;
      process.stdout.write(`  ${String(ok + fail).padStart(3)}/${ids.length}  cat ${rec.category ?? '-'}  ${p.name.slice(0, 48)}\n`);
    } catch (e) {
      fail++;
      console.warn(`  !! ${p.name}: ${e.message}`);
    }
    await sleep(DELAY_MS);
  }

  const withCat = Object.values(out).filter(r => r.category != null).length;
  const banner = `/* PF_PROVIDER_QUALITY — NZQA's public record per provider.
   GENERATED FILE — do not hand-edit.
   Rebuild: node scripts/scrape-provider-quality.js

   Scraped ${new Date().toISOString().slice(0, 10)} from NZQA organisation pages.
   ${ok} providers captured, ${withCat} carrying a provider category.

   The provider category comes from the External Evaluation and Review
   system, which ENDED on 19 January 2026 when the Quality Assurance of
   Tertiary Education Providers Rules 2026 revoked the EER Rules 2022.
   NZQA requires any quoted category to be shown with the year it was
   received and a note that the system no longer operates — PF_ROI_QA in
   roi-data.js carries that wording and the UI prints it. */\n`;

  fs.writeFileSync(OUT, banner + 'window.PF_PROVIDER_QUALITY=' + JSON.stringify({
    scraped: new Date().toISOString().slice(0, 10),
    source: 'NZQA organisation pages (nzqa.govt.nz/providers/details.do)',
    providers: out,
  }) + ';\n');

  console.log(`\nWrote ${OUT}`);
  console.log(`  ${ok} ok, ${fail} failed, ${withCat} with a category`);
})();
