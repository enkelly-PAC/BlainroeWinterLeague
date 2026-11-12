import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { emptyState, league, canonical, assignments, parseScores } from '../core.js';
import { synchroniseDraft, protectPublishedHistory } from '../publication.js';
import { readBaseline, readDraft, saveDraft, STORAGE_KEY, BASELINE_KEY } from '../storage.js';
import { buildUpdate, updateResults, argumentsFor } from '../tools/update-results.mjs';
import { atomicPublication } from '../tools/publication-io.mjs';

const csv = (date, score = 29) => `Competition Name,Synthetic net weekend\nPlayed on,${date}\nPlayer,Score,Handicap\nSynthetic Alpha,${score},7\nSynthetic Beta,24,-1\nSynthetic Gamma,20,3`;
const file = (date, score) => ({ path: `synthetic-${date}.csv`, source: csv(date, score) });
const options = { confirmNet: true };
function fixture() {
  const state = emptyState();
  state.teams = [{ name: 'Team 2', players: ['Synthetic Alpha', 'Synthetic Beta', 'Synthetic Gamma'] }];
  return state;
}
function firstWeekend() { return buildUpdate(fixture(), [file('2026-10-31')], options).state; }

test('weekly ingestion appends, retains every raw card and settings, and repeated imports do not duplicate', () => {
  const first = firstWeekend(); first.settings.maxRounds = 12;
  const next = buildUpdate(first, [file('2026-11-07', 30)], options).state;
  assert.deepEqual(next.rounds[0], first.rounds[0]);
  assert.deepEqual(next.teams, first.teams);
  assert.deepEqual(next.settings, first.settings);
  assert.equal(next.rounds.length, 2);
  assert.equal(league(next).rows[0].retained, 107);
  assert.deepEqual(buildUpdate(next, [file('2026-11-07', 30), file('2026-10-31')], options).state, next);
});
test('score and handicap conflicts require intentional complete named-weekend replacement', () => {
  const first = firstWeekend();
  const current = buildUpdate(first, [file('2026-11-07', 30)], options).state;
  assert.throws(() => buildUpdate(current, [file('2026-10-31', 40)], options), /Conflicting card/);
  assert.throws(() => buildUpdate(current, [{ path: 'changed-handicap.csv', source: csv('2026-10-31').replace(',29,7', ',29,8') }], options), /Conflicting card/);
  const replacement = { ...file('2026-10-31', 40), source: csv('2026-10-31', 40).split('\n').slice(0, 4).join('\n') };
  const corrected = buildUpdate(current, [replacement], { ...options, replacements: ['2026-10-31'] }).state;
  assert.equal(corrected.rounds[0].cards[0].score, 40);
  assert.equal(corrected.rounds[0].cards.length, 1);
  assert.deepEqual(corrected.rounds[1], current.rounds[1]);
  assert.deepEqual(corrected.teams, current.teams);
  assert.throws(() => buildUpdate(current, [file('2026-10-31', 40)], { ...options, replacements: ['2026-11-07'] }), /selected complete corrected/);
  assert.throws(() => buildUpdate(first, [file('2026-11-07')], { ...options, replacements: ['2026-11-07'] }), /existing weekend/);
});
test('CLI requires explicit files and net confirmation, uses report dates not filenames, and rejects other seasons', () => {
  assert.throws(() => argumentsFor([]), /explicit --file/);
  assert.throws(() => argumentsFor(['--file']), /Missing value/);
  assert.throws(() => argumentsFor(['--file', 'a', '--push']), /Unknown option/);
  assert.throws(() => buildUpdate(fixture(), [file('2026-10-31')]), /--confirm-net/);
  assert.throws(() => buildUpdate(fixture(), [file('2025-11-01')], options), /outside Winter League/);
  assert.throws(() => buildUpdate(fixture(), [file('2026-10-31')], { ...options, date: '2026-11-07' }), /disagrees/);
  assert.throws(() => buildUpdate(fixture(), [{ path: '2026-10-31.csv', source: 'Player,Score\nSynthetic Alpha,29' }], options), /No played-on date/);
  const result = buildUpdate(fixture(), [{ path: 'wrong-2025.csv', source: csv('2026-10-31') }], options);
  assert.equal(result.state.rounds[0].date, '2026-10-31');
  assert.equal(result.state.rounds[0].name, 'Synthetic net weekend');
});
test('report title is read from the actual HandicapMaster report preamble, never the printed date', () => {
  const report = [
    '"Synthetic Golf Club"', '"Mens Winter League singles - R1 - Alt Day"', '"Printed: 2 November 2026"', '"Competition Result"',
    '"Aggregate result of the Competition played on Saturday 31 October 2026 and Sunday 1 November 2026."',
    '"Aggregated Results - Net Scores"', '"Overall Position","","","Score (Play H\'cap)"',
    '"1","Synthetic Alpha","","29 pts (07)"', '"Number of Cards Processed = 1"'
  ].join('\n');
  const parsed = parseScores(report);
  assert.equal(parsed.name, 'Mens Winter League singles - R1 - Alt Day');
  assert.equal(parsed.playedOn, '2026-10-31');
});
test('mixed gross files are excluded, malformed result input is atomic, preview never writes', async t => {
  const folder = new URL(`../.test-update-${randomUUID()}/`, import.meta.url);
  await mkdir(folder);
  t.after(() => rm(folder, { recursive: true, force: true }));
  const target = fileURLToPath(new URL('published.json', folder));
  const net = fileURLToPath(new URL('net.csv', folder));
  const gross = fileURLToPath(new URL('gross.csv', folder));
  const bad = fileURLToPath(new URL('bad.csv', folder));
  const before = JSON.stringify(firstWeekend());
  await Promise.all([
    writeFile(target, before), writeFile(net, csv('2026-11-07', 30)),
    writeFile(gross, 'Competition Scorecards\nHole by Hole scores returned\nPlayer(s),,1,18,Total\nSynthetic Alpha,,5,6,11'),
    writeFile(bad, 'Player,Score\nSynthetic Broken,strokes')
  ]);
  const args = ['--file', net, '--file', gross, '--confirm-net'];
  const preview = await updateResults(args, target);
  assert.deepEqual(preview.excluded, [gross]);
  assert.equal(await readFile(target, 'utf8'), before);
  await assert.rejects(updateResults([...args, '--file', bad, '--apply'], target), /bad.csv: Invalid Stableford score/);
  assert.equal(await readFile(target, 'utf8'), before);
  await updateResults([...args, '--apply'], target);
  const applied = await readFile(target, 'utf8');
  assert.equal(JSON.parse(applied).rounds.length, 2);
  await updateResults([...args, '--apply'], target);
  assert.equal(await readFile(target, 'utf8'), applied);
  await assert.rejects(updateResults(['--file', gross, '--confirm-net', '--apply'], target), /No net results.*gross scorecard/);
  await assert.rejects(atomicPublication(target, fixture(), before), /changed during preview/);
  assert.equal(await readFile(target, 'utf8'), applied);
  await writeFile(`${target}.lock`, 'busy');
  await assert.rejects(atomicPublication(target, fixture(), applied), /Another publication update/);
  assert.equal(await readFile(`${target}.lock`, 'utf8'), 'busy');
  assert.equal(await readFile(target, 'utf8'), applied);
});
test('legacy drafts gain online rounds and current roster without losing local weekends or settings', () => {
  const published = firstWeekend(), draft = emptyState();
  draft.settings.maxRounds = 12;
  draft.rounds = buildUpdate(fixture(), [file('2026-11-07', 30)], options).state.rounds;
  const result = synchroniseDraft(draft, published);
  assert.deepEqual(result.teams, published.teams);
  assert.deepEqual(result.rounds[0], published.rounds[0]);
  assert.deepEqual(result.rounds[1], draft.rounds[0]);
  assert.equal(result.settings.maxRounds, 12);
  const customised = structuredClone(published);
  customised.teams[0].notes = 'Committee review';
  assert.equal(synchroniseDraft(customised, published).teams[0].notes, 'Committee review');
});
test('baseline safely merges independent team, settings and card changes, follows online corrections, and rejects hard conflicts', () => {
  const base = firstWeekend(), local = structuredClone(base), online = structuredClone(base);
  local.teams[0].notes = 'Local note'; local.settings.maxRounds = 12;
  online.teams[0].players[2] = 'Synthetic Fourth'; online.settings.discardCount = 1;
  online.rounds[0].cards[1].score = 28;
  const result = synchroniseDraft(local, online, base);
  assert.equal(result.teams[0].notes, 'Local note');
  assert.equal(result.teams[0].players[2], 'Synthetic Fourth');
  assert.equal(result.settings.maxRounds, 12);
  assert.equal(result.settings.discardCount, 1);
  assert.equal(result.rounds[0].cards[1].score, 28);
  local.rounds[0].cards[1].score = 30;
  const before = JSON.stringify(local);
  assert.throws(() => synchroniseDraft(local, online, base), /Sync conflict.*card syntheticbeta, score.*preserved/);
  assert.equal(JSON.stringify(local), before);
  assert.throws(() => synchroniseDraft(local, online), /Sync conflict/);
});
test('publication refuses stale history and local card removals, but allows an explicit complete-weekend correction', () => {
  const base = firstWeekend(), draft = structuredClone(base);
  draft.rounds[0].cards[0].score = 40;
  assert.throws(() => protectPublishedHistory(draft, base), /Published card.*--replace-weekend/);
  assert.equal(protectPublishedHistory(draft, base, ['2026-10-31']), draft);
  draft.rounds[0].cards.pop();
  assert.throws(() => synchroniseDraft(draft, base, base), /removed locally but is published/);
  const stale = fixture();
  assert.throws(() => protectPublishedHistory(stale, base), /weekend.*missing/);
  assert.throws(() => protectPublishedHistory(stale, base, ['2026-10-31']), /present in both/);
  const unrelated = fixture(); unrelated.teams[0].name = 'DEMO Team';
  assert.throws(() => synchroniseDraft(unrelated, base), /unrelated team list/);
  assert.throws(() => protectPublishedHistory(unrelated, base), /Unrelated/);
  unrelated.teams[0].name = 'Team 2';
  unrelated.teams[0].players = ['Another season one', 'Another season two', 'Another season three'];
  assert.throws(() => synchroniseDraft(unrelated, base), /unrelated players despite reusing/);
});
test('baseline storage survives reload and partial/old baseline records are never trusted', () => {
  const values = new Map(), storage = {
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)
  };
  const base = firstWeekend(), local = structuredClone(base);
  local.teams[0].notes = 'Local note';
  assert.equal(saveDraft(storage, local, base), null);
  assert.deepEqual(readBaseline(storage, readDraft(storage).state), base);
  values.set(STORAGE_KEY, JSON.stringify(base));
  assert.equal(readBaseline(storage, base), null);
  values.set(BASELINE_KEY, '{broken');
  assert.equal(readBaseline(storage, base), null);
  assert.deepEqual(readDraft(storage).state, base);
});
test('real first weekend has preserved net points, known matches and team best-two totals', async () => {
  const state = JSON.parse(await readFile(new URL('../data/published.json', import.meta.url), 'utf8'));
  state.rounds = state.rounds.filter(round => round.date === '2026-10-31');
  assert.equal(state.rounds.length, 1);
  const round = state.rounds[0];
  assert.equal(round.date, '2026-10-31');
  assert.equal(round.name, 'Mens Winter League singles - R1 - Alt Day');
  assert.equal(round.cards.length, 165);
  assert.deepEqual(round.cards.find(card => canonical(card.player) === canonical('Michael Neiland')), { player: 'Neiland, Michael', score: 29, handicap: 7 });
  const assigned = assignments(state.teams, state.identityBindings);
  assert.equal(round.cards.filter(card => !assigned.has(canonical(card.player))).length, 49);
  assert.equal(round.cards.filter(card => assigned.get(canonical(card.player))?.startsWith('Unassigned')).length, 0);
  assert.equal(round.cards.filter(card => assigned.has(canonical(card.player)) && !assigned.get(canonical(card.player)).startsWith('Unassigned')).length, 116);
  const leaders = league(state).rows.filter(row => row.rank === 1);
  assert.deepEqual(leaders.map(row => [row.team.name, row.retained]), [['Team 15', 49], ['Team 27', 49]]);
  assert.equal(state.settings.complete, false);
  assert.equal(state.final, null);
});
test('replacement roster applies existing late-registration rules without changing historic cards', async () => {
  const current = JSON.parse(await readFile(new URL('../data/published.json', import.meta.url), 'utf8'));
  // Preserve the old draw-sheet fixture to isolate late registration from naming corrections.
  current.teams.forEach(team => {
    team.players = team.players.map(name => current.identityBindings.find(binding => binding.player === name)?.source || name);
  });
  delete current.identityBindings;
  current.rounds = current.rounds.filter(round => round.date === '2026-10-31');
  const previous = structuredClone(current);
  previous.teams = previous.teams.filter(team => team.name !== 'Team 1');
  previous.teams.find(team => team.name === 'Team 21').players[2] = 'David Starling';
  previous.teams.find(team => team.name === 'Team 34').players.pop();
  protectPublishedHistory(current, previous);
  const points = state => Object.fromEntries(league(state).rows.map(row => [row.team.name, row.retained]));
  const before = points(previous), after = points(current);
  assert.equal(after['Team 1'], 22);
  assert.equal(before['Team 21'], 0);
  assert.equal(after['Team 21'], 24);
  assert.equal(before['Team 34'], 23);
  assert.equal(after['Team 34'], 38);
  for (const team of previous.teams) {
    if (!['Team 21', 'Team 34'].includes(team.name)) assert.equal(after[team.name], before[team.name]);
    assert.deepEqual(current.teams.find(entry => entry.name === team.name).heldPlayers, team.heldPlayers);
    assert.deepEqual(current.teams.find(entry => entry.name === team.name).notes, team.notes);
  }
  assert.deepEqual(current.rounds, previous.rounds);
});
test('real Weekend 2 keeps reported net cards and cumulative totals with the confirmed roster', async () => {
  const state = JSON.parse(await readFile(new URL('../data/published.json', import.meta.url), 'utf8'));
  assert.deepEqual(state.rounds.map(round => [round.date, round.cards.length]), [['2026-10-31', 165], ['2026-11-07', 162]]);
  const round = state.rounds[1], assigned = assignments(state.teams, state.identityBindings);
  assert.equal(round.cards.filter(card => !assigned.has(canonical(card.player))).length, 42);
  assert.equal(round.cards.filter(card => assigned.get(canonical(card.player))?.startsWith('Unassigned')).length, 0);
  const table = league(state);
  assert.deepEqual(table.rows.slice(0, 3).map(row => [row.team.name, row.retained]), [['Team 7', 99], ['Team 13', 98], ['Team 27', 98]]);
  assert.equal(table.rows.find(row => row.team.name === 'Team 7').scores[1].total, 51);
  for (const [player, score] of [['Gavin Pembrey', 29], ['William Seymour', 19], ['Cormac Byrne', 18],
    ['Owen McConnell', 17], ['Chris Mahon', 16], ['Scott McConnell', 16]])
    assert.equal(round.cards.find(card => canonical(card.player) === canonical(player)).score, score);
  for (const player of ['Fergal Keogh', "Dominic O'Malley", 'Darragh Kavanagh', 'Aidan Whelan', 'Thomas McDougall', 'Neil Campbell'])
    assert.equal(round.cards.some(card => canonical(card.player) === canonical(player)), false);
  for (const [team, total, retained, rank] of [['Team 23', 46, 91, 8], ['Team 15', 41, 90, 10],
    ['Team 22', 36, 77, 28], ['Team 46', 37, 77, 28], ['Team 29', 36, 74, 32]]) {
    const row = table.rows.find(row => row.team.name === team);
    assert.deepEqual([row.scores[1].total, row.retained, row.rank], [total, retained, rank]);
  }
  for (const team of state.teams.filter(team => ['Team 10', 'Team 37'].includes(team.name)))
    assert.deepEqual(team.heldPlayers || [], []);
  assert.equal(state.settings.complete, false);
  assert.equal(state.final, null);
});
