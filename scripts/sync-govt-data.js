#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════
   sync-govt-data.js

   Builds assets/js/govt-data.js — the four New Zealand government
   datasets PathFinder can legally republish, reduced to the handful of
   rows this app actually shows.

   ── Sources, and why only these four ───────────────────────────────
   Ten government datasets were reviewed. Most are free but unreachable
   from a server: Education Counts and data.govt.nz sit behind bot
   protection that returns 403 to any datacentre IP regardless of user
   agent, so a build script cannot fetch them (a person with a browser
   can — see README, "Government data"). These four answer to a plain
   HTTPS GET, which is what makes them scriptable:

     1. Immigration NZ — Student visa applications decided
        Approvals and declines by nationality and by application
        criteria, financial years 2016/17 onward. 50-page PDF,
        regenerated continuously.
     2. Immigration NZ — Work visa applications decided
        Same shape; carries the "Post-study - Open" criteria row, which
        is what happens to a master's graduate after they finish.
     3. Immigration NZ — Education agent performance data
        Student visa approval rates BY AGENT NAME, one sheet per source
        market, published annually as .xlsx. Sri Lanka is one of only
        nine markets covered. Read without a dependency — see unzip().
     4. MBIE / Tenancy Services — Rental bond data by territorial
        authority. Lower quartile, median and upper quartile weekly
        rent, monthly, from bonds actually lodged.

   ── Licence and attribution (this is the legal part) ───────────────
   Both publishers release under Crown copyright with reuse permitted
   on attribution:
     · Tenancy Services states CC BY 3.0 NZ explicitly on its rental
       bond data page, requiring credit to "The Ministry of Business,
       Innovation and Employment".
     · Immigration NZ statistics are Crown copyright published under
       NZGOAL, which defaults to CC BY.
   Both licences require attribution and neither permits implying
   endorsement. So every figure written by this script carries `src`,
   `srcUrl`, `licence` and `attribution` fields, and the UI prints the
   attribution next to the numbers rather than burying it — see
   govtSourceLine() in app.js. Do not strip those fields.

   We reduce, we do not restate: only rows PathFinder displays are
   kept, values are copied unmodified, and nothing is rescaled or
   re-derived except the approval percentage, which is computed on
   read in the browser from the approved/declined pair.

   ── Integrity ─────────────────────────────────────────────────────
   The PDFs are laid out as tables, not published as data, so parsing
   is positional. Every extracted row is checked (approved + declined
   must equal the printed total, and the number of year-triples must
   equal the number of year headings). A row that fails is DROPPED and
   reported; the script exits non-zero rather than writing a file with
   a silently wrong number in it. A wrong figure here would be printed
   to a family deciding whether to spend LKR 25 million.

   Run:  node scripts/sync-govt-data.js
   No key, no token, no account. Re-run after each INZ refresh
   (roughly monthly) and after each tenancy release (monthly).
   ════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'js', 'govt-data.js');

const INZ_BASE = 'https://www.immigration.govt.nz/assets/inz/documents/statistics';
const SRC = {
  student: {
    url: `${INZ_BASE}/statistics-student-applications-decided.pdf`,
    page: 'https://www.immigration.govt.nz/about-us/research-and-statistics/statistics/',
    name: 'Student visa applications decided',
    attribution: 'Immigration New Zealand',
    licence: 'Crown copyright, released under NZGOAL (CC BY)',
  },
  work: {
    url: `${INZ_BASE}/statistics-work-applications-decided.pdf`,
    page: 'https://www.immigration.govt.nz/about-us/research-and-statistics/statistics/',
    name: 'Work visa applications decided',
    attribution: 'Immigration New Zealand',
    licence: 'Crown copyright, released under NZGOAL (CC BY)',
  },
  agents: {
    // Per-year workbook; the year is filled in by the probe in main().
    url: 'https://www.immigration.govt.nz/assets/inz/documents/industry/education-agent-performance-data-for-{year}.xlsx',
    page: 'https://www.immigration.govt.nz/study/for-education-providers/data-and-processing-times-for-international-student-visas/education-agent-performance-data/',
    name: 'Education agent performance data',
    attribution: 'Immigration New Zealand',
    licence: 'Crown copyright, released under NZGOAL (CC BY)',
  },
  rent: {
    url: 'https://www.tenancy.govt.nz/assets/Uploads/Tenancy/Rental-bond-data/detailed-monthly-tla-tenancy-v3.csv',
    page: 'https://www.tenancy.govt.nz/about-tenancy-services/data-and-statistics/rental-bond-data/',
    name: 'Rental bond data by territorial authority',
    attribution: 'Ministry of Business, Innovation and Employment',
    licence: 'CC BY 3.0 NZ',
  },
};

