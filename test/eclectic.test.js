import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyState } from '../core.js';
import { allocatedStrokes, buildEclectic, eclecticFingerprint, eclecticStandings, parseGrossScorecards, validateEclectic, eclecticCategory, eclecticSubtotal, eclecticDisplayRows, eclecticInsights } from '../eclectic.js';
import { eclecticArguments, updateEclectic } from '../tools/update-eclectic.mjs';
import { atomicPublication } from '../tools/publication-io.mjs';
import { sourceCard, weekendFixture } from './eclectic-fixture.js';

function fixture() {
  const alpha1 = sourceCard('Old Alpha', [null, 4, 4, 5, 5, 4, 4, 3, 4, 4, 4, 3]);
  const alpha2 = sourceCard('Alpha', [4, null, 4, 5, 5, 4, 4, 3, 4, 4, 4, 3]);
  const incomplete = sourceCard('Incomplete', [4, null, 4, 5, 5, 4, 4, 3, 4, 4, 4, 3]);
  const dq = sourceCard('DQ Player', Array(12).fill(1));
  const weeks = [
    weekendFixture('2026-10-31', [alpha1, dq], [sourceCard('Visitor'), incomplete], ['DQ Player']),
    weekendFixture('2026-11-07', [alpha2], [sourceCard('Visitor')])
  ];
  const state = emptyState();
  state.teams = [{ name: 'Team 1', players: ['Alpha', 'Member Two', 'Member Three'], heldPlayers: ['Alpha'] }];
  state.identityBindings = [{ source: 'Old Alpha', player: 'Alpha' }];
  state.settings.complete = true;
  state.settings.discardCount = 1;
  state.rounds = weeks.map(week => week.round);
  return { state, gross: weeks.flatMap(week => week.gross), net: weeks.map(week => week.net) };
}

test('accepted gross NR cards contribute numeric holes, PU is never a minimum, DQ is excluded, and ties/incomplete identities remain honest', async () => {
  const { state, gross, net } = fixture(), before = structuredClone(state);
  const data = await buildEclectic(state, gross, net);
  validateEclectic(data, state, await eclecticFingerprint(state));
  assert.equal(data.acceptedCards, 5);
  assert.equal(data.coverage[0].days[0].rawCards, 2);
  assert.equal(data.coverage[0].days[0].acceptedCards, 1);
  for (const field of ['gross', 'net']) {
    const table = eclecticStandings(state, data, field);
    assert.deepEqual(table.rows.map(row => [row.player, row.total, row.rank]),
      [['Alpha', 48, 1], ['Visitor', 48, 1], ['Incomplete', null, null]]);
    assert.equal(table.rows[0].holes[0], 4);
    assert.equal(table.rows[2].holes[1], null);
    assert.equal(table.complete, 2);
  }
  assert.deepEqual(state, before);
});

test('Summer-style categories preserve numeric nett zero and distinguish every relative-to-par band from missing scores', () => {
  assert.deepEqual([-3, -2, -1, 0, 1, 2, 3, 7].map(diff => eclecticCategory(4 + diff, 4)),
    ['eagle', 'eagle', 'birdie', 'par', 'bogey', 'double', 'worse', 'worse']);
  assert.equal(eclecticCategory(0, 3), 'eagle');
  assert.equal(eclecticCategory(null, 3), null);
  assert.equal(eclecticCategory(undefined, 3), null);
  assert.equal(eclecticSubtotal([0, 3, 4]), 7);
  assert.equal(eclecticSubtotal([null, 3, 4]), null);
  assert.equal(eclecticSubtotal([0, undefined, 4]), null);
});

