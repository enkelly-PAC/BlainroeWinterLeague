import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { emptyState, canonical, validateState, parseJSON, parseCSV, parseTeams, parseScores, classifyScoreCSV, importRound, weekendDate, league, singles, validateFinal, parseFinal, finalTable, reportHTML, MAX_BYTES, editTeam, replaceTeams, rosterStatus, csvCell } from '../core.js';
import { readDraft, saveDraft, STORAGE_KEY } from '../storage.js';

const teams = count => Array.from({ length: count }, (_, i) => ({ name: `Synthetic Team ${i + 1}`, players: [1, 2, 3].map(n => `Player T${i + 1}P${n}`) }));
function dateAt(index) {
  const date = new Date('2026-11-07T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + 7 * index);
  return date.toISOString().slice(0, 10);
}
function round(index, teamTotals, registration) {
  return { date: dateAt(index), name: `Synthetic weekend ${index + 1}`, qualifying: true, canceled: false,
    cards: teamTotals.flatMap((total, i) => total === null ? [] : [
      { player: registration[i].players[0], score: Math.ceil(total / 2) },
      { player: registration[i].players[1], score: Math.floor(total / 2) },
      { player: registration[i].players[2], score: 0 }
    ]) };
}
function fixture(totals = [[70, 60]], complete = false) {
  const state = emptyState(); state.teams = teams(totals[0].length);
  state.rounds = totals.map((values, i) => round(i, values, state.teams));
  state.settings.complete = complete;
  return validateState(state);
}
function finalCard(team, index, total = 40, back9 = 20) {
  return { team: team.name, player: team.players[index], total, back9, back6: Math.min(12, back9), back3: Math.min(6, back9), back1: Math.min(2, back9) };
}

test('workbook roster preserves numbered teams, vacancy and unresolved entries without invented results', async () => {
  const state = parseJSON(await readFile(new URL('../data/published.json', import.meta.url), 'utf8'));
  assert.equal(state.teams.length, 45);
  assert.equal(state.teams.flatMap(t => t.players).length, 134);
  assert.equal(new Set(state.teams.flatMap(t => t.players.map(canonical))).size, 133);
  assert.deepEqual(state.teams.map(t => Number(t.name.slice(5))).sort((a, b) => a - b), Array.from({ length: 45 }, (_, i) => i + 2));
  assert.deepEqual(state.teams.find(t => t.name === 'Team 34').players, ['Paddy Daly', 'Timothy Cummins']);
  assert.match(rosterStatus(state.teams.find(t => t.name === 'Team 37')), /Eugene McCrystal \(away member at Bundoran\): eligibility pending confirmation by Niall/);
  assert.deepEqual(state.rounds, []);
  assert.equal(state.final, null);
  assert.equal(state.settings.complete, false);
  assert.match(reportHTML(state, 'Local review'), /Player 3 vacant/);
  assert.match(reportHTML(state, 'Local review'), /Score matching held: Colin Owens/);
});
test('canonical names match surname-first, punctuation, accents and case', () => {
  assert.equal(canonical("O'Br\u00eden, S\u00e9\u00e1n"), canonical('SEAN OBRIEN'));
  assert.equal(canonical('Anne-Marie Test'), canonical('anne marie test'));
});
test('CSV supports BOM, CRLF, commas, doubled quotes and multiline cells', () => {
  assert.deepEqual(parseCSV('\uFEFFName,Note\r\n"Last, First","A ""quote""\r\nand line"\r\n'), [
    ['Name', 'Note'], ['Last, First', 'A "quote"\r\nand line']
  ]);
});
test('malformed CSV quotes and unclosed fields fail', () => {
  assert.throws(() => parseCSV('a,"unclosed'), /unclosed/);
  assert.throws(() => parseCSV('"name"unexpected,1'), /Malformed/);
  assert.throws(() => parseCSV('na"me,1'), /Malformed/);
});
test('team header variants parse three-player teams', () => {
  assert.deepEqual(parseTeams('Team Name,Player 1,PLAYER2,Player3\r\nSynthetic Alpha,"Surname, Given",Player A2,Player A3'), [
    { name: 'Synthetic Alpha', players: ['Surname, Given', 'Player A2', 'Player A3'] }
  ]);
});
test('registration rejects duplicate teams, globally duplicated members and wrong team sizes', () => {
  assert.throws(() => parseTeams('Team,Player1,Player2,Player3\nAlpha,A1,A2,A3\nALPHA,B1,B2,B3'), /duplicate/);
  assert.throws(() => parseTeams('Team,Player1,Player2,Player3\nAlpha,"Test, Given",A2,A3\nBeta,Given Test,B2,B3'), /globally unique/);
  const state = emptyState(); state.teams = [{ name: 'Alpha', players: ['A1', 'A2'] }];
  assert.throws(() => validateState(state), /exactly 3/);
  assert.throws(() => parseTeams('Team,Player1,Player2,Player3\nAlpha,A1,A2,'), /exactly 3/);
});
test('Team 34 vacancy survives CSV and storage, scores only real cards and can be filled', () => {
  const state = emptyState();
  state.teams = parseTeams('Team,Player1,Player2,Player3\nTeam 34,Synthetic One,Synthetic Two,');
  state.rounds = [{ date: dateAt(0), name: 'Synthetic weekend', qualifying: true, canceled: false,
    cards: [{ player: 'Synthetic One', score: 20 }, { player: 'Synthetic Two', score: 25 }] }];
  const restored = parseJSON(JSON.stringify(state));
  assert.equal(league(restored).rows[0].scores[0].total, 45);
  assert.equal(league(restored).rows[0].scores[0].missed, 1);
  assert.equal(league(editTeam(restored, 'Team 34', { name: 'Team 34', players: ['Synthetic One', 'Synthetic Two', 'Synthetic Three'] })).rows[0].raw, 45);
  assert.throws(() => parseTeams('Team,Player1,Player2,Player3\nTeam 34,Synthetic One,,Synthetic Three'), /Player/);
  assert.throws(() => parseTeams('Team,Player1,Player2,Player3\nTeam 35,Synthetic One,Synthetic Two,'), /exactly 3/);
});
test('ambiguous duplicate roster names require explicit holds on both teams and never score twice', () => {
  const state = fixture([[50, 40]]);
  state.teams[0].players[0] = 'Synthetic Shared';
  state.teams[1].players[0] = 'Shared, Synthetic';
  state.teams.forEach(t => { t.heldPlayers = [t.players[0]]; });
  state.rounds[0].cards.push({ player: 'Synthetic Shared', score: 99 });
  validateState(state);
  assert.deepEqual(league(state).rows.map(r => r.raw), [25, 20]);
  assert.match(singles(state).rows[0].team, /Unassigned.*held/);
  const invalid = structuredClone(state); invalid.teams[1].heldPlayers = [];
  assert.throws(() => validateState(invalid), /duplicate/);
  const corrected = editTeam(state, state.teams[1].name, { ...state.teams[1], players: ['Synthetic Different', ...state.teams[1].players.slice(1)], heldPlayers: [] });
  const released = editTeam(corrected, state.teams[0].name, { ...state.teams[0], heldPlayers: [] });
  assert.equal(league(released).rows.find(r => r.team.name === state.teams[0].name).raw, 124);
  assert.deepEqual(released.rounds, state.rounds);
});
test('roster edits and CSV replacement preserve raw data, metadata and backward-compatible backups', () => {
  const state = fixture([[50]]);
  state.teams[0].notes = 'Eligibility pending committee confirmation';
  state.teams[0].heldPlayers = [state.teams[0].players[2]];
  const basic = parseTeams(`Team,Player1,Player2,Player3\n${state.teams[0].name},${state.teams[0].players.join(',')}`);
  assert.deepEqual(replaceTeams(state, basic), state);
  const columns = ['Team', 'Player1', 'Player2', 'Player3', 'Notes', 'Held Players'];
  const team = state.teams[0];
  const csv = [columns, [team.name, ...team.players, team.notes, team.heldPlayers.join('|')]].map(row => row.map(csvCell).join(',')).join('\n');
  assert.deepEqual(parseTeams(csv), state.teams);
  const edited = editTeam(state, team.name, { ...team, players: ['New Synthetic', ...team.players.slice(1)] });
  assert.deepEqual(edited.rounds, state.rounds);
  assert.deepEqual(edited.settings, state.settings);
  assert.equal(singles(edited).rows.find(r => r.player === team.players[0]).team, 'Unassigned');
  assert.throws(() => editTeam(state, team.name, { ...team, name: 'Renumbered' }), /unchanged/);
  const finalState = fixture([[50]], true);
  finalState.final = { date: null, cards: [finalCard(finalState.teams[0], 0)] };
  assert.throws(() => editTeam(finalState, finalState.teams[0].name, { ...finalState.teams[0], players: ['New Synthetic', ...finalState.teams[0].players.slice(1)] }), /not registered/);
  assert.equal(finalState.final.cards.length, 1);
});
test('team header-only imports are rejected, not treated as registration deletion', () => {
  assert.throws(() => parseTeams('Team Name,Player1,Player2,Player3\n'), /no teams/);
});
test('Handicap Master metadata and pts scores parse without score conversion', () => {
  const result = parseScores('Blainroe synthetic export\nPlayed on,08/11/2026\nPosition,Name,Score (Play H\'cap)\n1,"Test, Given",42 pts (+10)\n2,Player A2,0 pts (-1)');
  assert.equal(result.playedOn, '2026-11-08');
  assert.deepEqual(result.cards, [{ player: 'Test, Given', score: 42, handicap: 10 }, { player: 'Player A2', score: 0, handicap: -1 }]);
});
const aggregatedReport = [
  '"Synthetic Golf Club"',
  '"Printed: 9 November 2026"',
  '"Competition Result"',
  '"Aggregate result of the Competition played on Saturday 31 October 2026 and Sunday 1 November 2026 at Synthetic Club."',
  '"Aggregated Results - Net Scores"',
  '"Overall Position","","","Score (Play H\'cap)","","","Countback","","",""',
  '"Overall Winners",',
  '"1","Alpha, Synthetic ","","29 pts    (07)","","Overall Winner","","","",""',
  '"Division 1",',
  '"(Handicap Indexes up To 10.5)",',
  '"2","Beta, Synthetic ","","24 pts    (-01)","","","Last Nine Holes","","",""',
  '"-","NoReturn, Synthetic ","","No Return","","DQ: Rule 3.3b(2)","","","",""',
  '"Overall Position","","","Score (Play H\'cap)","","","Countback","","",""',
  '"Division 2",',
  '"(Handicap Indexes 10.6 to 15.5)",',
  '"3","Gamma, Synthetic ","","0 pts    (+03)","","","","","",""',
  '"-","DisqualifiedOne, Synthetic ","","21 pts    (12)","","DQ: Rule 3.3b(2)","","","",""',
  '"-","DisqualifiedTwo, Synthetic ","","12 pts    (10)","","DQ: Rule 3.3b(2)","","","",""',
  '"Number of Cards Processed = 6  [Division 1 = 2, Division 2 = 3]"',
  '"Competition Format:"',
  '"Singles, Stableford competition played over 12 holes per round."',
  '"Ties:"',
  '"Countback notes, not results."',
  '"Disqualifications:"',
  '"Rule","Description",""',
  '"3.3b(2)","Synthetic disqualification explanation.",""',
  '"Twos:"',
  '"There was 1 Two recorded:"',
  '"","Division","Hole",""',
  '"Alpha, Synthetic ","Division 1","15",""'
].join('\r\n');
test('aggregated net report handles unnamed player column, repeated sections, DQ and footers', () => {
  const result = parseScores('\uFEFF' + aggregatedReport);
  assert.equal(result.playedOn, '2026-10-31');
  assert.deepEqual(result.cards, [
    { player: 'Alpha, Synthetic', score: 29, handicap: 7 },
    { player: 'Beta, Synthetic', score: 24, handicap: -1 },
    { player: 'Gamma, Synthetic', score: 0, handicap: 3 }
  ]);
  assert.deepEqual(result.omitted, { noReturn: 1, disqualified: 2 });
});
test('aggregated report refuses truncated records, malformed cards and unknown result rows', () => {
  assert.throws(() => parseScores(aggregatedReport.replace('Processed = 6', 'Processed = 7')), /complete report/);
  assert.throws(() => parseScores(aggregatedReport.replace('29 pts    (07)', '29 strokes')), /explicit pts/);
  assert.throws(() => parseScores(aggregatedReport.replace('29 pts    (07)', '')), /explicit pts/);
  assert.throws(() => parseScores(aggregatedReport.replace('"Overall Winners",', '"Unexpected result data",')), /Unexpected aggregated/);
  assert.throws(() => parseScores(aggregatedReport.replace('Aggregated Results - Net Scores', 'Aggregated Results - Gross Scores')), /Net Scores/);
});
test('aggregated report does not count duplicates or unexplained unranked numeric scores', () => {
  assert.throws(() => parseScores(aggregatedReport.replace('Beta, Synthetic', 'Alpha, Synthetic')), /duplicate/);
  assert.throws(() => parseScores(aggregatedReport.replace('"2","Beta,', '"-","Beta,')), /no explicit No Return or DQ/);
});
test('multiple played dates must be the same weekend and Printed dates never supply play dates', () => {
  assert.throws(() => parseScores(aggregatedReport.replace('Sunday 1 November', 'Sunday 8 November')), /different weekends/);
  assert.equal(parseScores('Printed Date: 2026-11-08\nPlayer,Score\nSynthetic Player,29').playedOn, null);
  assert.equal(parseScores('Played on,31/10/2026 and 01/11/2026\nPlayer,Score\nSynthetic Player,29').playedOn, '2026-10-31');
});
test('gross Competition Scorecards are rejected with the correct net report instruction', () => {
  const summary = ['Player(s)', '', ...Array.from({ length: 18 }, (_, i) => i + 1), 'Total', 'Page'].join(',');
  for (const source of [
    'Competition Scorecards\nHole by Hole scores returned in a synthetic competition\n' + summary + '\nSynthetic Player,,5,PU,-,NR',
    summary + '\nSynthetic Player,,5,PU,-,NR',
    'Competition Scorecard\nPlayer,Score\nSynthetic Player,72',
    'Hole by Hole scores returned\nPlayer,Score\nSynthetic Player,NR'
  ]) assert.throws(() => parseScores(source), /Use Competition Report \(Aggregated Net Result\) instead/);
});
test('mixed-upload classification recognizes gross exports without hiding unknown or malformed net results', () => {
  assert.equal(classifyScoreCSV('Competition Scorecards\nHole by Hole scores returned\nSynthetic Player,PU'), 'scorecards');
  assert.equal(classifyScoreCSV('Player(s),,1,18,Total\nSynthetic Player,,5,4,72'), 'scorecards');
  assert.equal(classifyScoreCSV(aggregatedReport), 'results');
  assert.equal(classifyScoreCSV('Player,Score\nSynthetic Player,strokes'), 'results');
  assert.equal(classifyScoreCSV('Competition Scorecards\nAggregated Results - Net Scores\nOverall Position,,,Score (Play H\'cap)'), 'results');
  assert.throws(() => classifyScoreCSV('Competition Scorecards\n"broken'), /unclosed/);
});
test('score alternatives accept zero and signed handicap metadata', () => {
  assert.deepEqual(parseScores('Player,Score,Handicap\nPlayer A1,0,+3\nPlayer A2,42,-2.5').cards,
    [{ player: 'Player A1', score: 0, handicap: 3 }, { player: 'Player A2', score: 42, handicap: -2.5 }]);
});
test('metadata dates are explicit, with no current-date fallback', () => {
  assert.equal(parseScores('Player,Score\nPlayer A1,42').playedOn, null);
  assert.equal(parseScores('Played on,7 November 2026\nName,Score\nPlayer A1,42').playedOn, '2026-11-07');
  assert.equal(parseScores('Date,2026-11-07\nName,Score\nPlayer A1,42').playedOn, '2026-11-07');
  assert.throws(() => parseScores('Played on,31/02/2026\nName,Score\nPlayer A1,42'), /Invalid date/);
});
test('non-Stableford, missing and invalid scores are rejected', () => {
  for (const score of ['NR', '', '-1', '42 strokes', '42.5', 'Infinity', '301']) {
    assert.throws(() => parseScores(`Player,Score\nPlayer A1,${score}`), /score|Score/);
  }
  assert.throws(() => parseScores('Player,Score,Gross Strokes\nPlayer A1,42,72'), /Only net Stableford/);
  assert.throws(() => parseScores('Player,Medal\nPlayer A1,72'), /header not found/);
});
test('same player cannot have two cards in one parsed score file or saved weekend', () => {
  assert.throws(() => parseScores('Player,Score\n"Test, Given",42\nGiven Test,40'), /duplicate/);
  const state = fixture(); state.rounds[0].cards.push({ ...state.rounds[0].cards[0] });
  assert.throws(() => validateState(state), /duplicate/);
});
test('Sunday and Saturday map to one weekend; weekdays and invalid dates rejected', () => {
  assert.equal(weekendDate('2026-11-08'), '2026-11-07');
  assert.equal(weekendDate('2026-11-07'), '2026-11-07');
  assert.throws(() => weekendDate('2026-11-06'), /Saturday or Sunday/);
  assert.throws(() => weekendDate('2026-02-31'), /Invalid date/);
  assert.throws(() => weekendDate(''), /explicit ISO/);
});
test('scores before teams remain raw; late registrations recalculate standings', () => {
  let state = importRound(emptyState(), { date: dateAt(0), name: 'Synthetic', qualifying: true, canceled: false,
    cards: [{ player: 'Player A1', score: 42 }, { player: 'Player A2', score: 40 }] });
  assert.equal(league(state).rows.length, 0);
  state.teams = [{ name: 'Synthetic Alpha', players: ['Player A1', 'Player A2', 'Player A3'] }];
  validateState(state);
  assert.equal(league(state).rows[0].raw, 82);
  assert.equal(league(state).rows[0].scores[0].missed, 1);
});
test('singles ranks every submitted card before registration, preserves zero and shared competition ranks', () => {
  const state = emptyState();
  state.rounds = [{ date: dateAt(0), name: 'Synthetic singles', qualifying: true, canceled: false, cards: [
    { player: 'Synthetic Zebra', score: 30 }, { player: 'Synthetic Zero', score: 0 },
    { player: 'Synthetic Lower', score: 20 }, { player: 'Synthetic Alpha', score: 30 }
  ] }];
  const before = structuredClone(state);
  assert.deepEqual(singles(state).rows, [
    { player: 'Synthetic Alpha', score: 30, team: 'Unassigned', rank: 1 },
    { player: 'Synthetic Zebra', score: 30, team: 'Unassigned', rank: 1 },
    { player: 'Synthetic Lower', score: 20, team: 'Unassigned', rank: 3 },
    { player: 'Synthetic Zero', score: 0, team: 'Unassigned', rank: 4 }
  ]);
  assert.deepEqual(state, before);
  state.teams = [{ name: 'Synthetic Team', players: ['Alpha, Synthetic', 'Synthetic Zero', 'Synthetic Absent'] }];
  validateState(state);
  const rows = singles(state).rows;
  assert.equal(rows[0].team, 'Synthetic Team');
  assert.equal(rows[3].team, 'Synthetic Team');
  assert.equal(rows[1].team, 'Unassigned');
  assert.equal(rows.length, 4);
});
test('singles defaults to latest active weekend, respects selection and exposes canceled/excluded context', () => {
  const state = fixture([[70], [60], [50], [40]]);
  state.rounds[2].qualifying = false;
  state.rounds[3].canceled = true;
  const before = structuredClone(state);
  assert.equal(singles(state).round.date, dateAt(1));
  assert.equal(singles(state).status, 'Qualifying');
  assert.deepEqual(singles(state, dateAt(0)).rows.map(r => r.score), [35, 35, 0]);
  assert.equal(singles(state, dateAt(2)).status, 'Excluded / nonqualifying');
  const canceled = singles(state, dateAt(3));
  assert.equal(canceled.status, 'Canceled');
  assert.deepEqual(canceled.rows.map(r => r.score), [20, 20, 0]);
  assert.deepEqual(canceled.rounds.map(r => r.date), [dateAt(3), dateAt(2), dateAt(1), dateAt(0)]);
  assert.equal(singles(state, 'missing').round.date, dateAt(1));
  assert.deepEqual(state, before);
  state.rounds.forEach(r => { r.qualifying = false; });
  assert.equal(singles(state).round.date, dateAt(3));
  assert.equal(singles(state).status, 'Canceled');
  state.rounds = state.rounds.filter(r => r.date !== dateAt(3));
  assert.equal(singles(state, dateAt(3)).round.date, dateAt(2));
  assert.equal(singles(state).status, 'Excluded / nonqualifying');
});
test('singles has no invented results for empty imports or a weekend without cards', () => {
  assert.deepEqual(singles(emptyState()), { rounds: [], round: null, status: null, rows: [] });
  const state = fixture(); state.rounds[0].cards = [];
  assert.deepEqual(singles(state).rows, []);
  assert.equal(singles(state).round.date, dateAt(0));
});
test('singles ignores team discards and final scoring settings', () => {
  const state = fixture([[70], [60], [50]], true);
  const expected = singles(state, dateAt(0)).rows;
  assert.equal(league(state).discardCount, 2);
  assert.deepEqual(expected.map(r => r.score), [35, 35, 0]);
  state.settings.finalScoring = 'all3';
  state.settings.discardCount = 0;
  assert.deepEqual(singles(state, dateAt(0)).rows, expected);
});
test('multiple imports merge different players and identical cards only once', () => {
  const base = { date: dateAt(0), name: 'Synthetic', qualifying: true, canceled: false };
  let state = importRound(emptyState(), { ...base, cards: [{ player: 'Player A1', score: 40 }] });
  state = importRound(state, { ...base, date: '2026-11-08', cards: [{ player: 'PLAYER A1', score: 40 }, { player: 'Player A2', score: 41 }] });
  assert.equal(state.rounds.length, 1);
  assert.equal(state.rounds[0].cards.length, 2);
});
test('conflicting repeated cards require explicit full-weekend replacement, never silent duplicate', () => {
  const base = { date: dateAt(0), name: 'Synthetic', qualifying: true, canceled: false };
  const state = importRound(emptyState(), { ...base, cards: [{ player: 'Player A1', score: 40 }, { player: 'Player A2', score: 41 }] });
  const incoming = { ...base, cards: [{ player: 'Player A1', score: 42 }] };
  assert.throws(() => importRound(state, incoming), /Conflicting card/);
  const replaced = importRound(state, incoming, 'replace');
  assert.deepEqual(replaced.rounds[0].cards, incoming.cards);
  assert.equal(state.rounds[0].cards.length, 2);
});
test('merge requires matching metadata and rejects accidental date collisions in saved state', () => {
  const state = fixture();
  assert.throws(() => importRound(state, { ...state.rounds[0], name: 'Changed' }), /metadata differs/);
  assert.throws(() => importRound(state, state.rounds[0], 'append'), /merge or replace/);
  state.rounds.push(structuredClone(state.rounds[0]));
  assert.throws(() => validateState(state), /Duplicate weekend/);
});
test('best two distinct players count; all teams appear with absent weekend zeros', () => {
  const state = fixture([[70, null], [60, 65]]);
  const table = league(state);
  assert.equal(table.rows.length, 2);
  const missed = table.rows.find(r => r.team.name === state.teams[1].name);
  assert.equal(missed.raw, 65);
  assert.equal(missed.scores[0].total, 0);
  assert.equal(missed.scores[0].missed, 3);
  state.rounds[0].cards[2].score = 50;
  assert.equal(league(state).rows.find(r => r.team.name === state.teams[0].name).scores[0].total, 85);
  const cards = state.rounds[0].cards.slice(0, 3);
  [29, 24, 20].forEach((score, index) => { cards[index].score = score; });
  assert.equal(league(state).rows.find(r => r.team.name === state.teams[0].name).scores[0].total, 53);
  assert.deepEqual(state.rounds[0].cards.slice(0, 3).map(card => card.score), [29, 24, 20]);
  assert.equal(state.rounds[0].cards.length, 3);
});
test('ten-round aggregation is live with no discards and final retains best eight', () => {
  const state = fixture(Array.from({ length: 10 }, (_, i) => [50 + i, 40 + i]));
  let table = league(state);
  assert.equal(table.rows[0].raw, 545);
  assert.equal(table.rows[0].retained, 545);
  assert.equal(table.discardCount, 0);
  state.settings.complete = true;
  table = league(state);
  assert.equal(table.rows[0].retained, 444);
  assert.deepEqual(table.rows[0].discarded, [51, 50]);
  assert.equal(table.rows[0].scores.filter(s => s.discarded).length, 2);
});
test('short completed schedule clamps discards, retaining at least one weekend', () => {
  const state = fixture([[70, 60]], true);
  assert.equal(league(state).discardCount, 0);
  assert.equal(league(state).rows[0].retained, 70);
  state.rounds.push(round(1, [75, 65], state.teams));
  assert.equal(league(state).discardCount, 1);
  assert.equal(league(state).rows[0].retained, 75);
});
test('best discarded descending comparison distinguishes incorrect minimum comparison', () => {
  const state = fixture([[1, 4], [9, 6], [50, 50], [50, 50]], true);
  const result = league(state);
  assert.equal(result.rows[0].team.name, state.teams[0].name);
  assert.deepEqual(result.rows[0].discarded, [9, 1]);
  assert.deepEqual(result.rows[1].discarded, [6, 4]);
  assert.equal(result.rows[0].retained, 100);
  assert.equal(result.rows[1].retained, 100);
  assert.equal(result.rows[1].rank, 2);
});
test('discard tie comparison continues to second highest discarded score', () => {
  const state = fixture([[2, 1], [9, 9], [50, 50], [50, 50]], true);
  assert.equal(league(state).rows[0].team.name, state.teams[0].name);
});
test('unresolved equal scores share competition ranks, not false alphabetical winners', () => {
  const state = fixture([[70, 70, 60]]);
  const result = league(state);
  assert.deepEqual(result.rows.map(r => r.rank), [1, 1, 3]);
  assert.equal(result.firstUnresolved, true);
});
test('top 16 crossing tie prevents confirmed eligibility and final acceptance', () => {
  const state = fixture([Array.from({ length: 17 }, () => 70)], true);
  const result = league(state);
  assert.equal(result.cutoffUnresolved, true);
  assert.deepEqual(result.eligible, []);
  assert.throws(() => validateFinal(state, { date: null, cards: [] }), /cutoff/);
});
test('tie entirely within top 16 does not block cutoff; fewer teams all eligible', () => {
  const state = fixture([[70, 70, 60]], true);
  assert.equal(league(state).eligible.length, 3);
  assert.equal(league(state).cutoffUnresolved, false);
  const larger = fixture([Array.from({ length: 17 }, (_, i) => i < 2 ? 100 : 100 - i)], true);
  assert.equal(league(larger).eligible.length, 16);
  assert.equal(league(larger).cutoffUnresolved, false);
});
test('weather canceled and excluded weekends leave the common schedule entirely', () => {
  const state = fixture([[70, 60], [75, 65], [80, 70]]);
  state.rounds[1].canceled = true; state.rounds[2].qualifying = false;
  state.settings.maxRounds = 1; state.settings.discardCount = 0;
  validateState(state);
  assert.equal(league(state).rounds.length, 1);
  assert.deepEqual(league(state).rows.map(r => r.raw), [70, 60]);
  assert.equal(state.rounds[1].cards.length, 6);
});
test('settings reject invalid ranges, booleans, modes, excess qualifiers and empty completion', () => {
  for (const change of [
    { maxRounds: 0 }, { maxRounds: 53 }, { maxRounds: 2.5 }, { discardCount: -1 },
    { discardCount: 10 }, { discardCount: 0.5 }, { complete: 'true' }, { finalScoring: 'unknown' }
  ]) {
    const state = emptyState(); Object.assign(state.settings, change);
    assert.throws(() => validateState(state));
  }
  assert.throws(() => fixture(Array.from({ length: 11 }, () => [70, 60])), /above the configured maximum/);
});
test('excess active qualifiers are rejected instead of silently truncated', () => {
  const state = fixture(Array.from({ length: 10 }, () => [70, 60]));
  assert.throws(() => importRound(state, round(10, [70, 60], state.teams)), /above the configured maximum/);
  const empty = emptyState(); empty.settings.complete = true;
  assert.throws(() => validateState(empty), /at least one active/);
});
test('JSON restore rejects bad JSON, versions, unknown fields and malformed state', () => {
  assert.throws(() => parseJSON('{bad'), /Invalid JSON/);
  assert.throws(() => parseJSON('{"version":2}'), /Unsupported/);
  const state = emptyState(); state.privateEmail = 'not-permitted';
  assert.throws(() => parseJSON(JSON.stringify(state)), /unsupported field/);
  const malformed = emptyState(); delete malformed.final;
  assert.throws(() => validateState(malformed), /Final blocked|Final:/);
  assert.deepEqual(parseJSON('\uFEFF' + JSON.stringify(emptyState())), emptyState());
});
test('CSV and JSON reject oversized input', () => {
  assert.throws(() => parseCSV('a'.repeat(MAX_BYTES + 1)), /2 MB/);
  assert.throws(() => parseJSON(' '.repeat(MAX_BYTES + 1)), /2 MB/);
});
test('combined draft cannot grow beyond its own restorable backup size', () => {
  const state = emptyState();
  const cards = Array.from({ length: 5000 }, (_, i) => ({ player: `Player ${i} ${'x'.repeat(140)}`, score: 40 }));
  state.rounds = [0, 1, 2].map(i => ({ date: dateAt(i), name: 'Synthetic large export', qualifying: false, canceled: false, cards }));
  assert.throws(() => validateState(state), /Combined state exceeds/);
});
test('final blocked before qualification complete; no carryover in final', () => {
  const state = fixture([[70, 60]]);
  assert.throws(() => validateFinal(state, { date: null, cards: [] }), /complete qualification/);
  state.settings.complete = true;
  state.final = { date: null, cards: state.teams[1].players.map((_, i) => finalCard(state.teams[1], i, 40)) };
  validateState(state);
  const result = finalTable(state);
  assert.equal(result[0].team.name, state.teams[1].name);
  assert.equal(result[0].total, 80);
  assert.equal(result[1].rank, null);
});
test('final team total setting changes best2 versus all3, countback always uses all3', () => {
  const state = fixture([[70, 60]], true);
  state.final = { date: null, cards: [
    ...[40, 40, 1].map((n, i) => finalCard(state.teams[0], i, n, Math.min(n, 20))),
    ...[39, 39, 39].map((n, i) => finalCard(state.teams[1], i, n, 20))
  ] };
  validateState(state);
  let result = finalTable(state);
  assert.equal(result[0].team.name, state.teams[0].name);
  assert.equal(result[0].total, 80);
  assert.equal(result[0].countback[0], 41);
  state.settings.finalScoring = 'all3';
  result = finalTable(state);
  assert.equal(result[0].team.name, state.teams[1].name);
  assert.equal(result[0].total, 117);
});
test('final countback includes the third card even if it is not in best2 total', () => {
  const state = fixture([[70, 60]], true);
  state.final = { date: null, cards: [
    ...[40, 40, 10].map((n, i) => finalCard(state.teams[0], i, n, i === 2 ? 10 : 9)),
    ...[40, 40, 9].map((n, i) => finalCard(state.teams[1], i, n, i === 2 ? 0 : 9))
  ] };
  validateState(state);
  const result = finalTable(state);
  assert.equal(result[0].total, result[1].total);
  assert.deepEqual(result.map(r => r.countback[0]), [28, 18]);
  assert.equal(result[0].team.name, state.teams[0].name);
});
test('final countback proceeds through back6, back3 and back1 then shares unresolved rank', () => {
  for (const field of ['back6', 'back3', 'back1']) {
    const state = fixture([[70, 60]], true);
    state.final = { date: null, cards: state.teams.flatMap(t => t.players.map((_, i) => finalCard(t, i))) };
    state.final.cards[3][field] -= 1;
    validateState(state);
    assert.deepEqual(finalTable(state).map(r => r.rank), [1, 2]);
    state.final.cards[3][field] += 1;
    assert.deepEqual(finalTable(state).map(r => r.rank), [1, 1]);
  }
});
test('final requires all3 for ranking and validates membership, eligibility and unique cards', () => {
  const state = fixture([[70, 60]], true);
  const card = finalCard(state.teams[0], 0);
  state.final = { date: null, cards: [card, finalCard(state.teams[0], 1)] };
  validateState(state);
  assert.equal(finalTable(state)[0].rank, null);
  assert.throws(() => validateFinal(state, { date: null, cards: [card, { ...card }] }), /duplicate/);
  assert.throws(() => validateFinal(state, { date: null, cards: [{ ...card, player: state.teams[1].players[0] }] }), /not registered/);
  assert.throws(() => validateFinal(state, { date: null, cards: [{ ...card, team: 'Unknown' }] }), /not an eligible/);
  const larger = fixture([Array.from({ length: 17 }, (_, i) => 100 - i)], true);
  assert.throws(() => validateFinal(larger, { date: null, cards: [finalCard(larger.teams[16], 0)] }), /not an eligible/);
});
test('final validates finite nonnegative monotonic countback, total and explicit dates', () => {
  const state = fixture([[70, 60]], true), card = finalCard(state.teams[0], 0);
  for (const change of [{ back9: 41 }, { back6: 21 }, { back3: 13 }, { back1: 7 }, { back9: -1 }, { back9: Infinity }, { back9: NaN }, { total: 40.5 }]) {
    assert.throws(() => validateFinal(state, { date: null, cards: [{ ...card, ...change }] }));
  }
  assert.throws(() => validateFinal(state, { date: '2026-02-31', cards: [card] }), /Invalid date/);
});
test('final CSV supports registration canonicalization and rejects blank template scores', () => {
  const state = fixture([[70, 60]], true), t = state.teams[0];
  const source = `Team,Player,Total,Back9,Back6,Back3,Back1\n${t.name.toUpperCase()},${t.players[0].toLowerCase()},40,20,12,6,2`;
  assert.equal(parseFinal(source, state).cards[0].total, 40);
  assert.equal(parseFinal(source, state).date, null);
  assert.throws(() => parseFinal(`Team,Player,Total,Back9,Back6,Back3,Back1\n${t.name},${t.players[0]},,,,,`, state), /not a blank/);
});
test('changing qualification cannot retain final cards that become ineligible', () => {
  const state = fixture([[70, 60]], true);
  state.final = { date: null, cards: [finalCard(state.teams[0], 0)] };
  state.settings.complete = false;
  assert.throws(() => validateState(state), /Final blocked/);
});
test('safe HTML report escapes malicious names and never executes imported markup', () => {
  const state = fixture();
  state.teams[0].name = '<img src=x onerror=alert(1)>';
  state.teams[0].players[0] = '<script>alert(1)</script>';
  const report = reportHTML(state, '<script>draft</script>');
  assert.ok(report.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(report.includes('&lt;script&gt;'));
  assert.ok(!report.includes('<script>'));
  assert.ok(report.includes("default-src 'none'"));
  assert.ok(report.includes('Provisional'));
});
test('localStorage round trip persists drafts across reload', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const state = fixture();
  assert.equal(saveDraft(storage, state), null);
  assert.deepEqual(readDraft(storage).state, state);
  assert.ok(values.has(STORAGE_KEY));
});
test('corrupt and denied storage return actionable errors without overwriting data', () => {
  let writes = 0;
  const storage = { getItem: () => '{bad', setItem: () => { writes++; } };
  const result = readDraft(storage);
  assert.equal(result.state, null);
  assert.match(result.error, /not overwritten/);
  assert.equal(writes, 0);
  assert.match(readDraft(null).error, /could not be read/);
});
test('quota handling preserves the in-memory draft and explicitly warns about reload loss', () => {
  const state = fixture();
  const error = saveDraft({ setItem() { throw new Error('QuotaExceededError'); } }, state);
  assert.match(error, /only in memory/);
  assert.match(error, /not survive reload/);
  assert.equal(state.teams.length, 2);
});
test('publication helper requires explicit input and refuses invalid files without changing publication', async () => {
  const publishedURL = new URL('../data/published.json', import.meta.url);
  const before = await readFile(publishedURL, 'utf8');
  const script = new URL('../tools/publish.mjs', import.meta.url);
  const { fileURLToPath } = await import('node:url');
  const noInput = spawnSync(process.execPath, [fileURLToPath(script)], { encoding: 'utf8' });
  assert.equal(noInput.status, 1);
  assert.match(noInput.stderr, /explicit/);
  const invalid = spawnSync(process.execPath, [fileURLToPath(script), fileURLToPath(new URL('../package.json', import.meta.url))], { encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Publication refused/);
  assert.equal(await readFile(publishedURL, 'utf8'), before);
});