/* The agent workbook has one sheet per source market. Sri Lanka is the
   audience, and one of only nine markets INZ publishes at all. */
const AGENT_MARKET = 'Sri Lanka';

/* What we keep. Sri Lanka is the audience; the other five are the
   comparison every Sri Lankan applicant has already heard about from an
   agent, so showing them turns a bare percentage into a position. */
const NATIONALITIES = [
  { code: 'LK', row: 'Sri Lanka',  label: 'Sri Lanka' },
  { code: 'CN', row: 'China',      label: 'China' },
  { code: 'IN', row: 'India',      label: 'India' },
  { code: 'NP', row: 'Nepal',      label: 'Nepal' },
  { code: 'PK', row: 'Pakistan',   label: 'Pakistan' },
  { code: 'BD', row: 'Bangladesh', label: 'Bangladesh' },
];

/* Student visa criteria a postgraduate applicant could actually be
   processed under. The file lists ~20; the rest are dependants,
   section 61 orders and reconsiderations, which are not routes anyone
   chooses. */
const STUDENT_CRITERIA = [
  { row: 'Full fee paying',          label: 'Full fee paying' },
  { row: 'Pathway',                  label: 'Pathway student visa' },
  { row: 'English language studies', label: 'English language studies' },
  { row: 'NZ Government Scholarship', label: 'NZ Government Scholarship' },
  { row: 'Exchange Student',         label: 'Exchange student' },
];

/* The two post-study work visa routes, from the work-visa file. "Open"
   is the one a master's graduate gets; "Employer Assisted" closed to
   new applicants in 2019 and is kept only because its collapse is the
   clearest evidence that this policy moves. */
const WORK_CRITERIA = [
  { row: 'Post-study - Open',              label: 'Post-study work visa (open)' },
  { row: 'Post-study - Employer Assisted', label: 'Post-study work visa (employer assisted)' },
];

/* PF_CITY_COSTS ids → the territorial authority name in the bond file. */
const CITIES = [
  { id: 'akl', tla: 'Auckland',               city: 'Auckland' },
  { id: 'wlg', tla: 'Wellington City',        city: 'Wellington' },
  { id: 'chc', tla: 'Christchurch City',      city: 'Christchurch' },
  { id: 'dud', tla: 'Dunedin City',           city: 'Dunedin' },
  { id: 'ham', tla: 'Hamilton City',          city: 'Hamilton' },
  { id: 'pn',  tla: 'Palmerston North City',  city: 'Palmerston North' },
];

const problems = [];
const fail = m => { problems.push(m); console.error('  ✗ ' + m); };

/* ── fetch ──────────────────────────────────────────────────────── */
function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('too many redirects: ' + url));
    https.get(url, {
      headers: {
        // Identify the client honestly. These are public files served to
        // anyone; we are not evading anything, just not sending the
        // default Node UA that some CDNs drop.
        'User-Agent': 'PathFinder-data-sync/1.0 (+https://github.com/ureshan2011/Pathfinder)',
        'Accept': '*/*',
      },
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).toString(), redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const bufs = [];
      res.on('data', b => bufs.push(b));
      res.on('end', () => resolve(Buffer.concat(bufs)));
    }).on('error', reject);
  });
}

/* ── PDF → text ─────────────────────────────────────────────────────
   These files are Crystal Reports exports: flate-compressed content
   streams of literal-string show operators, no custom encodings on the
   table text. Pulling the literals out in stream order reproduces the
   tables well enough to parse positionally, which is why this needs no
   PDF library. */
function pdfText(buf) {
  // latin1 is a byte-for-byte round trip, so string offsets here are byte
  // offsets — which utf8 would not be, and the streams are binary.
  const bin = buf.toString('latin1');
  const chunks = [];
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(bin)) !== null) {
    const start = m.index + m[0].length;
    const end = bin.indexOf('endstream', start);
    if (end < 0) continue;
    try {
      const out = zlib.inflateSync(Buffer.from(bin.slice(start, end), 'latin1')).toString('latin1');
      if (out.includes('Tj') || out.includes('TJ')) chunks.push(out);
    } catch (_) { /* image or font stream — not text */ }
  }
  const literals = chunks.join('\n').match(/\((?:[^()\\]|\\.)*\)/g) || [];
  return literals.map(s => s.slice(1, -1)).join(' ').replace(/\s+/g, ' ');
}

