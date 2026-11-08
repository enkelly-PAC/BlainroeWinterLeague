import { canonical, csvCell, escapeHTML, isHeld, league, singles, validateState, weekendDate } from './core.js';
import { weekendCards } from './leaderboard-layout.js';

const dateLabel = date => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
});
const clean = value => String(value).replace(/[\u2013\u2014]/gu, ':');
const html = value => escapeHTML(clean(value));
const csv = rows => rows.map(row => row.map(value => csvCell(clean(value))).join(',')).join('\r\n') + '\r\n';
const playerName = value => {
  const [surname, ...given] = String(value).split(',');
  return given.length ? `${given.join(' ').trim()} ${surname.trim()}` : String(value);
};
const names = rows => rows.map(row => playerName(row.player)).join(', ').replace(/, ([^,]+)$/, ' and $1');
const teamNames = rows => rows.map(row => row.team.name).join(', ').replace(/, ([^,]+)$/, ' and $1');
const ordinal = rank => ({ 1: 'first', 2: 'second', 3: 'third' }[rank] ||
  `${rank}${rank % 100 >= 11 && rank % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[rank % 10] || 'th'}`);
const position = (row, rows) => `${rows.filter(other => other.rank === row.rank).length > 1 ? 'joint ' : ''}${ordinal(row.rank)}`;

function weekendSummary(state, round, index, active) {
  const snapshot = { ...state, rounds: state.rounds.filter(other => other.date <= round.date) };
  const result = league(snapshot), individual = singles(snapshot, round.date);
  const latest = round;
  const sunday = new Date(`${round.date}T12:00:00Z`);
  sunday.setUTCDate(sunday.getUTCDate() + 1);
  const weekend = `${dateLabel(round.date)} and ${dateLabel(sunday.toISOString().slice(0, 10))}`;
  if (!individual.rows.length) throw new Error(`Weekend ${round.date} has no individual results for the newsletter.`);
  if (!round.cards.some(card => active.has(canonical(card.player))))
    throw new Error(`Weekend ${round.date} has no qualifying results matched to a team.`);
  const leaders = result.rows.filter(row => row.rank === 1);
  const chasingScore = result.rows.find(row => row.retained < leaders[0].retained)?.retained;
  const chasing = result.rows.filter(row => row.retained === chasingScore);
  const summary = `${teamNames(leaders)} ${leaders.length > 1 ? 'share the lead' : 'leads'} on ${leaders[0].retained} points.`;
  const chasingSummary = chasing.length ? `${teamNames(chasing)} ${chasing.length > 1 ? 'are' : 'is'} ${leaders[0].retained - chasingScore} ${leaders[0].retained - chasingScore === 1 ? 'point' : 'points'} behind on ${chasingScore}.` : '';
  const weeklyScore = Math.max(...result.rows.map(row => row.scores.find(score => score.date === round.date).total));
  const weeklyLeaders = result.rows.filter(row => row.scores.find(score => score.date === round.date).total === weeklyScore);
  const weeklySummary = teamNames(weeklyLeaders) === teamNames(leaders) ? '' :
    `<p>${html(`${teamNames(weeklyLeaders)} posted the weekend's highest team total of ${weeklyScore} points.`)}</p>`;
  const singleLeaders = individual.rows.filter(row => row.rank === 1);
  const nextScore = individual.rows.find(row => row.score < singleLeaders[0].score)?.score;
  const nextSingles = individual.rows.filter(row => row.score === nextScore);
  const singlesSummary = `${names(singleLeaders)} ${singleLeaders.length > 1 ? 'set' : 'sets'} the pace in Singles with ${singleLeaders[0].score} points.${nextSingles.length ? ` ${names(nextSingles)} ${nextSingles.length > 1 ? 'follow' : 'follows'} on ${nextScore}.` : ''}`;
  const performances = leaders.map(row => {
    const counting = weekendCards(row.team, latest)
      .map((card, playerIndex) => ({ ...card, player: row.team.players[playerIndex] }))
      .filter(card => card.counting).sort((a, b) => b.score - a.score);
    const score = row.scores.find(entry => entry.date === latest.date).total;
    return counting.length ? `${row.team.name}: ${counting.map(card => `${playerName(card.player)} (${card.score})`).join(' and ')} combined for ${score} points this weekend.` : '';
  }).filter(Boolean);
  return { date: round.date, result, individual,
    html: `<h3>Weekend ${index + 1}: ${html(weekend)}</h3><p>${html(summary)} ${html(chasingSummary)}</p>${weeklySummary}${performances.map(performance => `<p>${html(performance)}</p>`).join('')}<p>${html(singlesSummary)}</p>` };
}

