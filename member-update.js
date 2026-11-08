import { canonical, csvCell, escapeHTML, isHeld, league, rosterStatus, singles, validateState, weekendDate } from './core.js';
import { weekendCards } from './leaderboard-layout.js';

const dateLabel = date => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
});
const clean = value => String(value).replace(/[\u2013\u2014]/gu, ':');
const html = value => escapeHTML(clean(value));
const csv = rows => rows.map(row => row.map(value => csvCell(clean(value))).join(',')).join('\r\n') + '\r\n';
const table = (caption, headers, rows) => `<table><caption>${html(caption)}</caption><thead><tr>${headers.map(value => `<th scope="col">${html(value)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(value => `<td>${html(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

export function memberUpdate(state, { mode = 'published', saved = true, pendingDate = null } = {}) {
  validateState(state);
  if (!['published', 'draft'].includes(mode)) throw new Error('Unknown member update source.');
  if (pendingDate !== null) {
    if (weekendDate(pendingDate) !== pendingDate) throw new Error('Pending weekend must use its Saturday date.');
    if (state.rounds.some(round => round.date === pendingDate)) throw new Error('Pending weekend already has an imported round. Review its status instead.');
    if (state.rounds.some(round => round.date > pendingDate)) throw new Error('Pending weekend precedes newer imported results. Review it separately.');
  }
  const result = league(state);
  // Never conceal a newer cancelled, excluded or empty import behind older scores.
  const latest = [...state.rounds].sort((a, b) => a.date.localeCompare(b.date)).at(-1) || null;
  const individual = singles(state, latest?.date);
  const active = new Set(state.teams.flatMap(team => team.players.filter(player => !isHeld(team, player)).map(canonical)));
  const hasTeamResults = result.rounds.some(round => round.cards.some(card => active.has(canonical(card.player))));
  const through = result.rounds.filter(round => round.cards.length).at(-1)?.date || null;
  const source = mode === 'published' ? 'Published data snapshot' : saved ? 'Saved local draft, not published' : 'Unsaved local draft, not published';
  const status = `DRAFT MEMBER UPDATE: committee review required. ${source}. Not sent.`;
  const summary = !hasTeamResults ? 'Team standings await qualifying cards matched to the team list.' :
    `${result.rows.filter(row => row.rank === 1).map(row => row.team.name).join(' and ')} ${result.firstUnresolved ? 'share the lead' : 'leads'} on ${result.rows[0].retained} team points. ${state.settings.complete ? 'Qualification complete.' : 'Provisional standings; qualification is still in progress.'}`;
  const singlesSummary = !latest || !individual.rows.length ? 'No individual cards are available for the latest imported weekend.' :
    latest.canceled || !latest.qualifying ? `${individual.status}: historical review only, not active standings.` :
    `${individual.rows.filter(row => row.rank === 1).map(row => row.player).join(' and ')} ${individual.rows.filter(row => row.rank === 1).length > 1 ? 'share first place' : 'leads'} with ${individual.rows[0].score} points. Equal points share rank; official countback is not available.`;
  const teamHeaders = ['Season rank', 'Team', 'Player 1', 'Player 2', 'Player 3', 'Season points',
    ...result.rounds.map(round => `${round.date} team points`), 'Roster review'];
  const teamRows = result.rows.map(row => [hasTeamResults ? row.rank : 'Awaiting results', row.team.name,
    ...[0, 1, 2].map(index => row.team.players[index] || 'Vacant'),
    hasTeamResults ? row.retained : 'Awaiting results',
    ...row.scores.map(score => hasTeamResults ? `${score.total}${score.discarded ? ' D' : ''}` : 'Awaiting results'), rosterStatus(row.team)]);
  const singleHeaders = ['Weekend', 'Status', 'Rank', 'Player', 'Net points', 'Team assignment'];
  const singleRows = individual.rows.map(row => [latest.date, individual.status, row.rank, row.player, row.score, row.team]);
  const latestHeaders = ['Team', 'Player 1', 'Player 2', 'Player 3', 'P1', 'P2', 'P3', 'Team points'];
  const latestRows = latest ? result.rows.map(row => [row.team.name, ...[0, 1, 2].map(index => row.team.players[index] || 'Vacant'),
    ...weekendCards(row.team, latest).map(card => `${card.text}${card.counting ? ' (counting)' : ''}`),
    latest.canceled ? 'C' : !latest.qualifying ? 'X' : hasTeamResults ?
      `${row.scores.find(score => score.date === latest.date).total}${row.scores.find(score => score.date === latest.date).discarded ? ' D' : ''}` : 'Awaiting match']) : [];
  const unmatched = individual.rows.filter(row => row.team === 'Unassigned').length;
  const held = individual.rows.filter(row => row.team.startsWith('Unassigned (')).length;
  const pending = pendingDate ? `Weekend of ${dateLabel(pendingDate)}: results pending. No cards or totals have been added for this weekend.` : 'Only imported weekends are included. No later results are implied.';
  const qualifier = through ? `Team qualifying results through weekend of ${dateLabel(through)}.` : 'No qualifying team results imported.';
  const latestLabel = latest ? `Latest imported weekend: ${dateLabel(latest.date)} (${individual.status}).` : 'No imported weekend.';
  const warnings = state.teams.filter(team => team.notes || team.heldPlayers?.length || team.players.length < 3);
  const body = `<h1>Blainroe Golf Club</h1><h2>Men's Winter League 2026/2027</h2><p>Sponsored by Spirit Ford Wicklow</p><p class="draft">${html(status)}</p><p>${html(qualifier)} ${html(latestLabel)}</p><p>${html(pending)}</p>
<section><h2>Member newsletter draft</h2><p>Dear members,</p><p>Here is the latest Winter League update using the imported results and current team list.</p><p>${html(summary)}</p><p>${html(singlesSummary)}</p><p>${html(pending)}</p><p>Team weekend totals use the best two reported 12-hole net Stableford cards. Missing or held cards are not submitted zeroes. Season totals use the existing qualification and discard rules.</p><p>Thank you to Spirit Ford Wicklow for supporting the league.</p></section>
<p>${individual.rows.length} latest-weekend individual cards: ${individual.rows.length - unmatched - held} team-matched, ${unmatched} unmatched and ${held} held. Unmatched and held cards remain in Singles; held cards count for neither team.</p>
<h2>Team standings</h2>${table('Cumulative qualifying team scores', teamHeaders, teamRows)}
<h2>Latest imported weekend: team cards</h2><p>${html(latestLabel)} NA: no card or vacant. H: held. C: cancelled. X: excluded. D: discarded from season points. Counting cards are identified explicitly; team order is season rank, not a separate weekend rank.</p>${table('Latest imported team cards', latestHeaders, latestRows)}
<h2>Singles</h2><p>${html(latestLabel)} One imported weekend only, not a cumulative singles championship. Equal points share competition rank; alphabetical display is not official countback.</p>${table('All latest-weekend individual cards', singleHeaders, singleRows)}
<h2>Committee review before sending</h2><ul>${warnings.map(team => `<li>${html(team.name)}: ${html(rosterStatus(team))}</li>`).join('')}</ul><p>Review names, consent, result completeness and unresolved membership before sending. This download does not publish results or send communications.</p>`;
  return {
    filename: `blainroe-member-update-draft-${latest?.date || 'awaiting-results'}.html`,
    html: `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Blainroe Winter League: draft member update</title><style>body{font:16px Arial,sans-serif;color:#173517;margin:2rem}h1,h2,caption{color:#1a5e1a}.draft{border:2px solid #805500;padding:1rem}table{border-collapse:collapse;width:100%;font-size:12px;margin:1rem 0 2rem}caption{text-align:left;font-weight:bold;margin-bottom:.5rem}th,td{border:1px solid #ccc;padding:6px;text-align:left}th{background:#edf5ed}tr:nth-child(even){background:#f5f8f5}@media print{@page{size:A4 landscape;margin:12mm}body{margin:0}thead{display:table-header-group}tr{break-inside:avoid}h2{break-after:avoid}}</style></head><body>${body}</body></html>`,
    teamCSV: csv([['DRAFT: not sent', qualifier, pending], teamHeaders, ...teamRows]),
    singlesCSV: csv([['DRAFT: not sent', latestLabel, pending], singleHeaders, ...singleRows]),
    result, individual, through, pendingDate
  };
}
