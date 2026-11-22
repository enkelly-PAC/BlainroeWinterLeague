import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import vm from 'node:vm';
import { assignments, canonical, cumulativeSingles, league, leagueMovement, parseCSV, parseJSON, parseScores, playerKey } from '../core.js';
import { memberUpdate } from '../member-update.js';
import { createLeaderboardPDF, createSinglesPDF, leaderboardPDFDocument, singlesPDFDocument } from '../leaderboard-pdf.js';
import { weekendCards } from '../leaderboard-layout.js';
import { buildUpdate } from '../tools/update-results.mjs';

const publication = () => readFile(new URL('../data/published.json', import.meta.url), 'utf8').then(parseJSON);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const aggregateName = 'Competition Report (Aggregated Net Result) - Spirit Ford - Mens Winter League - Round 4 - Sunday 22 November 2026.csv';

function syntheticSeason(state, count) {
  const season = structuredClone(state);
  while (season.rounds.length < count) {
    const date = new Date(Date.UTC(2026, 9, 31 + season.rounds.length * 7)).toISOString().slice(0, 10);
    season.rounds.push({ ...structuredClone(state.rounds.at(-1)), date, name: `Synthetic weekend ${date}`,
      qualifying: season.rounds.length < season.settings.maxRounds });
  }
  season.rounds = season.rounds.slice(0, count);
  return season;
}

test('final R4 extends immutable R1 to R3 cards, roster, approved identities and settings', async () => {
  const state = await publication();
  assert.deepEqual(state.rounds.map(round => [round.date, round.cards.length]),
    [['2026-10-31', 165], ['2026-11-07', 162], ['2026-11-14', 165], ['2026-11-21', 148]]);
  assert.deepEqual(state.rounds.slice(0, 3).map(digest), [
    'c854a9d036f65343a6506c38b446f948db0f3a7a07bfbcb30e5e25a6f05d6e18',
    '3d62a98c8daa6e3ad5aa449ce4a92a96ddbc78f1145e7a427f38ba6ef66a282a',
    'ccc3ffc34e78d805377e722722db4dfc3f0371fd6fe210513ce5601ecd26a84c'
  ]);
  assert.equal(digest(state.teams), 'bcc70d343a705af9b156fa996eddc7a90383ce1c9f62f857ced04f0e761dfff0');
  assert.equal(digest(state.identityBindings), 'b5e38443a8858dd9e1689faf005a045a709f3bd91956a26c0278c13df04a203f');
  assert.equal(digest(state.settings), '9f00808a41d3bd94b4385720c460f22a1afcf704b37448178259e2906a422e61');
  assert.equal(digest(state.rounds.at(-1).cards), '808b37697e9b5ad607b1840fe05e4a9b885b0d397b7ac3c3c88dde17c108d308');
  assert.equal(state.final, null);
  const keys = state.rounds.at(-1).cards.map(card => playerKey(card.player, state.identityBindings));
  assert.equal(new Set(keys).size, 148);
  const assigned = assignments(state.teams, state.identityBindings);
  assert.equal(state.rounds.at(-1).cards.filter(card => assigned.has(canonical(card.player))).length, 116);
  assert.ok(league(state).rows.every(row => row.raw === row.retained && row.discarded.length === 0));
  assert.equal(cumulativeSingles(state).rows.length, 219);
});

test('final R4 Team 19 and Singles totals use all four weekends and genuine R3 competition-rank movement', async () => {
  const state = await publication(), before = structuredClone(state);
  before.rounds.pop();
  const baseline = { schemaVersion: 1, through: '2026-11-14', state: before, teams: league(before).rows };
  const update = memberUpdate(state, { baseline });
  const row = update.result.rows.find(row => row.team.name === 'Team 19');
  assert.deepEqual(row.scores.map(score => score.total), [44, 39, 43, 42]);
  assert.equal(row.retained, 168);
  assert.equal(row.rank, 17);
  assert.deepEqual(weekendCards(row.team, state.rounds.at(-1), state.identityBindings).map(card => [card.score, card.counting]),
    [[20, true], [22, true], [20, false]]);
  const movement = update.movement.find(row => row.team.name === 'Team 19');
  assert.equal(movement.previous, 15);
  assert.equal(movement.change, -2);
  assert.deepEqual(leagueMovement(state).rows.find(row => row.team === 'Team 19'),
    { team: 'Team 19', previousRank: 15, places: -2 });
  assert.match(update.html, /Weekend 4: 21 November 2026 and 22 November 2026/);
  assert.match(update.html, /Movement from Weekend 3 to Weekend 4/);
  assert.match(update.html, /Team 28 \([^)]*\) leads on 193 points/);
  assert.doesNotMatch(update.html, /[\u2013\u2014]/u);
  for (const [player, total, rank] of [['Enda Kelly', 86, 22], ['Ross Beacom', 79, 43], ['Alan Dunne', 71, 73]]) {
    const single = cumulativeSingles(state).rows.find(row => row.player === player);
    assert.equal(single.total, total);
    assert.equal(single.rank, rank);
  }
  assert.deepEqual(baseline.state, before);
});