test('insights use recorded holes as category/rate denominators and complete records alone for total averages and group records', () => {
  const pars = [4, 4, 4, 5, 5, 4, 4, 3, 4, 4, 4, 3];
  const state = { ...emptyState(), rounds: [{ date: '2026-10-31', name: 'Synthetic', qualifying: true, canceled: false,
    cards: ['Alpha', 'Bravo', 'Charlie'].map(player => ({ player, score: 0 })) }] };
  const data = { players: [
    { key: 'alpha', net: [0, 3, 4, 6, 7, 7, 8, 9, null, null, null, null] },
    { key: 'bravo', net: pars },
    { key: 'charlie', net: pars.map(value => value - 1) }
  ] };
  const before = JSON.stringify(data), stats = eclecticInsights(state, data, 'net');
  assert.equal(stats.players, 3);
  assert.equal(stats.complete, 2);
  assert.equal(stats.incomplete, 1);
  assert.equal(stats.recorded, 32);
  assert.equal(stats.averageTotal, 42);
  assert.deepEqual(stats.leaders, ['Charlie']);
  assert.deepEqual(stats.categories, { eagle: 1, birdie: 13, par: 13, bogey: 1, double: 1, worse: 3 });
  assert.equal(stats.holes[0].count, 3);
  assert.equal(stats.holes[0].average, 7 / 3);
  assert.equal(stats.holes[0].parOrBetter, 100);
  assert.equal(stats.holes[5].parOrBetter, 2 / 3 * 100);
  assert.equal(stats.holes[8].count, 2);
  assert.equal(stats.holes[8].average, 3.5);
  assert.deepEqual(stats.outRecord, { score: 28, players: ['Charlie'] });
  assert.deepEqual(stats.inRecord, { score: 8, players: ['Charlie'] });
  assert.equal(stats.composite[0], 0);
  assert.equal(stats.compositeTotal, 33);
  assert.deepEqual(stats.threeUnder, [{ player: 'Alpha', hole: 1, par: 4, score: 0, relativeToPar: -4 }]);
  assert.equal(eclecticDisplayRows(state, data, 'net').find(row => row.key === 'alpha').out, null);
  assert.equal(JSON.stringify(data), before);
  const oneMissing = { players: [{ key: 'alpha', net: [...pars.slice(0, 11), null] }, ...data.players.slice(1)] };
  assert.deepEqual(eclecticInsights(state, oneMissing, 'net').oneToGo[0].missing, [15]);
  const empty = { players: data.players.map(row => ({ ...row, net: Array(12).fill(null) })) };
  const unavailable = eclecticInsights(state, empty, 'net');
  assert.equal(unavailable.averageTotal, null);
  assert.equal(unavailable.compositeTotal, null);
  assert.equal(unavailable.holes[0].average, null);
  assert.equal(unavailable.holes[0].parOrBetter, null);
  assert.deepEqual(unavailable.hardest, []);
  assert.deepEqual(unavailable.leaders, []);
});

test('accepted round counts and 9-plus-3 subtotals do not change Winter ranks or shared ties', async () => {
  const { state, gross, net } = fixture();
  const data = await buildEclectic(state, gross, net);
  const rows = eclecticDisplayRows(state, data, 'gross');
  assert.deepEqual(rows.map(row => [row.player, row.rounds, row.out, row.in, row.total, row.rank]),
    [['Alpha', 2, 37, 11, 48, 1], ['Visitor', 2, 37, 11, 48, 1], ['Incomplete', 1, null, 11, null, null]]);
});

test('real Winter insights exactly reconcile independent category totals and complete-only averages from unchanged best-hole arrays', async () => {
  const state = JSON.parse(await readFile(new URL('../data/published.json', import.meta.url), 'utf8'));
  const data = JSON.parse(await readFile(new URL('../data/eclectic.json', import.meta.url), 'utf8'));
  for (const [field, expected, average, composite] of [
    ['gross', [2, 167, 1065, 943, 312, 61], 9695 / 179, 36],
    ['net', [91, 882, 1188, 351, 37, 1], 7920 / 179, 25]
  ]) {
    const stats = eclecticInsights(state, data, field);
    assert.equal(stats.complete, 179);
    assert.equal(stats.incomplete, 40);
    assert.equal(stats.recorded, 2550);
    assert.deepEqual(Object.values(stats.categories), expected);
    assert.equal(stats.averageTotal, average);
    assert.equal(stats.compositeTotal, composite);
    assert.equal(stats.oneToGo.length, 19);
    for (let i = 0; i < 12; i++) {
      const values = data.players.map(row => row[field][i]).filter(value => value !== null);
      assert.equal(stats.holes[i].count, values.length);
      assert.equal(stats.holes[i].average, values.reduce((sum, value) => sum + value, 0) / values.length);
      assert.equal(Object.values(stats.holes[i].categories).reduce((sum, value) => sum + value, 0), values.length);
    }
  }
  assert.deepEqual(eclecticInsights(state, data, 'gross').hardest.map(hole => hole.hole), [2, 6, 10]);
  assert.deepEqual(eclecticInsights(state, data, 'net').easiest.map(hole => hole.hole), [15, 3, 8]);
  assert.equal(eclecticInsights(state, data, 'net').threeUnder.length, 1);
});

test('as-played net minima can use a different round than gross minima and preserve numeric zero-point holes', async () => {
  const first = sourceCard('Alpha', Array(12).fill(5));
  const second = sourceCard('Alpha', Array(12).fill(6), Array(12).fill(4), 24);
  const weeks = [
    weekendFixture('2026-10-31', [first], [sourceCard('Visitor')]),
    weekendFixture('2026-11-07', [second], [sourceCard('Visitor')])
  ];
  const state = { ...emptyState(), rounds: weeks.map(week => week.round) };
  // Like published R3, the net points are published without playing-handicap metadata.
  delete state.rounds[1].cards[0].handicap;
  const data = await buildEclectic(state, weeks.flatMap(week => week.gross), weeks.map(week => week.net));
  const row = data.players.find(player => player.key === 'alpha');
  assert.deepEqual(row.gross, Array(12).fill(5));
  assert.deepEqual(row.net, Array(12).fill(4));
  assert.equal(first.points[7], 0);
  assert.equal(row.net[7], 4);
});

