# Deviations from the Ink & Brass handoff

Tracking anything implemented differently from the literal spec, and why.

**Status:** every view but Research Studio has been ported to the Ink &
Brass hero/listcard/row/chip system (some fully, some as a "shell ported,
inner cards still old-shaped" partial port — each one is called out below,
not left unstated). Settle In and Research Studio's own inner content are
untouched. The Funds Check/Settle In → Visa Hub and Explore/Research
Studio → Courses tab mergers the handoff asks for are deferred — every
view still lives at its current hash route.

## Implementation strategy

- **`site.css` scoping.** `site.css` is shared by `index.html` and the four
  legal pages, which load it directly with no `brand.css` on top — but the
  handoff also asks for shared class names (`.btn`, `.field`, `.bar`,
  `.chip`) to get new shapes. Rewriting those classes in place would have
  restyled the landing page, which is explicitly out of scope. Every new/
  changed Ink & Brass component rule is scoped under `.shell` (the app-only
  wrapper) instead, so index.html and the legal pages keep today's "Atlas"
  look untouched even though the class names are shared. New component
  names with no landing-page collision (`.topnav`, `.hero`, `.listcard`,
  `.row`, `.stat`, `.sidecard`, `.nudge`, `.tab`, `.icontile`, `.avatar`)
  are scoped the same way for one consistent boundary in the file.

- **Legacy token aliases.** `brand.css`'s new `:root` keeps aliases from the
  old Survey Blue token names (`--route`, `--surface`, `--pine`, `--ochre`,
  `--sea`, `--ink-faint`, etc.) to their nearest Ink & Brass equivalent, so
  every view not yet ported to the new component classes stays tonally
  consistent instead of reverting to the unrelated "Atlas" landing colours
  that `site.css`'s own `:root` would otherwise show through. Remove each
  alias once nothing references it by its old name anymore.

## Content decisions

