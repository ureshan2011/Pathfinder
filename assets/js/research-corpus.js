/* ════════════════════════════════════════════════════════════
   PF_RESEARCH_CORPUS — INDEX for the pre-scraped New-Zealand-authored corpus.

   GENERATED FILE — do not hand-edit. Rebuild from shards with:
     node scripts/build-corpus-index.js
   or re-scrape with:
     node scripts/scrape-nz-corpus.js

   Index only (meta + field → shard map). Papers live in per-field shards under
   assets/js/corpus/<slug>.js, lazy-loaded one at a time by the Research Studio.
   3,504 papers across 8 fields. Generated 2026-06-21.
   ════════════════════════════════════════════════════════════ */
const PF_RESEARCH_CORPUS = {"meta":{"generated":"2026-06-21","source":"OpenAlex","fields":["Agriculture & Food","Business & Economics","Computer Science & AI","Engineering","Environmental Science","Health & Medicine","Physics & Mathematics","Social Sciences & Education"],"paperCount":3504},"fields":{"Agriculture & Food":{"slug":"agriculture-and-food","file":"corpus/agriculture-and-food.js","count":458},"Business & Economics":{"slug":"business-and-economics","file":"corpus/business-and-economics.js","count":524},"Computer Science & AI":{"slug":"computer-science-and-ai","file":"corpus/computer-science-and-ai.js","count":939},"Engineering":{"slug":"engineering","file":"corpus/engineering.js","count":70},"Environmental Science":{"slug":"environmental-science","file":"corpus/environmental-science.js","count":731},"Health & Medicine":{"slug":"health-and-medicine","file":"corpus/health-and-medicine.js","count":417},"Physics & Mathematics":{"slug":"physics-and-mathematics","file":"corpus/physics-and-mathematics.js","count":62},"Social Sciences & Education":{"slug":"social-sciences-and-education","file":"corpus/social-sciences-and-education.js","count":303}}};
if (typeof window !== 'undefined') { window.PF_RESEARCH_CORPUS = PF_RESEARCH_CORPUS; window.PF_CORPUS_SHARDS = window.PF_CORPUS_SHARDS || {}; }
