# Blainroe Winter League

Self-contained GitHub Pages app for Men's Winter League 2026/2027, sponsored by Spirit Ford Wicklow.

See [the HTML owner guide](./README.html) for rules, privacy, CSV formats and actual owner publication steps.

Node 20 or later, no dependencies:

```text
npm test
npm run serve
npm run publish:data -- "C:\explicit\path\reviewed.json"
```

Public results read `data/published.json`. Uploads and committee tools change only results saved on this device. The publication helper validates and copies local data only, never commits or pushes. The owner supplies `blainroe-anni-logo.png`, reviews public-name consent and deploys `main` root through GitHub Pages.

The supplied **WinterLeague 2026-2027 Team List.xlsx** is now baked into the local publication file: 45 populated teams (IDs 2 to 46), 134 player entries, 133 distinct canonical names. Workbook order and team numbers are preserved, including Team 21 first. Number-only rows 1 and 47 to 50 are unused placeholders, not invented teams. Trailing spaces in Chris Mahon and David Brown are trimmed; original spellings, initials, the curly apostrophe in Brian O'Reilly's workbook name, and surname-first `Leonard, Dean` are otherwise preserved. No workbook scores were imported: score cells were empty and cached totals were zero.

**More: team list, final and committee tools > Committee tools > Edit team list** has a team selector, editable players and notes, and **Save team to my draft**. Existing team IDs stay fixed. New teams require three names. Team 34 contains only Paddy Daly and Timothy Cummins with an explicitly vacant third place. Team 37 records Eugene McCrystal (away member at Bundoran) as awaiting eligibility confirmation by Niall, not approved. Colin Owens appears in both Teams 10 and 37 in the workbook. Both entries are preserved with score matching held: his raw cards stay in Singles/unassigned review and count for neither team until the committee corrects/disambiguates membership and clears the holds. Notes are informational, not an automatic eligibility filter.

The app opens the published **Team leaderboard**. With no qualifying results, it shows **No results uploaded yet**, not invented first-place ties. After upload, the table shows rank, team number and players, team points and weekend points. Team-list questions are collapsed; unmatched/held uploaded cards remain visible and actionable. Advanced views, settings, exports and editing are secondary.

An older saved draft with zero teams uses the published team list when previewing scores and adds it on explicit **Update leaderboard** or **Resume my saved results**, preserving raw scores and settings. Preview alone never writes storage. Existing customized teams are never automatically replaced: use **Use published team list in my draft** and confirm if that is intended. A change that invalidates final cards is rejected, not silently deleted. Team-list edits recalculate every weekend by canonical name without renaming raw cards; genuinely changed names can leave older cards unassigned. Review those cards and back up first. Reload opens published data, with an obvious resume action when local scores exist.

**Download draft team list CSV** exports editable `Team Name,Player1,Player2,Player3,Notes,Held Players` columns. Held Players uses `|` between names. Reimport through **Replace team list from CSV**, preview notes/vacancies/holds and confirm the removed-team list. Basic four-column CSV remains supported and preserves notes and holds on matching existing teams; explicit Notes/Held Players columns replace those values. JSON backups, reload, HTML reports and publication exports retain the same team metadata. Browser editing does not publish; the owner must review names/consent and follow the existing publication workflow.

Choose **Upload HandicapMaster results** directly on the leaderboard, select net report CSV(s), review actual player/team matches and matched/unmatched/held counts, confirm 12-hole net points, then choose **Update leaderboard**. Supported report dates and explicit competition/round names fill automatically; otherwise a dated weekend name is offered or missing essentials are requested. The recalculated leaderboard appears immediately. Updates are **Saved on this device**, not shared automatically. Progress and filename-specific errors appear beside the chooser. Recognized gross scorecards are listed and excluded from net scoring, not stored. Only-scorecard batches need a net report; malformed/unknown result files block the whole net import. Preview saves nothing and creates no draft. Final/JSON imports are in **Other imports**; committee settings, editing, backups/publication and destructive tools remain expandable.

For Handicap Master weekend net points, include **Competition Report (Aggregated Net Result)**. Gross **Competition Scorecards** or hole-by-hole files may accompany it in the same selection but are recognized and excluded, never converted to net points or saved. Aggregated reports handle divisions, footers, signed handicap metadata and a common Saturday/Sunday weekend. Explicit No Return/withdrawn and DQ rows are omitted with preview counts. Printed dates never supply the weekend. Keep gross scorecard originals privately for a future separate Winter Eclectic Cup; no Eclectic implementation or approval to publish that data is included.

Winter League is 12-hole net Stableford: retain all three players' reported cards unchanged and combine the highest two for the team's weekly score. Do not rescale to 18 holes, convert handicaps, or assume a fixed hole set. This weekly rule does not settle the separate final scoring assumption.

The Singles tab ranks all submitted individual cards for one imported weekend, including zero and unassigned players before registration. It defaults to the latest qualifying, noncanceled weekend, or the latest imported weekend if none is active. Canceled/excluded weekends are labeled historical review only. Equal points share competition rank; alphabetical display is not official countback, which is unavailable from imported numeric fields. No cumulative singles championship or individual discards are applied. Selection changes only Singles. Review Singles separately: the HTML report still covers league and final only.

## Assumptions
- Committee must confirm tie hierarchy, final scoring interpretation and final date.

## Open Questions
- Committee: resolve Colin Owens' duplicate membership, confirm Eugene McCrystal's eligibility, and fill Team 34's vacancy when known.
- Owner: confirm permission to publish names.

## Risks / Blockers
- Names become public when published. Back up local drafts.

## Next Actions
- Owner: review the HTML guide, validate, approve and publish.
