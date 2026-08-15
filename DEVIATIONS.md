# Deviations from the Ink & Brass handoff

Tracking anything implemented differently from the literal spec, and why.
Updated as the port continues (currently through step 5 — dashboard).

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

## Still open

- The sidebar's persistent "your mentor" identity/quote (see above) needs
  a real product decision: either accept the request-state version here,
  or add a mentor-profile read the student's device is allowed to sync.
- Track switch, sign-in controls, and legal links now live inside the
  overflow popover rather than a dedicated location the handoff didn't
  specify. Flagging in case a different placement is preferred.
