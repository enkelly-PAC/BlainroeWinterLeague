import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cumulativeSingles, cumulativeSinglesCSV, emptyState, parseCSV } from '../core.js';
import { singlesPDFDocument, singlesPDFModel, leaderboardPDFDocument } from '../leaderboard-pdf.js';

test('cumulative Singles resolves explicit identities without team restrictions, missing zeroes or historical cards', () => {
  const state = emptyState();
  state.teams = [{ name: 'Team 1', players: ['Official One', 'Held Player', 'Third'], heldPlayers: ['Held Player'] }];
  state.identityBindings = [{ source: 'Old One', player: 'Official One' }];
  state.settings.complete = true;
  state.settings.discardCount = 1;
  const round = (date, cards, extra = {}) => ({ date, name: date, qualifying: true, canceled: false, cards, ...extra });
  state.rounds = [
    round('2026-10-31', [{ player: 'Old One', score: 10 }, { player: 'Held Player', score: 20 }, { player: 'Visitor, Zero', score: 0 }]),
    round('2026-11-07', [{ player: 'Official One', score: 10 }, { player: 'Unassigned', score: 20 }]),
    round('2026-11-14', [{ player: 'Old One', score: 99 }], { canceled: true }),
    round('2026-11-21', [{ player: 'Unassigned', score: 99 }], { qualifying: false })
  ];
  const before = structuredClone(state);
  const result = cumulativeSingles(state);
  assert.equal(result.rounds.length, 2);
  assert.deepEqual(result.rows.map(row => [row.player, row.total, row.rank]),
    [['Held Player', 20, 1], ['Official One', 20, 1], ['Unassigned', 20, 1], ['Zero Visitor', 0, 4]]);
  const csv = parseCSV(cumulativeSinglesCSV(state));
  assert.deepEqual(csv.find(row => row[1] === 'Held Player'), ['1', 'Held Player', '20', 'NA', '20']);
  assert.deepEqual(csv.find(row => row[1] === 'Zero Visitor'), ['4', 'Zero Visitor', '0', 'NA', '0']);
  const document = singlesPDFDocument(state, { mode: 'draft', saved: false }, 'logo');
  assert.deepEqual(document.content.find(node => node.table).table.body.slice(1).map(row => row.map(cell => cell.text)), csv.slice(1));
  assert.match(document.info.subject, /DRAFT: not saved/);
  assert.match(JSON.stringify(document.footer(1, 1)), /DRAFT/);
  assert.throws(() => singlesPDFModel(state, { selectedDate: '2026-11-14' }), /Historical weekends/);
  assert.deepEqual(state, before);
});

test('current cumulative Singles contains all 197 players, with 130 both-weekend cards and honest held scores', async () => {
  const state = JSON.parse(await readFile(new URL('../data/published.json', import.meta.url), 'utf8'));
  const { rows } = cumulativeSingles(state);
  assert.equal(rows.length, 197);
  assert.equal(rows.filter(row => Object.keys(row.scores).length === 2).length, 130);
  assert.equal(rows.find(row => row.player === 'Colin Owens').total, 32);
  assert.equal(rows.flatMap(row => Object.values(row.scores)).length, 327);
  assert.equal(parseCSV(cumulativeSinglesCSV(state)).length, 198);
});

test('member integrated PDF repeats named identities and Combined before bounded weekend columns', async () => {
  const state = JSON.parse(await readFile(new URL('../data/published.json', import.meta.url), 'utf8'));
  const document = leaderboardPDFDocument(state, { format: 'detail', audience: 'members' });
  const table = document.content.find(node => node.table).table;
  assert.deepEqual(table.body[1].slice(0, 6).map(cell => cell.text),
    ['Pos.', 'Team', 'Player 1', 'Player 2', 'Player 3', 'Combined']);
  assert.equal(table.widths.length, 14);
  assert.ok(table.body.every(row => row.length === 14));
  assert.equal(table.body[2][5].text, '99');
  assert.equal(table.body[2][1].text, 'Team 7');
  assert.equal(table.headerRows, 2);
  assert.equal(document.pageOrientation, 'landscape');
  assert.doesNotMatch(JSON.stringify(document.footer(1, 2)), /DRAFT|PUBLISHED|Provisional/);
});

test('long-season Singles PDFs bound portrait weekend groups and repeat identities and overall totals', () => {
  const state = emptyState();
  state.rounds = Array.from({ length: 8 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 9, 31 + index * 7)).toISOString().slice(0, 10);
    return { date, name: date, qualifying: true, canceled: false, cards: [{ player: 'Visitor', score: index }] };
  });
  const document = singlesPDFDocument(state);
  const tables = document.content.filter(node => node.table).map(node => node.table);
  assert.equal(document.pageOrientation, 'portrait');
  assert.equal(tables.length, 3);
  assert.ok(tables.every(table => table.widths.length <= 6 && table.headerRows === 1 && table.dontBreakRows));
  assert.deepEqual(tables.map(table => [table.body[1][1].text, table.body[1].at(-1).text]),
    [['Visitor', '28'], ['Visitor', '28'], ['Visitor', '28']]);
});