test('allocation repeats over 12 holes and plus handicaps surrender strokes at the highest index', async () => {
  assert.deepEqual([1, 2, 3, 12].map(index => allocatedStrokes(26, index)), [3, 3, 2, 2]);
  assert.deepEqual([1, 11, 12].map(index => allocatedStrokes(-1, index)), [0, 0, -1]);
  assert.deepEqual([1, 11, 12].map(index => allocatedStrokes(-13, index)), [-1, -1, -2]);
  assert.throws(() => allocatedStrokes(8.5, 1), /exact integer/);
  const plus = sourceCard('Plus', [4, 4, 4, 5, 5, 4, 4, 3, 4, 4, 4, 3],
    [4, 4, 4, 6, 5, 4, 4, 3, 4, 4, 4, 3], -1);
  const week = weekendFixture('2026-10-31', [plus], [sourceCard('Visitor')]);
  const data = await buildEclectic({ ...emptyState(), rounds: [week.round] }, week.gross, [week.net]);
  assert.equal(data.players.find(row => row.key === 'plus').net[3], 6);
});

test('missing cards/days, duplicate confirmed cards, invalid hole structure and inconsistent allocations refuse a build', async () => {
  const { state, gross, net } = fixture();
  await assert.rejects(buildEclectic(state, gross.slice(1), net), /both days/);
  await assert.rejects(buildEclectic(state, [...gross, gross[0]], net), /Duplicate scorecard day/);
  await assert.rejects(buildEclectic(state, gross, net.slice(1)), /authoritative net report/);
  const missing = structuredClone(gross);
  const week = weekendFixture('2026-10-31', [sourceCard('Other')], [sourceCard('Visitor')]);
  missing[0] = week.gross[0];
  await assert.rejects(buildEclectic(state, missing, net), /missing source card/);
  const duplicate = structuredClone(gross);
  const repeated = weekendFixture('2026-10-31', [sourceCard('Old Alpha'), sourceCard('Alpha')], [sourceCard('Visitor')]);
  duplicate[0] = repeated.gross[0];
  await assert.rejects(buildEclectic(state, duplicate, net), /duplicate confirmed scorecard/);
  assert.throws(() => parseGrossScorecards(gross[0].source.replace('"S.I."', '"Wrong index"')), /stroke header/);
  assert.throws(() => parseGrossScorecards(gross[0].source.replace('"","1","4","9"', '"","12","4","9"')), /12-hole structure/);
  const changed = structuredClone(net);
  changed[0].source = changed[0].source.replace('"Old Alpha","22","0"', '"Old Alpha","22","1"');
  await assert.rejects(buildEclectic(state, gross, changed), /sources disagree|allocation disagrees/);
});

test('fingerprint invalidates changed accepted cards, roster, bindings or qualifying status but ignores team holds/discards', async () => {
  const { state, gross, net } = fixture();
  const data = await buildEclectic(state, gross, net);
  for (const change of [
    state => state.rounds[0].cards[0].score++,
    state => state.teams[0].players[1] = 'Replacement',
    state => state.identityBindings[0].source = 'Different Alias',
    state => state.rounds[0].canceled = true,
    state => state.rounds[0].qualifying = false,
    state => state.rounds.push({ ...structuredClone(state.rounds[1]), date: '2026-11-14' })
  ]) {
    const changed = structuredClone(state); change(changed);
    assert.throws(() => validateEclectic(data, changed, 'mismatch'), /does not match/);
    assert.notEqual(await eclecticFingerprint(changed), data.sourceFingerprint);
  }
  const held = structuredClone(state);
  held.teams[0].heldPlayers = [];
  held.settings.discardCount = 0;
  assert.equal(await eclecticFingerprint(held), data.sourceFingerprint);
  const invalid = structuredClone(data); invalid.players[0].gross[0] = 0;
  assert.throws(() => validateEclectic(invalid, state, data.sourceFingerprint), /hole values/);
  assert.deepEqual(eclecticArguments(['--gross-file', 'Saturday.csv', '--net-file', 'Net.csv']),
    { gross: ['Saturday.csv'], net: ['Net.csv'], apply: false });
  assert.throws(() => eclecticArguments(['--gross-file']), /Missing value/);
});