test('actual four-round member PDFs retain the A3 Team grid and show every Singles weekend together', async () => {
  const state = await publication();
  const team = leaderboardPDFDocument(state, { audience: 'members', format: 'detail' });
  const grid = team.content.find(block => block.table).table;
  assert.equal(team.pageSize, 'A3');
  assert.equal(team.pageOrientation, 'landscape');
  assert.equal(grid.body.length, 48);
  assert.equal(grid.widths.length, 22);
  assert.ok(grid.widths.slice(2, 5).every(width => width >= 90 && width <= 110 && width < 212.85 / 2));
  assert.deepEqual(grid.widths.slice(6, 10), [20, 20, 20, 27]);
  assert.ok(grid.body.every(row => row.length === 22));
  assert.deepEqual(grid.body[0].filter(cell => cell.colSpan).map(cell => cell.text),
    ['Round 1\n31 Oct', 'Round 2\n7 Nov', 'Round 3\n14 Nov', 'Round 4\n21 Nov']);
  const team19 = grid.body.find(row => row[1]?.text === 'Team 19');
  assert.equal(team19[0].text, '17 -2');
  assert.equal(team19[5].text, '168');
  assert.deepEqual(team19.slice(-4).map(cell => cell.text), ['20', '22', '20', '42']);
  for (const row of league(state).rows) {
    const printed = grid.body.find(cells => cells[1]?.text === row.team.name);
    assert.equal(Number(printed[5].text), row.retained);
    state.rounds.forEach((round, index) => {
      assert.deepEqual(printed.slice(6 + index * 4, 9 + index * 4).map(cell => cell.text),
        weekendCards(row.team, round, state.identityBindings).map(card => card.held ? 'NA' : card.text));
      assert.equal(printed[9 + index * 4].text, String(row.scores[index].total));
    });
  }
  const singles = singlesPDFDocument(state);
  const tables = singles.content.filter(block => block.table).map(block => block.table);
  assert.equal(singles.pageSize, 'A4');
  assert.equal(singles.pageOrientation, 'portrait');
  assert.equal(tables.length, 1);
  assert.equal(singles.content.some(block => block.pageBreak), false);
  assert.deepEqual(tables[0].widths, [30, '*', 65, 65, 65, 65, 70]);
  assert.deepEqual(tables.map(table => table.body[0].map(cell => cell.text)),
    [['Pos.', 'Player', '31 Oct 2026', '7 Nov 2026', '14 Nov 2026', '21 Nov 2026', 'Overall total']]);
  assert.ok(tables.every(table => table.body.length === 220));
  assert.deepEqual(tables.map(table => table.body.find(row => row[1].text === 'Enda Kelly').map(cell => cell.text)),
    [['22', 'Enda Kelly', '22', '22', '22', '20', '86']]);
  const result = cumulativeSingles(state);
  assert.deepEqual(tables[0].body.slice(1).map(row => row.map(cell => cell.text.replace(/\u200b/gu, ''))),
    result.rows.map(row => [row.rank, row.player, ...result.rounds.map(round => row.scores[round.date] ?? 'NA'), row.total].map(String)));
});

