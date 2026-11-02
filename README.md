# Blainroe Winter League

Self-contained GitHub Pages app for Men's Winter League 2026/2027, sponsored by Spirit Ford Wicklow.

See [the HTML owner guide](./README.html) for rules, privacy, CSV formats and actual owner publication steps.

Node 20 or later, no dependency install:

```text
npm test
npm run serve
npm run publish:data -- "C:\explicit\path\reviewed.json"
```

Public results read `data/published.json`. Uploads and committee tools change only results saved on this device. The publication helper validates and copies local data only, never commits or pushes. The owner supplies `blainroe-anni-logo.png`, reviews public-name consent and deploys `main` root through GitHub Pages.

## Weekly accumulated results

Select any table column header to sort ascending, then select it again to reverse. Arrows show the active sort; keyboard users can Tab to a header and use Enter or Space. Sorting changes display order only, not ranks, stored results or PDF/report order. Sort choices last while the page stays open and reset if the selected column disappears.

On the team leaderboard, scroll across for each active qualifying round's P1, P2, P3 and best-two team total. Rank and team/player identity stay visible. P1 to P3 refer to the labelled players in the team column. NA means no card or vacant; 0 is an actual submitted score; H marks a held raw card which does not count. Discarded team totals are labelled after completion. Cancelled/excluded weekends remain in Team list and weekends and the PDF, not the qualifying leaderboard.

The shared publication now includes the real **Mens Winter League singles - R1 - Alt Day**, played **31 October and 1 November 2026**, keyed as weekend **2026-10-31**. The report contains 168 processed rows: **165 scoring cards**, with **1 NR and 2 DQ excluded**. There are **98 matched, 66 unmatched and 1 held** scoring cards. Teams **15 and 27 share first place on 49 points**. All raw accepted net points and reported playing handicaps are preserved; team best-two scoring is unchanged. Colin Owens' held card counts for neither team.

Private source, read without changing it:

```text
C:\Users\enkelly\OneDrive\GoY_Ecclectic\Winter_League\2026-2027\Results\Competition Report (Aggregated Net Result) - Mens Winter League singles - R1 - Alt Day - Sunday 1 November 2026.csv
```

`WL1-Competition Scorecards.csv` and `WL1-Competition Scorecards-AltDay.csv` in that folder were recognised as gross and excluded, not stored. No raw CSV, report footers, contact details or workbook are published.

Like GOY/Eclectic's `Step1-IngestCsvs.ps1` and `append-preload.js`, weekly updates extend the checked-in shared preload and deduplicate existing results. Unlike that script, this tool never commits, pushes or deploys. Its net-only parser does not copy GOY's 18-hole/gross/eclectic rules. GOY's Step 2 newsletter/PDF workflow is separate and is not added here.

From the repository, preview the next approved report:

```text
npm run update:results -- --file "C:\path\Competition Report (Aggregated Net Result).csv" --confirm-net
```

Review the printed weekend, excluded files, omission counts, matches and cumulative standings. Repeat the same command with **`--apply`** to write `data/published.json` locally. Add repeated `--file "C:\path\another.csv"` arguments for up to 20 files, including optional gross scorecards. Multiple weekends can be ingested together. Every file is validated before any write; an invalid net file rejects the entire batch. Repeating identical results changes nothing. Existing weekends, raw cards, teams, roster holds/notes, settings and valid final cards remain.

Dates come from played-on metadata, never filenames or the upload date; Saturdays and Sundays share a Saturday key. The report's explicit title supplies the round name. If absent, the tool uses the existing weekend name or `Weekend YYYY-MM-DD`. Use **`--date YYYY-MM-DD`** only for missing committee weekend metadata, or **`--name "Approved round name"`** when necessary. Explicit dates that contradict a report are refused. A season safety fence accepts weekends from 1 October 2026 to 30 April 2027, not last-year handover examples; it is not an eligibility schedule. `--confirm-net` attests these are reported 12-hole net Stableford points, not converted gross scores.

Conflicting points, handicap metadata or weekend metadata are refused without writing. For an intentional correction, select the **complete corrected net results for that weekend**, preview with **`--replace-weekend 2026-10-31`** (substitute the actual existing Saturday key), review the whole replacement, then add `--apply`. Only the named weekend is replaced; omitted players lose their card for that weekend. The flag must name an existing weekend included in the selected results. Back up or retain the reviewed git version first. Final eligibility validation still applies.