/* ── xlsx → rows ────────────────────────────────────────────────────
   The agent performance workbook is a real .xlsx, which is a ZIP of
   XML parts. Rather than take a dependency for one file a year, this
   reads the ZIP directly: walk the central directory, inflateRaw each
   entry we need. Same trick as pdfText() above — zlib is already here,
   and the format is stable enough that a library buys nothing.

   Only three parts matter: workbook.xml (sheet name → rel id), the
   rels file (rel id → part path), and sharedStrings.xml, because Excel
   stores repeated text once and the cells hold indices into it. */
function unzip(buf) {
  // End-of-central-directory record, scanned backwards past any comment.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('agent workbook is not a zip (no EOCD)');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory entry');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    // The local header repeats the name/extra lengths, and its extra
    // field length can differ from the central one — always trust local.
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    files[name] = method === 0 ? raw : zlib.inflateRawSync(raw);

    p += 46 + nameLen + extraLen + cmtLen;
  }
  return files;
}

const xmlUnescape = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&amp;/g, '&');

/* Every <si> is one shared string; its text may be split across several
   <t> runs when Excel has applied mixed formatting, so concatenate. */
function sharedStrings(xml) {
  return (xml.match(/<si>[\s\S]*?<\/si>/g) || []).map(si =>
    xmlUnescape((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [])
      .map(t => t.replace(/<[^>]+>/g, '')).join('')));
}

/* One sheet → array of row arrays of display strings. Cells carrying
   t="s" index the shared table; t="inlineStr" carries its own <t>;
   anything else is a literal already in <v>. Blank cells collapse —
   this sheet is three dense columns, so position is not load-bearing. */