test('published R1 to R4 eclectic matches verified individual oracles without changing net publication', async () => {
  const state = JSON.parse(await readFile(new URL('../data/published.json', import.meta.url), 'utf8'));
  const data = JSON.parse(await readFile(new URL('../data/eclectic.json', import.meta.url), 'utf8'));
  validateEclectic(data, state, await eclecticFingerprint(state));
  assert.equal(data.acceptedCards, 640);
  assert.deepEqual(data.coverage.map(round => round.acceptedCards), [165, 162, 165, 148]);
  for (const [field, totals] of [['gross', [49, 52, 50]], ['net', [42, 43, 40]]]) {
    const table = eclecticStandings(state, data, field);
    assert.equal(table.rows.length, 219);
    assert.equal(table.complete, 179);
    assert.equal(table.incomplete, 40);
    assert.deepEqual(['Enda Kelly', 'Ross Beacom', 'Alan Dunne'].map(player => table.rows.find(row => row.player === player).total), totals);
  }
  assert.deepEqual(eclecticStandings(state, data, 'gross').rows.filter(row => row.rank === 1).map(row => [row.player, row.total]),
    [['Barry Whelan', 43], ['Brian Sammon', 43], ['Joshua McCall', 43]]);
  assert.equal(eclecticStandings(state, data, 'net').rows[0].player, 'Mark Lester');
  assert.equal(eclecticStandings(state, data, 'net').rows[0].total, 36);
  assert.doesNotMatch(JSON.stringify(data), /handicap|OneDrive|Player A:|Strokes|Points/);
});

test('CLI preview never writes, initial apply is atomic, identical updates do not write and locks/stale targets are preserved', async () => {
  const directory = new URL(`../.test-eclectic-${randomUUID()}/`, import.meta.url);
  await mkdir(directory);
  try {
    const { state, gross, net } = fixture();
    const before = JSON.stringify(state);
    await writeFile(new URL('published.json', directory), before);
    const args = [];
    for (const [flag, files] of [['--gross-file', gross], ['--net-file', net]]) {
      for (const file of files) {
        const url = new URL(file.path, directory);
        await writeFile(url, file.source);
        args.push(flag, fileURLToPath(url));
      }
    }
    const folder = fileURLToPath(directory);
    await updateEclectic(args, folder);
    const target = new URL('eclectic.json', directory);
    await assert.rejects(readFile(target), { code: 'ENOENT' });
    await updateEclectic([...args, '--apply'], folder);
    const output = await readFile(target, 'utf8'), modified = (await stat(target)).mtimeMs;
    await updateEclectic([...args, '--apply'], folder);
    assert.equal((await stat(target)).mtimeMs, modified);
    assert.equal(await readFile(new URL('published.json', directory), 'utf8'), before);
    const targetPath = fileURLToPath(target);
    await assert.rejects(atomicPublication(targetPath, { version: 2 }, null), /changed during preview/);
    assert.equal(await readFile(target, 'utf8'), output);
    await writeFile(`${targetPath}.lock`, 'Existing reviewer lock');
    await assert.rejects(atomicPublication(targetPath, { version: 2 }, output), /holds the lock/);
    assert.equal(await readFile(`${targetPath}.lock`, 'utf8'), 'Existing reviewer lock');
    assert.equal(await readFile(target, 'utf8'), output);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('private authoritative scorecards reproduce the complete published derived file', { skip: !process.env.R4_RESULTS_DIR }, async () => {
  const root = process.env.R4_RESULTS_DIR;
  const gross = ['WL1-Competition Scorecards-AltDay.csv', 'WL1-Competition Scorecards.csv',
    'WL-Rd2-Scorecards-Updated-AltDay-Competition Scorecards.csv', 'WL-Rd2-Scorecards-Updated-Sunday-Competition Scorecards.csv',
    'WL-Rd3-Competition Scorecards-ALTDAY.csv', 'WL-Rd3-Competition Scorecards-SUNDAY.csv',
    'WL-Rd4-AltDay-Competition Scorecards.csv', 'WL-Rd4-Sunday-Competition Scorecards.csv'];
  const net = [
    'Competition Report (Aggregated Net Result) - Mens Winter League singles - R1 - Alt Day - Sunday 1 November 2026.csv',
    'UPDATEDBYRAYNOVEMBER12-Competition Report (Aggregated Net Result) - Spirit Ford - Mens Winter League Round 2 - Sunday 8 November 2026.csv',
    'Competition Report (Aggregated Net Result) - Spirit Ford - Mens Winter League Round 3 - Sunday 15 November 2026.csv',
    'Competition Report (Aggregated Net Result) - Spirit Ford - Mens Winter League - Round 4 - Sunday 22 November 2026.csv'
  ];
  const files = paths => Promise.all(paths.map(async file => ({ path: join(root, file), source: await readFile(join(root, file), 'utf8') })));
  const state = JSON.parse(await readFile(new URL('../data/published.json', import.meta.url), 'utf8'));
  const data = JSON.parse(await readFile(new URL('../data/eclectic.json', import.meta.url), 'utf8'));
  assert.deepEqual(await buildEclectic(state, await files(gross), await files(net)), data);
});
