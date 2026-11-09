import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { emptyState, escapeHTML, league, singles, parseCSV } from '../core.js';
import { memberUpdate } from '../member-update.js';
import { leaderboardPDFDocument, leaderboardPDFModel } from '../leaderboard-pdf.js';
import { weekendCards } from '../leaderboard-layout.js';

test('Weekend 1 newsletter is prose only, with complete tables as separate clean exports', async () => {
  const state = JSON.parse(await readFile(new URL('../data/published.json', import.meta.url), 'utf8'));
  state.rounds = state.rounds.filter(round => round.date === '2026-10-31');
  const before = structuredClone(state);
  const update = memberUpdate(state, { mode: 'draft', saved: false, pendingDate: '2026-11-07' });
  assert.equal(update.through, '2026-10-31');
  assert.deepEqual(update.result, league(state));
  assert.deepEqual(update.individual.rows, singles(state).rows);
  assert.equal(parseCSV(update.teamCSV).length, 47);
  assert.equal(parseCSV(update.singlesCSV).length, 166);
  assert.match(update.status, /Unsaved local draft, not published/);
  assert.equal(update.pendingDate, '2026-11-07');
  assert.match(update.html, /Team 15 \([^)]*\) and Team 27 \([^)]*\) share the lead on 49/);
  assert.match(update.html, /Team 11 \([^)]*\), Team 13 \([^)]*\) and Team 7 \([^)]*\) are 1 point behind on 48/);
  assert.match(update.html, /Michael Neiland sets the pace in Singles with 29/);
  assert.match(update.html, /Michael Geraghty Jnr, Colm Lynch and David Woods follow on 27/);
  assert.match(update.html, /Dominic O&#39;Malley \(26\) and Gerard O&#39;Malley \(23\)/);
  assert.match(update.html, /Michael Neiland \(29\) and Joe Neiland \(20\)/);
  assert.doesNotMatch(update.html, /<table|Weekend 2|7 November|moved|climbed|roster|DRAFT|provisional|pending|import|committee|held|unmatched|countback|not sent|not published/i);
  for (const content of [update.teamCSV, update.singlesCSV])
    assert.doesNotMatch(content, /DRAFT|pending|review|assignment|Unassigned|held/i);
  assert.equal(parseCSV(update.singlesCSV).find(row => row[1] === 'Colin Owens')[3], '15');
  assert.doesNotMatch(update.html, /[\u2013\u2014]/u);
  assert.deepEqual(state, before);
});
test('member exports with no results fail explicitly, without inventing ranks or winners', () => {
  const state = emptyState();
  state.teams = [{ name: 'Team 1', players: ['Synthetic One', 'Synthetic Two', 'Synthetic Three'] }];
  assert.throws(() => memberUpdate(state), /require qualifying results/);
});
test('combined update preserves both weekends and calculates genuine fixed-roster movement', async () => {
  const state = JSON.parse(await readFile(new URL('../data/published.json', import.meta.url), 'utf8'));
  const first = structuredClone(state);
  first.rounds = first.rounds.filter(round => round.date === '2026-10-31');
  const baseline = { schemaVersion: 1, through: '2026-10-31', state: first, teams: league(first).rows };
  const before = structuredClone(baseline);
  const update = memberUpdate(state, { baseline });
  assert.ok(update.html.indexOf('Weekend 1:') < update.html.indexOf('Weekend 2:'));
  assert.ok(update.html.indexOf('Weekend 2:') < update.html.indexOf('Movement from Weekend 1 to Weekend 2'));
  assert.match(update.html, /Team 15 \([^)]*\) and Team 27 \([^)]*\) share the lead on 49/);
  assert.match(update.html, /Team 7 \([^)]*\) leads on 99/);
  assert.match(update.html, /Team 28 \([^)]*\) posted the weekend&#39;s highest team total of 54/);
  assert.match(update.html, /J\. C\. Doyle and Pat Sheehy set the pace in Singles with 28/);
  assert.match(update.html, /Team 7 \([^)]*\) moved from joint third to first/);
  assert.match(update.html, /Team 5 \([^)]*\), up 14 places from joint 40th to joint 26th/);
  for (const mention of update.html.matchAll(/Team \d+/g)) {
    const team = state.teams.find(team => team.name === mention[0]);
    const label = escapeHTML(`${team.name} (${team.players.join(', ')})`);
    assert.equal(update.html.slice(mention.index, mention.index + label.length), label);
  }
  for (const format of ['standings', 'latest', 'detail']) {
    const document = leaderboardPDFDocument(state, { format, audience: 'members' });
    if (format === 'detail') {
      const table = document.content.find(block => block.table).table;
      assert.deepEqual(table.body.slice(table.headerRows).map(row => row.slice(1, 5).map(cell => cell.text)),
        update.result.rows.map(row => [row.team.name, ...row.team.players]));
      continue;
    }
    const labels = document.content.filter(block => block.table).flatMap(block =>
      block.table.body.flat().filter(cell => typeof cell.text === 'string' && /^Team \d+ /.test(cell.text))
        .map(cell => cell.text.replace(/\u200b/g, '')));
    assert.deepEqual(labels, update.result.rows.map(row => `${row.team.name} (${row.team.players.join(', ')})`));
  }
  assert.equal(update.movement.find(row => row.team.name === 'Team 1').change, 8);
  assert.equal(update.movement.find(row => row.team.name === 'Team 15').change, -7);
  assert.equal(parseCSV(update.singlesCSV).length, 197);
  assert.equal(parseCSV(update.teamCSV).length, 47);
  assert.doesNotMatch(update.html, /<table|draft|pending|roster|import|held|committee|[\u2013\u2014]/i);
  assert.deepEqual(baseline, before);
  const changed = structuredClone(state);
  changed.teams[0].players[1] = 'Synthetic roster change';
  assert.throws(() => memberUpdate(changed, { baseline }), /differ from the comparison baseline/);
  const corrupt = structuredClone(baseline);
  corrupt.teams[0].retained++;
  assert.throws(() => memberUpdate(state, { baseline: corrupt }), /standings disagree/);
  assert.throws(() => memberUpdate(state, { baseline: { ...baseline, through: '2026-10-24' } }), /preceding weekend/);
  assert.throws(() => memberUpdate(state, { insights: [{ date: '2026-11-07', text: 'Synthetic insight' }] }), /source provenance/);
  const escaped = memberUpdate(state, { insights: [{ date: '2026-11-07', text: '<script>Synthetic</script>', source: 'Internal source' }] });
  assert.match(escaped.html, /&lt;script&gt;Synthetic&lt;\/script&gt;/);
  assert.doesNotMatch(escaped.html, /Internal source/);
  const unmatched = structuredClone(state);
  unmatched.rounds[0].cards = [{ player: 'Synthetic unmatched player', score: 20, handicap: 1 }];
  assert.throws(() => memberUpdate(unmatched), /2026-10-31 has no qualifying results matched to a team/);
  const tied = structuredClone(state);
  tied.rounds[0].cards.forEach(card => { card.score = 0; });
  const splittingTies = memberUpdate(tied);
  assert.ok(splittingTies.movement.every(row => row.change <= 0));
  assert.doesNotMatch(splittingTies.html, /kept the same positions/);
  assert.match(splittingTies.html, /positions changed elsewhere/);
});
test('newer cancelled, excluded and empty imports are explicit, not silently replaced by older Singles', () => {
  for (const flags of [{ canceled: true, qualifying: true }, { canceled: false, qualifying: false }, { canceled: false, qualifying: true }]) {
    const state = emptyState();
    state.teams = [{ name: 'Team 1', players: ['Synthetic One', 'Synthetic Two', 'Synthetic Three'] }];
    state.rounds = [
      { date: '2026-10-31', name: 'First', qualifying: true, canceled: false, cards: [{ player: 'Synthetic One', score: 20 }] },
      { date: '2026-11-07', name: 'Latest', ...flags, cards: [] }
    ];
    assert.throws(() => memberUpdate(state), /latest weekend has no active qualifying results/);
    if (flags.canceled || !flags.qualifying) {
      state.rounds[1].cards = [{ player: 'Synthetic One', score: 25 }];
      assert.throws(() => memberUpdate(state), /latest weekend has no active qualifying results/);
    }
  }
});
test('member draft validates pending status and escapes user-controlled names', () => {
  const state = emptyState();
  state.teams = [{ name: '<script>Team</script>', players: ['<b>One</b>', 'Two', 'Three'] }];
  state.rounds = [{ date: '2026-10-31', name: 'First', qualifying: true, canceled: false, cards: [{ player: '<b>One</b>', score: 0 }] }];
  const update = memberUpdate(state, { mode: 'draft', saved: true });
  assert.match(update.status, /Saved local draft, not published/);
  assert.match(update.html, /&lt;script&gt;/);
  assert.doesNotMatch(update.html, /<script>|<b>One/);
  assert.throws(() => memberUpdate(state, { mode: 'unknown' }), /Unknown/);
  assert.throws(() => memberUpdate(state, { pendingDate: '2026-10-31' }), /already has/);
  assert.throws(() => memberUpdate(state, { pendingDate: '2026-11-08' }), /Saturday/);
  assert.throws(() => memberUpdate(state, { pendingDate: '2026-10-24' }), /precedes newer/);
});
test('member preparation CLI writes a review bundle, preserves the publication and refuses overwrite', async t => {
  const output = await mkdtemp(join(tmpdir(), 'blainroe-member-review-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const script = fileURLToPath(new URL('../tools/prepare-member-update.mjs', import.meta.url));
  const source = new URL('../data/published.json', import.meta.url);
  const before = await readFile(source, 'utf8');
  const args = [script, '--out', output, '--pending-weekend', '2026-11-14'];
  const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  assert.equal((await readdir(output)).length, 4);
  const htmlPath = join(output, 'blainroe-member-update-draft-2026-11-07.html');
  const draft = await readFile(htmlPath, 'utf8');
  assert.doesNotMatch(draft, /<table|pending|draft|not published/i);
  const baselinePath = join(output, 'blainroe-comparison-baseline-2026-11-07.json');
  const baselineContent = await readFile(baselinePath, 'utf8');
  const baseline = JSON.parse(baselineContent);
  assert.equal(baseline.through, '2026-11-07');
  assert.equal(baseline.sourceSHA256, createHash('sha256').update(before).digest('hex'));
  assert.deepEqual(baseline.state.rounds, JSON.parse(before).rounds);
  assert.deepEqual(baseline.teams, league(baseline.state).rows);
  assert.equal(baseline.teams.find(row => row.team.name === 'Team 34').scores[0].total, 42);
  assert.equal(baseline.teams.find(row => row.team.name === 'Team 21').scores[0].total, 41);
  const repeated = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(repeated.status, 1);
  assert.match(repeated.stderr, /EEXIST/);
  assert.equal(await readFile(htmlPath, 'utf8'), draft);
  assert.equal(await readFile(baselinePath, 'utf8'), baselineContent);
  assert.equal(await readFile(source, 'utf8'), before);
});
test('member PDFs remove presentation disclaimers without changing ranks, scores or review defaults', async () => {
  const state = JSON.parse(await readFile(new URL('../data/published.json', import.meta.url), 'utf8'));
  for (const format of ['standings', 'latest', 'detail']) {
    const model = leaderboardPDFModel(state, { mode: 'draft', format, audience: 'members' });
    assert.deepEqual(model.result, league(state));
    const document = leaderboardPDFDocument(state, { mode: 'draft', format, audience: 'members' });
    const visible = JSON.stringify([document.content, document.header(), document.footer(1, 2), document.info]);
    assert.doesNotMatch(visible, /DRAFT|PUBLISHED|Provisional|Generated|held|15 H|NA H/i);
    assert.match(JSON.stringify(leaderboardPDFDocument(state, { mode: 'draft', format }).footer(1, 2)), /DRAFT/);
  }
  assert.throws(() => leaderboardPDFModel(state, { audience: 'unknown' }), /Unknown PDF audience/);
  const noResults = structuredClone(state);
  noResults.rounds = [];
  assert.throws(() => leaderboardPDFModel(noResults, { audience: 'members' }), /needs qualifying results/);
});
test('member preparation CLI validates pending weekend before writing files', async t => {
  const output = await mkdtemp(join(tmpdir(), 'blainroe-invalid-review-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const script = fileURLToPath(new URL('../tools/prepare-member-update.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--out', output, '--pending-weekend', '2026-10-31'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /already has an imported round/);
  assert.deepEqual(await readdir(output), []);
});
test('PDF headers separate the logo and counting cards are bold dark green', async () => {
  const state = JSON.parse(await readFile(new URL('../data/published.json', import.meta.url), 'utf8'));
  const before = structuredClone(state);
  for (const audience of ['members', 'review']) {
    for (const format of ['latest', 'detail']) {
      const context = { format, audience };
      const model = leaderboardPDFModel(state, context);
      const document = leaderboardPDFDocument(state, context, 'club-logo');
      const header = document.header().stack[0];
      assert.equal(header.columnGap, 28);
      assert.equal(header.columns[0].width, 82);
      assert.equal(header.columns[0].image, 'club-logo');
      const grid = document.content.find(block => block.table);
      const rounds = format === 'latest' ? [model.latest] : model.rounds;
      const offset = audience === 'members' ? format === 'latest' ? 1 : 6 : format === 'latest' ? 4 : 5;
      model.result.rows.forEach((row, index) => {
        const cells = grid.table.body[index + grid.table.headerRows];
        rounds.forEach((round, roundIndex) => {
          weekendCards(row.team, round, state.identityBindings).forEach((card, playerIndex) => {
            const cell = cells[offset + roundIndex * 4 + playerIndex];
            assert.equal(cell.bold, card.counting);
            assert.equal(cell.color, card.counting ? '#1a5e1a' : '#687568');
          });
        });
      });
    }
  }
  assert.deepEqual(state, before);
});