export function memberUpdate(state, { mode = 'published', saved = true, pendingDate = null, baseline = null, insights = [] } = {}) {
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
  if (!hasTeamResults) throw new Error('Member exports require qualifying results matched to a team.');
  if (!latest || latest.canceled || !latest.qualifying || !individual.rows.length)
    throw new Error('The latest weekend has no active qualifying results. Review it before preparing member exports.');
  const through = result.rounds.filter(round => round.cards.length).at(-1)?.date || null;
  const source = mode === 'published' ? 'Published data snapshot' : saved ? 'Saved local draft, not published' : 'Unsaved local draft, not published';
  const status = `DRAFT MEMBER UPDATE: committee review required. ${source}. Not sent.`;
  const summaries = result.rounds.map((round, index) => weekendSummary(state, round, index, active));
  let previous = summaries.at(-2)?.result || null;
  if (baseline !== null) {
    if (baseline.schemaVersion !== 1 || !baseline.state) throw new Error('Invalid comparison baseline.');
    validateState(baseline.state);
    if (baseline.through !== summaries.at(-2)?.date) throw new Error('Comparison baseline must cover the preceding weekend.');
    if (JSON.stringify(baseline.state.teams) !== JSON.stringify(state.teams) ||
        JSON.stringify(baseline.state.settings) !== JSON.stringify(state.settings) ||
        JSON.stringify(baseline.state.rounds) !== JSON.stringify(state.rounds.filter(round => round.date <= baseline.through)))
      throw new Error('Roster, settings or historic cards differ from the comparison baseline. Review before claiming movement.');
    previous = league(baseline.state);
    if (JSON.stringify(previous.rows) !== JSON.stringify(baseline.teams))
      throw new Error('Comparison baseline standings disagree with its original cards.');
  }
  if (!Array.isArray(insights) || insights.some(insight => !insight || !summaries.some(summary => summary.date === insight.date) ||
      typeof insight.text !== 'string' || !insight.text.trim() || typeof insight.source !== 'string' || !insight.source.trim()))
    throw new Error('Newsletter insights need an imported weekend, text and source provenance.');
  const movement = previous ? result.rows.map(row => {
    const prior = previous.rows.find(other => other.team.name === row.team.name);
    return { ...row, previous: prior.rank, change: prior.rank - row.rank };
  }) : [];
  const risers = movement.filter(row => row.change > 0).sort((a, b) => b.change - a.change || a.rank - b.rank);
  const biggest = risers.filter(row => row.change === risers[0].change).slice(0, 3);
  const currentLeaders = movement.filter(row => row.rank === 1 && row.change > 0);
  const noClimbers = movement.every(row => row.change === 0) ? 'The Team standings kept the same positions.' :
    `The leading ${result.rows.filter(row => row.rank === 1).length > 1 ? 'teams' : 'team'} held first place while positions changed elsewhere in the standings.`;
  const movements = previous ? `<h3>Movement from Weekend ${summaries.length - 1} to Weekend ${summaries.length}</h3>
${currentLeaders.map(row => `<p>${html(`${row.team.name} moved from ${position(previous.rows.find(other => other.team.name === row.team.name), previous.rows)} to ${position(row, result.rows)}, reaching ${row.retained} points.`)}</p>`).join('')}
${biggest.length ? `<p>${html(`The biggest climbs were ${biggest.map(row => `${row.team.name}, up ${row.change} ${row.change === 1 ? 'place' : 'places'} from ${position(previous.rows.find(other => other.team.name === row.team.name), previous.rows)} to ${position(row, result.rows)}`).join('; ')}.`)}</p>` : `<p>${html(noClimbers)}</p>`}
${movement.filter(row => row.previous === 1 && row.rank > 1).map(row => `<p>${html(`${row.team.name}, ${previous.rows.filter(other => other.rank === 1).length > 1 ? 'joint leader' : 'leader'} after Weekend ${summaries.length - 1}, is now ${position(row, result.rows)} on ${row.retained} points.`)}</p>`).join('')}` : '';
  const teamHeaders = ['Rank', 'Team', 'Player 1', 'Player 2', 'Player 3', 'Season points',
    ...result.rounds.map(round => `${round.date} points`)];
  const teamRows = result.rows.map(row => [row.rank, row.team.name,
    ...[0, 1, 2].map(index => row.team.players[index] || 'Vacant'),
    row.retained, ...row.scores.map(score => `${score.total}${score.discarded ? ' D' : ''}`)]);
  const singleHeaders = ['Rank', 'Player', `${latest.date} net points`, 'Team'];
  const singleRows = individual.rows.map(row => [row.rank, playerName(row.player), row.score,
    row.team.startsWith('Unassigned') ? '' : row.team]);
  const body = `<h1>Blainroe Golf Club</h1><h2>Men's Winter League 2026/2027</h2><p>Sponsored by Spirit Ford Wicklow</p>
<p>Dear members,</p><p>${summaries.length === 1 ? 'The Winter League is under way, with a tightly packed opening leaderboard.' : 'Here are the Winter League results and the latest standings.'}</p>
${summaries.map(summary => summary.html + insights.filter(insight => insight.date === summary.date).map(insight => `<p>${html(insight.text)}</p>`).join('')).join('')}${movements}
<p>The latest Singles results and Team standings are attached.</p><p>Thank you to Spirit Ford Wicklow for supporting the league.</p>`;
  return {
    filename: `blainroe-member-update-draft-${latest?.date || 'awaiting-results'}.html`,
    html: `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Blainroe Winter League: Weekend ${result.rounds.length}</title><style>body{font:16px Arial,sans-serif;color:#173517;max-width:760px;margin:2rem auto;padding:0 1rem;line-height:1.6}h1,h2,h3{color:#1a5e1a}</style></head><body>${body}</body></html>`,
    teamCSV: csv([teamHeaders, ...teamRows]),
    singlesCSV: csv([singleHeaders, ...singleRows]),
    result, individual, through, pendingDate, status, movement, insights
  };
}