test('integrated Team PDF preserves three-round A4 widths and all ten-round or overflow weekend columns', async () => {
  const state = await publication(), before = structuredClone(state);
  const a4 = leaderboardPDFDocument(syntheticSeason(state, 3), { audience: 'members' });
  assert.equal(a4.pageSize, 'A4');
  assert.equal(a4.pageOrientation, 'landscape');
  const a4Grid = a4.content[0].table;
  const originalNameWidth = (841.89 - 40 - 40 - 34 - 44 - 3 * 87 - 18 * 2 - 4 * 0.8) / 3;
  assert.ok(a4Grid.widths.slice(2, 5).every(width => Math.abs(width - originalNameWidth) < 1e-10));
  assert.deepEqual(a4Grid.widths.slice(6), Array(3).fill([20, 20, 20, 27]).flat());
  for (const count of [10, 11]) {
    const season = syntheticSeason(state, count);
    const document = leaderboardPDFDocument(season, { audience: 'members' });
    const grids = document.content.filter(block => block.table);
    assert.equal(document.pageSize, 'A3');
    assert.equal(grids.length, Math.ceil(count / 10));
    assert.deepEqual(grids.map(block => block.table.widths.length), count === 10 ? [46] : [46, 10]);
    assert.equal(grids.filter(block => block.pageBreak === 'before').length, grids.length - 1);
    assert.deepEqual(grids.flatMap(block => block.table.body[0].filter(cell => cell.colSpan).map(cell => cell.text)),
      season.rounds.map((round, index) => `Round ${index + 1}\n${new Date(`${round.date}T12:00:00Z`).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', timeZone: 'UTC'
      })}${round.qualifying ? '' : ' (X)'}`));
    const results = league(season).rows;
    for (const block of grids) {
      const { table, layout } = block;
      const width = table.widths.reduce((sum, width) => sum + width, 0) +
        table.widths.length * 2 + ((table.widths.length - 6) / 4 + 1) * 0.8;
      assert.ok(width <= 1190.55 - 40 + 1e-8);
      assert.ok(table.body.every(row => row.length === table.widths.length));
      assert.deepEqual(table.body[1].slice(6).map(cell => cell.text),
        Array((table.widths.length - 6) / 4).fill(['P1', 'P2', 'P3', 'Team']).flat());
      assert.deepEqual(table.body.slice(2).map(row => [row[1].text, row[5].text]),
        results.map(row => [row.team.name, String(row.retained)]));
      assert.equal(layout.paddingTop(), 0.2);
    }
    for (const row of results) {
      const printedScores = grids.flatMap(block =>
        block.table.body.find(cells => cells[1]?.text === row.team.name).slice(6).map(cell => cell.text));
      assert.deepEqual(printedScores, season.rounds.flatMap((round, index) => [
        ...weekendCards(row.team, round, season.identityBindings).map(card => card.held ? 'NA' : card.text),
        round.qualifying ? String(row.scores[index].total) : 'X'
      ]));
    }
  }
  assert.deepEqual(state, before);
});

test('final R4 produces real branded member Team and cumulative Singles PDF buffers', async t => {
  const state = await publication();
  const sandbox = { setTimeout, clearTimeout, console, navigator: { userAgent: 'Node PDF verification' } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const path of ['pdfmake.min.js', 'vfs_fonts.js'])
    vm.runInContext(await readFile(new URL(`../vendor/${path}`, import.meta.url), 'utf8'), sandbox);
  const original = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  globalThis.window = { pdfMake: sandbox.pdfMake };
  globalThis.document = { createElement: () => ({}), head: { append: script => queueMicrotask(() => script.onload()) } };
  const logo = await readFile(new URL('../blainroe-anni-logo.png', import.meta.url));
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => logo.buffer.slice(logo.byteOffset, logo.byteOffset + logo.byteLength) });
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  for (const [count, expectedPages] of [[3, 1], [4, 1], [10, 1], [11, 2]]) {
    const definition = leaderboardPDFDocument(syntheticSeason(state, count), { audience: 'members' });
    const pages = await new Promise(resolve => sandbox.pdfMake.createPdf(definition)._getPages({}, resolve));
    assert.equal(pages.length, expectedPages, `${count} Team weekends`);
    for (const block of definition.content.filter(block => block.table)) {
      const grid = block.table;
      for (const row of grid.body.slice(1)) {
        row.forEach((cell, index) => {
          assert.ok(cell._maxWidth <= grid.widths[index].width + 1e-8,
            `${count} weekends: ${cell.text} must fit its column without wrapping`);
        });
      }
      grid.body[0].forEach((cell, index) => {
        if (cell.colSpan) assert.ok(cell._maxWidth <=
          grid.widths.slice(index, index + 4).reduce((sum, width) => sum + width.width + 2, 0));
      });
    }
    for (const page of pages) {
      const lines = page.items.filter(item => item.type === 'line').map(item => item.item);
      assert.ok(lines.every(line => line.x >= 20 - 1e-8 && line.x + line.getWidth() <= page.pageSize.width - 20 + 1e-8),
        `${count} weekends: rendered text must stay inside page margins`);
    }
  }
  for (const [result, pages, through] of [
    [await createLeaderboardPDF(state, { audience: 'members', format: 'detail' }), 1, '2026-11-21'],
    [await createLeaderboardPDF(syntheticSeason(state, 10), { audience: 'members', format: 'detail' }), 1, '2027-01-02'],
    [await createSinglesPDF(state, {}), 5, '2026-11-21']
  ]) {
    const buffer = Buffer.from(result.buffer), raw = buffer.toString('latin1');
    assert.equal(buffer.subarray(0, 8).toString(), '%PDF-1.3');
    assert.match(raw, /%%EOF\s*$/);
    assert.match(raw, /\/Subtype \/Image/);
    assert.match(raw, /\/FontFile2/);
    assert.equal((raw.match(/\/Type \/Page\b/g) || []).length, pages);
    assert.ok(result.filename.endsWith(`${through}.pdf`));
    if (process.env.R4_VERIFY_PDFS && through === '2026-11-21') {
      await mkdir(process.env.R4_VERIFY_PDFS, { recursive: true });
      await writeFile(join(process.env.R4_VERIFY_PDFS, result.filename), buffer, { flag: 'wx' });
    }
  }
});

