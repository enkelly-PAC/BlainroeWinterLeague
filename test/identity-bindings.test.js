import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonical, playerKey, assignments, emptyState, importRound, isHeld, league, singles, validateState, reportHTML } from '../core.js';
import { leaderboardPDFDocument } from '../leaderboard-pdf.js';
import { weekendCards } from '../leaderboard-layout.js';
import { memberUpdate } from '../member-update.js';
import { protectPublishedHistory, synchroniseDraft } from '../publication.js';
import { buildUpdate } from '../tools/update-results.mjs';

const state = validateState(JSON.parse(await readFile(new URL('../data/published.json', import.meta.url), 'utf8')));
const expected = [
  ['Michael Farrell', 'Mike Farrell', 5, [14, 22], [32, 47]],
  ['Joshua McCall', 'Josh McCall', 28, [18, 26], [43, 54]],
  ['Joseph Neiland Jnr', 'Joe Neiland Jnr', 27, [18, 24], [49, 49]],
  ['Kieran Ryan', 'Keiran Ryan', 29, [18, 17], [38, 39]],
  ['Thomas Kelly', 'Tommy Kelly', 16, [23, 18], [47, 37]],
  ["Michael Anthony O'Neill", "Michael A. O'Neill", 41, [20, 24], [38, 42]],
  ['Mark McElhinney', 'Mark McElhinny', 11, [19, 22], [48, 46]],
  ['Patrick Daly', 'Paddy Daly', 34, [19, 21], [42, 47]],
  ['Calum Rawl', 'Callum Rawl', 24, [19, 19], [41, 43]],
  ['Kevin Forsyth', 'Ken Forsyth', 15, [18, 23], [49, 44]],
  ['Amory Schwartz', 'Amory Swartz', 21, [17, null], [41, 21]],
  ['Nicholas Byrne', 'Nick Byrne', 18, [21, 17], [44, 39]],
  ['Paul F Deignan', 'Paul Deignan', 36, [14, 12], [36, 37]],
  ['Robert Kiersey', 'Rob Kiersey', 1, [null, 18], [22, 48]],
  ['Sean Alger', 'Sean Algar', 2, [null, 21], [35, 44]],
  ['Jonathon Tymlin', 'Jonathan Tymlin', 42, [null, 17], [0, 43]]
];
const oldBound = structuredClone(state);
oldBound.identityBindings = state.identityBindings.map(({ source, player }) => ({ source: player, player: source }));
oldBound.teams.forEach(team => {
  team.players = team.players.map(name => expected.find(([source]) => source === name)?.[1] || name);
});
const original = structuredClone(oldBound);
delete original.identityBindings;
test('all 16 confirmed one-to-one bindings attach 28 original cards without changing source or Singles scores', () => {
  assert.equal(state.identityBindings.length, expected.length);
  const assigned = assignments(state.teams, state.identityBindings), rows = league(state).rows;
  let cards = 0;
  for (const [source, player, number, scores, totals] of expected) {
    assert.equal(playerKey(source, state.identityBindings), canonical(source));
    assert.equal(playerKey(player, state.identityBindings), canonical(source));
    assert.equal(assigned.get(canonical(source)), `Team ${number}`);
    const row = rows.find(row => row.team.name === `Team ${number}`);
    assert.ok(row.team.players.includes(source));
    assert.deepEqual(row.scores.map(score => score.total), totals);
    for (const [index, round] of state.rounds.entries()) {
      const card = round.cards.find(card => canonical(card.player) === canonical(source));
      assert.equal(card?.score ?? null, scores[index]);
      const cell = weekendCards(row.team, round, state.identityBindings)[row.team.players.indexOf(source)];
      assert.equal(cell.score ?? null, scores[index]);
      if (card) cards++;
    }
  }
  assert.equal(cards, 28);
  assert.deepEqual(state.rounds, original.rounds);
  for (const round of state.rounds) {
    const stripTeam = row => ({ player: row.player, score: row.score, handicap: row.handicap, rank: row.rank });
    assert.deepEqual(singles(state, round.date).rows.map(stripTeam), singles(original, round.date).rows.map(stripTeam));
  }
  assert.equal(rows.filter(row => row.retained !== league(original).rows.find(old => old.team.name === row.team.name).retained).length, 14);
  assert.deepEqual(rows.slice(0, 5).map(row => [row.team.name, row.retained, row.rank]),
    [['Team 7', 99, 1], ['Team 13', 98, 2], ['Team 27', 98, 2], ['Team 28', 97, 4], ['Team 20', 96, 5]]);
  assert.equal(rows.find(row => row.team.name === 'Team 5').rank, 26);
  assert.deepEqual(rows.map(row => [row.team.name, row.rank, row.retained, row.scores]),
    league(oldBound).rows.map(row => [row.team.name, row.rank, row.retained, row.scores]));
});
test('unconfirmed names and distinct lookalikes stay separate; historical holds and the W1 DQ stay excluded', () => {
  for (const [a, b] of [['David Browne', 'David Brown'], ["Michael O'Neill Snr.", "Michael A. O'Neill"],
    ["Brian O'Connor", 'Brian J. Connor'], ['David Starling', 'David Sparling'], ['Mick Farrell', 'Mike Farrell']])
    assert.notEqual(playerKey(a, state.identityBindings), playerKey(b, state.identityBindings));
  assert.equal(state.rounds[0].cards.some(card => canonical(card.player) === canonical('Robert Kiersey')), false);
  const heldState = structuredClone(state);
  heldState.teams.find(team => team.name === 'Team 10').players[0] = 'Colin Owens';
  for (const team of heldState.teams.filter(team => ['Team 10', 'Team 37'].includes(team.name))) {
    team.heldPlayers = ['Colin Owens'];
    assert.ok(isHeld(team, 'Colin Owens', state.identityBindings));
    for (const round of state.rounds) {
      const cell = weekendCards(team, round, state.identityBindings)[team.players.indexOf('Colin Owens')];
      assert.ok(cell.held);
      assert.equal(cell.counting, false);
    }
  }
  const alias = [{ source: 'Colin Owens Alias', player: 'Colin Owens' }];
  assert.ok(isHeld(heldState.teams.find(team => team.name === 'Team 10'), 'Colin Owens Alias', alias));
  assert.match(assignments(heldState.teams, alias).get(canonical('Colin Owens Alias')), /^Unassigned/);
});
test('confirmed Colin roster correction assigns distinct original cards and recalculates both teams without altering the DQ', () => {
  const before = structuredClone(state);
  before.teams.find(team => team.name === 'Team 10').players[0] = 'Colin Owens';
  for (const team of before.teams.filter(team => ['Team 10', 'Team 37'].includes(team.name)))
    team.heldPlayers = ['Colin Owens'];
  const assigned = assignments(state.teams, state.identityBindings);
  assert.equal(assigned.get(canonical('Halion, Colin')), 'Team 10');
  assert.equal(assigned.get(canonical('Owens, Colin')), 'Team 37');
  assert.notEqual(playerKey('Colin Halion', state.identityBindings), playerKey('Colin Owens', state.identityBindings));
  const expectedColins = [['Team 10', 'Colin Halion', [20, 18], [33, 34], 67, [true, true]],
    ['Team 37', 'Colin Owens', [15, 17], [35, 40], 75, [true, false]]];
  const rows = league(state).rows, oldRows = league(before).rows;
  for (const [name, player, scores, totals, retained, counting] of expectedColins) {
    const row = rows.find(row => row.team.name === name);
    assert.equal(isHeld(row.team, player), false);
    assert.deepEqual(row.scores.map(score => score.total), totals);
    assert.equal(row.retained, retained);
    assert.deepEqual(state.rounds.map((round, index) => {
      const cell = weekendCards(row.team, round, state.identityBindings)[row.team.players.indexOf(player)];
      assert.equal(cell.held, false);
      assert.equal(cell.counting, counting[index]);
      return cell.score;
    }), scores);
  }
  for (const row of rows.filter(row => !['Team 10', 'Team 37'].includes(row.team.name)))
    assert.deepEqual(row.scores, oldRows.find(old => old.team.name === row.team.name).scores);
  assert.deepEqual(state.rounds, before.rounds);
  assert.deepEqual(state.teams.find(team => team.name === 'Team 37').notes,
    before.teams.find(team => team.name === 'Team 37').notes);
  assert.equal(state.rounds[0].cards.find(card => canonical(card.player) === canonical('Gavin Pembrey')).score, 23);
  assert.equal(state.rounds[1].cards.some(card => canonical(card.player) === canonical('Gavin Pembrey')), false);
  const points = singles => singles.map(({ player, total, rank }) => ({ player, total, rank }));
  assert.deepEqual(points(singles(state).rows), points(singles(before).rows));
});
test('roster page and export displays use all 16 source names, with old draw-sheet spellings only as aliases', () => {
  const html = reportHTML(state, 'Local review');
  const pdf = JSON.stringify(leaderboardPDFDocument(state, { format: 'detail', audience: 'members' }));
  const csv = memberUpdate(state).teamCSV;
  for (const [source, alias] of expected) {
    const escaped = source.replaceAll('&', '&amp;').replaceAll("'", '&#39;');
    assert.ok(html.includes(escaped), `Page display: ${source}`);
    assert.ok(pdf.includes(source), `PDF display: ${source}`);
    assert.ok(csv.includes(source), `CSV display: ${source}`);
    assert.ok(!state.teams.some(team => team.players.includes(alias)));
    assert.ok(state.identityBindings.some(binding => binding.source === alias && binding.player === source));
  }
});
test('strict registry validation rejects unknown targets, redirected roster identities, duplicate sources and targets', () => {
  const invalid = bindings => validateState({ ...structuredClone(original), identityBindings: bindings });
  assert.throws(() => invalid(null), /expected an array/);
  assert.throws(() => invalid([{ source: 'New Alias', player: 'Unknown Member' }]), /not registered/);
  assert.throws(() => invalid([{ source: 'David Brown', player: 'Mike Farrell' }]), /already names a registered player/);
  assert.throws(() => invalid([{ source: 'Michael Farrell', player: 'Mike Farrell', fuzzy: true }]), /Unsupported|unsupported/);
  assert.throws(() => invalid([{ source: 'Michael Farrell', player: 'Mike Farrell' },
    { source: 'Farrell, Michael', player: 'Rob Kiersey' }]), /duplicate/i);
  assert.throws(() => invalid([{ source: 'Michael Farrell', player: 'Mike Farrell' },
    { source: 'Mick Farrell', player: 'Mike Farrell' }]), /duplicate/i);
  const redirected = structuredClone(state);
  redirected.identityBindings.push({ source: 'David Browne', player: 'David Brown' });
  assert.throws(() => validateState(redirected), /Confirmed player.*duplicate/i);
});
test('resolved duplicates are rejected within uploads; identical reimports preserve original spelling and conflicts block', () => {
  const existing = state.rounds[0].cards.find(card => canonical(card.player) === canonical('Michael Farrell'));
  const input = { ...state.rounds[0], cards: [{ ...existing, player: 'Mike Farrell' }] };
  const merged = importRound(state, input);
  assert.deepEqual(merged, state);
  assert.equal(merged.rounds[0].cards.find(card => canonical(card.player) === canonical('Michael Farrell')).player, existing.player);
  assert.throws(() => importRound(state, { ...input, cards: [existing, input.cards[0]] }), /duplicate/i);
  assert.throws(() => importRound(state, { ...input, cards: [{ ...input.cards[0], score: 15 }] }), /conflict/i);
  assert.throws(() => buildUpdate(state, [{ path: 'aliases.csv',
    source: 'Player,Score\nMichael Farrell,14\nMike Farrell,14' }],
  { confirmNet: true, date: '2026-10-31' }), /Duplicate confirmed identity/);
});
test('final membership uses confirmed identities but rejects duplicate identities and held members', () => {
  const fixture = emptyState();
  fixture.teams = [{ name: 'Team 1', players: ['Mike Farrell', 'Beta Player', 'Gamma Player'] }];
  fixture.identityBindings = [{ source: 'Michael Farrell', player: 'Mike Farrell' }];
  fixture.rounds = [{ date: '2026-10-31', name: 'Synthetic weekend', qualifying: true, canceled: false,
    cards: [{ player: 'Michael Farrell', score: 14 }] }];
  fixture.settings.complete = true;
  fixture.final = { date: null, cards: [{ team: 'Team 1', player: 'Michael Farrell', total: 20, back9: 10, back6: 6, back3: 3, back1: 1 }] };
  assert.doesNotThrow(() => validateState(fixture));
  const duplicate = structuredClone(fixture);
  duplicate.final.cards.push({ ...duplicate.final.cards[0], player: 'Mike Farrell' });
  assert.throws(() => validateState(duplicate), /duplicate/i);
  fixture.teams[0].heldPlayers = ['Mike Farrell'];
  assert.throws(() => validateState(fixture), /held/i);
});
test('legacy state compatibility and three-way sync retain confirmed bindings and protect their published history', () => {
  assert.deepEqual(validateState(structuredClone(original)), original);
  assert.deepEqual(synchroniseDraft(original, state, original), state);
  assert.deepEqual(synchroniseDraft(emptyState(), state), state);
  assert.doesNotThrow(() => protectPublishedHistory(state, original));
  assert.throws(() => protectPublishedHistory(original, state), /confirmed identity binding/);
  const conflicting = structuredClone(original);
  conflicting.identityBindings = [{ source: 'Other Farrell', player: 'Mike Farrell' }];
  assert.throws(() => synchroniseDraft(conflicting, state, original), /conflict/i);
});
test('old bound drafts adopt source display names only for equivalent approved pairs in unchanged slots', () => {
  assert.deepEqual(synchroniseDraft(oldBound, state, oldBound), state);
  assert.deepEqual(synchroniseDraft(oldBound, state), state);
  const independent = structuredClone(oldBound);
  independent.teams[0].notes = 'Independent local note';
  const merged = synchroniseDraft(independent, state, oldBound);
  assert.equal(merged.teams[0].notes, 'Independent local note');
  assert.deepEqual(merged.teams[0].players, state.teams[0].players);
  assert.deepEqual(merged.rounds, state.rounds);
  assert.doesNotThrow(() => protectPublishedHistory(state, oldBound));
  assert.doesNotThrow(() => protectPublishedHistory(oldBound, state));
  const edited = structuredClone(oldBound);
  [edited.teams[4].players[1], edited.teams[4].players[2]] =
    [edited.teams[4].players[2], edited.teams[4].players[1]];
  assert.throws(() => synchroniseDraft(edited, state, oldBound), /conflict/i);
  assert.throws(() => protectPublishedHistory(edited, state), /binding/i);
  const retargeted = structuredClone(state);
  retargeted.identityBindings[0].source = 'Other Farrell';
  assert.throws(() => protectPublishedHistory(retargeted, oldBound), /binding/i);
  assert.throws(() => synchroniseDraft(retargeted, state, oldBound), /conflict/i);
});
test('movement requires the same confirmed bindings in a separately corrected comparison baseline', () => {
  const before = { schemaVersion: 1, through: state.rounds[0].date,
    state: { ...structuredClone(original), rounds: [structuredClone(original.rounds[0])] } };
  before.teams = memberUpdate(before.state).result.rows;
  assert.throws(() => memberUpdate(state, { baseline: before }), /baseline|roster|historic/i);
  const corrected = structuredClone(before);
  corrected.state.teams = structuredClone(state.teams);
  corrected.state.identityBindings = structuredClone(state.identityBindings);
  corrected.teams = memberUpdate(corrected.state).result.rows;
  const update = memberUpdate(state, { baseline: corrected });
  assert.deepEqual(update.result.rows.slice(0, 5).map(row => [row.team.name, row.retained]),
    [['Team 7', 99], ['Team 13', 98], ['Team 27', 98], ['Team 28', 97], ['Team 20', 96]]);
});
