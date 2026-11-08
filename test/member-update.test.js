import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { emptyState, league, singles, parseCSV } from '../core.js';
import { memberUpdate } from '../member-update.js';

test('Weekend 1 member draft includes every team and individual card, leaving Weekend 2 pending', async () => {
  const state = JSON.parse(await readFile(new URL('../data/published.json', import.meta.url), 'utf8'));
  const before = structuredClone(state);
  const update = memberUpdate(state, { mode: 'draft', saved: false, pendingDate: '2026-11-07' });
  assert.equal(update.through, '2026-10-31');
  assert.deepEqual(update.result, league(state));
  assert.deepEqual(update.individual.rows, singles(state).rows);
  assert.equal(parseCSV(update.teamCSV).length, 48);
  assert.equal(parseCSV(update.singlesCSV).length, 167);
  assert.match(update.html, /DRAFT MEMBER UPDATE/);
  assert.match(update.html, /Unsaved local draft, not published/);
  assert.match(update.html, /7 November 2026: results pending/);
  assert.match(update.html, /Team 15 and Team 27 share the lead on 49/);
  assert.match(update.html, /Neiland, Michael leads with 29/);
  assert.match(update.html, /101 team-matched, 63 unmatched and 1 held/);
  assert.match(update.html, /eligibility pending confirmation by Niall/);
  assert.doesNotMatch(update.html, /[\u2013\u2014]/u);
  assert.deepEqual(state, before);
});
test('member draft with no results has no invented ranks, winners or season totals', () => {
  const state = emptyState();
  state.teams = [{ name: 'Team 1', players: ['Synthetic One', 'Synthetic Two', 'Synthetic Three'] }];
  const update = memberUpdate(state);
  assert.equal(update.through, null);
  assert.match(update.html, /await qualifying cards/);
  assert.match(update.teamCSV, /Awaiting results/);
  assert.doesNotMatch(update.html, /leads on|share the lead|leads with/);
});
test('newer cancelled, excluded and empty imports are explicit, not silently replaced by older Singles', () => {
  for (const flags of [{ canceled: true, qualifying: true }, { canceled: false, qualifying: false }, { canceled: false, qualifying: true }]) {
    const state = emptyState();
    state.teams = [{ name: 'Team 1', players: ['Synthetic One', 'Synthetic Two', 'Synthetic Three'] }];
    state.rounds = [
      { date: '2026-10-31', name: 'First', qualifying: true, canceled: false, cards: [{ player: 'Synthetic One', score: 20 }] },
      { date: '2026-11-07', name: 'Latest', ...flags, cards: [] }
    ];
    const update = memberUpdate(state);
    assert.equal(update.individual.round.date, '2026-11-07');
    assert.equal(update.individual.rows.length, 0);
    assert.equal(update.through, '2026-10-31');
    assert.match(update.html, /No individual cards are available/);
  }
});
test('member draft validates pending status and escapes user-controlled names', () => {
  const state = emptyState();
  state.teams = [{ name: '<script>Team</script>', players: ['<b>One</b>', 'Two', 'Three'] }];
  state.rounds = [{ date: '2026-10-31', name: 'First', qualifying: true, canceled: false, cards: [{ player: '<b>One</b>', score: 0 }] }];
  const update = memberUpdate(state, { mode: 'draft', saved: true });
  assert.match(update.html, /Saved local draft, not published/);
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
  const args = [script, '--out', output, '--pending-weekend', '2026-11-07'];
  const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  assert.equal((await readdir(output)).length, 3);
  const htmlPath = join(output, 'blainroe-member-update-draft-2026-10-31.html');
  const draft = await readFile(htmlPath, 'utf8');
  assert.match(draft, /results pending/);
  assert.match(draft, /Saved local draft, not published/);
  const repeated = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(repeated.status, 1);
  assert.match(repeated.stderr, /EEXIST/);
  assert.equal(await readFile(htmlPath, 'utf8'), draft);
  assert.equal(await readFile(source, 'utf8'), before);
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
