import test from 'node:test';
import assert from 'node:assert/strict';
import { cumulativeSingles, cumulativeSinglesCSV, emptyState, parseCSV } from '../core.js';
import { singlesPDFDocument, singlesPDFModel, leaderboardPDFDocument } from '../leaderboard-pdf.js';
import { publicationThrough } from './publication-fixture.js';

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

test('first two weekends contain all 197 Singles players, with 130 both-weekend cards and honest held scores', async () => {
  const state = await publicationThrough('2026-11-07');
  const { rows } = cumulativeSingles(state);
  assert.equal(rows.length, 197);
  assert.equal(rows.filter(row => Object.keys(row.scores).length === 2).length, 130);
  assert.equal(rows.find(row => row.player === 'Colin Owens').total, 32);
  assert.equal(rows.flatMap(row => Object.values(row.scores)).length, 327);
  assert.equal(parseCSV(cumulativeSinglesCSV(state)).length, 198);
});

test('member integrated PDF keeps named identities and Overall before bounded weekend columns', async () => {
  const state = await publicationThrough('2026-11-07');
  const document = leaderboardPDFDocument(state, { format: 'detail', audience: 'members' });
  const table = document.content.find(node => node.table).table;
  assert.deepEqual(table.body[1].slice(0, 6).map(cell => cell.text),
    ['Pos.', 'Team', 'Player 1', 'Player 2', 'Player 3', 'Overall']);
  assert.equal(table.widths.length, 14);
  assert.ok(table.body.every(row => row.length === 14));
  assert.equal(table.body[2][5].text, '99');
  assert.equal(table.body[2][1].text, 'Team 7');
  assert.equal(table.headerRows, 2);
  assert.equal(document.pageOrientation, 'landscape');
  assert.doesNotMatch(JSON.stringify(document.footer(1, 2)), /DRAFT|PUBLISHED/);
  assert.match(JSON.stringify(document.footer(1, 2)), /Provisional top 16/);
});

test('Singles PDFs retain existing widths for up to three weekends and preserve the fifth weekend in a new panel', () => {
  const state = emptyState();
  state.rounds = Array.from({ length: 5 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 9, 31 + index * 7)).toISOString().slice(0, 10);
    return { date, name: date, qualifying: true, canceled: false, cards: [{ player: 'Visitor', score: index }] };
  });
  for (let count = 1; count <= 3; count++) {
    const document = singlesPDFDocument({ ...state, rounds: state.rounds.slice(0, count) });
    const tables = document.content.filter(node => node.table).map(node => node.table);
    assert.equal(tables.length, 1);
    assert.deepEqual(tables[0].widths, [30, '*', ...Array(count).fill(75), 70]);
  }
  const document = singlesPDFDocument(state);
  const tables = document.content.filter(node => node.table).map(node => node.table);
  assert.equal(tables.length, 2);
  assert.deepEqual(tables.map(table => table.widths), [[30, '*', 65, 65, 65, 65, 70], [30, '*', 75, 70]]);
  assert.deepEqual(tables.map(table => table.body[0].map(cell => cell.text)),
    [['Pos.', 'Player', '31 Oct 2026', '7 Nov 2026', '14 Nov 2026', '21 Nov 2026', 'Overall total'],
      ['Pos.', 'Player', '28 Nov 2026', 'Overall total']]);
  assert.deepEqual(tables.map(table => table.body[1].map(cell => cell.text)),
    [['1', 'Visitor', '0', '1', '2', '3', '10'], ['1', 'Visitor', '4', '10']]);
  assert.equal(document.content.filter(node => node.pageBreak === 'before').length, 1);
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
  assert.equal(tables.length, 2);
  assert.ok(tables.every(table => table.widths.length === 7 && table.headerRows === 1 && table.dontBreakRows));
  assert.deepEqual(tables.map(table => [table.body[1][1].text, table.body[1].at(-1).text]),
    [['Visitor', '28'], ['Visitor', '28']]);
  assert.deepEqual(tables.flatMap(table => table.body[1].slice(2, -1).map(cell => cell.text)),
    ['0', '1', '2', '3', '4', '5', '6', '7']);
});
