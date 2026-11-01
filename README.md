# Blainroe Winter League

Self-contained GitHub Pages app for Men's Winter League 2026/2027, sponsored by Spirit Ford Wicklow.

See [the HTML owner guide](./README.html) for rules, privacy, CSV formats and actual owner publication steps.

Node 20 or later, no dependencies:

```text
npm test
npm run serve
npm run publish:data -- "C:\explicit\path\reviewed.json"
```

Public results read `data/published.json`. Administration changes only a browser draft. The publication helper validates and copies local data only, never commits or pushes. The owner supplies `blainroe-anni-logo.png`, reviews public-name consent and deploys `main` root through GitHub Pages.

For Handicap Master weekend results, use **Competition Report (Aggregated Net Result)**, not gross **Competition Scorecards** or hole-by-hole files. Aggregated reports handle divisions, footers, signed handicap metadata and a common Saturday/Sunday weekend. Explicit No Return/withdrawn and DQ rows are omitted with preview counts. Printed dates never supply the weekend. Gross scorecard sources may be retained privately for a future separate Winter Eclectic Cup; no Eclectic implementation or approval to publish that data is included.

Winter League is 12-hole net Stableford: retain all three players' reported cards unchanged and combine the highest two for the team's weekly score. Do not rescale to 18 holes, convert handicaps, or assume a fixed hole set. This weekly rule does not settle the separate final scoring assumption.

The Singles tab ranks all submitted individual cards for one imported weekend, including zero and unassigned players before registration. It defaults to the latest qualifying, noncanceled weekend, or the latest imported weekend if none is active. Canceled/excluded weekends are labeled historical review only. Equal points share competition rank; alphabetical display is not official countback, which is unavailable from imported numeric fields. No cumulative singles championship or individual discards are applied. Selection changes only Singles. Review Singles separately: the HTML report still covers league and final only.

## Assumptions
- Committee must confirm tie hierarchy, final scoring interpretation and final date.

## Open Questions
- Approved team registration and permission to publish names are still needed.

## Risks / Blockers
- Names become public when published. Back up local drafts.

## Next Actions
- Owner: review the HTML guide, validate, approve and publish.
