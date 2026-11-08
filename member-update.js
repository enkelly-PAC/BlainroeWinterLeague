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
  if (!hasTeamResults) throw new Error('Member exports require qualifying results matched to a team.');
  if (!latest || latest.canceled || !latest.qualifying || !individual.rows.length)
    throw new Error('The latest weekend has no active qualifying results. Review it before preparing member exports.');
  const through = result.rounds.filter(round => round.cards.length).at(-1)?.date || null;
  const source = mode === 'published' ? 'Published data snapshot' : saved ? 'Saved local draft, not published' : 'Unsaved local draft, not published';
  const status = `DRAFT MEMBER UPDATE: committee review required. ${source}. Not sent.`;
  const leaders = result.rows.filter(row => row.rank === 1);
  const chasingScore = result.rows.find(row => row.retained < leaders[0].retained)?.retained;
  const chasing = result.rows.filter(row => row.retained === chasingScore);
  const summary = `${leaders.map(row => row.team.name).join(' and ')} ${leaders.length > 1 ? 'share the lead' : 'leads'} on ${leaders[0].retained} points.`;
  const chasingSummary = chasing.length ? `${chasing.map(row => row.team.name).join(', ').replace(/, ([^,]+)$/, ' and $1')} ${chasing.length > 1 ? 'are' : 'is'} ${leaders[0].retained - chasingScore} ${leaders[0].retained - chasingScore === 1 ? 'point' : 'points'} behind on ${chasingScore}.` : '';
  const singleLeaders = individual.rows.filter(row => row.rank === 1);
  const nextScore = individual.rows.find(row => row.score < singleLeaders[0].score)?.score;
  const nextSingles = individual.rows.filter(row => row.score === nextScore);
  const singlesSummary = `${names(singleLeaders)} ${singleLeaders.length > 1 ? 'set' : 'sets'} the pace in Singles with ${singleLeaders[0].score} points.${nextSingles.length ? ` ${names(nextSingles)} ${nextSingles.length > 1 ? 'follow' : 'follows'} on ${nextScore}.` : ''}`;
  const performances = leaders.map(row => {
    const counting = weekendCards(row.team, latest)
      .map((card, index) => ({ ...card, player: row.team.players[index] }))
      .filter(card => card.counting).sort((a, b) => b.score - a.score);
    const score = row.scores.find(entry => entry.date === latest.date).total;
    return counting.length ? `${row.team.name}: ${counting.map(card => `${playerName(card.player)} (${card.score})`).join(' and ')} combined for ${score} points this weekend.` : '';
  }).filter(Boolean);
  const teamHeaders = ['Rank', 'Team', 'Player 1', 'Player 2', 'Player 3', 'Season points',
    ...result.rounds.map(round => `${round.date} points`)];
  const teamRows = result.rows.map(row => [row.rank, row.team.name,
    ...[0, 1, 2].map(index => row.team.players[index] || 'Vacant'),
    row.retained, ...row.scores.map(score => `${score.total}${score.discarded ? ' D' : ''}`)]);
  const singleHeaders = ['Rank', 'Player', `${latest.date} net points`, 'Team'];
  const singleRows = individual.rows.map(row => [row.rank, playerName(row.player), row.score,
    row.team.startsWith('Unassigned') ? '' : row.team]);
  const sunday = new Date(`${latest.date}T12:00:00Z`);
  sunday.setUTCDate(sunday.getUTCDate() + 1);
  const weekend = `${dateLabel(latest.date)} and ${dateLabel(sunday.toISOString().slice(0, 10))}`;
  const body = `<h1>Blainroe Golf Club</h1><h2>Men's Winter League 2026/2027</h2><p>Sponsored by Spirit Ford Wicklow</p><h3>Weekend ${result.rounds.length}: ${html(weekend)}</h3>
<p>Dear members,</p><p>${result.rounds.length === 1 ? 'The Winter League is under way, with a tightly packed opening leaderboard.' : 'Here are the latest Winter League results.'}</p>
<p>${html(summary)} ${html(chasingSummary)}</p>${performances.map(performance => `<p>${html(performance)}</p>`).join('')}
<p>${html(singlesSummary)}</p><p>The Singles results and Team standings are attached.</p><p>Thank you to Spirit Ford Wicklow for supporting the league.</p>`;
  return {
    filename: `blainroe-member-update-draft-${latest?.date || 'awaiting-results'}.html`,
    html: `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Blainroe Winter League: Weekend ${result.rounds.length}</title><style>body{font:16px Arial,sans-serif;color:#173517;max-width:760px;margin:2rem auto;padding:0 1rem;line-height:1.6}h1,h2,h3{color:#1a5e1a}</style></head><body>${body}</body></html>`,
    teamCSV: csv([teamHeaders, ...teamRows]),
    singlesCSV: csv([singleHeaders, ...singleRows]),
    result, individual, through, pendingDate, status
  };
}