After applying, run `npm test` and review `git diff -- data/published.json`. The owner separately commits, pushes and deploys through the existing reviewed GitHub process. Check **Refresh published results** and a second device after deployment. The JSON is written by validated same-directory staging and atomic rename, with a concurrent-update lock and stale-file check. Interrupted writes cannot leave a partial publication; if a crashed process leaves `.lock`/`.pending` files, confirm no update is running before removing those leftover files. No credentials, scheduled task or backend is needed.

Browser uploads also fetch the latest shared publication before preview and again before apply. A saved draft gains new online weekends instead of hiding them. A saved baseline supports three-way merging of independent roster, settings and card changes. Existing current-league customisations are preserved; unrelated-season/team drafts are blocked. Legacy drafts without a baseline retain their roster/settings, adopt published teams when empty, and merge compatible history conservatively. Conflicting shared cards or weekend metadata require a committee decision, never silent overwrite. Download the unchanged draft backup before correcting it or intentionally replacing it with published data.

**Export validated publication JSON** fetches/rebases on the latest online results and refuses removal or alteration of already-published cards/weekends. It downloads only, never saves to the server. For intentional score corrections use the CLI replacement workflow. For reviewed roster/settings or new-weekend browser exports, run `npm run publish:data -- "C:\path\reviewed.json"` rather than copying over the publication directly: it protects existing history and writes atomically. Its optional `--replace-weekend YYYY-MM-DD` permits a reviewed complete correction to that named weekend, never deletion of online weekends. Git history retains each reviewed published version.

The supplied **WinterLeague 2026-2027 Team List.xlsx** is now baked into the local publication file: 45 populated teams (IDs 2 to 46), 134 player entries, 133 distinct canonical names. Workbook order and team numbers are preserved, including Team 21 first. Number-only rows 1 and 47 to 50 are unused placeholders, not invented teams. Trailing spaces in Chris Mahon and David Brown are trimmed; original spellings, initials, the curly apostrophe in Brian O'Reilly's workbook name, and surname-first `Leonard, Dean` are otherwise preserved. No workbook scores were imported: score cells were empty and cached totals were zero.

**More: team list, final and committee tools > Committee tools > Edit team list** has a team selector, editable players and notes, and **Save team to my draft**. Existing team IDs stay fixed. New teams require three names. Team 34 contains only Paddy Daly and Timothy Cummins with an explicitly vacant third place. Team 37 records Eugene McCrystal (away member at Bundoran) as awaiting eligibility confirmation by Niall, not approved. Colin Owens appears in both Teams 10 and 37 in the workbook. Both entries are preserved with score matching held: his raw cards stay in Singles/unassigned review and count for neither team until the committee corrects/disambiguates membership and clears the holds. Notes are informational, not an automatic eligibility filter.

The app opens the published **Team leaderboard**. With no qualifying results, it shows **No results uploaded yet**, not invented first-place ties. After upload, the table shows rank, team number and players, team points and weekend points. Team-list questions are collapsed; unmatched/held uploaded cards remain visible and actionable. Advanced views, settings, exports and editing are secondary.

**Export leaderboard PDF**, beside the main upload button, downloads an actual PDF of the currently visible published view or local draft. Resume saved results first to export that draft. The PDF labels published/provisional, saved DRAFT or unsaved DRAFT accurately, gives the actual qualifying results-through weekend, and includes every team, player and imported weekend. With no qualifying team matches it exports an honest awaiting-results team list, without ranks or totals. The green/white landscape report has the club logo, Spirit Ford Wicklow branding, repeated table/club headers, page numbers, scoring notes and brief team-list/held-card flags. A summary is followed by six-weekend detail groups, showing all three raw cards and counted/discarded team totals without shrinking a long season to tiny columns. Cancelled/excluded weekends remain labelled historical detail.

Precedents inspected: Craig's `Craig-Handover\WINTER LEAGUE 2025 - 2026 TEAM LIST R5.pdf` and `WINTER LEAGUE 2025 - 2025 TEAM LIST R5II.xlsm` (Teams and Sheet1); the GOY app's `js\app.js` (`exportPDF`, `getGOYPdfCSS`, event key); and the actual GOY, Gross and Nett PDFs in `PublishResults\AfterNovemberMedal`. Reused the landscape club/sponsor heading, separate player columns, prominent combined totals, green table headers and striped rows. The GOY implementation uses browser print, not a PDF library. To provide a real download without print-dialog setup, this app adds pinned local pdfmake 0.2.20 and embedded Roboto fonts, loaded only on first export. No CDN, server upload, analytics or external font request is used. Keep `vendor\NOTICE.txt`, the MIT library licence and the bundled fonts' SIL OFL 1.1 licence with the distributions. Export works without internet once the static app and local PDF assets are available; this is not an offline service-worker install.

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