function sheetRows(xml, strings) {
  return (xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || []).map(row =>
    (row.match(/<c[^>]*\/>|<c[^>]*>[\s\S]*?<\/c>/g) || []).map(c => {
      const type = (c.match(/\st="([^"]+)"/) || [])[1];
      if (type === 'inlineStr') {
        return xmlUnescape((c.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || '').trim();
      }
      const v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      if (v == null) return '';
      return type === 's' ? (strings[+v] || '').trim() : v.trim();
    }).filter(x => x !== ''));
}

/* Pull one country's sheet out of the workbook by its tab name. */
function xlsxSheet(files, tabName) {
  const wb = files['xl/workbook.xml'].toString('utf8');
  const rels = files['xl/_rels/workbook.xml.rels'].toString('utf8');
  const strings = files['xl/sharedStrings.xml']
    ? sharedStrings(files['xl/sharedStrings.xml'].toString('utf8')) : [];

  const tag = (wb.match(/<sheet[^>]*>/g) || [])
    .find(t => xmlUnescape((t.match(/name="([^"]*)"/) || [])[1] || '') === tabName);
  if (!tag) return null;

  const rid = (tag.match(/r:id="([^"]+)"/) || [])[1];
  const rel = (rels.match(/<Relationship[^>]*>/g) || [])
    .find(r => r.includes(`Id="${rid}"`));
  let target = (rel && (rel.match(/Target="([^"]+)"/) || [])[1]) || '';
  target = target.replace(/^\/?xl\//, '').replace(/^\//, '');

  const part = files['xl/' + target];
  if (!part) return null;
  return sheetRows(part.toString('utf8'), strings);
}

/* ── agent performance ──────────────────────────────────────────────
   INZ publishes one workbook a year, one sheet per source market, and
   Sri Lanka is one of only nine. Each sheet is a header block of
   asterisked methodology notes, then three columns: agent name, an
   approval-rate BAND (never a point figure), and a volume RANGE.

   The banding is deliberate on INZ's part and we keep it: republishing
   "87.5%" where the publisher wrote "85-90%" would be restating their
   data, not reproducing it. We also carry their notes verbatim, because
   one of them changes how the numbers read — individual agent rows
   exclude withdrawn and lapsed applications while the market total
   includes them, so an agent's band is NOT directly comparable to the
   market figure. A reader who is not told that will draw the wrong
   conclusion, and we would have handed them the means to do it. */
function parseAgents(rows, market) {
  // The methodology block may arrive as one cell per note or as a single
  // cell with the notes newline-separated, depending on how the sheet was
  // authored that year. Flatten both shapes to one note per line.
  const notes = rows
    .filter(r => r.length === 1 && r[0].startsWith('*'))
    .flatMap(r => r[0].split(/\r?\n/))
    .map(l => l.replace(/^\*\s*/, '').trim())
    .filter(l => l && !/^Contact\s+\S+@/i.test(l));   // drop the INZ mailbox line
  const title = (rows.find(r => r.length === 1 && !r[0].startsWith('*')) || [])[0] || '';

  const head = rows.findIndex(r => r[0] === 'Agent name');
  if (head < 0) return fail(`agents/${market}: no "Agent name" header row`), null;

  let total = null;
  const agents = [];
  for (const r of rows.slice(head + 1)) {
    if (r.length < 3) continue;
    const [name, rate, volume] = r;
    if (/^Total for/i.test(name)) {
      // The market row carries a fraction (0.8), not a band.
      const pct = Number(rate);
      if (!isFinite(pct)) { fail(`agents/${market}: market total rate "${rate}" is not a number`); continue; }
      total = { label: name, rate: Math.round(pct * 1000) / 10, volume };
      continue;
    }
    if (!/^\d+-\d+%$/.test(rate)) { fail(`agents/${market}: "${name}" rate "${rate}" is not a band`); continue; }
    agents.push({ name, band: rate, volume });
  }

  if (!total) return fail(`agents/${market}: no market total row`), null;
  if (agents.length < 5) return fail(`agents/${market}: only ${agents.length} agent rows`), null;

  // Sort by band floor descending, then by name, so the shipped order is
  // stable across builds and does not depend on the publisher's ordering.
  agents.sort((a, b) => (parseInt(b.band, 10) - parseInt(a.band, 10)) || a.name.localeCompare(b.name));
  return { title, notes, total, agents };
}

/* ── table row parsing ──────────────────────────────────────────────
   A row reads "<label> a d t  a d t  …  grandTotal", one approved /
   declined / total triple per financial year. Three things make this
   harder than it sounds, and each has a defence:

   · A wide table SPLITS ACROSS PAGES, so one row's ten years arrive as
     nine triples in one place and the tenth plus the grand total
     somewhere later. We therefore walk every occurrence of the label in
     document order and keep filling years until the row is complete.
   · Each table is rendered TWICE, the second time with zero cells
     collapsed to blanks, which would parse into garbage. We stop as
     soon as the row is full, which is always inside the first copy.
   · The publisher prints a GRAND TOTAL at the end of the row. That is
     a checksum they have handed us for free: if our ten yearly totals
     do not sum to their printed total, our column alignment is wrong.
     We require it to match. This is what turns positional PDF scraping
     into something safe enough to print at a family. */
function docYears(text) {
  const count = {};
  (text.match(/\d{4}\/\d{2}/g) || []).forEach(y => { count[y] = (count[y] || 0) + 1; });
  // Column headings repeat on every page; a year mentioned once or twice
  // is prose, not a heading.
  return Object.keys(count).filter(y => count[y] >= 3).sort();
}

function numberRuns(text, label) {
  const runs = [];
  let at = -1;
  while ((at = text.indexOf(label + ' ', at + 1)) >= 0) {
    const after = text.slice(at + label.length);
    const run = (after.match(/^[\s\d,]+/) || [''])[0];
    const nums = (run.match(/\d[\d,]*/g) || []).map(n => Number(n.replace(/,/g, '')));
    if (nums.length) runs.push(nums);
  }
  return runs;
}

function parseRow(text, label, what, years) {
  const runs = numberRuns(text, label);
  if (!runs.length) { fail(`${what}: row "${label}" not found`); return null; }

  const series = [];
  let printedTotal = null;

  for (const nums of runs) {
    // A run is k triples, optionally followed by the row's grand total.
    const hasTotal = nums.length % 3 === 1;
    const k = (nums.length - (hasTotal ? 1 : 0)) / 3;
    if (k < 1) continue;

    for (let i = 0; i < k && series.length < years.length; i++) {
      const [a, d, t] = nums.slice(i * 3, i * 3 + 3);
      if (a + d !== t) {
        fail(`${what}: "${label}" ${years[series.length]} — ${a}+${d} ≠ printed ${t}`);
        return null;
      }
      series.push({ y: years[series.length], a, d });
    }
    if (hasTotal) printedTotal = nums[nums.length - 1];
    if (series.length >= years.length) break;
  }

  if (series.length !== years.length) {
    fail(`${what}: "${label}" filled ${series.length} of ${years.length} years`);
    return null;
  }
  if (printedTotal === null) {
    fail(`${what}: "${label}" has no printed grand total to check against`);
    return null;
  }
  const sum = series.reduce((n, r) => n + r.a + r.d, 0);
  if (sum !== printedTotal) {
    fail(`${what}: "${label}" sums to ${sum} but the file prints ${printedTotal} — columns are misaligned`);
    return null;
  }
  return series;
}

function preparedOn(text) {
  const m = text.match(/Report prepared:\s*(\d{1,2} \w+ \d{4})/) ||
            text.match(/Date Prepared:\s*(\d{1,2} \w+ \d{4})/);
  return m ? m[1] : null;
}

/* ── rental bonds ───────────────────────────────────────────────────
   The file is one row per month per territorial authority, back to
   1993. We keep the latest month for six cities and nothing else.

   IMPORTANT, and the reason this is presented as a reference rather
   than substituted into PF_CITY_COSTS: a bond is lodged against a
   WHOLE TENANCY, so the median is what a whole house or flat costs —
   not what one student pays for a room in a shared one. Conflating the
   two would roughly double every living-cost figure in the app. */
function parseRent(csv) {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const cell = line => line.split(/","|^"|"$/).filter(s => s !== '');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = cell(lines[i]);
    if (c.length < 10) continue;
    rows.push({
      month: c[0], name: c[2],
      active: Number(String(c[4]).replace(/,/g, '')),
      median: Number(String(c[6]).replace(/,/g, '')),
      uq: Number(String(c[8]).replace(/,/g, '')),
      lq: Number(String(c[9]).replace(/,/g, '')),
    });
  }
  const asOf = rows.map(r => r.month).sort().pop();
  const latest = rows.filter(r => r.month === asOf);

  const byCity = {};
  CITIES.forEach(c => {
    const r = latest.find(x => x.name === c.tla);
    if (!r || !isFinite(r.median) || !r.median) { fail(`rent: no ${c.tla} row for ${asOf}`); return; }
    if (!(r.lq <= r.median && r.median <= r.uq)) { fail(`rent: ${c.tla} quartiles out of order`); return; }
    byCity[c.id] = { city: c.city, tla: c.tla, median: r.median, lq: r.lq, uq: r.uq, bonds: r.active };
  });
  return { asOf: asOf ? asOf.slice(0, 7) : null, byCity };
}

/* ── write ──────────────────────────────────────────────────────── */
function serialise(data) {
  return `/* GENERATED by scripts/sync-govt-data.js — do not edit by hand.
   Run: node scripts/sync-govt-data.js

   Three New Zealand government datasets, reduced to the rows PathFinder
   displays. Values are copied unmodified from the published files;
   percentages are computed in the browser from the approved/declined
   pair, never stored here.

   Every block carries its own attribution and licence because both
   publishers require credit as a condition of reuse. The UI prints
   them. Do not remove them.

   Built: ${new Date().toISOString().slice(0, 10)}
*/
window.PF_GOVT = ${JSON.stringify(data, null, 2)};
`;
}

/* ── main ───────────────────────────────────────────────────────── */
(async function main() {
  console.log('PathFinder — government data sync\n');

  console.log('1/4  Immigration NZ — student visa decisions');
  const studentPdf = await get(SRC.student.url);
  const studentTxt = pdfText(studentPdf);
  console.log(`     ${(studentPdf.length / 1024).toFixed(0)} KB, ${studentTxt.length.toLocaleString()} chars of text`);

  const studentYears = docYears(studentTxt);
  const byNationality = {};
  NATIONALITIES.forEach(n => {
    const s = parseRow(studentTxt, n.row, 'student/nationality', studentYears);
    if (s) byNationality[n.code] = { label: n.label, series: s };
  });
  const studentCriteria = [];
  STUDENT_CRITERIA.forEach(c => {
    const s = parseRow(studentTxt, c.row, 'student/criteria', studentYears);
    if (s) studentCriteria.push({ label: c.label, series: s });
  });
  console.log(`     ${Object.keys(byNationality).length} nationalities, ${studentCriteria.length} criteria`);

  console.log('2/4  Immigration NZ — work visa decisions');
  const workPdf = await get(SRC.work.url);
  const workTxt = pdfText(workPdf);
  const workYears = docYears(workTxt);
  const postStudy = [];
  WORK_CRITERIA.forEach(c => {
    const s = parseRow(workTxt, c.row, 'work/criteria', workYears);
    if (s) postStudy.push({ label: c.label, series: s });
  });
  console.log(`     ${postStudy.length} post-study routes`);

  /* INZ publishes this one workbook a year with the year in the filename
     and no index to discover it from, so probe backwards from next year
     and take the newest that exists. New editions are picked up by
     re-running the script; nothing here needs editing in January. */
  console.log('3/4  Immigration NZ — education agent performance');
  const thisYear = new Date().getFullYear();
  let agentBook = null, agentYear = null;
  for (let y = thisYear + 1; y >= thisYear - 3; y--) {
    try {
      agentBook = await get(SRC.agents.url.replace('{year}', y));
      agentYear = y;
      break;
    } catch (_) { /* not published yet, or no longer hosted */ }
  }
  let agents = null;
  if (!agentBook) {
    fail('agents: no workbook found for any year in range');
  } else {
    console.log(`     ${agentYear} edition, ${(agentBook.length / 1024).toFixed(0)} KB`);
    const parts = unzip(agentBook);
    const rows = xlsxSheet(parts, AGENT_MARKET);
    if (!rows) fail(`agents: no "${AGENT_MARKET}" sheet in the ${agentYear} workbook`);
    else {
      agents = parseAgents(rows, AGENT_MARKET);
      if (agents) console.log(`     ${agents.agents.length} named agents, market ${agents.total.rate}%`);
    }
  }

  console.log('4/4  MBIE — rental bond data');
  const rentCsv = (await get(SRC.rent.url)).toString('utf8');
  const rent = parseRent(rentCsv);
  console.log(`     ${Object.keys(rent.byCity).length} cities, as at ${rent.asOf}`);

  if (problems.length) {
    console.error(`\n✗ ${problems.length} integrity problem(s) — nothing written.`);
    console.error('  The published layout probably changed. Fix the parser before shipping.');
    process.exit(1);
  }

  const meta = s => ({ src: s.name, srcUrl: s.page, fileUrl: s.url, attribution: s.attribution, licence: s.licence });

  const data = {
    built: new Date().toISOString().slice(0, 10),
    studentVisa: {
      ...meta(SRC.student),
      preparedOn: preparedOn(studentTxt),
      note: 'Counts are applications, not people — one person applying twice is counted twice. "Declined" also includes applications withdrawn or replaced by a later one, so it is not purely a policy refusal.',
      byNationality,
      byCriteria: studentCriteria,
    },
    postStudyWork: {
      ...meta(SRC.work),
      preparedOn: preparedOn(workTxt),
      note: 'Post-study work visa decisions across all nationalities. The employer-assisted route closed to new applicants in 2019.',
      routes: postStudy,
    },
    agents: agents ? {
      ...meta(SRC.agents),
      fileUrl: SRC.agents.url.replace('{year}', agentYear),
      year: agentYear,
      market: AGENT_MARKET,
      title: agents.title,
      publisherNotes: agents.notes,
      total: agents.total,
      rows: agents.agents,
      note: 'Approval rates are published as BANDS and volumes as RANGES \u2014 INZ does not release point figures, and neither do we. A band is not a quality score: it counts offshore student visa decisions where that agent was declared on the form, over one calendar year.',
    } : null,
    rent: {
      ...meta(SRC.rent),
      ...rent,
      note: 'Median weekly rent for a WHOLE tenancy — a house or a flat, not a room in a shared one. A student sharing pays a fraction of this.',
    },
  };

  fs.writeFileSync(OUT, serialise(data));
  const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
  console.log(`\n✓ Wrote ${path.relative(ROOT, OUT)} (${kb} KB)`);
})().catch(e => { console.error('\n✗ ' + e.message); process.exit(1); });