test('private final R4 aggregate reconciles both day summaries, detailed net points, DQs and scoring analyses', {
  skip: !process.env.R4_RESULTS_DIR && 'Set R4_RESULTS_DIR to the private Results folder to verify source evidence.'
}, async () => {
  const read = name => readFile(join(process.env.R4_RESULTS_DIR, name), 'utf8');
  const source = await read(aggregateName), rows = parseCSV(source), parsed = parseScores(source);
  const records = rows.filter(row => /^(?:\d+|-)$/.test(row[0]) && row[1]);
  assert.equal(records.length, 153);
  assert.equal(new Set(records.map(row => canonical(row[1]))).size, 153);
  assert.deepEqual(parsed.omitted, { noReturn: 4, disqualified: 1 });
  const dq = records.filter(row => row.some(cell => /^DQ\b/.test(cell)));
  assert.deepEqual(dq.map(row => row[1]).sort(),
    ['Beausang, Paul', 'Gleeson, Kenneth', 'Kavanagh, Darragh', 'Kennelly, Patrick', 'Lawlor, Martin']);
  assert.ok(dq.every(row => !parsed.cards.some(card => canonical(card.player) === canonical(row[1]))));
  assert.equal(rows.filter(row => row[0] === '1' && row[1]).length, 1);
  assert.match(rows.find(row => /^Number of Cards Processed/.test(row[0]))[0], /= 153.*Division 1 = 37, Division 2 = 40, Division 3 = 37, Division 4 = 38/);
  const allSummaries = [];
  for (const [prefix, analysisName, count, accepted, analysedHoles] of [
    ['WL-Rd4-AltDay', 'WL-Rd4-AltDay-Competition Scoring Analysis.csv', 62, 60, 732],
    ['WL-Rd4-Sunday', 'WL-Rd4-Competition Scoring Analysis.csv', 91, 88, 1056]
  ]) {
    const day = parseCSV(await read(`${prefix}-Competition Scorecards.csv`));
    const start = day.findIndex(row => row[0] === 'Player(s)') + 1;
    const end = day.findIndex((row, index) => index >= start && row[0] === 'Competition Scorecard');
    const summary = day.slice(start, end);
    assert.equal(summary.length, count);
    allSummaries.push(...summary);
    assert.equal(summary.filter(row => parsed.cards.some(card => canonical(card.player) === canonical(row[0]))).length, accepted);
    let player;
    const details = [];
    for (const row of day.slice(end)) {
      if (row[1] === 'Player A:') player = row[2];
      if (row[1] === 'TOTAL') details.push({ player, points: Number(row[5]) });
    }
    assert.equal(details.length, count);
    assert.deepEqual(details.map(card => canonical(card.player)).sort(), summary.map(row => canonical(row[0])).sort());
    for (const detail of details) {
      const card = parsed.cards.find(card => canonical(card.player) === canonical(detail.player));
      if (card) assert.equal(detail.points, card.score, detail.player);
    }
    const analysis = parseCSV(await read(analysisName));
    assert.ok(analysis.some(row => row[0].includes(analysedHoles.toLocaleString('en-GB') + ' holes played')));
    const holes = analysis.filter(row => /^\d+$/.test(row[0]));
    assert.deepEqual(holes.map(row => Number(row[0])), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 15]);
    assert.ok(holes.every(row => row.slice(2, 11).reduce((total, value) => total + Number(value), 0) === analysedHoles / 12));
  }
  assert.equal(new Set(allSummaries.map(row => canonical(row[0]))).size, 153);
  assert.deepEqual(allSummaries.map(row => canonical(row[0])).sort(), records.map(row => canonical(row[1])).sort());
  const state = await publication(), previous = structuredClone(state);
  previous.rounds.pop();
  const result = buildUpdate(previous, [{ path: aggregateName, source }], { confirmNet: true });
  assert.deepEqual(result.state, state);
  assert.deepEqual([result.matched, result.unmatched, result.held], [116, 32, 0]);
  assert.deepEqual(buildUpdate(state, [{ path: aggregateName, source }], { confirmNet: true }).state, state);
  // The publication baseline has no holds; separately exercise the existing held-card safeguard.
  const held = structuredClone(previous);
  held.teams.find(team => team.name === 'Team 37').heldPlayers = ['Colin Owens'];
  const imported = buildUpdate(held, [{ path: aggregateName, source }], { confirmNet: true });
  assert.deepEqual(imported.state.teams, held.teams);
  assert.deepEqual(imported.state.rounds.slice(0, 3), held.rounds);
  assert.equal(imported.held, 1);
  assert.equal(weekendCards(imported.state.teams.find(team => team.name === 'Team 37'),
    imported.state.rounds.at(-1), imported.state.identityBindings)[1].counting, false);
});