- **Dashboard drops the full saved-opportunities list, the full mentor-
  request history, and the news strip.** The handoff's dashboard layout is
  enumerated exactly — hero, four stats, one applications listcard in the
  main column; funds/mentor/advisory in the aside — and doesn't include
  these. Nothing is lost: saved items are still manageable from Courses/
  Explore/Funding (where they're saved), the full request history is still
  at Mentors → My requests, and Briefing is its own view. This matches the
  redesign's stated goal ("five competing hierarchies... this version has
  one"), so it's treated as intentional simplification, not a cut needing
  sign-off — but flagging it here since it does remove a browsing surface
  from this one screen.

- **Mentor side card shows the student's own request state, not a mentor's
  name/quote.** The handoff's mockup shows an assigned mentor's avatar,
  name, university/field and a personal quote. The real data model doesn't
  support this: `mentor_requests` only gets a `mentorId` (uid) written on
  claim (see `firebase.js` → `claimRequest`), never a name, and there's no
  quote/bio field anywhere a student could read. Rather than invent a name
  or a quote, the card shows the student's own most recent active request
  (topic, note, status chip) with a prompt state when there isn't one.
  Giving this its full spec'd form would mean adding a mentor-profile
  lookup by uid — a data-model change, not a visual port — so flagging
  instead of building it silently.

- **`highestPriorityIncompleteStep()` never ranks by a scholarship or
  application deadline**, even though the ranking rule is "hard deadline
  soonest → blocks another step → cheapest to finish." `PF_SCHOLARSHIPS
  .deadline` is prose ("1 Mar / 1 Jul / 1 Nov", "Rolling", "Check Manaaki
  rounds"), not a date, and tracked applications carry no deadline field at
  all — sorting by either would mean inventing a specific date. The one
  place a real, ordered, blocking sequence exists is the visa checklist
  (each stage genuinely gates the next), so an open visa stage is the only
  thing that outranks `journeyModel()`'s own next incomplete milestone,
  which remains the fallback for everything else.

- **Hero segment labels** (Choose/Credentials/Apply & fund/Offer & visa/
  Arrive for master's; Foundation/Supervisor Discovery/Proposal &
  Application/Offer & Visa/Arrival & Enrollment for PhD) are a separate,
  shorter label set from `journeyModel()`'s own phase labels (Discover/
  Plan/Apply/Visa/Settle in), matched by index — both are 5-phase, in the
  same order. `journeyModel()` itself is unchanged and remains the one
  source of the actual pct/done/complete data; only the segment strip's
  copy uses the shorter, buildRoadmap-style names the handoff asked for.

## Mentor Dashboard (and, coming next, Admin) — partial port

The Mentor Dashboard's shell (hero, 4 stats, `.tab` row with real
`role="tab"`/`aria-selected`) is fully ported. The request/person/session
*cards* inside each tab (`openReqCard`, `personCard`, `sessionCard`,
`claimedReqCard`) are still the old `.card`-based shapes — they're shared
with Admin (same functions, `adm*` helpers), deeply nested, and load-bearing
for a lot of payment/session logic. Restructuring them into `.row`/`.chip`
is real remaining work, tracked as a follow-up rather than done silently
as "finished." The mentor stat row also drops "Invoiced, not yet paid"
(a 5th metric) to stay at the spec's 4-max — it's still visible inside the
Session log tab itself.

## Course Catalogue, Explore — partial port

Course Catalogue is fully restructured (hero, `.tab` subject/sub-area
rails, a 3-up `.card-grid` of `.listcard`-shaped results with the open one
spanning full width). Explore got its hero, `.tab` field filter, and the
same-class-name bug fixes below, but `uniCard()`/`polytechCards()` still
use their pre-existing `.card` shapes rather than a full listcard/row
rebuild — real remaining work, same partial-port pattern as Mentor
Dashboard/Admin. Research Studio (`renderResearch` and its four
sub-stages) hasn't been touched yet. The handoff's IA also asks for
Explore and Research Studio to become `.tab`s *inside* Courses rather than
their own routes — that routing/IA consolidation is deferred; both still
render at `#explore`/`#research` today. Flagging this explicitly rather
than claiming the merge is done.

## Global fix found while porting Courses/Explore

`.btn-ghost` is built for dark chrome/hero panels (`--chrome-line`/
`--on-chrome` text and border). It was also the class the pre-existing app
used for secondary buttons on ordinary light `.card` surfaces everywhere
— Research Studio, Funding, Funds Check, Templates, Pricing, Account,
Mentors, Admin's session/order tables, etc. On a light card that pairing
is close to unreadable (near-white text/border on near-white). Since this
is a correctness bug rather than a per-view IA decision, all ~60 of those
call sites were switched to `.btn-quiet` in one pass, rather than only
fixing it inside whichever view happened to be mid-port. The two
legitimate `.btn-ghost` uses (the hero's own secondary-button variant,
inside `renderHero()`) are untouched.

## Visa Hub, Funds Check — ported; Settle In and the tab merge deferred

Visa Hub and Funds Check are fully restructured (hero with the real
progress/score figure, listcard-per-stage or listcard result, sidecard for
money/rights facts). Settle In (`renderSettlement`) has not been touched —
it drives the 3D scene/funds-planner/buying-power/first-months tools in
`assets/js/settlement/*.js`, and a rushed restyle risked breaking that
integration under time pressure. Same as Explore/Research Studio: the
handoff's ask to fold Funds Check and Settle In into Visa Hub as tabs is a
routing/IA change deferred to a follow-up, not done silently.

## viewHead() — down to one caller left

Every view now uses renderHero() except Research Studio (`renderResearch`
and its four sub-stages: landing, intake, discover, proposal — six
`viewHead()` calls). It's the most complex remaining view (OpenAlex
literature search, a deterministic proposal generator, several distinct
stages) and wasn't touched this pass — restructuring it is real remaining
work, not a quick swap like the other auth/loading-state screens were.
`viewHead()` itself stays defined until that last caller migrates.

## Still open

- The sidebar's persistent "your mentor" identity/quote (see above) needs
  a real product decision: either accept the request-state version here,
  or add a mentor-profile read the student's device is allowed to sync.
- Track switch, sign-in controls, and legal links now live inside the
  overflow popover rather than a dedicated location the handoff didn't
  specify. Flagging in case a different placement is preferred.
- **Research Studio is untouched** — still `viewHead()` + `.card`
  throughout, across all four sub-stages (landing, intake, discover,
  proposal). It's the largest single remaining piece of work.
- **Settle In** (`renderSettlement`) is untouched for the same reason as
  above — its 3D scene / funds planner / buying-power / first-months tools
  need care a same-session restyle risked breaking.
- **Partial ports** (shell done, inner cards still old-shaped): Mentor
  Dashboard's request/person/session cards, Admin's per-section bodies,
  Explore's `uniCard`/`polytechCards`, Billing's order/session cards.
- **Accessibility pass is inline, not a dedicated sweep.** Every view
  built or touched this session got `aria-hidden` on decorative icons,
  `role="tab"`/`aria-selected` on tab rows, `aria-current="page"` on nav,
  and 44px-minimum touch targets on interactive rows/buttons as it was
  written — `:focus-visible` and `prefers-reduced-motion` are global
  rules, not per-view. What hasn't happened is a dedicated keyboard-only
  walkthrough of the whole app, or a contrast check beyond the token
  table's own pre-verified pairings.
- **Responsive verification** covered the views built this session at
  1280/1000ish/390px via screenshots (see the shell's own breakpoints:
  ≥1200, 900–1199, <900). Views not yet ported (Research Studio, Settle
  In) inherit the shell's responsive behaviour but haven't been
  individually checked at each breakpoint.
